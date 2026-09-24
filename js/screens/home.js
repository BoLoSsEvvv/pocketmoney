// Главный экран: список счетов / бюджеты (переключаются в тулбаре)
import { h, money, fmtRate } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import {
  Screen, push, toolbar, segmented, balanceBar, sectionHeader, ring, roundPlus, chevron, deleteCircle,
  confirmBox, actionSheet, sortable, TG, toast, group, switchCell, checkCell, backButton, cell,
} from '../ui.js';
import { RegisterScreen } from './register.js';
import { EditTxnScreen } from './txn.js';
import { AccountInfoScreen } from './account.js';
import { SettingsScreen } from './settings.js';
import { FiltersScreen } from './filters.js';
import { RepeatsScreen } from './repeats.js';
import * as B from './budgets.js';
import { accountsChart } from './charts.js';
import { exportMenu } from '../io.js';

export const groupName = (g) => ({
  bank: t('Банковские счета'), cash: t('Наличные'), credit: t('Кредитные'), asset: t('Активы'),
  liability: t('Обязательства'), online: t('Онлайн'),
}[g]);

export function balClass(acc, bal) {
  if (M.overLimit(acc, bal)) return 'over';
  return bal > 0 ? 'pos' : bal < 0 ? 'neg' : '';
}

export function cycleBalance(slot) {
  const s = M.state.settings;
  const key = slot === 0 ? 'balanceType' : 'balanceType2';
  const i = M.BALANCE_TYPES.indexOf(s[key]);
  s[key] = M.BALANCE_TYPES[(i + 1) % M.BALANCE_TYPES.length];
  M.commit();
}

export function balanceSlots(fnValue, acc) {
  const s = M.state.settings;
  const types = s.secondBalance ? [s.balanceType, s.balanceType2] : [s.balanceType];
  return types.map((type) => {
    const cents = fnValue(type);
    return { label: M.balanceLabel(type, acc), cents, cur: acc ? M.curOf(acc) : s.home, red: cents < 0 };
  });
}

export class HomeScreen extends Screen {
  constructor() {
    super();
    this.mode = 'accounts';
    this.editing = false;
    this.brange = null;
  }

  nav() {
    const editBtn = {
      label: this.editing ? t('Готово') : t('Изм.'), style: this.editing ? 'done' : 'plain',
      onClick: () => { this.editing = !this.editing; this.render(); },
    };
    let right;
    if (this.editing) right = { icon: 'plus', onClick: () => (this.mode === 'accounts' ? push(new AccountInfoScreen(null)) : push(new B.EditBudgetScreen(null))) };
    else right = { icon: 'gear', onClick: () => push(new SettingsScreen()) };
    return {
      title: 'PocketMoney', left: editBtn, right,
      sub: this.mode === 'budgets' ? B.budgetsSub(this) : null,
    };
  }

  body() {
    return this.mode === 'accounts' ? this.accountsBody() : B.budgetsBody(this);
  }

  footer() {
    if (this.mode === 'budgets') return B.budgetsFooter(this);
    return balanceBar(balanceSlots((type) => M.totalBalance(type)), cycleBalance);
  }

  toolbar() {
    const seg = segmented(
      [{ value: 'accounts', label: t('Счета') }, { value: 'budgets', label: t('Бюджеты') }],
      this.mode,
      (v) => { this.mode = v; this.editing = false; this.render(); },
    );
    if (this.mode === 'budgets')
      return toolbar({ icon: 'calendar', onClick: () => B.pickView(this) }, '|', seg, '|', { icon: 'eye', onClick: () => push(new B.BudgetOptionsScreen()) });
    return toolbar({ icon: 'action', onClick: () => exportMenu() }, '|', seg, '|', { icon: 'eye', onClick: () => push(new AccountsViewScreen()) });
  }

  accountRow(a) {
    const s = M.state.settings;
    const online = a.type === 'online';
    const bal = online ? 0 : M.balance(a.id, 'current');
    const rate = M.rateOf(a);
    const open = () => {
      if (this.editing) return push(new AccountInfoScreen(a.id));
      if (online) {
        if (a.url) {
          const url = /^https?:/.test(a.url) ? a.url : 'https://' + a.url;
          TG?.openLink ? TG.openLink(url) : window.open(url, '_blank');
        } else push(new AccountInfoScreen(a.id));
        return;
      }
      push(new RegisterScreen({ acc: a.id }));
    };
    return h('div', { class: 'row tap acct', 'data-id': a.id, onclick: open },
      this.editing
        ? deleteCircle(async () => {
          if (await confirmBox(t('Удалить счёт «{0}» со всеми операциями?', a.name), { ok: t('Удалить'), destructive: true })) M.deleteAccount(a.id);
        })
        : ring(a.worth, () => { a.worth = !a.worth; M.commit(); }),
      h('span', { class: 'aicon' }, a.icon || '🏦'),
      h('span', { class: 'name' }, a.name),
      online ? null : h('span', { class: 'bal amt ' + balClass(a, bal) }, money(bal, M.curOf(a)),
        s.multiCur && rate !== 1 ? h('div', { class: 'rate' }, fmtRate(rate)) : null),
      this.editing
        ? (s.showAccounts === 'all' && !s.groupByType ? h('span', { class: 'grab' }, h('i')) : chevron())
        : online ? chevron() : roundPlus(() => push(new EditTxnScreen(M.newTxnDraft(a.id)))));
  }

  accountsBody() {
    const s = M.state.settings;
    const accs = M.visibleAccounts();
    const out = [];
    if (s.accountsChart !== 'none') out.push(accountsChart(s.accountsChart));
    if (s.groupByType) {
      for (const g of M.GROUPS) {
        const list = accs.filter((a) => M.TYPE_GROUP[a.type] === g);
        if (!list.length) continue;
        const sum = list.reduce((x, a) => x + (a.type === 'online' ? 0 : M.toHome(M.balance(a.id, 'current'), a)), 0);
        const collapsed = !!s.collapsed[g];
        out.push(sectionHeader(groupName(g), {
          right: g === 'online' ? '' : money(sum), collapsed,
          onToggle: () => { s.collapsed[g] = !collapsed; M.commit(); },
        }));
        if (!collapsed) out.push(...list.map((a) => this.accountRow(a)));
      }
    } else {
      out.push(sectionHeader(t('Счета')));
      const list = h('div', { class: 'acclist' }, accs.map((a) => this.accountRow(a)));
      out.push(list);
      if (this.editing) setTimeout(() => sortable(list, (ids) => M.reorderAccounts(ids)));
    }
    if (!accs.length) {
      out.push(h('div', { class: 'empty' }, M.state.accounts.length
        ? t('Нет счетов для показа. Проверьте «Показывать счета» в настройках вида (глаз).')
        : t('Счетов пока нет.\nНажмите «Изм.», затем «+», чтобы добавить счёт.')));
    }
    const custom = [];
    if (s.showAllTx) custom.push([t('Все операции'), () => push(new RegisterScreen({ acc: null }))]);
    if (s.showFilters) custom.push([t('Фильтры'), () => push(new FiltersScreen(null))]);
    if (s.showRepeating) custom.push([t('Повторяющиеся операции'), () => push(new RepeatsScreen())]);
    if (custom.length && !this.editing) {
      out.push(sectionHeader(t('Прочее…')));
      for (const [label, fn] of custom) out.push(h('div', { class: 'row tap link', onclick: fn }, h('span', { class: 'grow' }, label), chevron()));
    }
    if (this.editing) out.push(h('div', { class: 'empty' }, t('Нажмите на счёт, чтобы изменить его. Перетащите ≡, чтобы поменять порядок.')));
    return out;
  }
}

// Параметры вида для экрана счетов (кнопка «глаз»)
export class AccountsViewScreen extends Screen {
  constructor() { super(); this.bodyClass = 'pinstripe'; }
  nav() { return { title: t('Вид счетов'), left: backButton('PocketMoney') }; }
  body() {
    const s = M.state.settings;
    const set = (k, v) => { s[k] = v; M.commit(); };
    const opt = (k, v, label) => checkCell(label, s[k] === v, () => set(k, v));
    return [
      group([
        opt('showAccounts', 'all', t('Все')),
        opt('showAccounts', 'nonzero', t('Ненулевые')),
        opt('showAccounts', 'worth', t('Только в «Итого»')),
      ], { title: t('Показывать счета'), footer: t('Кольцо слева от счёта включает его в общий итог.') }),
      group([
        switchCell(t('Группировать по типу'), s.groupByType, (v) => set('groupByType', v)),
        switchCell(t('Вторая строка баланса'), s.secondBalance, (v) => set('secondBalance', v)),
      ]),
      group([
        cell({
          label: t('Будущий баланс'), value: s.futureDays ? t('на {0} дн. вперёд', s.futureDays) : t('все операции'),
          onClick: async () => {
            const opts = [7, 15, 30, 60, 90, 365, 0];
            const i = await actionSheet({ title: t('Будущий баланс учитывает операции'), buttons: opts.map((d) => ({ label: d ? t('на {0} дн. вперёд', d) : t('все будущие') })) });
            if (i != null) set('futureDays', opts[i]);
          },
        }),
      ]),
      group([
        opt('accountsChart', 'none', t('Нет')),
        opt('accountsChart', 'networth', t('Чистые активы')),
        opt('accountsChart', 'cashflow', t('Денежный поток')),
      ], { title: t('График над счетами') }),
      group([
        switchCell(t('Все операции'), s.showAllTx, (v) => set('showAllTx', v)),
        switchCell(t('Фильтры'), s.showFilters, (v) => set('showFilters', v)),
        switchCell(t('Повторяющиеся операции'), s.showRepeating, (v) => set('showRepeating', v)),
      ], { title: t('Раздел «Прочее…»') }),
    ];
  }
}
