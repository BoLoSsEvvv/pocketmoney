// Резервные копии, экспорт (CSV/QIF) и импорт (JSON/QIF/CSV), демо-данные
import { h, today, addDays, addMonths, fmt, uid, pad, evalAmount, parse, iso } from './util.js';
import { t } from './i18n.js';
import * as M from './model.js';
import { actionSheet, alertBox, confirmBox, toast, push, PickerScreen } from './ui.js';

// ---------- выдача файла ----------
export async function deliverFile(name, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const file = new File([blob], name, { type: mime });
  const opts = [];
  if (navigator.canShare?.({ files: [file] })) opts.push([t('Поделиться файлом…'), async () => {
    try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name !== 'AbortError') toast(t('Не удалось поделиться')); }
  }]);
  opts.push([t('Скачать файл'), () => {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }]);
  opts.push([t('Скопировать как текст'), async () => {
    try { await navigator.clipboard.writeText(text); toast(t('Скопировано — вставьте в «Избранное» Telegram')); }
    catch { await alertBox({ title: name, message: t('Не удалось скопировать автоматически. Выделите текст вручную:'), input: { value: text.slice(0, 20000) }, buttons: [{ label: 'OK', value: true }] }); }
  }]);
  const i = await actionSheet({ title: `${name} (${Math.ceil(text.length / 1024)} КБ)`, buttons: opts.map(([label]) => ({ label })) });
  if (i != null) await opts[i][1]();
}

const stamp = () => today().replace(/-/g, '');

// ---------- CSV ----------
const sep = () => (fmt.lang === 'ru' ? ';' : ',');
const csvCell = (v) => {
  v = v == null ? '' : String(v);
  return /[;,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const num = (c) => { const s = (c / 100).toFixed(2); return fmt.lang === 'ru' ? s.replace('.', ',') : s; };

export function toCSV(entries) {
  const head = [t('Дата'), t('Счёт'), t('Номер'), t('Получатель'), t('Категория'), t('Класс'), t('Примечание'), t('Сумма'), t('Валюта'), t('Проведена')];
  const rows = [head.join(sep())];
  for (const e of entries) {
    const acc = M.account(e.acc);
    for (const l of M.linesOf(e)) {
      rows.push([e.date, acc?.name, e.t.num, M.payeeOf(e), l.category, l.cls, l.memo || e.t.memo, num(l.amt), M.curOf(acc), e.cleared ? '1' : ''].map(csvCell).join(sep()));
    }
  }
  return '﻿' + rows.join('\r\n');
}

// ---------- QIF ----------
const QIF_TYPE = { cash: 'Cash', credit: 'CCard', creditline: 'CCard', asset: 'Oth A', liability: 'Oth L' };
const qifDate = (s) => { const [y, m, d] = s.split('-'); return `${+m}/${+d}/${y}`; };
const qifNum = (c) => (c / 100).toFixed(2);

export function toQIF(accId, entries) {
  const acc = M.account(accId);
  const out = ['!Account', `N${acc.name}`, `T${QIF_TYPE[acc.type] || 'Bank'}`, '^', `!Type:${QIF_TYPE[acc.type] || 'Bank'}`];
  for (const e of entries) {
    if (e.acc !== accId) continue;
    const x = e.t;
    out.push(`D${qifDate(e.date)}`, `T${qifNum(e.amt)}`);
    if (e.cleared) out.push('C*');
    if (x.num) out.push(`N${x.num}`);
    if (x.type === 't') out.push(`P${M.accName(e.other)}`, `L[${M.accName(e.other)}]`);
    else {
      if (x.payee) out.push(`P${x.payee}`);
      if (x.splits?.length && e.dir === 'out') {
        for (const s of x.splits) {
          out.push(`S${s.category || ''}${s.cls ? '/' + s.cls : ''}`);
          if (s.memo) out.push(`E${s.memo}`);
          out.push(`$${qifNum(s.amount)}`);
        }
      } else if (x.category || x.cls) out.push(`L${x.category || ''}${x.cls ? '/' + x.cls : ''}`);
    }
    if (x.memo) out.push(`M${x.memo}`);
    out.push('^');
  }
  return out.join('\r\n') + '\r\n';
}

export function allQIF(entries) {
  return M.sortedAccounts().filter((a) => a.type !== 'online').map((a) => toQIF(a.id, entries || M.entriesOf(a.id))).join('');
}

// ---------- меню экспорта ----------
export async function exportMenu() {
  const items = [
    [t('Резервная копия (всё)'), () => backup()],
    [t('CSV — все операции'), () => deliverFile(`pocketmoney-${stamp()}.csv`, toCSV(M.allEntries()), 'text/csv')],
    [t('QIF — все счета'), () => deliverFile(`pocketmoney-${stamp()}.qif`, allQIF(), 'application/qif')],
    [t('CSV — изменения с прошлого экспорта'), () => {
      const es = M.allEntries().filter((e) => (e.t.mod || 0) > (M.state.lastExport || 0));
      if (!es.length) return toast(t('Новых изменений нет'));
      return deliverFile(`pocketmoney-changes-${stamp()}.csv`, toCSV(es), 'text/csv');
    }],
    [t('Импорт из файла…'), () => importFile()],
  ];
  const i = await actionSheet({ title: t('Экспорт и резервные копии'), buttons: items.map(([label]) => ({ label })) });
  if (i == null) return;
  await items[i][1]();
  if (i >= 1 && i <= 3) { M.state.lastExport = Date.now(); M.commit(); }
}

export async function exportEntries(entries, accId) {
  const items = [[t('CSV (Excel, Numbers)'), () => deliverFile(`pocketmoney-${stamp()}.csv`, toCSV(entries), 'text/csv')]];
  if (accId) items.push([t('QIF (Quicken, старый PocketMoney)'), () => deliverFile(`${M.accName(accId)}-${stamp()}.qif`, toQIF(accId, entries), 'application/qif')]);
  const i = await actionSheet({ title: t('Экспорт {0} операций', entries.length), buttons: items.map(([label]) => ({ label })) });
  if (i != null) items[i][1]();
}

export function backup() {
  const data = JSON.stringify({ app: 'PocketMoney-TG', v: 1, exported: new Date().toISOString(), state: M.state });
  return deliverFile(`pocketmoney-backup-${stamp()}.json`, data, 'application/json');
}

// ---------- импорт ----------
function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => {
      const f = inp.files[0];
      inp.remove();
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, text: String(r.result) });
      r.onerror = () => resolve(null);
      r.readAsText(f);
    });
    document.body.append(inp);
    inp.click();
  });
}

export async function importFile() {
  const f = await pickFile('.json,.qif,.csv,.txt,application/json,text/csv,text/plain');
  if (!f) return;
  const text = f.text.replace(/^﻿/, '');
  const ext = f.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'json' || text.trim().startsWith('{')) return await restoreBackup(text);
    if (ext === 'qif' || /^!(Type|Account)/m.test(text)) return await importQIF(text);
    return await importCSV(text);
  } catch (e) {
    console.error(e);
    alertBox({ title: t('Ошибка импорта'), message: String(e.message || e) });
  }
}

async function restoreBackup(text) {
  const j = JSON.parse(text);
  const st = j.state || j;
  if (!st.accounts || !st.txns) throw new Error(t('Это не резервная копия PocketMoney'));
  const ok = await confirmBox(t('Восстановить копию от {0}?\nСчетов: {1}, операций: {2}.\nТекущие данные будут заменены.', (j.exported || '').slice(0, 10), st.accounts.length, st.txns.length), { ok: t('Восстановить'), destructive: true });
  if (!ok) return;
  M.replaceState(st);
  toast(t('Данные восстановлены'));
}

function chooseAccount(title) {
  return new Promise((resolve) => {
    let picked = false;
    const scr = new PickerScreen({
      title, search: false, index: false,
      items: [{ value: '__new', label: t('+ Новый счёт') }, ...M.sortedAccounts().map((a) => ({ value: a.id, label: a.name, icon: a.icon }))],
      onPick: (v) => { picked = true; resolve(v); },
    });
    scr.onClose = () => { if (!picked) resolve(null); };
    push(scr);
  });
}

function parseDate(s) {
  s = s.trim().replace(/\s/g, '');
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s))) return `${yr(m[3], false)}-${pad(+m[2])}-${pad(+m[1])}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})(['/-])(\d{2,4})$/.exec(s))) return `${yr(m[4], m[3] === "'")}-${pad(+m[1])}-${pad(+m[2])}`;
  if ((m = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/.exec(s))) return `${yr(m[3], false)}-${pad(+m[1])}-${pad(+m[2])}`;
  return null;
}
function yr(y, apos) {
  y = +y;
  if (y >= 100) return y;
  if (apos) return 2000 + y;
  return y < 70 ? 2000 + y : 1900 + y;
}
function parseNum(s) {
  s = (s || '').trim().replace(/[\s ]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const v = parseFloat(s.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

export function parseQIF(text) {
  const blocks = [];
  let cur = { name: null, type: 'Bank', txns: [] };
  let x = null;
  let inAccount = false;
  let acctName = null;
  let split = null;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith('!')) {
      if (line.startsWith('!Account')) { inAccount = true; acctName = null; continue; }
      if (line.startsWith('!Type:')) {
        const ty = line.slice(6).trim();
        if (/^(Cat|Class|Memorized|Invst|Prices|Security)/i.test(ty)) { inAccount = 'skip'; continue; }
        if (cur.txns.length || cur.name) blocks.push(cur);
        cur = { name: acctName, type: ty, txns: [] };
        inAccount = false;
      }
      continue;
    }
    if (inAccount === 'skip') { if (line === '^') continue; continue; }
    if (inAccount) {
      if (line[0] === 'N') acctName = line.slice(1).trim();
      if (line === '^') inAccount = false;
      continue;
    }
    x ??= { splits: [] };
    const c = line[0], v = line.slice(1);
    switch (c) {
      case 'D': x.date = parseDate(v); break;
      case 'T': case 'U': x.amount = parseNum(v); break;
      case 'P': x.payee = v.trim(); break;
      case 'N': x.num = v.trim(); break;
      case 'M': x.memo = v.trim(); break;
      case 'C': x.cleared = v.trim() === '*' || v.trim().toUpperCase() === 'X'; break;
      case 'L': x.cat = v.trim(); break;
      case 'S': split = { cat: v.trim() }; x.splits.push(split); break;
      case 'E': if (split) split.memo = v.trim(); break;
      case '$': if (split) split.amount = parseNum(v); break;
      case '^': if (x.date && x.amount != null) cur.txns.push(x); x = null; split = null; break;
      default: break;
    }
  }
  if (cur.txns.length) blocks.push(cur);
  return blocks;
}

const splitCat = (s) => {
  const [cat, cls] = (s || '').split('/');
  return { category: cat || '', cls: cls || '' };
};

async function targetAccount(name, qifType) {
  const byName = name && M.state.accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (byName) return byName.id;
  const v = await chooseAccount(name ? t('Куда импортировать «{0}»?', name) : t('В какой счёт импортировать?'));
  if (!v) return null;
  if (v !== '__new') return v;
  const type = { Cash: 'cash', CCard: 'credit', 'Oth A': 'asset', 'Oth L': 'liability' }[qifType] || 'checking';
  return M.saveAccount({ name: name || t('Импорт'), type, icon: type === 'cash' ? '💵' : type === 'credit' ? '💳' : '🏦', worth: true, currency: M.state.settings.home, rate: 1 }).id;
}

function isDup(accId, d) {
  return M.state.txns.some((x) => x.acc === accId && x.date === d.date && Math.abs(x.amount) === Math.abs(d.amount) && (x.payee || '') === (d.payee || ''));
}

async function importQIF(text) {
  const blocks = parseQIF(text);
  if (!blocks.length) throw new Error(t('В файле нет операций'));
  let added = 0, dups = 0;
  const pendingTransfers = [];
  for (const b of blocks) {
    const accId = await targetAccount(b.name, b.type);
    if (!accId) continue;
    for (const q of b.txns) {
      const tm = /^\[(.+)\]$/.exec(q.cat || '');
      if (tm) {
        pendingTransfers.push({ accId, q, other: tm[1] });
        continue;
      }
      const d = {
        acc: accId, date: q.date, amount: Math.abs(q.amount), type: q.amount < 0 ? 'w' : 'd', payee: q.payee || '',
        num: q.num || '', memo: q.memo || '', cleared: !!q.cleared, to: null, splits: [], ...splitCat(q.cat),
      };
      if (q.splits.length > 1) {
        d.splits = q.splits.map((s) => ({ ...splitCat(s.cat), amount: s.amount || 0, memo: s.memo || '' }));
        d.category = '';
      }
      if (isDup(accId, { ...d, amount: q.amount })) { dups++; continue; }
      M.saveTxn(d, { silent: true });
      added++;
    }
  }
  // переводы: каждая пара встречается в обоих счетах — берём только уход денег
  for (const p of pendingTransfers) {
    const other = M.state.accounts.find((a) => a.name.toLowerCase() === p.other.toLowerCase());
    if (!other) {
      M.saveTxn({ acc: p.accId, date: p.q.date, amount: Math.abs(p.q.amount), type: p.q.amount < 0 ? 'w' : 'd', payee: p.other, category: '', cls: '', num: p.q.num || '', memo: p.q.memo || '', cleared: !!p.q.cleared, splits: [] }, { silent: true });
      added++;
      continue;
    }
    if (p.q.amount > 0) {
      const mirrored = pendingTransfers.some((o) => o.accId === other.id && o.q.date === p.q.date && o.q.amount === -p.q.amount);
      if (mirrored) continue;
    }
    const from = p.q.amount < 0 ? p.accId : other.id;
    const to = p.q.amount < 0 ? other.id : p.accId;
    const exists = M.state.txns.some((x) => x.type === 't' && x.acc === from && x.to === to && x.date === p.q.date && Math.abs(x.amount) === Math.abs(p.q.amount));
    if (exists) { dups++; continue; }
    M.saveTxn({ acc: from, to, type: 't', date: p.q.date, amount: Math.abs(p.q.amount), payee: '', category: '', cls: '', num: p.q.num || '', memo: p.q.memo || '', cleared: !!p.q.cleared, splits: [] }, { silent: true });
    added++;
  }
  M.commit();
  alertBox({ title: t('Импорт завершён'), message: t('Добавлено операций: {0}', added) + (dups ? '\n' + t('Пропущено дубликатов: {0}', dups) : '') });
}

function splitCSVLine(line, d) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function importCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error(t('В файле нет строк'));
  const d = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const head = splitCSVLine(lines[0], d).map((s) => s.trim().toLowerCase());
  const col = (...names) => head.findIndex((hh) => names.some((n) => hh.includes(n)));
  const ci = {
    date: col('дата', 'date'), acc: col('счёт', 'счет', 'account'), num: col('номер', 'num', 'check'),
    payee: col('получатель', 'payee', 'описание', 'description', 'контрагент'), cat: col('категория', 'category'),
    cls: col('класс', 'class'), memo: col('примечание', 'memo', 'комментарий', 'note'), amt: col('сумма', 'amount'),
    cleared: col('проведена', 'cleared'),
  };
  if (ci.date < 0 || ci.amt < 0) throw new Error(t('Нужны хотя бы колонки «Дата» и «Сумма»'));
  let fixedAcc = null;
  if (ci.acc < 0) { fixedAcc = await targetAccount(null); if (!fixedAcc) return; }
  const accCache = {};
  let added = 0, dups = 0, bad = 0;
  for (const line of lines.slice(1)) {
    const c = splitCSVLine(line, d);
    const date = parseDate(c[ci.date] || '');
    const amount = parseNum(c[ci.amt]);
    if (!date || amount == null) { bad++; continue; }
    let accId = fixedAcc;
    if (!accId) {
      const name = (c[ci.acc] || '').trim() || t('Импорт');
      accId = accCache[name] ??= M.state.accounts.find((a) => a.name === name)?.id || M.saveAccount({ name, type: 'checking', icon: '🏦', worth: true, currency: M.state.settings.home, rate: 1 }).id;
    }
    const x = {
      acc: accId, date, amount: Math.abs(amount), type: amount < 0 ? 'w' : 'd', payee: (c[ci.payee] || '').trim(),
      category: (c[ci.cat] || '').trim(), cls: (c[ci.cls] || '').trim(), num: (c[ci.num] || '').trim(), memo: (c[ci.memo] || '').trim(),
      cleared: ci.cleared >= 0 && /^(1|да|yes|true|\*|x)$/i.test((c[ci.cleared] || '').trim()), splits: [],
    };
    if (isDup(accId, x)) { dups++; continue; }
    M.saveTxn(x, { silent: true });
    added++;
  }
  M.commit();
  alertBox({ title: t('Импорт завершён'), message: t('Добавлено операций: {0}', added) + (dups ? '\n' + t('Пропущено дубликатов: {0}', dups) : '') + (bad ? '\n' + t('Не распознано строк: {0}', bad) : '') });
}

// ---------- демо-данные ----------
export function demoState() {
  const s = M.defaultState();
  s.settings = { ...M.state.settings, multiCur: true };
  const A = (name, type, icon, extra = {}) => ({ id: uid(), name, type, icon, worth: true, currency: 'RUB', rate: 1, ...extra });
  const cash = A('Наличные', 'cash', '💵');
  const card = A('Карта Сбербанк', 'checking', '💳', { institution: 'Сбербанк', fee: 5000, chk: '101' });
  const credit = A('Кредитка Тинькофф', 'credit', '💳', { limit: 15000000 });
  const save = A('Накопительный', 'savings', '🐷');
  const usd = A('Доллары', 'cash', '🇺🇸', { currency: 'USD', rate: 92.5 });
  s.accounts = [cash, card, credit, save, usd].map((a, i) => ({ ...a, order: i }));
  const txns = [];
  let seq = 0;
  const add = (acc, date, amount, payee, category, extra = {}) => {
    txns.push({ id: uid(), seq: ++seq, acc: acc.id, date, type: amount < 0 ? 'w' : 'd', amount, payee, category, cls: '', num: '', memo: '', cleared: date < addDays(today(), -3), splits: [], mod: 0, ...extra });
  };
  const start = addMonths(today().slice(0, 8) + '01', -6);
  add(card, start, 4500000, 'Начальный баланс', '', { cleared: true, opening: true });
  add(cash, start, 1500000, 'Начальный баланс', '', { cleared: true, opening: true });
  add(save, start, 30000000, 'Начальный баланс', '', { cleared: true, opening: true });
  add(usd, start, 50000, 'Начальный баланс', '', { cleared: true, opening: true });
  const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) / 10) * 1000;
  for (let d = start; d <= addDays(today(), 20); d = addDays(d, 1)) {
    const day = +d.slice(8);
    const wd = parse(d).getDay();
    if (day === 10) add(card, d, 12000000, 'ООО «Ромашка»', 'Доход:Зарплата');
    if (day === 25) add(card, d, 2350000, 'СФР', 'Доход:Пенсия');
    if (day === 12) add(card, d, -rnd(650, 900) * 10, 'ЖКХ', 'Коммунальные');
    if (day === 15) add(card, d, -69900, 'Билайн', 'Связь:Телефон');
    if (day === 16) add(card, d, -29900, 'Кинопоиск', 'Подписки');
    if (wd === 6) add(card, d, -rnd(250, 600) * 10, 'Пятёрочка', 'Еда:Продукты');
    if (wd === 3) add(cash, d, -rnd(40, 150) * 10, 'Рынок', 'Еда:Продукты');
    if (wd === 5 && Math.random() < 0.5) add(credit, d, -rnd(150, 400) * 10, 'Кафе «Пушкин»', 'Еда:Кафе и рестораны');
    if (wd === 1 && Math.random() < 0.6) add(credit, d, -rnd(250, 350) * 10, 'Лукойл', 'Авто:Бензин');
    if (day === 5 && Math.random() < 0.5) add(cash, d, -rnd(100, 400) * 10, 'Аптека 36,6', 'Здоровье:Аптека');
    if (day === 11) txns.push({ id: uid(), seq: ++seq, acc: card.id, to: save.id, type: 't', date: d, amount: -1500000, toAmount: 1500000, payee: '', category: '', cls: '', num: '', memo: 'Откладываю', cleared: true, toCleared: true, splits: [], mod: 0 });
    if (day === 3) txns.push({ id: uid(), seq: ++seq, acc: card.id, to: cash.id, type: 't', date: d, amount: -1000000, toAmount: 1000000, payee: '', category: '', cls: '', num: 'Банкомат', memo: '', cleared: true, toCleared: true, splits: [], mod: 0 });
    if (day === 20) txns.push({ id: uid(), seq: ++seq, acc: card.id, to: credit.id, type: 't', date: d, amount: -1200000, toAmount: 1200000, payee: '', category: '', cls: '', num: '', memo: '', cleared: true, toCleared: true, splits: [], mod: 0 });
  }
  add(card, addDays(today(), -9), -1234000, 'Леруа Мерлен', '', {
    splits: [{ category: 'Дом:Ремонт', amount: -954000, memo: 'краска, кисти' }, { category: 'Хобби', amount: -280000, memo: 'рассада' }], type: 'w',
  });
  s.txns = txns;
  s.seq = seq;
  s.budgets = [
    { id: uid(), category: 'Доход:Зарплата', kind: 'income', period: 'monthly', amount: 12000000, subcats: false },
    { id: uid(), category: 'Еда', kind: 'expense', period: 'monthly', amount: 3000000, subcats: true },
    { id: uid(), category: 'Авто', kind: 'expense', period: 'monthly', amount: 1000000, subcats: true },
    { id: uid(), category: 'Коммунальные', kind: 'expense', period: 'monthly', amount: 900000, subcats: true },
    { id: uid(), category: 'Подписки', kind: 'expense', period: 'monthly', amount: 50000, subcats: false },
  ];
  s.payees = ['ООО «Ромашка»', 'СФР', 'ЖКХ', 'Билайн', 'Кинопоиск', 'Пятёрочка', 'Рынок', 'Кафе «Пушкин»', 'Лукойл', 'Аптека 36,6', 'Леруа Мерлен'].sort();
  s.categories = [...new Set([...s.categories, 'Хобби', 'Дом:Ремонт'])].sort((a, b) => a.localeCompare(b, 'ru'));
  return s;
}
