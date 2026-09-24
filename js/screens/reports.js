// Отчёты: по категориям/получателям/классам/счетам, по месяцам, графики
import { h, clone, money, monthYear, addDays, addMonths, today } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import { Screen, push, backButton, ring, chevron, group, checkCell, switchCell, barButton, haptic, toast } from '../ui.js';
import { RegisterScreen } from './register.js';
import { rangeLabel } from './budgets.js';
import { PALETTE, pieCanvas, chartBox } from './charts.js';

const MODES = ['all', 'monthly', 'bimonthly', 'quarterly', 'halfyear', 'yearly'];
const ANCHOR = '2000-01-01';
const byTitle = (by) => ({ category: t('Категории'), payee: t('Получатели'), class: t('Классы'), account: t('Счета') }[by]);

function srcEntries(src) {
  return src.shown || src.entries();
}

function drillFilter(src, extra) {
  const base = src.filter ? clone(src.filter) : M.emptyFilter();
  if (src.acc) base.accounts = [src.acc];
  else if (base.accounts === 'current') base.accounts = 'all';
  return { ...base, ...extra };
}

function periodBar(screen) {
  const mode = screen.mode;
  const label = mode === 'all' ? t('Все') : rangeLabel(screen.range);
  const shift = (dir) => {
    if (mode === 'all') return;
    screen.range = M.shiftPeriod(mode, screen.range, dir, ANCHOR);
    haptic();
    screen.render();
  };
  return h('div', { class: 'periodbar' },
    h('button', { type: 'button', class: 'pnav', onclick: () => shift(-1) }, '◀'),
    barButton({
      label, onClick: () => {
        screen.mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
        M.state.settings.reportPeriod = screen.mode;
        screen.range = screen.mode === 'all' ? null : M.periodRange(screen.mode, today(), ANCHOR);
        screen.render();
      },
    }),
    h('button', { type: 'button', class: 'pnav', onclick: () => shift(1) }, '▶'));
}

export class ReportScreen extends Screen {
  constructor({ by, src }) {
    super();
    this.by = by;
    this.src = src;
    this.excluded = new Set();
    this.mode = M.state.settings.reportPeriod || 'all';
    this.range = this.mode === 'all' ? null : M.periodRange(this.mode, today(), ANCHOR);
  }
  nav() {
    return { title: byTitle(this.by), left: backButton(t('Журнал')), right: { icon: 'eye', onClick: () => push(new ReportOptionsScreen(this.by)) } };
  }
  entries() {
    const r = this.range;
    return srcEntries(this.src).filter((e) => !r || (e.date >= r.start && e.date <= r.end));
  }
  groups() {
    const s = M.state.settings;
    let groups = M.groupLines(M.reportLines(this.entries(), this.by), this.by).filter((g) => g.sum !== 0);
    const exp = groups.filter((g) => g.sum < 0).sort((a, b) => a.sum - b.sum);
    const inc = groups.filter((g) => g.sum > 0).sort((a, b) => b.sum - a.sum);
    exp.forEach((g, i) => (g.color = PALETTE[i % PALETTE.length]));
    inc.forEach((g, i) => (g.color = PALETTE[(i + 1) % PALETTE.length]));
    const sort = {
      name: (a, b) => a.key.localeCompare(b.key),
      amount: (a, b) => Math.abs(b.sum) - Math.abs(a.sum),
      count: (a, b) => b.count - a.count,
    }[s.reportSort];
    groups = [...exp, ...inc].sort((a, b) => (Math.sign(a.sum) - Math.sign(b.sum)) || sort(a, b));
    return groups;
  }
  body() {
    const s = M.state.settings;
    const groups = this.groups();
    this.groupsCache = groups;
    const incl = groups.filter((g) => !this.excluded.has(g.key));
    const expTotal = incl.filter((g) => g.sum < 0).reduce((a, g) => a + g.sum, 0);
    const incTotal = incl.filter((g) => g.sum > 0).reduce((a, g) => a + g.sum, 0);
    const out = [];
    if (s.reportChart === 'pie') {
      const expG = incl.filter((g) => g.sum < 0);
      const incG = incl.filter((g) => g.sum > 0);
      out.push(h('div', { class: 'pies' },
        pieCanvas(expG.map((g) => ({ value: -g.sum, color: g.color })), '-', (i) => this.drill(expG[i])),
        pieCanvas(incG.map((g) => ({ value: g.sum, color: g.color })), '+', (i) => this.drill(incG[i]))));
    }
    out.push(periodBar(this));
    if (!groups.length) out.push(h('div', { class: 'empty' }, t('Нет данных за этот период')));
    const maxAbs = Math.max(1, ...groups.map((g) => Math.abs(g.sum)));
    for (const g of groups) {
      const off = this.excluded.has(g.key);
      const tot = g.sum < 0 ? expTotal : incTotal;
      const pct = off || !tot ? 0 : (g.sum / tot) * 100;
      out.push(h('div', { class: 'rrow tap' + (off ? ' off' : ''), onclick: () => this.drill(g) },
        ring(!off, () => { if (off) this.excluded.delete(g.key); else this.excluded.add(g.key); this.render(); }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { class: 'rn' }, g.key),
          h('div', { class: 'rv', style: { color: g.color } }, `${money(g.sum)} • ${pct.toLocaleString(M.state.settings.lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% • ${g.count}`),
          s.reportChart === 'bar' ? h('div', { class: 'hbar', style: { width: `${(Math.abs(g.sum) / maxAbs) * 100}%`, background: g.color } }) : null),
        chevron()));
    }
    return out;
  }
  footer() {
    const incl = (this.groupsCache || this.groups()).filter((g) => !this.excluded.has(g.key));
    const total = incl.reduce((a, g) => a + g.sum, 0);
    return h('div', { class: 'rfoot' }, h('span', null, t('Итого (+/−)')), h('b', { style: { color: total < 0 ? '#ff5555' : '#6f6' } }, money(total)));
  }
  drill(g) {
    if (!g) return;
    const r = this.range;
    const extra = r ? { dates: 'custom', from: r.start, to: r.end } : {};
    const none = g.key.startsWith('<') && g.key.endsWith('>') && this.by !== 'payee';
    if (none) return toast(t('Для этой группы нет отдельного списка'));
    if (this.by === 'category') extra.category = M.state.settings.groupSubcats ? g.key + '%' : g.key;
    if (this.by === 'payee') extra.payee = g.key;
    if (this.by === 'class') extra.cls = g.key;
    if (this.by === 'account') {
      const a = M.state.accounts.find((x) => x.name === g.key);
      if (a) extra.accounts = [a.id];
    }
    const f = drillFilter(this.src, extra);
    f.name = g.key;
    push(new RegisterScreen({ filter: f, title: g.key, back: byTitle(this.by), fixedFilter: true }));
  }
}

export class ReportOptionsScreen extends Screen {
  constructor(by) { super(); this.by = by; this.bodyClass = 'pinstripe'; }
  nav() { return { title: t('Вид отчёта'), left: backButton(t('Отчёт')) }; }
  body() {
    const s = M.state.settings;
    const set = (k, v) => { s[k] = v; M.commit(); };
    return [
      group([
        checkCell(t('По названию'), s.reportSort === 'name', () => set('reportSort', 'name')),
        checkCell(t('По сумме'), s.reportSort === 'amount', () => set('reportSort', 'amount')),
        checkCell(t('По количеству'), s.reportSort === 'count', () => set('reportSort', 'count')),
      ], { title: t('Сортировка') }),
      group([
        checkCell(t('Круговые диаграммы'), s.reportChart === 'pie', () => set('reportChart', 'pie')),
        checkCell(t('Полоски'), s.reportChart === 'bar', () => set('reportChart', 'bar')),
      ], { title: t('График') }),
      this.by === 'category' ? group([switchCell(t('Объединять подкатегории'), s.groupSubcats, (v) => set('groupSubcats', v))]) : null,
    ];
  }
}

// Помесячный отчёт
export class MonthlyScreen extends Screen {
  constructor({ src }) { super(); this.src = src; }
  nav() { return { title: t('По месяцам'), left: backButton(t('Журнал')) }; }
  body() {
    const es = srcEntries(this.src);
    const map = M.monthly(es);
    const months = [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
    const out = [chartBox('cashflow', () => es)];
    if (!months.length) out.push(h('div', { class: 'empty' }, t('Нет данных')));
    let ti = 0, te = 0;
    for (const m of months) {
      ti += m.income; te += m.expense;
      const net = m.income + m.expense;
      const from = m.month + '-01';
      out.push(h('div', {
        class: 'mrow tap', onclick: () => {
          const f = drillFilter(this.src, { dates: 'custom', from, to: addDays(addMonths(from, 1), -1) });
          push(new RegisterScreen({ filter: f, title: monthYear(from), back: t('По месяцам'), fixedFilter: true }));
        },
      },
        h('span', { class: 'mn' }, monthYear(from)),
        h('span', { class: 'amt ' + (net < 0 ? 'red' : 'pos') }, money(net, null, { plus: true })),
        h('span', { class: 'ms pos' }, t('Доходы: {0}', money(m.income))),
        h('span', { class: 'ms', style: { textAlign: 'right' } }, t('Расходы: {0}', money(m.expense)))));
    }
    if (months.length > 1) {
      const n = months.length;
      out.push(h('div', { class: 'mrow', style: { background: '#f3f3f3' } },
        h('span', { class: 'mn' }, t('В среднем за месяц')), h('span', { class: 'amt' }, money(Math.round((ti + te) / n), null, { plus: true })),
        h('span', { class: 'ms pos' }, money(Math.round(ti / n))), h('span', { class: 'ms', style: { textAlign: 'right' } }, money(Math.round(te / n)))));
    }
    return out;
  }
}

// Большой график с таблицей по месяцам
export class ChartScreen extends Screen {
  constructor(kind, src) { super(); this.kind = kind; this.src = src; this.bodyClass = 'dark'; }
  nav() { return { title: this.kind === 'networth' ? t('Чистые активы') : t('Денежный поток'), left: backButton(t('Назад')) }; }
  body() {
    const list = h('div', { style: { background: '#fff' } });
    const box = chartBox(this.kind, () => (this.src ? srcEntries(this.src) : M.allEntries()), {
      onSelect: (d, data) => {
        list.replaceChildren(...[...data].reverse().map((x) => h('div', { class: 'mrow' + (x === d ? ' sel' : ''), style: x === d ? { background: '#fff8c4' } : null },
          h('span', { class: 'mn' }, monthYear(x.month)),
          h('span', { class: 'amt ' + (x.line < 0 ? 'red' : 'pos') }, money(x.line)),
          h('span', { class: 'ms pos' }, (this.kind === 'networth' ? t('Активы: {0}') : t('Доходы: {0}')).replace('{0}', money(x.up))),
          h('span', { class: 'ms', style: { textAlign: 'right' } }, (this.kind === 'networth' ? t('Долги: {0}') : t('Расходы: {0}')).replace('{0}', money(x.down))))));
      },
    });
    const hint = h('div', { class: 'gfoot', style: { color: '#aaa', textShadow: 'none', padding: '4px 0 8px' } },
      t('Нажмите на столбик, чтобы выбрать месяц; стрелки по краям листают месяцы.'));
    return [box, hint, list];
  }
}
