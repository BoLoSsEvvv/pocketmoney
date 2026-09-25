// Журнал операций счёта (register)
import { h, money, shortDate, today, evalAmount, amountInput } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import {
  Screen, push, pop, toolbar, segmented, balanceBar, ring, chevron, swipeToDelete, actionSheet, confirmBox,
  promptBox, datePicker, backButton, group, checkCell, switchCell, toast, haptic,
} from '../ui.js';
import { EditTxnScreen } from './txn.js';
import { FiltersScreen } from './filters.js';
import { ReportScreen, MonthlyScreen, ChartScreen } from './reports.js';
import { balanceSlots, cycleBalance } from './home.js';
import { exportEntries } from '../io.js';

const SORTS = ['date', 'amount', 'payee', 'category', 'cls', 'num', 'memo', 'cleared'];
export const sortLabel = (k) => ({
  date: t('Дата'), amount: t('Сумма'), payee: t('Получатель'), category: t('Категория'), cls: t('Класс'),
  num: t('Номер'), memo: t('Примечание'), cleared: t('Проведена'),
}[k]);

export function entrySubline(e) {
  const x = e.t;
  const f = M.state.settings.regFields;
  const parts = [];
  if (f.category) {
    if (x.splits?.length && e.dir === 'out') parts.push(t('<--сплит-->'));
    else if (x.category) parts.push(x.category);
  }
  if (f.num && x.num) parts.push('№ ' + x.num);
  if (f.cls && x.cls) parts.push(x.cls);
  if (f.memo && x.memo) parts.push(x.memo);
  return parts.join(' • ');
}

export class RegisterScreen extends Screen {
  // opts: {acc, filter, title, back}
  constructor(opts) {
    super();
    this.acc = opts.acc || null;
    this.filter = opts.filter || null;
    this.fixedFilter = !!opts.fixedFilter;
    this.title = opts.title;
    this.back = opts.back;
    this.searchOpen = false;
    this.q = '';
    this.qMode = 'all';
  }

  get account() { return this.acc && M.account(this.acc); }

  nav() {
    return {
      title: this.title || (this.acc ? M.accName(this.acc) : this.filter?.name || t('Все операции')),
      left: backButton(this.back || t('Счета')),
      right: { icon: 'search', onClick: () => { this.searchOpen = !this.searchOpen; if (!this.searchOpen) this.q = ''; this.render(); if (this.searchOpen) setTimeout(() => this.searchInput?.focus(), 50); } },
      sub: this.searchOpen ? this.searchBar() : null,
    };
  }

  searchBar() {
    this.searchInput = h('input', {
      class: 'search-inp', type: 'search', placeholder: t('Поиск: текст или >300, <-300, =20'), value: this.q, autocomplete: 'off',
      oninput: (e) => { this.q = e.target.value; this.renderRows(); this.footEl?.replaceWith(this.footer()); },
    });
    return h('div', { class: 'searchbar' }, this.searchInput,
      segmented([{ value: 'pending', label: t('Непроведённые') }, { value: 'cleared', label: t('Проведённые') }, { value: 'all', label: t('Все') }],
        this.qMode, (v) => { this.qMode = v; this.render(); }, 'light'));
  }

  entries() {
    const m = M.makeMatcher(this.filter, this.acc);
    let es = (this.acc ? M.entriesOf(this.acc) : M.allEntries()).filter(m.entry);
    if (this.searchOpen) {
      const sm = M.searchMatcher(this.q);
      es = es.filter((e) => (!sm || sm(e)) && (this.qMode === 'all' || (this.qMode === 'cleared') === e.cleared));
    }
    const { regSort, regAsc } = M.state.settings;
    if (regSort !== 'date') {
      const key = {
        amount: (e) => e.amt, payee: (e) => M.payeeOf(e).toLowerCase(), category: (e) => (e.t.category || '').toLowerCase(),
        cls: (e) => (e.t.cls || '').toLowerCase(), num: (e) => e.t.num || '', memo: (e) => (e.t.memo || '').toLowerCase(),
        cleared: (e) => (e.cleared ? 1 : 0),
      }[regSort];
      const coll = new Intl.Collator(M.state.settings.lang, { numeric: true }); // ё после е, 99 < 100
      es = [...es].sort((a, b) => {
        const ka = key(a), kb = key(b);
        return (typeof ka === 'string' ? coll.compare(ka, kb) : ka - kb) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      });
    }
    if (!regAsc) es = [...es].reverse();
    return es;
  }

  runningBalances() {
    const run = new Map();
    if (!this.acc) return run;
    let s = 0;
    for (const e of M.entriesOf(this.acc)) { s += e.amt; run.set(e.key, s); }
    return run;
  }

  row(e, run) {
    const x = e.t;
    const s = M.state.settings;
    const acc = M.account(e.acc);
    const future = e.date > today();
    const isRep = x.rep && M.repeat(x.rep);
    const payee = M.payeeOf(e) || t('<без получателя>');
    const amtCls = e.amt > 0 ? 'pos' : e.amt < 0 ? 'neg' : '';
    const short = s.rowStyle === 'short';
    let second = null;
    if (this.acc && s.regFields.balance && s.regSort === 'date') {
      const b = run.get(e.key);
      const bad = M.overLimit(acc, b) || (acc.limit == null && b < 0 && !M.isCreditish(acc));
      second = h('div', { class: 'tx-b' + (bad ? ' red' : '') }, money(b, M.curOf(acc)));
    } else if (!this.acc) second = h('div', { class: 'tx-b' }, M.accName(e.acc));
    const sub = entrySubline(e);
    const row = h('div', {
      class: 'txrow' + (future ? ' future' : '') + (short ? ' short' : ''), 'data-date': e.date, 'data-key': e.key,
      onclick: () => push(new EditTxnScreen(x, { fromAcc: e.acc })),
    },
      ring(e.cleared, () => M.toggleCleared(e)),
      h('div', { class: 'tx-date' + (isRep ? ' rep' : '') }, shortDate(e.date)),
      h('div', { class: 'tx-m' }, h('div', { class: 'tx-p' }, payee), !short && sub ? h('div', { class: 'tx-c' }, sub) : null),
      h('div', { class: 'tx-r' }, h('div', { class: 'tx-a ' + amtCls }, money(e.amt, M.curOf(acc))), !short ? second : null),
      chevron());
    swipeToDelete(row, () => { M.deleteTxn(x.id); haptic('warn'); });
    return row;
  }

  body() {
    const out = [];
    if (this.filter && !this.fixedFilter) {
      out.push(h('div', { class: 'filterbar' }, h('span', { class: 'grow' }, t('Фильтр: {0}', this.filter.name || t('текущий'))),
        h('button', { type: 'button', onclick: () => { this.filter = null; this.render(); } }, '✕')));
    }
    this.rowsEl = h('div', { class: 'txlist ' + (M.state.settings.redWithdrawals ? 'redw ' : '') + (M.state.settings.blackDeposits ? 'blackd' : '') });
    out.push(this.rowsEl);
    this.renderRows();
    return out;
  }

  renderRows() {
    const es = this.entries();
    this.shown = es;
    const run = this.runningBalances();
    const rows = es.map((e) => this.row(e, run));
    if (!rows.length) {
      rows.push(h('div', { class: 'empty' }, this.q ? t('Ничего не найдено') : t('Операций пока нет.\nНажмите «+» внизу, чтобы добавить.')));
    }
    this.rowsEl.replaceChildren(...rows);
  }

  afterRender(again) {
    if (again) return;
    // как в чековой книжке: показываем «сегодня» внизу экрана
    requestAnimationFrame(() => {
      const sc = this.scroller;
      if (!M.state.settings.regAsc) { sc.scrollTop = 0; return; }
      const firstFuture = [...this.rowsEl.children].find((r) => r.dataset.date > today());
      if (firstFuture) sc.scrollTop = Math.max(0, firstFuture.offsetTop - sc.clientHeight + firstFuture.offsetHeight * 0.6);
      else sc.scrollTop = sc.scrollHeight;
    });
  }

  footer() {
    if (this.acc) {
      const acc = this.account;
      if (!acc) return null;
      return balanceBar(balanceSlots((type) => M.balance(this.acc, type), acc), cycleBalance);
    }
    if (this.filter) {
      const { line } = M.makeMatcher(this.filter, this.acc); // из сплита — только подходящие строки
      const sum = (this.shown || this.entries()).reduce((a, e) => a + M.toHome(M.linesOf(e).filter(line).reduce((s, l) => s + l.amt, 0), M.account(e.acc)), 0);
      return (this.footEl = balanceBar([{ label: t('Итого по фильтру'), cents: sum, red: sum < 0 }]));
    }
    return balanceBar(balanceSlots((type) => M.totalBalance(type)), cycleBalance);
  }

  toolbar() {
    return toolbar(
      { icon: 'plus', onClick: () => push(new EditTxnScreen(M.newTxnDraft(this.acc || this.filterAcc()))) },
      '|',
      { label: t('Отчёты'), onClick: () => this.reportsMenu() },
      { label: t('Сервис'), onClick: () => this.toolsMenu() },
      { label: t('Фильтр'), onClick: () => push(new FiltersScreen(this)) },
      '|',
      { icon: 'eye', onClick: () => push(new RegisterViewScreen()) },
    );
  }

  filterAcc() {
    const a = this.filter && Array.isArray(this.filter.accounts) ? this.filter.accounts[0] : null;
    return a || null;
  }

  async reportsMenu() {
    const items = [
      [t('По категориям'), () => push(new ReportScreen({ by: 'category', src: this }))],
      [t('По получателям'), () => push(new ReportScreen({ by: 'payee', src: this }))],
      [t('По классам'), () => push(new ReportScreen({ by: 'class', src: this }))],
      [t('По счетам'), () => push(new ReportScreen({ by: 'account', src: this }))],
      [t('По месяцам'), () => push(new MonthlyScreen({ src: this }))],
      [t('Денежный поток'), () => push(new ChartScreen('cashflow', this))],
      [t('Чистые активы'), () => push(new ChartScreen('networth', this))],
    ];
    const i = await actionSheet({ title: t('Отчёт по показанным операциям'), buttons: items.map(([label]) => ({ label })) });
    if (i != null) items[i][1]();
  }

  async toolsMenu() {
    const items = [[t('Перейти к дате'), () => this.goToDate()]];
    if (this.acc) items.push([t('Скорректировать баланс'), () => this.adjust()]);
    items.push([t('Отметить все как проведённые'), async () => {
      if (await confirmBox(t('Отметить показанные операции ({0}) как проведённые?', this.shown.length))) M.markAllCleared(this.shown);
    }]);
    items.push([t('Экспорт показанных (CSV / QIF)'), () => exportEntries(this.shown, this.acc)]);
    if (this.acc) items.push([t('Свёртка'), () => this.rollup(), true]);
    const i = await actionSheet({ buttons: items.map(([label, , destructive]) => ({ label, destructive })) });
    if (i != null) items[i][1]();
  }

  async goToDate() {
    const d = await datePicker(today(), { title: t('Перейти к дате') });
    if (!d) return;
    const rows = [...this.rowsEl.children];
    const asc = M.state.settings.regAsc;
    const r = rows.find((x) => (asc ? x.dataset.date >= d : x.dataset.date <= d)) || rows[rows.length - 1];
    if (r) {
      r.scrollIntoView({ block: 'center' });
      r.classList.add('hl');
    }
  }

  async adjust() {
    const acc = this.account;
    const which = await actionSheet({ title: t('Какой баланс исправить?'), buttons: [{ label: t('Проведённый баланс') }, { label: t('Текущий баланс') }] });
    if (which == null) return;
    const clearedOnly = which === 0;
    const cur = M.balance(acc.id, clearedOnly ? 'cleared' : 'current');
    const v = await promptBox(t('Правильный баланс'), (cur < 0 ? '-' : '') + amountInput(cur), { inputmode: 'decimal', message: t('Будет добавлена операция «Корректировка баланса» на разницу.') });
    if (v == null) return;
    const cents = evalAmount(v);
    if (cents == null) return toast(t('Неверная сумма'));
    const x = M.adjustBalance(acc.id, cents, clearedOnly);
    toast(x ? t('Добавлена корректировка {0}', money(x.amount, M.curOf(acc))) : t('Баланс уже верный'));
  }

  async rollup() {
    const n = this.shown.filter((e) => M.rollable(e, this.acc)).length;
    if (!n) return toast(t('Нечего сворачивать (переводы и будущие операции не сворачиваются)'));
    const ok = await confirmBox(t('Заменить {0} показанных операций одной итоговой (разбитой по категориям)? Это нельзя отменить.', n), { ok: t('Свернуть'), destructive: true, title: t('Свёртка') });
    if (ok) { M.rollup(this.acc, this.shown); toast(t('Готово')); }
  }
}

// Параметры вида журнала
export class RegisterViewScreen extends Screen {
  constructor() { super(); this.bodyClass = 'pinstripe'; }
  nav() { return { title: t('Вид журнала'), left: backButton(t('Назад')) }; }
  body() {
    const s = M.state.settings;
    const set = (k, v) => { s[k] = v; M.commit(); };
    const f = s.regFields;
    const setF = (k, v) => { f[k] = v; M.commit(); };
    return [
      group(SORTS.map((k) => checkCell(sortLabel(k), s.regSort === k, () => set('regSort', k))), { title: t('Сортировка') }),
      group([
        checkCell(t('По возрастанию (новые внизу)'), s.regAsc, () => set('regAsc', true)),
        checkCell(t('По убыванию (новые сверху)'), !s.regAsc, () => set('regAsc', false)),
      ]),
      group([
        switchCell(t('Категория'), f.category, (v) => setF('category', v)),
        switchCell(t('Номер'), f.num, (v) => setF('num', v)),
        switchCell(t('Класс'), f.cls, (v) => setF('cls', v)),
        switchCell(t('Примечание'), f.memo, (v) => setF('memo', v)),
        switchCell(t('Остаток после операции'), f.balance, (v) => setF('balance', v)),
      ], { title: t('Показывать в строке'), footer: t('Остаток показывается при сортировке по дате.') }),
    ];
  }
}
