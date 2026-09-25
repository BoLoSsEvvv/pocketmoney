// Модель данных PocketMoney: счета, операции, повторы, бюджеты, фильтры, списки.
import {
  uid, clone, today, addDays, addMonths, parse, iso, diffDays, weekday, monthsBetween,
  weekStart, monthStart, wildcard, fmt, evalAmount,
} from './util.js';
import * as storage from './storage.js';
import { t } from './i18n.js';

export const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'credit', 'creditline', 'moneymarket', 'asset', 'liability', 'online'];
export const TYPE_GROUP = {
  checking: 'bank', savings: 'bank', moneymarket: 'bank', cash: 'cash', credit: 'credit',
  creditline: 'credit', asset: 'asset', liability: 'liability', online: 'online',
};
export const GROUPS = ['bank', 'cash', 'credit', 'asset', 'liability', 'online'];
const CREDITISH = new Set(['credit', 'creditline', 'liability']);
export const isCreditish = (acc) => CREDITISH.has(acc.type);

export const BALANCE_TYPES = ['current', 'cleared', 'future', 'available'];

const DEFAULT_CATEGORIES = [
  'Авто', 'Авто:Бензин', 'Авто:Обслуживание', 'Банк:Комиссии', 'Благотворительность', 'Дети', 'Дом',
  'Дом:Аренда', 'Дом:Ремонт', 'Еда', 'Еда:Кафе и рестораны', 'Еда:Продукты', 'Здоровье', 'Здоровье:Аптека',
  'Коммунальные', 'Коммунальные:Электричество', 'Коммунальные:Вода', 'Коммунальные:Газ', 'Связь:Телефон',
  'Связь:Интернет', 'Налоги', 'Образование', 'Одежда', 'Отдых', 'Подарки', 'Подписки', 'Путешествия',
  'Развлечения', 'Разное', 'Страхование', 'Транспорт', 'Хобби', 'Доход:Зарплата', 'Доход:Пенсия',
  'Доход:Проценты', 'Доход:Прочее',
];

export function defaultSettings() {
  return {
    lang: 'ru', home: 'RUB', multiCur: false, autoRates: false,
    theme: 'blue', rowStyle: 'normal', toggleStyle: 'ring', fontSize: 16,
    redWithdrawals: false, blackDeposits: false, parens: true,
    secondBalance: true, balanceType: 'cleared', balanceType2: 'current',
    groupByType: false, collapsed: {}, showAccounts: 'all', futureDays: 30, accountsChart: 'none',
    showAllTx: true, showFilters: true, showRepeating: true,
    regSort: 'date', regAsc: true,
    regFields: { num: true, category: true, memo: false, cls: false, balance: true },
    txnFields: { num: true, cleared: true, memo: true, cls: true },
    categoryFirst: false, showTime: false,
    autocomplete: true, addToLists: true, clearAmountOnAuto: false, clearSplitsOnAuto: false,
    lastDate: false, focusFirst: 'payee',
    postRepeats: true, advanceDays: 15,
    passHash: null, passDelay: 0,
    budget: {
      start: today().slice(0, 4) + '-01-01', view: 'monthly', sort: 'category', hideZero: false,
      showUnbudgeted: true, includeUnbudgeted: false, cents: false, allAccounts: true,
      rightCol: 'balance', footer: 'saved', collapsed: {},
    },
    reportSort: 'amount', reportChart: 'pie', groupSubcats: false, reportPeriod: 'all',
  };
}

export function defaultState() {
  return {
    v: 1, seq: 0, savedAt: 0, lastExport: 0,
    settings: defaultSettings(),
    accounts: [
      { id: uid(), name: 'Наличные', type: 'cash', icon: '💵', worth: true, currency: 'RUB', rate: 1, order: 0 },
      { id: uid(), name: 'Карта', type: 'checking', icon: '💳', worth: true, currency: 'RUB', rate: 1, order: 1 },
    ],
    txns: [], repeats: [], budgets: [], filters: [],
    payees: [], categories: [...DEFAULT_CATEGORIES], classes: ['Личное', 'Работа'], ids: ['Банкомат', 'Онлайн', 'СБП'],
    lastDates: {},
  };
}

export let state = null;
const listeners = new Set();
let version = 0;
export const onChange = (fn) => listeners.add(fn);

function migrate(s) {
  const d = defaultState();
  s.settings = { ...d.settings, ...s.settings, budget: { ...d.settings.budget, ...(s.settings?.budget || {}) } };
  for (const k of ['accounts', 'txns', 'repeats', 'budgets', 'filters', 'payees', 'categories', 'classes', 'ids'])
    s[k] ??= [];
  s.lastDates ??= {};
  s.seq ??= s.txns.length;
  return s;
}

export async function load() {
  const data = await storage.load();
  state = data ? migrate(data) : defaultState();
  applyFmt();
  if (postDueRepeats()) storage.save(state);
  version++;
  return state;
}

export function applyFmt() {
  fmt.lang = state.settings.lang;
  fmt.parens = state.settings.parens;
  fmt.home = state.settings.home;
}

// Любое изменение данных → сохранить и перерисовать.
export function commit() {
  version++;
  cache = null;
  applyFmt();
  storage.save(state);
  for (const fn of listeners) fn();
}

export function replaceState(s) {
  state = migrate(s);
  commit();
}

// ---------- счета ----------
export const account = (id) => state.accounts.find((a) => a.id === id);
export const accName = (id) => account(id)?.name ?? t('(удалённый счёт)');
export const sortedAccounts = () => [...state.accounts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export function visibleAccounts() {
  const mode = state.settings.showAccounts;
  return sortedAccounts().filter((a) => {
    if (mode === 'worth') return a.worth;
    if (mode === 'nonzero') return a.type === 'online' || balance(a.id, 'current') !== 0;
    return true;
  });
}

export function rateOf(acc) {
  if (!acc || !state.settings.multiCur || !acc.currency || acc.currency === state.settings.home) return 1;
  return acc.rate || 1;
}
export const curOf = (acc) => (state.settings.multiCur && acc?.currency ? acc.currency : state.settings.home);
export const toHome = (cents, acc) => Math.round(cents * rateOf(acc));
export function convert(cents, fromId, toId) {
  const a = account(fromId), b = account(toId);
  return Math.round((cents * rateOf(a)) / rateOf(b));
}

export function saveAccount(a) {
  if (!a.id) {
    a.id = uid();
    a.order = Math.max(-1, ...state.accounts.map((x) => x.order ?? 0)) + 1;
    state.accounts.push(a);
  } else {
    const i = state.accounts.findIndex((x) => x.id === a.id);
    state.accounts[i] = a;
  }
  commit();
  return a;
}

export function deleteAccount(id) {
  state.accounts = state.accounts.filter((a) => a.id !== id);
  state.txns = state.txns.filter((x) => x.acc !== id && x.to !== id);
  state.repeats = state.repeats.filter((r) => r.tpl.acc !== id && r.tpl.to !== id);
  commit();
}

export function reorderAccounts(ids) {
  ids.forEach((id, i) => { const a = account(id); if (a) a.order = i; });
  commit();
}

// ---------- записи (операция глазами одного счёта) ----------
let cache = null;
function build() {
  const all = [];
  const byAcc = new Map();
  const push = (e) => {
    all.push(e);
    if (!byAcc.has(e.acc)) byAcc.set(e.acc, []);
    byAcc.get(e.acc).push(e);
  };
  for (const x of state.txns) {
    push({ key: x.id + 'o', t: x, acc: x.acc, amt: x.amount, cleared: !!x.cleared, dir: 'out', other: x.type === 't' ? x.to : null, date: x.date });
    if (x.type === 't' && x.to)
      push({ key: x.id + 'i', t: x, acc: x.to, amt: x.toAmount ?? -x.amount, cleared: !!x.toCleared, dir: 'in', other: x.acc, date: x.date });
  }
  const cmp = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.t.seq ?? 0) - (b.t.seq ?? 0));
  all.sort(cmp);
  for (const list of byAcc.values()) list.sort(cmp);
  return { all, byAcc, bal: new Map() };
}
function C() { return (cache ??= build()); }
export const allEntries = () => C().all;
export const entriesOf = (accId) => C().byAcc.get(accId) || [];

export const isTransfer = (e) => e.t.type === 't';
export const payeeOf = (e) => (e.t.type === 't' ? `<${accName(e.other)}>` : e.t.payee || '');

export function linesOf(e) {
  const x = e.t;
  if (x.splits?.length && e.dir === 'out')
    return x.splits.map((s, i) => ({ e, i, amt: s.amount, category: s.category || '', cls: s.cls || x.cls || '', memo: s.memo || '' }));
  return [{ e, i: -1, amt: e.amt, category: x.category || '', cls: x.cls || '', memo: x.memo || '' }];
}

export function futureLimit() {
  const d = state.settings.futureDays;
  return d ? addDays(today(), d) : '9999-12-31';
}

export function balance(accId, type = 'current') {
  const c = C();
  const key = accId + type;
  if (c.bal.has(key)) return c.bal.get(key);
  const acc = account(accId);
  let s = 0;
  if (type === 'available') {
    const cur = balance(accId, 'current');
    const lim = acc?.limit || 0;
    s = isCreditish(acc) ? cur + lim : cur - lim;
  } else {
    const td = type === 'future' ? futureLimit() : today();
    for (const e of entriesOf(accId)) {
      if (type === 'cleared' ? e.cleared : e.date <= td) s += e.amt;
    }
  }
  c.bal.set(key, s);
  return s;
}

export function totalBalance(type) {
  let s = 0;
  for (const a of state.accounts) if (a.worth && a.type !== 'online') s += toHome(balance(a.id, type), a);
  return s;
}

export function overLimit(acc, bal) {
  if (!acc || acc.limit == null || acc.limit === '') return false;
  return isCreditish(acc) ? bal < -acc.limit : bal < acc.limit;
}

export function balanceLabel(type, acc) {
  return {
    current: t('Текущий баланс'), cleared: t('Проведённый баланс'), future: t('Будущий баланс'),
    available: acc && isCreditish(acc) ? t('Доступный кредит') : t('Доступно'),
  }[type];
}

// ---------- операции ----------
export const txn = (id) => state.txns.find((x) => x.id === id);

export function newTxnDraft(accId, type = 'w') {
  const s = state.settings;
  const date = s.lastDate && state.lastDates.date ? state.lastDates.date : today();
  return {
    acc: accId || sortedAccounts()[0]?.id, type, date, amount: 0, payee: '', category: '', cls: '',
    num: '', memo: '', cleared: false, to: null, toAmount: null, toCleared: false, splits: [],
  };
}

function normalize(d) {
  const x = clone(d);
  delete x.repeat;
  delete x._touched;
  if (x.type === 't') {
    x.splits = [];
    x.payee = '';
    x.amount = -Math.abs(x.amount);
    x.toCleared = !!x.cleared; // перевод проводится сразу на обоих счетах
    const acc = account(x.acc), to = account(x.to);
    if (!state.settings.multiCur || curOf(acc) === curOf(to) || x.toAmount == null) x.toAmount = convert(-x.amount, x.acc, x.to);
    else x.toAmount = Math.abs(x.toAmount);
  } else if (x.splits?.length) {
    x.amount = x.splits.reduce((a, s) => a + s.amount, 0);
    x.type = x.amount < 0 ? 'w' : 'd';
    x.category = '';
    x.to = null;
  } else {
    x.amount = x.type === 'w' ? -Math.abs(x.amount) : Math.abs(x.amount);
    x.to = null;
  }
  return x;
}

export function addToLists(x) {
  if (!state.settings.addToLists) return;
  const add = (list, v) => {
    v = (v || '').trim();
    if (v && !list.some((i) => i.toLowerCase() === v.toLowerCase())) {
      list.push(v);
      list.sort((a, b) => a.localeCompare(b, fmt.lang));
    }
  };
  if (x.type !== 't') add(state.payees, x.payee);
  const cats = [x.category, ...(x.splits || []).map((s) => s.category)].filter(Boolean);
  for (const c of cats) {
    const parts = c.split(':');
    for (let i = 1; i <= parts.length; i++) add(state.categories, parts.slice(0, i).join(':'));
  }
  add(state.classes, x.cls);
  for (const s of x.splits || []) add(state.classes, s.cls);
  if (x.num && !/^\d+$/.test(x.num)) add(state.ids, x.num);
}

// Сохранить операцию. Возвращает сохранённую запись.
export function saveTxn(d, { silent } = {}) {
  const x = normalize(d);
  x.mod = Date.now();
  if (!x.id) {
    x.id = uid();
    x.seq = ++state.seq;
    state.txns.push(x);
  } else {
    const i = state.txns.findIndex((y) => y.id === x.id);
    if (i >= 0) state.txns[i] = x;
    else state.txns.push(x);
  }
  // номер чека: запоминаем следующий
  if (/^\d+$/.test(x.num || '')) {
    const acc = account(x.acc);
    if (acc && (!acc.chk || +x.num >= +acc.chk)) acc.chk = String(+x.num + 1);
  }
  state.lastDates.date = x.date;
  addToLists(x);
  if (!silent) commit();
  return x;
}

export function deleteTxn(id) {
  state.txns = state.txns.filter((x) => x.id !== id);
  commit();
}

export function toggleCleared(e) {
  if (e.t.type === 't') e.t.cleared = e.t.toCleared = !e.cleared; // обе стороны перевода
  else e.t.cleared = !e.t.cleared;
  e.t.mod = Date.now();
  commit();
}

// Автозаполнение: последняя операция с таким получателем
export function lastByPayee(payee) {
  if (!payee) return null;
  const p = payee.trim().toLowerCase();
  let best = null;
  for (const x of state.txns) {
    if (x.type !== 't' && (x.payee || '').toLowerCase() === p) {
      if (!best || x.date > best.date || (x.date === best.date && (x.seq ?? 0) > (best.seq ?? 0))) best = x;
    }
  }
  return best;
}

// Какие категории встречались у получателя и наоборот (для связанных списков)
export function linkedValues(field, byField, value) {
  const out = new Set();
  if (!value) return [];
  const v = value.toLowerCase();
  for (const x of state.txns) {
    const lines = x.splits?.length ? x.splits.map((s) => ({ category: s.category, payee: x.payee, cls: s.cls || x.cls })) : [x];
    for (const l of lines) if ((l[byField] || '').toLowerCase() === v && l[field]) out.add(l[field]);
  }
  return [...out].sort((a, b) => a.localeCompare(b, fmt.lang));
}

// ---------- повторяющиеся операции ----------
export const FREQS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

function nthWeekdayOfMonth(y, m, wd, nth) {
  if (nth >= 5) {
    const d = new Date(y, m + 1, 0, 12);
    while (d.getDay() !== wd) d.setDate(d.getDate() - 1);
    return d;
  }
  const d = new Date(y, m, 1, 12);
  while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + (nth - 1) * 7);
  return d;
}

function monthOccurrence(r, k) {
  const S = parse(r.start);
  if (r.monthMode === 'weekday') {
    const nth = Math.ceil(S.getDate() / 7);
    const t0 = new Date(S.getFullYear(), S.getMonth() + k, 1, 12);
    return iso(nthWeekdayOfMonth(t0.getFullYear(), t0.getMonth(), S.getDay(), nth));
  }
  return addMonths(r.start, k, S.getDate());
}

// Первая дата повтора строго после d (или сама дата начала, если d раньше неё).
export function occurrenceAfter(r, d) {
  const every = Math.max(1, r.every || 1);
  if (d < r.start && r.freq !== 'weekly') return r.start;
  switch (r.freq) {
    case 'daily': {
      const k = Math.floor(diffDays(r.start, d) / every) + 1;
      return addDays(r.start, k * every);
    }
    case 'weekly': {
      const days = r.days?.length ? r.days : [weekday(r.start)];
      const ws = weekStart(r.start);
      let x = d < r.start ? addDays(r.start, -1) : d;
      for (let i = 0; i < 7 * every + 8; i++) {
        x = addDays(x, 1);
        if (x < r.start) continue;
        const w = Math.floor(diffDays(ws, weekStart(x)) / 7);
        if (w % every === 0 && days.includes(weekday(x))) return x;
      }
      return null;
    }
    case 'monthly':
    case 'yearly': {
      const step = r.freq === 'yearly' ? 12 * every : every;
      let k = Math.max(0, Math.floor(monthsBetween(r.start, d) / step) * step - step);
      for (let guard = 0; guard < 10; guard++, k += step) {
        const x = r.freq === 'yearly' ? addMonths(r.start, k, parse(r.start).getDate()) : monthOccurrence(r, k);
        if (x > d) return x;
      }
      return null;
    }
    default:
      return null;
  }
}

export function repeatLabel(r) {
  if (!r || r.freq === 'none') return t('Нет');
  const n = r.every || 1;
  const base = { daily: t('Ежедневно'), weekly: t('Еженедельно'), monthly: t('Ежемесячно'), yearly: t('Ежегодно') }[r.freq];
  if (n === 1) return base;
  if (r.freq === 'weekly' && n === 2) return t('Раз в 2 недели');
  const unit = { daily: t('дн.'), weekly: t('нед.'), monthly: t('мес.'), yearly: t('г.') }[r.freq];
  return t('Каждые {0} {1}', n, unit);
}

export function postDueRepeats(until) {
  if (!state.settings.postRepeats && !until) return 0;
  const limit = until || addDays(today(), state.settings.advanceDays || 0);
  let posted = 0;
  for (const r of [...state.repeats]) {
    let guard = 0;
    while (r.next && r.next <= limit && guard++ < 1000) {
      if (r.end && r.next > r.end) { r.next = null; break; }
      const d = clone(r.tpl);
      d.date = r.next;
      d.rep = r.id;
      d.cleared = false;
      d.toCleared = false;
      saveTxn(d, { silent: true });
      posted++;
      r.next = occurrenceAfter(r, r.next);
      if (r.end && r.next && r.next > r.end) r.next = null;
    }
    if (!r.next) state.repeats = state.repeats.filter((x) => x !== r);
  }
  if (posted) {
    cache = null;
    version++;
  }
  return posted;
}

export const repeat = (id) => state.repeats.find((r) => r.id === id);

export function templateOf(x) {
  const tpl = clone(x);
  for (const k of ['id', 'seq', 'mod', 'rep', 'date', 'repeat', '_touched']) delete tpl[k];
  return tpl;
}

// Настроить повтор для операции (d — черновик с полем repeat).
export function applyRepeat(x, rule, existingId) {
  if (!rule || rule.freq === 'none') {
    if (existingId) removeRepeat(existingId);
    return null;
  }
  let r = existingId && repeat(existingId);
  const lastPosted = state.txns.filter((y) => y.rep === existingId).reduce((m, y) => (y.date > m ? y.date : m), x.date);
  if (!r) {
    r = { id: uid() };
    state.repeats.push(r);
  }
  Object.assign(r, { freq: rule.freq, every: rule.every || 1, end: rule.end || null, days: rule.days || [], monthMode: rule.monthMode || 'date' });
  r.start = x.date;
  r.tpl = templateOf(x);
  r.next = occurrenceAfter(r, lastPosted);
  if (r.end && r.next && r.next > r.end) r.next = null;
  if (!r.next) {
    state.repeats = state.repeats.filter((y) => y !== r);
    return null;
  }
  return r;
}

export const normalizeTxn = (d) => normalize(d);

// Сохранить шаблон повторяющейся операции (экран «Повторяющиеся операции»)
export function saveRepeatTemplate(d, rule, id) {
  const x = normalize(d);
  let r = id && repeat(id);
  if (!rule || rule.freq === 'none') {
    if (r) removeRepeat(id);
    commit();
    return null;
  }
  if (!r) {
    r = { id: uid() };
    state.repeats.push(r);
  }
  Object.assign(r, {
    freq: rule.freq, every: rule.every || 1, end: rule.end || null, days: rule.days || [], monthMode: rule.monthMode || 'date',
    start: x.date, next: x.date, tpl: templateOf(x),
  });
  addToLists(x);
  postDueRepeats();
  commit();
  return r;
}

export function ruleOf(r) {
  return r ? { freq: r.freq, every: r.every || 1, end: r.end || null, days: [...(r.days || [])], monthMode: r.monthMode || 'date' } : { freq: 'none', every: 1, end: null, days: [], monthMode: 'date' };
}

export function removeRepeat(id) {
  state.repeats = state.repeats.filter((r) => r.id !== id);
  for (const x of state.txns) if (x.rep === id) delete x.rep;
}

// ---------- периоды ----------
export const PERIODS = {
  daily: { d: 1 }, weekly: { d: 7 }, biweekly: { d: 14 }, monthly: { m: 1 }, bimonthly: { m: 2 },
  quarterly: { m: 3 }, halfyear: { m: 6 }, yearly: { m: 12 },
};
const AVG_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30.436875, bimonthly: 60.87375, quarterly: 91.310625, halfyear: 182.62125, yearly: 365.2425 };

export function periodRange(kind, date, anchor) {
  const p = PERIODS[kind];
  if (p.d) {
    const n = Math.floor(diffDays(anchor, date) / p.d);
    const start = addDays(anchor, n * p.d);
    return { start, end: addDays(start, p.d - 1) };
  }
  const dom = parse(anchor).getDate();
  let n = monthsBetween(anchor, date);
  if (addMonths(anchor, n, dom) > date) n--;
  n = Math.floor(n / p.m) * p.m;
  const start = addMonths(anchor, n, dom);
  return { start, end: addDays(addMonths(anchor, n + p.m, dom), -1) };
}
export function shiftPeriod(kind, range, dir, anchor) {
  return periodRange(kind, dir > 0 ? addDays(range.end, 1) : addDays(range.start, -1), anchor);
}
export function prorate(amount, from, to) {
  if (from === to) return amount;
  return Math.round((amount * AVG_DAYS[to]) / AVG_DAYS[from]);
}

// ---------- бюджеты ----------
export function saveBudget(b) {
  if (!b.id) { b.id = uid(); state.budgets.push(b); }
  else state.budgets[state.budgets.findIndex((x) => x.id === b.id)] = b;
  commit();
}

const inCat = (cat, parent, subs) => cat === parent || (subs && cat.startsWith(parent + ':'));

export function budgetView(range) {
  const bs = state.settings.budget;
  const accOk = (id) => {
    const a = account(id);
    return a && (bs.allAccounts || a.worth);
  };
  const sums = new Map();
  for (const e of allEntries()) {
    if (e.date < range.start || e.date > range.end || !accOk(e.acc)) continue;
    if (e.dir === 'in' && accOk(e.other)) continue;
    for (const l of linesOf(e)) {
      if (!l.category) continue;
      sums.set(l.category, (sums.get(l.category) || 0) + toHome(l.amt, account(e.acc)));
    }
  }
  const view = bs.view;
  const items = state.budgets.map((b) => {
    let raw = 0;
    for (const [cat, v] of sums) if (inCat(cat, b.category, b.subcats)) raw += v;
    const actual = b.kind === 'income' ? raw : -raw;
    return { b, actual, budget: prorate(b.amount, b.period, view) };
  });
  const covered = (cat) => state.budgets.some((b) => inCat(cat, b.category, b.subcats));
  const unbudgeted = [];
  for (const [cat, v] of sums) if (!covered(cat) && v !== 0) unbudgeted.push({ category: cat, actual: v });
  return { items, unbudgeted };
}

// ---------- фильтры ----------
export const DATE_PRESETS = ['all', 'today', 'thisWeek', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'lastYear', 'last30', 'last12', 'custom', 'recent'];
export const datePresetLabel = (p) => ({
  all: t('Все даты'), today: t('Сегодня'), thisWeek: t('Эта неделя'), thisMonth: t('Этот месяц'),
  lastMonth: t('Прошлый месяц'), thisQuarter: t('Этот квартал'), thisYear: t('Этот год'), lastYear: t('Прошлый год'),
  last30: t('Последние 30 дней'), last12: t('Последние 12 месяцев'), custom: t('Период…'), recent: t('Недавние изменения'),
}[p]);

export function presetRange(p, from, to) {
  const td = today();
  const y = td.slice(0, 4);
  switch (p) {
    case 'today': return { from: td, to: td };
    case 'thisWeek': { const s = weekStart(td); return { from: s, to: addDays(s, 6) }; }
    case 'thisMonth': return { from: monthStart(td), to: addDays(addMonths(monthStart(td), 1), -1) };
    case 'lastMonth': { const s = addMonths(monthStart(td), -1); return { from: s, to: addDays(monthStart(td), -1) }; }
    case 'thisQuarter': { const r = periodRange('quarterly', td, '2000-01-01'); return { from: r.start, to: r.end }; }
    case 'thisYear': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'lastYear': return { from: `${+y - 1}-01-01`, to: `${+y - 1}-12-31` };
    case 'last30': return { from: addDays(td, -29), to: td };
    case 'last12': return { from: addMonths(monthStart(td), -11), to: td };
    case 'custom': return { from: from || null, to: to || null };
    default: return null;
  }
}

export function emptyFilter() {
  return { name: '', type: 'all', accounts: 'all', dates: 'all', from: null, to: null, payee: '', num: '', cleared: 'any', category: '', cls: '', memo: '' };
}

export function filterAccounts(f, ctxAcc) {
  if (!f || f.accounts === 'all') return ctxAcc ? [ctxAcc] : null;
  if (f.accounts === 'current') return ctxAcc ? [ctxAcc] : null;
  return f.accounts;
}

export function makeMatcher(f, ctxAcc) {
  const accs = filterAccounts(f, ctxAcc);
  const accSet = accs ? new Set(accs) : null;
  if (!f) {
    return {
      accSet,
      entry: (e) => (accSet ? accSet.has(e.acc) && !(e.dir === 'in' && accSet.has(e.other) && accs.length > 1) : e.dir === 'out'),
      line: () => true,
    };
  }
  const range = f.dates === 'recent' ? null : presetRange(f.dates, f.from, f.to);
  const payee = wildcard(f.payee), num = wildcard(f.num), cat = wildcard(f.category), cls = wildcard(f.cls);
  const memo = f.memo ? f.memo.toLowerCase() : null;
  const line = (l) => (!cat || cat(l.category)) && (!cls || cls(l.cls)) && (!memo || (l.memo || l.e.t.memo || '').toLowerCase().includes(memo));
  const entry = (e) => {
    if (accSet) {
      if (!accSet.has(e.acc)) return false;
      if (e.dir === 'in' && accSet.has(e.other) && accs.length > 1) return false;
    } else if (e.dir === 'in') return false;
    if (f.type !== 'all' && e.t.type !== f.type) return false;
    if (range && ((range.from && e.date < range.from) || (range.to && e.date > range.to))) return false;
    if (f.dates === 'recent' && !((e.t.mod || 0) > (state.lastExport || 0))) return false;
    if (f.cleared === 'yes' && !e.cleared) return false;
    if (f.cleared === 'no' && e.cleared) return false;
    if (payee && !payee(payeeOf(e)) && !payee(e.t.payee)) return false;
    if (num && !num(e.t.num)) return false;
    if (cat || cls || memo) return linesOf(e).some(line);
    return true;
  };
  return { accSet, entry, line };
}

// Поиск в журнале: текст или сумма (>300, <-300, =20, -300...-500)
export function searchMatcher(q) {
  q = (q || '').trim();
  if (!q) return null;
  let m;
  const num = (s) => evalAmount(s);
  if ((m = /^([<>=])\s*(-?[\d\s.,]+)$/.exec(q))) {
    const v = num(m[2]);
    return (e) => (m[1] === '>' ? e.amt > v : m[1] === '<' ? e.amt < v : Math.abs(e.amt) === Math.abs(v));
  }
  if ((m = /^(-?[\d\s.,]+?)\s*\.{2,3}\s*(-?[\d\s.,]+)$/.exec(q))) {
    const a = num(m[1]), b = num(m[2]);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return (e) => e.amt >= lo && e.amt <= hi;
  }
  const s = q.toLowerCase();
  return (e) =>
    [payeeOf(e), e.t.category, e.t.memo, e.t.num, e.t.cls, ...(e.t.splits || []).map((x) => x.category + ' ' + (x.memo || ''))]
      .some((v) => (v || '').toLowerCase().includes(s));
}

export function saveFilter(f) {
  if (!f.id) { f.id = uid(); state.filters.push(f); }
  else state.filters[state.filters.findIndex((x) => x.id === f.id)] = f;
  commit();
  return f;
}

// ---------- отчёты ----------
export function reportLines(entries, by) {
  const out = [];
  for (const e of entries) {
    if (e.t.opening && by !== 'account') continue;
    if (by !== 'account' && e.t.type === 't' && !e.t.category) continue;
    for (const l of linesOf(e)) out.push(l);
  }
  return out;
}

export function groupKey(l, by) {
  switch (by) {
    case 'category': {
      const c = l.category || t('<без категории>');
      return state.settings.groupSubcats ? c.split(':')[0] : c;
    }
    case 'payee': return payeeOf(l.e) || t('<без получателя>');
    case 'class': return l.cls || t('<без класса>');
    case 'account': return accName(l.e.acc);
    default: return '';
  }
}

export function groupLines(lines, by) {
  const map = new Map();
  for (const l of lines) {
    const k = groupKey(l, by);
    const g = map.get(k) || { key: k, sum: 0, count: 0 };
    g.sum += toHome(l.amt, account(l.e.acc));
    g.count++;
    map.set(k, g);
  }
  return [...map.values()];
}

// Помесячная сводка: доходы/расходы
export function monthly(entries, fromMonth, toMonth) {
  const map = new Map();
  for (const e of entries) {
    if (e.t.opening || (e.t.type === 't' && !e.t.category)) continue;
    const m = e.date.slice(0, 7);
    if ((fromMonth && m < fromMonth) || (toMonth && m > toMonth)) continue;
    const g = map.get(m) || { month: m, income: 0, expense: 0 };
    for (const l of linesOf(e)) {
      const v = toHome(l.amt, account(e.acc));
      if (v >= 0) g.income += v; else g.expense += v;
    }
    map.set(m, g);
  }
  return map;
}

export function netWorthAt(date) {
  let assets = 0, debts = 0;
  for (const a of state.accounts) {
    if (!a.worth || a.type === 'online') continue;
    let s = 0;
    for (const e of entriesOf(a.id)) if (e.date <= date) s += e.amt;
    s = toHome(s, a);
    if (s >= 0) assets += s; else debts += s;
  }
  return { assets, debts, net: assets + debts };
}

// ---------- инструменты журнала ----------
export function markAllCleared(entries) {
  for (const e of entries) {
    e.t.cleared = true;
    if (e.t.type === 't') e.t.toCleared = true;
    e.t.mod = Date.now();
  }
  commit();
}

export function adjustBalance(accId, target, clearedOnly) {
  const cur = balance(accId, clearedOnly ? 'cleared' : 'current');
  const diff = target - cur;
  if (!diff) return null;
  return saveTxn({
    acc: accId, type: diff < 0 ? 'w' : 'd', date: today(), amount: Math.abs(diff), payee: t('Корректировка баланса'),
    category: '', cls: '', num: '', memo: '', cleared: clearedOnly, splits: [],
  });
}

// Свернуть показанные операции счёта в одну (или две: проведённые и нет)
export function rollup(accId, entries) {
  const own = entries.filter((e) => e.acc === accId && e.dir === 'out' && e.t.type !== 't');
  if (!own.length) return 0;
  const last = own.reduce((m, e) => (e.date > m ? e.date : m), own[0].date);
  for (const cleared of [true, false]) {
    const part = own.filter((e) => e.cleared === cleared);
    if (!part.length) continue;
    const byCat = new Map();
    for (const e of part) for (const l of linesOf(e)) byCat.set(l.category, (byCat.get(l.category) || 0) + l.amt);
    const splits = [...byCat].filter(([, v]) => v).map(([category, amount]) => ({ category, amount, memo: '', cls: '' }));
    const ids = new Set(part.map((e) => e.t.id));
    state.txns = state.txns.filter((x) => !ids.has(x.id));
    saveTxn({
      acc: accId, type: 'w', date: last, amount: 0, payee: t('Свёртка'), category: '', cls: '', num: '',
      memo: t('Свёрнуто операций: {0}', part.length), cleared, splits: splits.length ? splits : [{ category: '', amount: 0 }],
    }, { silent: true });
  }
  commit();
  return own.length;
}

// ---------- управляемые списки ----------
export const LISTS = { payees: 'payee', categories: 'category', classes: 'cls', ids: 'num' };

export function renameInList(list, oldName, newName, everywhere) {
  const arr = state[list];
  const field = LISTS[list];
  const i = arr.indexOf(oldName);
  if (i >= 0) arr[i] = newName;
  if (list === 'categories') {
    for (let j = 0; j < arr.length; j++) if (arr[j].startsWith(oldName + ':')) arr[j] = newName + arr[j].slice(oldName.length);
  }
  if (everywhere) {
    const fix = (v) => (v === oldName ? newName : list === 'categories' && v?.startsWith(oldName + ':') ? newName + v.slice(oldName.length) : v);
    const touch = (x) => {
      x[field] = fix(x[field]);
      if (field === 'category' || field === 'cls') for (const s of x.splits || []) s[field] = fix(s[field]);
    };
    state.txns.forEach(touch);
    state.repeats.forEach((r) => touch(r.tpl));
    if (list === 'categories') for (const b of state.budgets) b.category = fix(b.category);
  }
  state[list] = [...new Set(arr)].sort((a, b) => a.localeCompare(b, fmt.lang));
  commit();
}

export function removeFromList(list, name, alsoBudget) {
  state[list] = state[list].filter((x) => x !== name && !(list === 'categories' && x.startsWith(name + ':')));
  if (list === 'categories' && alsoBudget) state.budgets = state.budgets.filter((b) => b.category !== name);
  commit();
}

export function addToList(list, name) {
  name = name.trim();
  if (!name || state[list].includes(name)) return;
  state[list].push(name);
  state[list].sort((a, b) => a.localeCompare(b, fmt.lang));
  commit();
}

// ---------- курсы валют ----------
export async function updateRates() {
  const home = state.settings.home;
  const need = [...new Set(state.accounts.map((a) => a.currency).filter((c) => c && c !== home && c.length === 3 && !['HRS', 'DAY', 'MIL', 'KMS', 'NON'].includes(c)))];
  if (!need.length) return 0;
  let rates = null;
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${home}`);
    const j = await r.json();
    if (j.result === 'success') rates = j.rates; // единиц валюты за 1 home
  } catch {}
  if (!rates && home === 'RUB') {
    try {
      const r = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
      const j = await r.json();
      rates = {};
      for (const [code, v] of Object.entries(j.Valute)) rates[code] = v.Nominal / v.Value;
    } catch {}
  }
  if (!rates) throw new Error('rates');
  let n = 0;
  for (const a of state.accounts) {
    if (a.currency && rates[a.currency]) {
      a.rate = +(1 / rates[a.currency]).toFixed(6);
      n++;
    }
  }
  state.ratesAt = Date.now();
  commit();
  return n;
}

export const getVersion = () => version;
