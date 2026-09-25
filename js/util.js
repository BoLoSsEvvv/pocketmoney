// Общие утилиты: DOM, даты, деньги.

export const fmt = { lang: 'ru', parens: true, home: 'RUB' };

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of [kids].flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- даты (строки YYYY-MM-DD в локальном времени) ----------
export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export function addMonths(s, n, dom) {
  const d = parse(s);
  const day = dom ?? d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return iso(t);
}
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export const weekday = (s) => parse(s).getDay();
export const monthsBetween = (a, b) => {
  const A = parse(a), B = parse(b);
  return (B.getFullYear() - A.getFullYear()) * 12 + B.getMonth() - A.getMonth();
};
export const monthStart = (s) => s.slice(0, 8) + '01';
export const weekStart = (s) => addDays(s, -((weekday(s) + 6) % 7)); // понедельник

const locale = () => (fmt.lang === 'ru' ? 'ru-RU' : 'en-US');

export function shortDate(s) {
  const [y, m, d] = s.split('-');
  return fmt.lang === 'ru' ? `${d}.${m}.${y.slice(2)}` : `${+m}/${+d}/${y.slice(2)}`;
}

const dfCache = {};
function df(key, opts) {
  const k = fmt.lang + key;
  return (dfCache[k] ??= new Intl.DateTimeFormat(locale(), opts));
}

export function longDate(s) {
  const d = parse(s);
  const main = df('long', { day: 'numeric', month: 'short', year: 'numeric' }).format(d).replace(' г.', '');
  const wd = df('wd', { weekday: 'short' }).format(d);
  return `${main} (${wd})`;
}
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function monthYear(s) {
  return cap(df('my', { month: 'long', year: 'numeric' }).format(parse(s)).replace(' г.', ''));
}
export function monthName(s, short) {
  return cap(df(short ? 'ms' : 'ml', { month: short ? 'short' : 'long' }).format(parse(s)).replace('.', ''));
}
export function weekdayNames() {
  // Пн..Вс (или Su..Sa для en)
  const base = parse('2024-01-01'); // понедельник
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base); d.setDate(d.getDate() + i);
    out.push(cap(df('wds', { weekday: 'short' }).format(d)));
  }
  return out; // индекс 0 = понедельник
}

// ---------- деньги (целые копейки) ----------
export const UNITS = {
  HRS: { ru: 'ч', en: 'hr' },
  DAY: { ru: 'дн', en: 'd' },
  MIL: { ru: 'миль', en: 'mi' },
  KMS: { ru: 'км', en: 'km' },
  NON: { ru: '', en: '' },
};

const nfCache = {};
function nf(cur, cents) {
  const k = `${fmt.lang}|${cur}|${cents}`;
  if (nfCache[k]) return nfCache[k];
  const digits = cents ? 2 : 0;
  let f;
  if (UNITS[cur]) {
    f = new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } else {
    try {
      f = new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
  }
  return (nfCache[k] = f);
}

export function money(cents, cur, opts = {}) {
  cur = cur || fmt.home;
  const showCents = opts.cents ?? true;
  const abs = Math.abs(cents || 0) / 100;
  let s = nf(cur, showCents).format(showCents ? abs : Math.round(abs));
  if (UNITS[cur]) {
    const u = UNITS[cur][fmt.lang];
    if (u) s = fmt.lang === 'ru' ? `${s} ${u}` : `${u} ${s}`;
  }
  if (cents < 0) s = fmt.parens ? `(${s})` : `−${s}`;
  else if (opts.plus && cents > 0) s = `+${s}`;
  return s;
}

// число для поля ввода: 1234,5 -> "1234,50"
export function amountInput(cents) {
  if (cents == null || cents === 0) return '';
  const s = (Math.abs(cents) / 100).toFixed(2);
  return fmt.lang === 'ru' ? s.replace('.', ',') : s;
}

// Число с разделителями: "1 234,56", "1,234.56", "1.234.567"; мусор ("12.5.3") → null
function numTok(tok) {
  const seps = tok.replace(/\d/g, '');
  if (!seps) return Number(tok);
  let dec = seps.at(-1); // десятичный — последний разделитель…
  // …кроме повторяющегося (1.000.000) и английского 1,000
  if (seps.length > 1 ? seps[0] === dec : dec === ',' && fmt.lang === 'en' && /,\d{3}$/.test(tok)) dec = '';
  const k = dec ? tok.lastIndexOf(dec) : tok.length;
  const int = tok.slice(0, k), frac = tok.slice(k + 1);
  const g = int.split(/[.,]/);
  if (new Set(int.replace(/\d/g, '')).size > 1) return null;
  if (g.length > 1 && (!/^\d{1,3}$/.test(g[0]) || g.slice(1).some((x) => x.length !== 3))) return null;
  if (!g.join('') && !frac) return null;
  return Number((g.join('') || '0') + '.' + (frac || '0'));
}

// Разбор выражения: "120+35,5*2" → число (или null)
export function evalNum(str) {
  if (str == null) return null;
  const s = String(str)
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/[^\d.,+\-*/()]/g, '');
  if (!s) return null;
  let i = 0;
  const peek = () => s[i];
  function num() {
    const st = i;
    while (i < s.length && /[\d.,]/.test(s[i])) i++;
    if (st === i) throw 0;
    const v = numTok(s.slice(st, i));
    if (v == null || Number.isNaN(v)) throw 0;
    return v;
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (s[i] !== ')') throw 0; i++; return v; }
    return num();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++]; const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]; const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = expr();
    return i === s.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// Сумма в копейках с калькулятором: "120+35,5*2"
export function evalAmount(str) {
  const v = evalNum(str);
  return v == null ? null : Math.round(v * 100);
}

export function fmtRate(r) {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 6 }).format(r);
}

export function currencyName(code) {
  const u = { HRS: ['Часы', 'Hours'], DAY: ['Дни', 'Days'], MIL: ['Мили', 'Miles'], KMS: ['Километры', 'Kilometers'], NON: ['Без единиц', 'None'] }[code];
  if (u) return fmt.lang === 'ru' ? u[0] : u[1];
  try {
    return cap(new Intl.DisplayNames([locale()], { type: 'currency' }).of(code));
  } catch {
    return code;
  }
}

export function allCurrencies() {
  try {
    return Intl.supportedValuesOf('currency');
  } catch {
    return ['AED', 'AMD', 'AUD', 'AZN', 'BGN', 'BRL', 'BYN', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'GEL', 'HKD', 'HUF', 'ILS', 'INR', 'JPY', 'KGS', 'KRW', 'KZT', 'MDL', 'MXN', 'NOK', 'NZD', 'PLN', 'RON', 'RSD', 'RUB', 'SEK', 'SGD', 'THB', 'TJS', 'TMT', 'TRY', 'UAH', 'USD', 'UZS', 'VND', 'ZAR'];
  }
}

// SQL-подобные шаблоны: % — любые символы, _ — один символ
export function wildcard(pattern) {
  if (!pattern) return null;
  const hasWild = /[%_]/.test(pattern);
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  const re = new RegExp(`^${esc}$`, 'i');
  return (s) => re.test(s || '') || (!hasWild && (s || '').toLowerCase() === pattern.toLowerCase());
}

export const debounce = (fn, ms) => {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
};

export async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
