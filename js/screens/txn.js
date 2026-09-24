// Редактирование операции, сплиты, повтор, курс валюты
import { h, clone, money, longDate, today, evalAmount, amountInput, fmtRate, weekdayNames, parse, currencyName, allCurrencies } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import {
  Screen, push, pop, toolbar, segmented, subbar, balanceBar, group, cell, inputCell, switchCell, checkCell, PickerScreen,
  datePicker, actionSheet, confirmBox, alertBox, toast, backButton, deleteCircle, chevron, haptic, promptBox,
} from '../ui.js';

export const typeLabel = (ty) => ({ w: t('Расход'), d: t('Доход'), t: t('Перевод') }[ty]);

// ---------- выборщики ----------
export function pickAccount(title, value, onPick, exclude) {
  push(new PickerScreen({
    title, value, search: false, index: false,
    items: M.sortedAccounts().filter((a) => a.id !== exclude).map((a) => ({ value: a.id, label: a.name, icon: a.icon || '🏦', sub: money(M.balance(a.id), M.curOf(a)) })),
    onPick,
  }));
}

export function categoryItems() {
  return M.state.categories.map((c) => ({ value: c, label: c, indent: c.includes(':') }));
}

export function pickCategory(value, payee, onPick) {
  const linked = payee ? M.linkedValues('category', 'payee', payee) : [];
  push(new PickerScreen({
    title: t('Категория'), value, allowNew: true, items: categoryItems(),
    none: { label: t('<без категории>'), value: '' },
    linked: linked.length ? { label: payee, items: linked } : null,
    onPick,
  }));
}

export function pickPayee(value, category, onPick) {
  const linked = category ? M.linkedValues('payee', 'category', category) : [];
  push(new PickerScreen({
    title: t('Получатель'), value, allowNew: true, items: M.state.payees.map((p) => ({ value: p, label: p })),
    linked: linked.length ? { label: category, items: linked } : null,
    onPick,
  }));
}

export function pickFromList(list, title, value, onPick) {
  push(new PickerScreen({
    title, value, allowNew: true, items: M.state[list].map((p) => ({ value: p, label: p })),
    none: { label: t('<нет>'), value: '' }, onPick,
  }));
}

// Поле суммы с калькулятором: "120+35"
function amountCell(label, cents, onValue, extra = {}) {
  const c = inputCell({
    label, value: amountInput(cents), placeholder: '0', inputmode: 'decimal',
    onInput: extra.onInput,
    onChange: (v) => {
      const r = evalAmount(v);
      if (r == null && v.trim()) { toast(t('Неверная сумма')); return; }
      onValue(r ?? 0);
    },
    right: extra.right,
  });
  c.input.addEventListener('focus', () => setTimeout(() => c.input.select(), 30));
  return c;
}

// ---------- экран операции ----------
export class EditTxnScreen extends Screen {
  // src: сохранённая операция или черновик; opts: {fromAcc, repeatId, newRepeat}
  constructor(src, opts = {}) {
    super();
    this.opts = opts;
    this.bodyClass = 'pinstripe';
    this.noAutoRefresh = true;
    this.templateMode = !!(opts.repeatId || opts.newRepeat);
    if (opts.repeatId) {
      const r = M.repeat(opts.repeatId);
      this.d = { ...clone(r.tpl), date: r.next };
      this.rule = M.ruleOf(r);
    } else {
      this.d = clone(src);
      this.rule = M.ruleOf(this.d.rep && M.repeat(this.d.rep));
      if (opts.newRepeat) this.rule = { ...M.ruleOf(null), freq: 'monthly' };
    }
    const d = this.d;
    d.splits ??= [];
    d.amount = d.type === 't' ? Math.abs(d.amount) : d.splits.length ? d.amount : Math.abs(d.amount);
    this.isNew = !d.id && !opts.repeatId;
    this.touched = {};
    this.ruleChanged = false;
    this.origJson = JSON.stringify(this.d);
  }

  get acc() { return M.account(this.d.acc); }

  nav() {
    const d = this.d;
    return {
      title: this.templateMode ? t('Повтор') : this.isNew ? t('Новая операция') : t('Операция'),
      left: { label: t('Отменить'), onClick: () => this.cancel() },
      right: { label: t('Сохранить'), style: 'done', onClick: () => this.save() },
      sub: subbar(segmented(['w', 'd', 't'].map((v) => ({ value: v, label: typeLabel(v) })), d.type, (v) => this.setType(v))),
    };
  }

  onBack() { this.cancel(); }

  async cancel() {
    this.flushInputs();
    if (JSON.stringify(this.d) !== this.origJson || this.ruleChanged) {
      const i = await actionSheet({ title: t('Сохранить изменения?'), buttons: [{ label: t('Сохранить') }, { label: t('Не сохранять'), destructive: true }] });
      if (i === 0) return this.save();
      if (i !== 1) return;
    }
    pop();
  }

  flushInputs() {
    document.activeElement?.blur?.();
  }

  setType(v) {
    const d = this.d;
    if (v === 't') {
      if (M.state.accounts.length < 2) return toast(t('Для перевода нужен второй счёт'));
      d.type = 't';
      if (d.splits.length) { d.amount = Math.abs(d.splits.reduce((a, s) => a + s.amount, 0)); d.splits = []; }
      if (!d.to || d.to === d.acc) {
        pickAccount(t('Перевод на'), null, (id) => { d.to = id; }, d.acc);
      }
    } else {
      if (d.splits.length) {
        // меняем знак всех частей
        const sign = v === 'w' ? -1 : 1;
        d.splits.forEach((s) => (s.amount = sign * Math.abs(s.amount)));
      }
      d.type = v;
    }
    this.render();
  }

  splitTotal() { return this.d.splits.reduce((a, s) => a + s.amount, 0); }

  applyAuto(payee) {
    const s = M.state.settings;
    if (!this.isNew || !s.autocomplete) return;
    const last = M.lastByPayee(payee);
    if (!last) return;
    const d = this.d;
    if (!d.category && !d.splits.length && last.category) d.category = last.category;
    if (!s.clearSplitsOnAuto && last.splits?.length && !d.splits.length && !this.touched.amount) d.splits = clone(last.splits);
    if (!this.touched.amount && !s.clearAmountOnAuto && !d.splits.length) {
      d.amount = Math.abs(last.amount);
      if (last.type !== 't') d.type = last.type;
    }
    if (d.splits.length) d.type = this.splitTotal() < 0 ? 'w' : 'd';
    if (!d.cls && last.cls) d.cls = last.cls;
    if (!d.num && last.num && !/^\d+$/.test(last.num)) d.num = last.num;
    haptic();
  }

  payeeCell() {
    const d = this.d;
    const label = d.type === 'd' ? t('От кого') : t('Кому');
    const sugg = h('div', { class: 'suggest' });
    const showSugg = (q) => {
      q = (q || '').trim().toLowerCase();
      if (!q) return sugg.replaceChildren();
      const list = M.state.payees.filter((p) => p.toLowerCase().includes(q) && p.toLowerCase() !== q).slice(0, 6);
      sugg.replaceChildren(...list.map((p) => h('div', {
        onpointerdown: (e) => e.preventDefault(),
        onclick: () => { d.payee = p; this.applyAuto(p); this.render(); },
      }, p)));
    };
    const c = inputCell({
      label, value: d.payee, placeholder: t('Получатель'),
      onInput: (v) => { d.payee = v; showSugg(v); },
      onChange: (v) => { d.payee = v.trim(); if (this.isNew) { this.applyAuto(d.payee); setTimeout(() => this.render(), 150); } },
      onBlur: () => setTimeout(() => sugg.replaceChildren(), 200),
      right: h('span', { class: 'chev', onclick: (e) => { e.preventDefault(); pickPayee(d.payee, d.category, (v) => { d.payee = v; this.applyAuto(v); }); } }),
    });
    this.payeeInput = c.input;
    return [c, sugg];
  }

  categoryCell() {
    const d = this.d;
    if (d.splits.length) return cell({ label: t('Категория'), value: t('<--сплит-->'), onClick: () => push(new SplitsScreen(this)) });
    return cell({ label: t('Категория'), value: d.category, placeholder: t('Категория'), onClick: () => pickCategory(d.category, d.payee, (v) => { d.category = v; }) });
  }

  body() {
    const d = this.d;
    const s = M.state.settings;
    const acc = this.acc;
    const multi = s.multiCur;
    const repeating = this.rule.freq !== 'none';

    const dateCell = cell({
      label: t('Дата'), value: longDate(d.date), valueClass: repeating ? 'rep' : '',
      onClick: async () => { const v = await datePicker(d.date); if (v) { d.date = v; this.touched.date = true; this.render(); } },
      detail: () => push(new RepeatScreen(this)), chevron: false,
    });
    const accCell = cell({ label: t('Счёт'), value: acc?.name, onClick: () => pickAccount(t('Счёт'), d.acc, (id) => { d.acc = id; if (d.to === id) d.to = null; }) });

    let partyCells;
    if (d.type === 't') {
      partyCells = [cell({ label: t('Перевод на'), value: d.to ? M.accName(d.to) : '', placeholder: t('Выберите счёт'), onClick: () => pickAccount(t('Перевод на'), d.to, (id) => { d.to = id; }, d.acc) })];
    } else {
      partyCells = this.payeeCell();
    }
    const catCell = this.categoryCell();

    let amtCell;
    if (d.splits.length) {
      amtCell = cell({ label: t('Сумма'), value: money(this.splitTotal(), M.curOf(acc)), onClick: () => push(new SplitsScreen(this)) });
    } else {
      const rateBtn = multi && d.type !== 't'
        ? h('button', { type: 'button', class: 'mini', onclick: (e) => { e.preventDefault(); push(new ExchangeScreen(this)); } },
          d.fCur ? `${d.fCur} × ${fmtRate(d.fRate || 1)}` : '× 1')
        : null;
      amtCell = amountCell(t('Сумма'), d.amount, (v) => {
        this.touched.amount = true;
        if (v < 0 && d.type !== 't') { d.type = d.type === 'w' ? 'd' : 'w'; v = -v; d.amount = v; this.render(); return; }
        d.amount = Math.abs(v);
        if (d.fAmt && d.fRate) d.fAmt = Math.round(d.amount / d.fRate);
      }, { right: rateBtn, onInput: () => (this.touched.amount = true) });
      this.amountInputEl = amtCell.input;
    }

    const first = [dateCell, accCell];
    if (d.type === 't') first.push(...partyCells);
    else if (s.categoryFirst) first.push(catCell, ...partyCells);
    else first.push(...partyCells, catCell);
    first.push(amtCell);
    if (d.type === 't') {
      const to = M.account(d.to);
      if (multi && to && M.curOf(to) !== M.curOf(acc)) {
        const toAmt = d.toAmount ?? M.convert(d.amount, d.acc, d.to);
        first.push(amountCell(t('Зачислено'), toAmt, (v) => { d.toAmount = Math.abs(v); }, { right: h('span', { class: 'muted' }, M.curOf(to)) }));
      }
      first.push(cell({ label: t('Категория'), value: d.category, placeholder: t('необязательно'), onClick: () => pickCategory(d.category, '', (v) => { d.category = v; }) }));
    }

    const f = s.txnFields;
    const second = [];
    if (f.num) {
      const nextBtn = acc?.chk ? h('button', { type: 'button', class: 'mini', onclick: (e) => { e.preventDefault(); d.num = String(acc.chk); this.render(); } }, t('След. №')) : null;
      const c = inputCell({ label: t('Номер'), value: d.num, placeholder: t('№ чека, Банкомат…'), onInput: (v) => (d.num = v), right: [nextBtn, h('span', { class: 'chev', onclick: (e) => { e.preventDefault(); pickFromList('ids', t('Номер'), d.num, (v) => { d.num = v; }); } })] });
      second.push(c);
    }
    if (f.cleared) second.push(switchCell(t('Проведена'), !!d.cleared, (v) => (d.cleared = v)));
    if (f.memo) second.push(inputCell({ label: t('Примечание'), value: d.memo, placeholder: t('Примечание'), onInput: (v) => (d.memo = v) }));
    if (f.cls) second.push(cell({ label: t('Класс'), value: d.cls, placeholder: t('Класс'), onClick: () => pickFromList('classes', t('Класс'), d.cls, (v) => { d.cls = v; }) }));

    const out = [group(first)];
    if (second.length) out.push(group(second));
    if (repeating) out.push(h('div', { class: 'gfoot' }, t('Повтор: {0}', M.repeatLabel(this.rule)) + (this.rule.end ? ' ' + t('до {0}', longDate(this.rule.end)) : '')));
    if (this.templateMode) out.push(h('div', { class: 'gfoot' }, t('Дата — ближайшее повторение. Операции создаются автоматически при запуске.')));
    return out;
  }

  afterRender(again) {
    if (again || !this.isNew || this.focused) return;
    this.focused = true;
    const ff = M.state.settings.focusFirst;
    setTimeout(() => {
      if (ff === 'payee' && this.payeeInput) this.payeeInput.focus();
      else if (ff === 'amount' && this.amountInputEl) this.amountInputEl.focus();
      else if (ff === 'category' && this.d.type !== 't') pickCategory(this.d.category, this.d.payee, (v) => { this.d.category = v; });
    }, 380);
  }

  footer() {
    if (this.templateMode || !this.acc) return null;
    const a = this.acc;
    return balanceBar([
      { label: M.balanceLabel('cleared'), cents: M.balance(a.id, 'cleared'), cur: M.curOf(a) },
      { label: M.balanceLabel('current'), cents: M.balance(a.id, 'current'), cur: M.curOf(a) },
    ]);
  }

  toolbar() {
    const acc = this.acc;
    return toolbar(
      this.templateMode ? null : { icon: 'dup', onClick: () => this.duplicate() },
      this.d.type !== 't' ? { icon: 'splits', onClick: () => push(new SplitsScreen(this)) } : null,
      acc?.fee && !this.templateMode ? { label: '+' + t('Комиссия'), onClick: () => this.addFee() } : null,
      '|',
      this.isNew && !this.templateMode ? null : { icon: 'trash', onClick: () => this.remove() },
    );
  }

  validate() {
    const d = this.d;
    if (!this.acc) { toast(t('Выберите счёт')); return false; }
    if (d.type === 't' && (!d.to || d.to === d.acc)) { toast(t('Выберите счёт перевода')); return false; }
    return true;
  }

  async save() {
    this.flushInputs();
    await new Promise((r) => setTimeout(r, 30)); // дать сработать onchange
    if (!this.validate()) return;
    const d = this.d;
    if (d.splits.length === 1) {
      const sp = d.splits[0];
      d.category = sp.category; d.amount = Math.abs(sp.amount); d.type = sp.amount < 0 ? 'w' : 'd';
      if (sp.memo && !d.memo) d.memo = sp.memo;
      if (sp.cls && !d.cls) d.cls = sp.cls;
      d.splits = [];
    }
    if (this.templateMode) {
      M.saveRepeatTemplate(d, this.rule, this.opts.repeatId);
      haptic('ok');
      pop();
      return;
    }
    let future = false;
    const r = d.rep && M.repeat(d.rep);
    if (r && !this.isNew && !this.ruleChanged && JSON.stringify(d) !== this.origJson) {
      const i = await actionSheet({ title: t('Это повторяющаяся операция'), buttons: [{ label: t('Изменить только эту') }, { label: t('Эту и все будущие') }] });
      if (i == null) return;
      future = i === 1;
    }
    const x = M.saveTxn(d, { silent: true });
    if (this.ruleChanged) {
      const rr = M.applyRepeat(x, this.rule, x.rep);
      if (rr) x.rep = rr.id; else delete x.rep;
    } else if (future && r) {
      r.tpl = M.templateOf(x);
    }
    M.postDueRepeats();
    M.commit();
    haptic('ok');
    pop();
  }

  async duplicate() {
    this.flushInputs();
    await new Promise((r) => setTimeout(r, 30));
    if (!this.validate()) return;
    const copy = clone(this.d);
    delete copy.id; delete copy.seq; delete copy.rep; delete copy.mod; delete copy.opening;
    copy.date = today();
    copy.cleared = false;
    copy.toCleared = false;
    if (this.isNew || JSON.stringify(this.d) !== this.origJson) M.saveTxn(this.d);
    pop();
    setTimeout(() => push(new EditTxnScreen(copy)), 50);
    toast(t('Копия операции'));
  }

  addFee() {
    const acc = this.acc;
    M.saveTxn({
      acc: acc.id, type: 'w', date: this.d.date, amount: acc.fee, payee: t('Комиссия'), category: 'Банк:Комиссии',
      cls: '', num: '', memo: this.d.payee ? t('за «{0}»', this.d.payee) : '', cleared: false, splits: [],
    });
    toast(t('Добавлена комиссия {0}', money(acc.fee, M.curOf(acc))));
  }

  async remove() {
    if (this.templateMode) {
      if (await confirmBox(t('Удалить повторяющуюся операцию? Уже созданные операции останутся.'), { ok: t('Удалить'), destructive: true })) {
        M.removeRepeat(this.opts.repeatId);
        M.commit();
        pop();
      }
      return;
    }
    if (await confirmBox(t('Удалить эту операцию?'), { ok: t('Удалить'), destructive: true })) {
      M.deleteTxn(this.d.id);
      pop();
    }
  }
}

// ---------- сплиты ----------
export class SplitsScreen extends Screen {
  constructor(parent) {
    super();
    this.p = parent;
    this.editing = false;
    this.noAutoRefresh = true;
    const d = parent.d;
    this.sign = d.type === 'd' ? 1 : -1;
    this.total = d.splits.length ? parent.splitTotal() : this.sign * Math.abs(d.amount || 0);
    if (!d.splits.length && (d.category || d.amount)) {
      d.splits.push({ category: d.category || '', amount: this.sign * Math.abs(d.amount || 0), memo: '', cls: '' });
      d.category = '';
    }
  }
  nav() {
    return {
      title: t('Сплиты'), left: backButton(t('Операция')),
      right: { label: this.editing ? t('Готово') : t('Изм.'), style: this.editing ? 'done' : 'plain', onClick: () => { this.editing = !this.editing; this.render(); } },
    };
  }
  body() {
    const d = this.p.d;
    const cur = M.curOf(this.p.acc);
    if (!d.splits.length) return h('div', { class: 'empty' }, t('Разбейте одну операцию на несколько категорий.\nНажмите «+», чтобы добавить часть.'));
    return d.splits.map((sp, i) => h('div', { class: 'row tap', onclick: () => push(new SplitEditScreen(this, i)) },
      this.editing ? deleteCircle(() => { d.splits.splice(i, 1); this.render(); }) : null,
      h('span', { class: 'grow' }, sp.category || t('<без категории>'), sp.memo ? h('div', { class: 'sub' }, sp.memo) : null),
      h('span', { class: 'amt ' + (sp.amount > 0 ? 'pos' : 'neg') }, money(sp.amount, cur)),
      chevron()));
  }
  footer() {
    const sum = this.p.splitTotal();
    const cur = M.curOf(this.p.acc);
    const rem = this.total - sum;
    return h('div', { class: 'balbar', style: { height: 'auto', padding: '6px 16px', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' } },
      h('div', { class: 'lbl' }, t('Сумма сплитов'), '  ', h('b', { style: { color: '#fff' } }, money(sum, cur))),
      h('div', { class: 'lbl' }, t('Остаток'), '  ', h('b', { style: { color: rem ? '#ff6b6b' : '#fff' } }, money(rem, cur))),
      h('div', { class: 'lbl', style: { borderTop: '1px solid #555', paddingTop: '2px' } }, t('Итого'), '  ', h('b', { style: { color: '#fff' } }, money(this.total, cur))));
  }
  toolbar() {
    const d = this.p.d;
    return toolbar(
      { icon: 'plus', onClick: () => { d.splits.push({ category: '', amount: 0, memo: '', cls: '' }); push(new SplitEditScreen(this, d.splits.length - 1)); } },
      { label: t('+Остаток'), onClick: () => {
        const rem = this.total - this.p.splitTotal();
        if (!rem) return toast(t('Остатка нет'));
        d.splits.push({ category: '', amount: rem, memo: '', cls: '' });
        push(new SplitEditScreen(this, d.splits.length - 1));
      } },
      '|',
      { label: t('Выровнять'), onClick: () => { this.total = this.p.splitTotal(); this.render(); toast(t('Итог = сумма сплитов')); } },
    );
  }
  onClose() {
    const d = this.p.d;
    d.splits = d.splits.filter((s) => s.amount || s.category);
    if (d.splits.length === 1) {
      const sp = d.splits[0];
      d.category = sp.category; d.amount = Math.abs(sp.amount); d.type = sp.amount < 0 ? 'w' : 'd';
      d.splits = [];
    } else if (d.splits.length) d.type = this.p.splitTotal() < 0 ? 'w' : 'd';
    else d.amount = Math.abs(this.total);
    this.p.touched.amount = true;
  }
}

export class SplitEditScreen extends Screen {
  constructor(parent, i) {
    super();
    this.p = parent;
    this.i = i;
    this.bodyClass = 'pinstripe';
    this.noAutoRefresh = true;
    const a = this.sp.amount;
    this.neg = a < 0 ? true : a > 0 ? false : parent.sign < 0;
  }
  get sp() { return this.p.p.d.splits[this.i]; }
  nav() {
    return {
      title: t('Часть'), left: backButton(t('Сплиты')),
      right: { label: t('Готово'), style: 'done', onClick: () => { document.activeElement?.blur(); setTimeout(() => pop(), 30); } },
      sub: subbar(segmented([{ value: 'w', label: t('Расход') }, { value: 'd', label: t('Доход') }], this.neg ? 'w' : 'd', (v) => {
        this.neg = v === 'w';
        this.sp.amount = (this.neg ? -1 : 1) * Math.abs(this.sp.amount);
        this.render();
      })),
    };
  }
  body() {
    const sp = this.sp;
    return group([
      cell({ label: t('Категория'), value: sp.category, placeholder: t('Категория'), onClick: () => pickCategory(sp.category, this.p.p.d.payee, (v) => { sp.category = v; }) }),
      amountCell(t('Сумма'), sp.amount, (v) => { sp.amount = (this.neg ? -1 : 1) * Math.abs(v); }),
      inputCell({ label: t('Примечание'), value: sp.memo, placeholder: t('Примечание'), onInput: (v) => (sp.memo = v) }),
      cell({ label: t('Класс'), value: sp.cls, placeholder: t('Класс'), onClick: () => pickFromList('classes', t('Класс'), sp.cls, (v) => { sp.cls = v; }) }),
    ]);
  }
}

// ---------- повтор ----------
export class RepeatScreen extends Screen {
  constructor(parent) {
    super();
    this.p = parent;
    this.bodyClass = 'pinstripe';
    this.noAutoRefresh = true;
  }
  nav() { return { title: t('Повтор'), left: backButton(t('Операция')) }; }
  set(k, v) { this.p.rule[k] = v; this.p.ruleChanged = true; this.render(); }
  body() {
    const r = this.p.rule;
    const date = this.p.d.date;
    const out = [group(M.FREQS.map((f) => checkCell(
      { none: t('Нет'), daily: t('Ежедневно'), weekly: t('Еженедельно'), monthly: t('Ежемесячно'), yearly: t('Ежегодно') }[f],
      r.freq === f, () => this.set('freq', f),
    )), { title: t('Частота') })];
    if (r.freq === 'none') return out;
    const unit = { daily: t('дн.'), weekly: t('нед.'), monthly: t('мес.'), yearly: t('г.') }[r.freq];
    out.push(group([
      cell({
        label: t('Каждые'), value: `${r.every || 1} ${unit}`,
        right: h('span', { style: { display: 'flex', gap: '6px' } },
          h('button', { type: 'button', class: 'mini', onclick: (e) => { e.stopPropagation(); this.set('every', Math.max(1, (r.every || 1) - 1)); } }, '−'),
          h('button', { type: 'button', class: 'mini', onclick: (e) => { e.stopPropagation(); this.set('every', (r.every || 1) + 1); } }, '+')),
      }),
      cell({
        label: t('До'), value: r.end ? longDate(r.end) : t('Без даты окончания'),
        onClick: async () => { const v = await datePicker(r.end || date, { allowNone: true, title: t('Последний повтор') }); if (v != null) this.set('end', v || null); },
      }),
    ]));
    if (r.freq === 'weekly') {
      const names = weekdayNames();
      const days = r.days?.length ? r.days : [parse(date).getDay()];
      out.push(group([1, 2, 3, 4, 5, 6, 0].map((wd) => checkCell(names[(wd + 6) % 7], days.includes(wd), () => {
        const set = new Set(days);
        if (set.has(wd)) set.delete(wd); else set.add(wd);
        if (!set.size) return;
        this.set('days', [...set]);
      })), { title: t('По дням недели') }));
    }
    if (r.freq === 'monthly') {
      const D = parse(date);
      const nth = Math.ceil(D.getDate() / 7);
      const wdName = new Intl.DateTimeFormat(M.state.settings.lang === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'long' }).format(D);
      const nthName = nth >= 5 ? t('последний') : [t('1-й'), t('2-й'), t('3-й'), t('4-й')][nth - 1];
      out.push(group([
        checkCell(t('{0}-го числа каждого месяца', D.getDate()), r.monthMode !== 'weekday', () => this.set('monthMode', 'date')),
        checkCell(t('{0} {1} месяца', nthName, wdName), r.monthMode === 'weekday', () => this.set('monthMode', 'weekday')),
      ], { title: t('Повторять') }));
    }
    const probe = { ...r, start: date };
    const next = [];
    let x = date;
    for (let i = 0; i < 4; i++) { x = M.occurrenceAfter(probe, x); if (!x || (r.end && x > r.end)) break; next.push(longDate(x)); }
    if (next.length) out.push(h('div', { class: 'gfoot' }, t('Следующие: {0}', next.join(', '))));
    return out;
  }
  onClose() { this.p.render(); }
}

// ---------- курс валюты для операции ----------
export class ExchangeScreen extends Screen {
  constructor(parent) {
    super();
    this.p = parent;
    this.bodyClass = 'pinstripe';
    this.noAutoRefresh = true;
    const d = parent.d;
    this.fCur = d.fCur || M.curOf(parent.acc);
    this.fRate = d.fRate || 1;
    this.fAmt = d.fAmt ?? d.amount;
  }
  nav() { return { title: t('Курс'), left: backButton(t('Операция')), right: { label: t('Готово'), style: 'done', onClick: () => { document.activeElement?.blur(); setTimeout(() => this.apply(), 30); } } }; }
  apply() {
    const d = this.p.d;
    if (this.fCur === M.curOf(this.p.acc) && this.fRate === 1) { delete d.fCur; delete d.fRate; delete d.fAmt; }
    else { d.fCur = this.fCur; d.fRate = this.fRate; d.fAmt = this.fAmt; }
    d.amount = Math.round(this.fAmt * this.fRate);
    this.p.touched.amount = true;
    pop();
  }
  guessRate(code) {
    const acc = this.p.acc;
    const other = M.state.accounts.find((a) => a.currency === code);
    const homeRate = code === M.state.settings.home ? 1 : other ? M.rateOf(other) : 1;
    return +(homeRate / M.rateOf(acc)).toFixed(6);
  }
  body() {
    const acc = this.p.acc;
    return [
      group([
        cell({ label: t('Валюта'), value: `${this.fCur} — ${currencyName(this.fCur)}`, onClick: () => push(new PickerScreen({
          title: t('Валюта'), value: this.fCur, items: allCurrencies().map((c) => ({ value: c, label: `${c} — ${currencyName(c)}` })),
          onPick: (v) => { this.fCur = v; this.fRate = this.guessRate(v); },
        })) }),
        amountCell(t('Сумма в валюте'), this.fAmt, (v) => { this.fAmt = Math.abs(v); this.render(); }),
        inputCell({
          label: t('Курс'), value: String(this.fRate).replace('.', M.state.settings.lang === 'ru' ? ',' : '.'), inputmode: 'decimal',
          onChange: (v) => { const r = parseFloat(v.replace(',', '.')); if (r > 0) { this.fRate = r; this.render(); } },
          right: h('button', { type: 'button', class: 'mini', onclick: (e) => { e.preventDefault(); this.fRate = +(1 / this.fRate).toFixed(6); this.render(); } }, '1/x'),
        }),
        amountCell(t('Сумма по счёту'), Math.round(this.fAmt * this.fRate), (v) => {
          if (this.fAmt) { this.fRate = +(Math.abs(v) / this.fAmt).toFixed(6); this.render(); }
        }, { right: h('span', { class: 'muted' }, M.curOf(acc)) }),
      ], { footer: t('Введите любые два значения — третье посчитается само.') }),
    ];
  }
}
