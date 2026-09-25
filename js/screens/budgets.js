// Бюджеты (второй режим главного экрана)
import { h, money, today, monthYear, longDate, shortDate, diffDays, amountInput, evalAmount, parse } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import {
  Screen, push, pop, group, cell, inputCell, switchCell, checkCell, segmented, PickerScreen, actionSheet, sectionHeader,
  deleteCircle, chevron, confirmBox, toast, datePicker, backButton, barButton, haptic,
} from '../ui.js';
import { RegisterScreen } from './register.js';
import { categoryItems } from './txn.js';

export const periodName = (p) => ({
  daily: t('День'), weekly: t('Неделя'), biweekly: t('2 недели'), monthly: t('Месяц'), bimonthly: t('2 месяца'),
  quarterly: t('Квартал'), halfyear: t('Полгода'), yearly: t('Год'),
}[p]);
export const periodAdj = (p) => ({
  daily: t('в день'), weekly: t('в неделю'), biweekly: t('в 2 недели'), monthly: t('в месяц'), bimonthly: t('в 2 месяца'),
  quarterly: t('в квартал'), halfyear: t('в полгода'), yearly: t('в год'),
}[p]);
const ITEM_PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

export function rangeLabel(r) {
  if (r.start === r.end) return longDate(r.start);
  const s = parse(r.start), e = parse(r.end);
  if (s.getDate() === 1 && e.getMonth() === s.getMonth() && e.getFullYear() === s.getFullYear()) return monthYear(r.start);
  if (s.getDate() === 1 && s.getMonth() === 0 && e.getMonth() === 11 && e.getDate() === 31 && s.getFullYear() === e.getFullYear()) return String(s.getFullYear());
  return `${shortDate(r.start)} – ${shortDate(r.end)}`;
}

function range(screen) {
  const bs = M.state.settings.budget;
  if (!screen.brange || screen.brangeView !== bs.view || screen.brangeStart !== bs.start) {
    screen.brange = M.periodRange(bs.view, today(), bs.start);
    screen.brangeView = bs.view;
    screen.brangeStart = bs.start;
  }
  return screen.brange;
}

export function budgetsSub(screen) {
  const bs = M.state.settings.budget;
  const r = range(screen);
  const shift = (dir) => { screen.brange = M.shiftPeriod(bs.view, r, dir, bs.start); haptic(); screen.render(); };
  const right = { balance: t('Остаток'), available: t('Доступно'), budget: t('Бюджет') }[bs.rightCol];
  return h('div', null,
    h('div', { class: 'bperiod' },
      h('button', { type: 'button', class: 'pnav', onclick: () => shift(-1) }, '◀'),
      barButton({ label: rangeLabel(r), onClick: () => { screen.brange = null; screen.render(); } }),
      h('button', { type: 'button', class: 'pnav', onclick: () => shift(1) }, '▶')),
    screen.editing ? null : h('div', { class: 'bhead' }, h('span', null, t('Факт')), h('span', {
      onclick: () => {
        const order = ['balance', 'available', 'budget'];
        bs.rightCol = order[(order.indexOf(bs.rightCol) + 1) % 3];
        M.commit();
      },
    }, right + ' ▸')));
}

function compute(screen) {
  const bs = M.state.settings.budget;
  const r = range(screen);
  const v = M.budgetView(r);
  const len = diffDays(r.start, r.end) + 1;
  const td = today();
  const elapsed = td < r.start ? 0 : td > r.end ? 1 : (diffDays(r.start, td) + 1) / len;
  const sortFn = {
    category: (a, b) => a.b.category.localeCompare(b.b.category),
    actual: (a, b) => b.actual - a.actual,
    budget: (a, b) => b.budget - a.budget,
    percent: (a, b) => b.actual / (b.budget || 1) - a.actual / (a.budget || 1),
  }[bs.sort];
  const inc = v.items.filter((i) => i.b.kind === 'income').sort(sortFn);
  let exp = v.items.filter((i) => i.b.kind !== 'income').sort(sortFn);
  if (bs.hideZero) exp = exp.filter((i) => i.actual !== 0);
  return { r, inc, exp, unb: v.unbudgeted, elapsed, allExp: v.items.filter((i) => i.b.kind !== 'income') };
}

function drill(category, subcats, r) {
  const f = { ...M.emptyFilter(), name: category, category, subcats, dates: 'custom', from: r.start, to: r.end };
  if (!M.state.settings.budget.allAccounts) f.accounts = M.state.accounts.filter((a) => a.worth).map((a) => a.id); // как в budgetView
  push(new RegisterScreen({ filter: f, title: category, back: t('Бюджеты'), fixedFilter: true }));
}

function bmoney(c) { return money(c, null, { cents: M.state.settings.budget.cents }); }

function budgetRow(item, elapsed, r) {
  const bs = M.state.settings.budget;
  const { b, actual, budget } = item;
  const income = b.kind === 'income';
  let fill = 0, over = 0;
  if (budget > 0) {
    if (actual <= budget) fill = Math.max(0, actual / budget);
    else { fill = budget / actual; over = 1 - fill; }
  } else if (actual > 0) over = 1;
  const bal = income ? actual - budget : budget - actual;
  const avail = Math.round(budget * elapsed) - actual;
  const rightVal = bs.rightCol === 'budget' ? budget : bs.rightCol === 'available' ? (income ? actual - Math.round(budget * elapsed) : avail) : bal;
  return h('div', { class: 'brow' + (income ? ' income' : ''), onclick: () => drill(b.category, b.subcats, r) },
    h('span', { class: 'fill', style: { width: `${fill * 100}%` } }),
    over ? h('span', { class: 'overflow', style: { width: `${over * 100}%` } }) : null,
    h('span', { class: 'ba' }, bmoney(actual)),
    h('span', { class: 'bn' }, b.category),
    h('span', { class: 'bb2' + (rightVal < 0 ? ' red' : '') }, bmoney(rightVal)));
}

export function budgetsBody(screen) {
  if (screen.editing) return editBody(screen);
  const bs = M.state.settings.budget;
  const c = compute(screen);
  if (!M.state.budgets.length && !c.unb.length) {
    return h('div', { class: 'empty' }, t('Бюджетов пока нет.\nНажмите «Изм.», затем «+», чтобы задать лимит расходов по категории (например, «Еда» — 30 000 в месяц).'));
  }
  const out = [];
  const sec = (key, title, items) => {
    if (!items.length) return;
    const a = items.reduce((s, i) => s + i.actual, 0);
    const b = items.reduce((s, i) => s + i.budget, 0);
    const collapsed = !!bs.collapsed[key];
    out.push(sectionHeader(title, { right: t('{0} из {1}', bmoney(a), bmoney(b)), collapsed, onToggle: () => { bs.collapsed[key] = !collapsed; M.commit(); } }));
    if (!collapsed) {
      const list = h('div', { class: 'blist' }, items.map((i) => budgetRow(i, c.elapsed, c.r)));
      if (c.elapsed > 0 && c.elapsed < 1) list.append(h('span', { class: 'ibeam', style: { left: `${c.elapsed * 100}%` } }));
      out.push(list);
    }
  };
  sec('income', t('Доходы'), c.inc);
  sec('expense', t('Расходы'), c.exp);
  if (bs.showUnbudgeted && c.unb.length) {
    const collapsed = !!bs.collapsed.unb;
    const sum = c.unb.reduce((s, u) => s + u.actual, 0);
    out.push(sectionHeader(t('Вне бюджета'), { right: bmoney(sum), collapsed, onToggle: () => { bs.collapsed.unb = !collapsed; M.commit(); } }));
    if (!collapsed) {
      for (const u of c.unb.sort((a, b) => a.category.localeCompare(b.category))) {
        out.push(h('div', { class: 'brow unb', onclick: () => drill(u.category, false, c.r) },
          h('span', { class: 'ba' + (u.actual > 0 ? ' pos' : '') }, bmoney(Math.abs(u.actual))),
          h('span', { class: 'bn' }, u.category),
          h('span', { class: 'bb2 muted' }, '—')));
      }
    }
  }
  return out;
}

export function budgetsFooter(screen) {
  if (screen.editing) return null;
  const bs = M.state.settings.budget;
  const c = compute(screen);
  let incA = c.inc.reduce((s, i) => s + i.actual, 0);
  let expA = c.allExp.reduce((s, i) => s + i.actual, 0);
  const incB = c.inc.reduce((s, i) => s + i.budget, 0);
  const expB = c.allExp.reduce((s, i) => s + i.budget, 0);
  if (bs.includeUnbudgeted) for (const u of c.unb) { if (u.actual > 0) incA += u.actual; else expA -= u.actual; }
  let label, value;
  if (bs.footer === 'saved') {
    value = incA - expA;
    label = value >= 0 ? t('Сэкономлено') : t('Дефицит');
  } else {
    value = expB - expA + (incA - incB);
    label = value >= 0 ? t('Лучше бюджета на') : t('Хуже бюджета на');
  }
  return h('div', { class: 'bfoot' + (value < 0 ? ' bad' : ''), onclick: () => { bs.footer = bs.footer === 'saved' ? 'beat' : 'saved'; M.commit(); } },
    h('span', { class: 'arr' }, '◀'), h('span', { style: { fontWeight: 'normal' } }, label), bmoney(Math.abs(value)));
}

function editBody(screen) {
  const out = [];
  const row = (b) => h('div', { class: 'row tap', onclick: () => push(new EditBudgetScreen(b.id)) },
    deleteCircle(async () => {
      if (await confirmBox(t('Удалить бюджет «{0}»?', b.category), { ok: t('Удалить'), destructive: true })) {
        M.state.budgets = M.state.budgets.filter((x) => x.id !== b.id);
        M.commit();
      }
    }),
    h('span', { class: 'grow' }, b.category, b.subcats ? h('div', { class: 'sub' }, t('с подкатегориями')) : null),
    h('span', { class: 'amt', style: { fontWeight: 'normal' } }, money(b.amount, null, { cents: false }), h('div', { class: 'sub', style: { textAlign: 'right' } }, periodAdj(b.period))),
    chevron());
  const inc = M.state.budgets.filter((b) => b.kind === 'income').sort((a, b) => a.category.localeCompare(b.category));
  const exp = M.state.budgets.filter((b) => b.kind !== 'income').sort((a, b) => a.category.localeCompare(b.category));
  if (inc.length) { out.push(sectionHeader(t('Доходы'))); out.push(...inc.map(row)); }
  if (exp.length) { out.push(sectionHeader(t('Расходы'))); out.push(...exp.map(row)); }
  const used = new Set(M.state.budgets.map((b) => b.category));
  const free = M.state.categories.filter((c) => !used.has(c));
  if (free.length) {
    out.push(sectionHeader(t('Без бюджета')));
    for (const c of free) {
      out.push(h('div', { class: 'row tap', onclick: () => push(new EditBudgetScreen(null, c)) },
        h('span', { class: 'grow' + (c.includes(':') ? ' muted' : '') }, c), h('span', { class: 'rplus' }, '+')));
    }
  }
  return out;
}

export async function pickView(screen) {
  const kinds = Object.keys(M.PERIODS);
  const i = await actionSheet({ title: t('Показывать бюджет за'), buttons: kinds.map((k) => ({ label: periodName(k) })) });
  if (i == null) return;
  M.state.settings.budget.view = kinds[i];
  screen.brange = null;
  M.commit();
}

export class EditBudgetScreen extends Screen {
  constructor(id, category) {
    super();
    this.bodyClass = 'pinstripe';
    this.noAutoRefresh = true;
    const found = id && M.state.budgets.find((b) => b.id === id);
    const isIncome = category && /^(Доход|Income)/i.test(category);
    this.b = found ? { ...found } : { category: category || '', kind: isIncome ? 'income' : 'expense', period: 'monthly', amount: 0, subcats: !!category && !category.includes(':') };
  }
  nav() {
    return {
      title: t('Бюджет'), left: { label: t('Отменить'), onClick: () => pop() },
      right: { label: t('Сохранить'), style: 'done', onClick: () => this.save() },
    };
  }
  async save() {
    document.activeElement?.blur?.();
    await new Promise((r) => setTimeout(r, 30));
    if (!this.b.category) return toast(t('Выберите категорию'));
    if (!this.b.amount) return toast(t('Введите сумму бюджета'));
    M.saveBudget(this.b);
    pop();
  }
  body() {
    const b = this.b;
    return [
      group([
        cell({ label: t('Категория'), value: b.category, placeholder: t('Выберите'), onClick: () => push(new PickerScreen({ title: t('Категория'), value: b.category, allowNew: true, items: categoryItems(), onPick: (v) => { b.category = v; M.addToList('categories', v); } })) }),
        h('div', { class: 'cell' }, segmented([{ value: 'expense', label: t('Расходы') }, { value: 'income', label: t('Доходы') }], b.kind, (v) => { b.kind = v; this.render(); }, 'light')),
        cell({ label: t('Период'), value: periodName(b.period), onClick: () => push(new PickerScreen({ title: t('Период'), value: b.period, search: false, index: false, items: ITEM_PERIODS.map((p) => ({ value: p, label: periodName(p) })), onPick: (v) => { b.period = v; } })) }),
        inputCell({ label: t('Сумма'), value: amountInput(b.amount), placeholder: '0', inputmode: 'decimal', onChange: (v) => { b.amount = Math.abs(evalAmount(v) || 0); } }),
        switchCell(t('Включая подкатегории'), !!b.subcats, (v) => (b.subcats = v)),
      ], { footer: t('Сумма пересчитывается под выбранный период просмотра: 3 000 в неделю ≈ 13 045 в месяц.') }),
      b.id ? group([h('div', {
        class: 'cell danger tap', onclick: async () => {
          if (await confirmBox(t('Удалить бюджет?'), { ok: t('Удалить'), destructive: true })) {
            M.state.budgets = M.state.budgets.filter((x) => x.id !== b.id);
            M.commit();
            pop();
          }
        },
      }, t('Удалить бюджет'))], { cls: 'danger' }) : null,
    ];
  }
}

export class BudgetOptionsScreen extends Screen {
  constructor() { super(); this.bodyClass = 'pinstripe'; }
  nav() { return { title: t('Вид бюджета'), left: backButton('PocketMoney') }; }
  body() {
    const bs = M.state.settings.budget;
    const set = (k, v) => { bs[k] = v; M.commit(); };
    return [
      group([
        cell({ label: t('Начало'), value: longDate(bs.start), onClick: async () => { const v = await datePicker(bs.start, { title: t('Начало бюджетного периода') }); if (v) set('start', v); } }),
      ], { footer: t('От этой даты отсчитываются периоды (например, месяц с 10-го числа, если зарплата 10-го).') }),
      group(['category', 'actual', 'budget', 'percent'].map((k) => checkCell({ category: t('Категория'), actual: t('Факт'), budget: t('Бюджет'), percent: t('% потрачено') }[k], bs.sort === k, () => set('sort', k))), { title: t('Сортировка') }),
      group([
        switchCell(t('Скрывать пустые расходы'), bs.hideZero, (v) => set('hideZero', v)),
        switchCell(t('Показывать вне бюджета'), bs.showUnbudgeted, (v) => set('showUnbudgeted', v)),
        switchCell(t('Учитывать вне бюджета в итоге'), bs.includeUnbudgeted, (v) => set('includeUnbudgeted', v)),
        switchCell(t('Показывать копейки'), bs.cents, (v) => set('cents', v)),
        switchCell(t('Все счета'), bs.allAccounts, (v) => set('allAccounts', v), t('Выкл. — только счета из общего итога')),
      ]),
    ];
  }
}
