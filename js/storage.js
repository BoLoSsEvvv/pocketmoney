// Хранилище: Telegram CloudStorage (синхронизируется между устройствами) + localStorage как кэш.
// CloudStorage ограничен: 1024 ключа, значение ≤ 4096 символов. Поэтому JSON сжимается
// LZ-string в base64 и режется на куски. Куски пишутся попеременно в слот «a» или «b»,
// а ключ pm_meta переключается последним — так недописанное сохранение не портит данные.

const TG = window.Telegram?.WebApp;
const CS = TG?.CloudStorage;
export const hasCloud = !!(CS && TG.initData && TG.isVersionAtLeast?.('6.9'));

const LOCAL_KEY = 'pm_data';
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

const pack = (obj) => LZString.compressToBase64(JSON.stringify(obj));
const unpack = (str) => JSON.parse(LZString.decompressFromBase64(str));

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? unpack(raw) : null;
  } catch {
    return null;
  }
}

async function readCloud() {
  const metaRaw = await call('getItem', 'pm_meta');
  if (!metaRaw) return { data: null, meta: null };
  const meta = JSON.parse(metaRaw);
  const keys = Array.from({ length: meta.n }, (_, i) => `${meta.slot}${i}`);
  const parts = [];
  for (let i = 0; i < keys.length; i += 100) {
    const res = await call('getItems', keys.slice(i, i + 100));
    for (const k of keys.slice(i, i + 100)) parts.push(res[k] ?? '');
  }
  return { data: unpack(parts.join('')), meta };
}

let cloudMeta = null;
let needPush = false;
export const pushNeeded = () => needPush;

export async function load() {
  const local = readLocal();
  if (!hasCloud) return local;
  try {
    const { data, meta } = await readCloud();
    cloudMeta = meta;
    if (data && (!local || (data.savedAt || 0) >= (local.savedAt || 0))) return data;
    // локальная копия новее облачной (например, приложение закрыли до отправки) — дошлём
    needPush = !!local;
    return local;
  } catch (e) {
    console.warn('CloudStorage read failed', e);
    // Без локальной копии нельзя стартовать с пустыми данными: первое же сохранение
    // затёрло бы облако. Пусть приложение предложит повторить попытку.
    if (!local) throw new Error('cloud_read');
    return local;
  }
}

let pending = null;
let writing = false;
let onError = () => {};
export const setErrorHandler = (fn) => (onError = fn);

export function save(state) {
  state.savedAt = Date.now();
  const packed = pack(state);
  try {
    localStorage.setItem(LOCAL_KEY, packed);
  } catch (e) {
    console.warn('localStorage write failed', e);
  }
  if (!hasCloud) return;
  pending = packed;
  if (!writing) flush();
}

async function flush() {
  writing = true;
  while (pending) {
    const packed = pending;
    pending = null;
    try {
      await writeCloud(packed);
    } catch (e) {
      console.warn('CloudStorage write failed', e);
      onError(e);
    }
  }
  writing = false;
}

async function writeCloud(packed) {
  const n = Math.ceil(packed.length / CHUNK);
  if (n * 2 + 1 > MAX_KEYS) throw new Error('too_big');
  const slot = cloudMeta?.slot === 'a' ? 'b' : 'a';
  const writes = [];
  for (let i = 0; i < n; i++) writes.push(call('setItem', `${slot}${i}`, packed.slice(i * CHUNK, (i + 1) * CHUNK)));
  await Promise.all(writes);
  cloudMeta = { slot, n, ts: Date.now() };
  await call('setItem', 'pm_meta', JSON.stringify(cloudMeta));
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
  if (!hasCloud) return;
  const keys = await call('getKeys').catch(() => []);
  if (keys.length) await call('removeItems', keys).catch(() => {});
  cloudMeta = null;
}
