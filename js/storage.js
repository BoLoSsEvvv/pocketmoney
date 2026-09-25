// Хранилище: Telegram CloudStorage (синхронизируется между устройствами) + localStorage как кэш.
// CloudStorage ограничен: 1024 ключа, значение ≤ 4096 символов. Поэтому JSON сжимается
// LZ-string в base64 и режется на куски. Куски пишутся попеременно в слот «a» или «b»,
// а ключ pm_meta переключается последним — так недописанное сохранение не портит данные.
// Локальная копия помнит (pm_sync), от какой облачной версии она произошла. В облако она уходит,
// только если там всё ещё эта версия, — иначе затёрли бы изменения с другого устройства.

const TG = window.Telegram?.WebApp;
const CS = TG?.CloudStorage;
export const hasCloud = !!(CS && TG.initData && TG.isVersionAtLeast?.('6.9'));

const LOCAL_KEY = 'pm_data';
const SYNC_KEY = 'pm_sync'; // { m: pm_meta версии-основы ('' — облако было пусто, null — неизвестно), d: есть неотправленное }
const ASIDE_KEY = 'pm_aside'; // локальная копия, уступившая облаку (на всякий случай)
const CHUNK = 4000;
const MAX_KEYS = 1000;

const call = (method, ...args) =>
  new Promise((resolve, reject) => {
    try {
      CS[method](...args, (err, res) => (err ? reject(new Error(String(err))) : resolve(res)));
    } catch (e) {
      reject(e);
    }
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pack = (obj) => LZString.compressToBase64(JSON.stringify(obj));
const unpack = (str) => JSON.parse(LZString.decompressFromBase64(str));

function readLocal() {
  try {
    const packed = localStorage.getItem(LOCAL_KEY);
    const data = packed && unpack(packed);
    return data ? { packed, data } : null;
  } catch {
    return null;
  }
}

function readSync() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY));
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

// Читает слот целиком. Все куски, кроме последнего, ровно по CHUNK символов — иначе слот недописан.
// scan: число кусков неизвестно (берём подряд идущие ключи до первого неполного куска).
async function readSlot(slot, n, scan) {
  const keys = Array.from({ length: n }, (_, i) => `${slot}${i}`);
  let parts = [];
  for (let i = 0; i < keys.length; i += 100) {
    const res = await call('getItems', keys.slice(i, i + 100));
    for (const k of keys.slice(i, i + 100)) parts.push(res?.[k] || '');
  }
  if (scan) parts = parts.slice(0, parts.findIndex((p) => p.length < CHUNK) + 1 || n);
  let data = null;
  try {
    if (!parts.some((p, i) => !p || p.length > CHUNK || (i < parts.length - 1 && p.length < CHUNK))) data = unpack(parts.join(''));
  } catch {}
  if (!data || typeof data !== 'object' || !Array.isArray(data.accounts)) throw new Error('bad_slot');
  return { slot, data, packed: parts.join('') };
}

async function readCloud() {
  let raw, meta;
  for (let a = 0; a < 2; a++) {
    raw = (await call('getItem', 'pm_meta')) || '';
    if (!raw) break;
    try { meta = JSON.parse(raw); } catch { meta = null; }
    if (/^[ab]$/.test(meta?.slot) && meta.n > 0 && meta.n <= MAX_KEYS) {
      try {
        return { raw, ...(await readSlot(meta.slot, meta.n)) };
      } catch (e) {
        if (e.message !== 'bad_slot') throw e;
      }
    }
    console.warn('CloudStorage: damaged', raw);
  }
  // pm_meta пуст/испорчен или его слот не читается: ищем целую копию в обоих слотах, берём новейшую
  const keys = await call('getKeys');
  let best = null;
  for (const slot of ['a', 'b']) {
    let n = 0;
    while (keys.includes(slot + n)) n++;
    const r = n && (await readSlot(slot, n, true).catch((e) => { if (e.message !== 'bad_slot') throw e; }));
    if (r && (!best || (r.data.savedAt || 0) > (best.data.savedAt || 0))) best = r;
  }
  if (best) return { raw, ...best, damaged: best.slot !== meta?.slot };
  // pm_meta есть, а данных не прочитать — пустыми стартовать нельзя
  if (raw) throw new Error('cloud_damaged');
  return { raw, slot: null, data: null };
}

let base = null; // pm_meta облачной версии, от которой происходят наши данные
let keep = null; // слот с целой копией, который нельзя перезаписывать
let tried = null; // pm_meta, который пытались записать: мог дойти, хоть и с ошибкой
let localOk = true;
let needPush = false;
export let notice = ''; // что сказать при запуске: offline | aside | backup
export const pushNeeded = () => needPush;

function markSync(d) {
  if (!localOk) return; // локальная копия не записалась — не выдаём её за наследницу base
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ m: base, d }));
  } catch {}
}

function writeLocal(packed, d) {
  try {
    localStorage.setItem(LOCAL_KEY, packed);
    localOk = true;
  } catch (e) {
    console.warn('localStorage write failed', e);
    localOk = false;
  }
  markSync(d);
}

export async function load() {
  const local = readLocal();
  const sync = local && readSync();
  base = sync?.m ?? null;
  if (!hasCloud) return local?.data ?? null;
  let c;
  for (let a = 0; !c; a++) {
    try {
      c = await readCloud();
    } catch (e) {
      console.warn('CloudStorage read failed', e);
      if (!a) { await sleep(700); continue; }
      // Без локальной копии нельзя стартовать с пустыми данными: первое же сохранение
      // затёрло бы облако. Пусть приложение предложит повторить попытку.
      if (!local) throw new Error('cloud_read');
      // С локальной копией работаем, но в облако она уйдёт, только если оно не менялось (см. writeCloud)
      notice = 'offline';
      return local.data;
    }
  }
  keep = c.slot;
  if (!c.data) {
    // облако пусто — затирать нечего, локальную копию (если есть) отправим
    base = '';
    needPush = !!local;
    return local?.data ?? null;
  }
  base = c.raw;
  // локальная копия от этой же облачной версии? (у копий без pm_sync сверяем savedAt)
  const own = local && (sync ? sync.m === c.raw : local.data.savedAt === c.data.savedAt);
  if (own && (sync?.d || c.damaged)) {
    // в ней есть неотправленные изменения (или облачная копия испорчена) — дошлём
    needPush = true;
    return local.data;
  }
  if (local && !own && (sync ? sync.d : (local.data.savedAt || 0) > (c.data.savedAt || 0))) {
    // неотправленные изменения не от этой облачной версии: облако важнее, копию откладываем
    try {
      localStorage.setItem(ASIDE_KEY, local.packed);
    } catch {}
    notice = 'aside';
  }
  if (c.damaged) notice = 'backup';
  writeLocal(c.packed, false);
  return c.data;
}

let pending = null;
let unsent = null; // последняя версия, ещё не записанная в облако
let writing = false;
let onError = () => {};
let onConflict = async () => false; // облако изменилось не нами: true — всё равно записать свою версию
export const setErrorHandler = (fn) => (onError = fn);
export const setConflictHandler = (fn) => (onConflict = fn);

export function save(state) {
  state.savedAt = Date.now();
  const packed = pack(state);
  writeLocal(packed, true);
  if (!hasCloud) return;
  pending = unsent = packed;
  if (!writing) flush();
}

// повторить неудавшуюся отправку (например, при возврате в приложение)
export function retry() {
  if (unsent && !writing) {
    pending = unsent;
    flush();
  }
}

// пока идёт запись в облако, Telegram переспросит при закрытии
function closing(on) {
  try {
    if (TG.isVersionAtLeast?.('6.2')) TG[on ? 'enableClosingConfirmation' : 'disableClosingConfirmation']();
  } catch {}
}

async function flush() {
  writing = true;
  closing(true);
  while (pending) {
    const packed = pending;
    pending = null;
    try {
      await writeCloud(packed);
      if (unsent === packed) unsent = null;
      markSync(!!unsent);
    } catch (e) {
      console.warn('CloudStorage write failed', e);
      onError(e);
    }
  }
  writing = false;
  closing(false);
}

// Куски пишем по нескольку за раз с повторами: сотни запросов разом упираются в лимиты Telegram.
// Ошибка — только когда все запросы завершены, чтобы запоздалый кусок не испортил следующую запись.
async function putAll(items) {
  let i = 0;
  let err = null;
  const worker = async () => {
    while (!err && i < items.length) {
      const [k, v] = items[i++];
      for (let a = 1; ; a++) {
        try {
          await call('setItem', k, v);
          break;
        } catch (e) {
          if (a >= 3 || err) { err ??= e; break; }
          await sleep(500 * a);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (err) throw err;
}

async function writeCloud(packed) {
  const n = Math.ceil(packed.length / CHUNK);
  if (n * 2 + 1 > MAX_KEYS) throw new Error('too_big');
  // Сверяемся с облаком прямо перед записью: пишем, только если там версия, от которой наши данные
  const raw = (await call('getItem', 'pm_meta')) || '';
  if (raw !== base) {
    if (raw && raw === tried?.m) keep = tried.slot; // прошлая запись pm_meta дошла, хоть и с ошибкой
    else {
      const busy = raw || (await call('getKeys')).some((k) => /^[ab]\d+$/.test(k));
      if (busy && !(await onConflict())) throw new Error('conflict');
      keep = null;
    }
    base = raw;
    markSync(true);
  }
  let slot = keep;
  if (!slot) try { slot = JSON.parse(raw).slot; } catch {}
  slot = slot === 'a' ? 'b' : 'a';
  await putAll(Array.from({ length: n }, (_, i) => [`${slot}${i}`, packed.slice(i * CHUNK, (i + 1) * CHUNK)]));
  const m = JSON.stringify({ slot, n, ts: Date.now() });
  tried = { m, slot };
  await call('setItem', 'pm_meta', m);
  // слот и основу меняем только после записи pm_meta
  base = m;
  keep = slot;
  tried = null;
  // Предыдущий слот остаётся нетронутым (резервная копия). В текущем убираем лишние куски,
  // оставшиеся от более длинной старой записи.
  const keys = await call('getKeys').catch(() => []);
  const stale = keys.filter((k) => {
    const m = /^([ab])(\d+)$/.exec(k);
    return m && m[1] === slot && +m[2] >= n;
  });
  if (stale.length) await call('removeItems', stale).catch(() => {});
}

export function sizeInfo(state) {
  const len = pack(state).length;
  return { bytes: len, chunks: Math.ceil(len / CHUNK), maxChunks: Math.floor((MAX_KEYS - 1) / 2) };
}

export async function wipe() {
  localStorage.removeItem(LOCAL_KEY);
  localStorage.removeItem(SYNC_KEY);
  if (!hasCloud) return;
  const keys = await call('getKeys').catch(() => []);
  if (keys.length) await call('removeItems', keys).catch(() => {});
  base = '';
  keep = null;
}
