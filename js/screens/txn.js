// Редактирование операции, сплиты, повтор, курс валюты
import { h, clone, money, longDate, today, evalAmount, amountInput, fmtRate, weekdayNames, parse, currencyName, allCurrencies } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import {
  Screen, push, pop, top, toolbar, segmented, subbar, balanceBar, group, cell, inputCell, switchCell, checkCell, PickerScreen,
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

// Поле суммы с калькулятором: "120+35". Сумма уходит в модель на каждый ввод:
// на iPhone тап по кнопке не снимает фокус, и onchange может не случиться. onValue(cents, прежнее)
function amountCell(label, cents, onValue, extra = {}) {
  let last = cents ?? 0; // последнее верное значение: недописанное «120+» его не трогает
  const c = inputCell({
    label, value: amountInput(cents), placeholder: '0', inputmode: 'decimal',
    onInput: (v) => { const r = v.trim() ? evalAmount(v) : 0; if (r != null) { const p = last; last = r; onValue(r, p); } },
    onChange: (v) => {
      const r = v.trim() ? evalAmount(v) : 0;
      if (r == null) toast(t('Неверная сумма'));
      c.input.setCents(Math.abs(r ?? last)); // показать итог: «120+35» → «155,00»
    },
    right: extra.right,
  });
  c.input.setCents = (x) => { last = x; c.input.value = amountInput(x); };
  c.input.cents = () => last;
  if (extra.key) c.input.dataset.f = extra.key;
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
    this.fees = []; // «+Комиссия»: запишется вместе с операцией
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
    if (JSON.stringify(this.d) !== this.origJson || this.ruleChanged || this.fees.length) {
      const i = await actionSheet({ title: t('Сохранить изменения?'), buttons: [{ label: t('Сохранить') }, { label: t('Не сохранять'), destructive: true }] });
      if (i === 0) return this.save();
      if (i !== 1) return;
    }
    pop();
  }

  flushInputs() {
    document.activeElement?.blur?.();
  }

  // Перевод между валютами: пишешь в одно поле — другое сразу пересчитывается по курсу
  syncXfer(src, cents) {
    const d = this.d;
    if (!this.toAmtInput || cents == null) return; // нет поля «Зачислено» или выражение ещё не дописано
    cents = Math.abs(cents);
    if (src === 'amount') {
      d.amount = cents;
      d.toAmount = null; // посчитается по курсу при сохранении
      this.toAmtInput.setCents(M.convert(cents, d.acc, d.to));
    } else {
      d.toAmount = cents;
      d.amount = M.convert(cents, d.to, d.acc);
      this.amountInputEl.setCents(d.amount);
    }
  }

  // Перерисовать, не трогая поле в фокусе: на iPhone его замена прячет клавиатуру и съедает набранное
  rerender() {
    const a = document.activeElement, k = a?.dataset?.f;
    if (!k || !this.el.contains(a)) return this.render();
    const live = this.el, sc = this.scroller.scrollTop;
    this.el = h('div');
    this.render();
    const fresh = this.el, b = fresh.querySelector(`[data-f="${k}"]`);
    this.el = live;
    if (!b) { live.replaceChildren(...fresh.childNodes); this.scroller.scrollTop = sc; return; } // поля больше нет
    // новое вставляем вокруг живой ячейки, поднимаясь до экрана
    for (let l = a.closest('.cell'), f = b.closest('.cell'); l !== live; l = l.parentNode, f = f.parentNode) {
      for (const n of [...l.parentNode.childNodes]) if (n !== l) n.remove();
      const kids = [...f.parentNode.childNodes], i = kids.indexOf(f);
      l.before(...kids.slice(0, i));
      l.after(...kids.slice(i + 1));
    }
    this.scroller = a.closest('.content');
    for (const p in this) if (this[p] === b) this[p] = a;
    // значение поменялось в обход поля (автозаполнение) — показать; набранное не трогаем
    if (a.cents ? Math.abs(a.cents()) !== Math.abs(evalAmount(b.value) ?? 0) : a.value !== b.value) {
      if (a.setCents) a.setCents(evalAmount(b.value) ?? 0); else a.value = b.value;
      a.select();
    }
  }

  setType(v) {
    this.flushInputs();
    const d = this.d;
    if (v === 't') {
      if (M.state.accounts.length < 2) return toast(t('Для перевода нужен второй счёт'));
      d.type = 't';
      if (d.splits.length) { d.amount = Math.abs(d.splits.reduce((a, s) => a + s.amount, 0)); d.splits = []; }
      if (!d.to || d.to === d.acc) {
        pickAccount(t('Перевод на'), null, (id) => { d.to = id; d.toAmount = null; }, d.acc);
      }
    } else {
      const tot = this.splitTotal();
      // знак итога сплита меняется — меняем знак каждой части (−1000 и +300 → +1000 и −300)
      if (tot && (tot < 0) !== (v === 'w')) d.splits.forEach((s) => (s.amount = -s.amount));
      d.type = v;
    }
    this.render();
  }

  splitTotal() { return this.d.splits.reduce((a, s) => a + s.amount, 0); }

  // true — что-то подставили
  applyAuto(payee) {
    const s = M.state.settings;
    if (!this.isNew || !s.autocomplete) return false;
    const last = M.lastByPayee(payee);
    if (!last) return false;
    const d = this.d;
    const was = JSON.stringify(d);
    if (!d.category && !d.splits.length && last.category) d.category = last.category;
    if (!s.clearSplitsOnAuto && last.splits?.length && !d.splits.length && !this.touched.amount) d.splits = clone(last.splits);
    if (!this.touched.amount && !s.clearAmountOnAuto && !d.splits.length) {
      d.amount = Math.abs(last.amount);
      if (last.type !== 't') d.type = last.type;
    }
    if (d.splits.length) d.type = this.splitTotal() < 0 ? 'w' : 'd';
    if (!d.cls && last.cls) d.cls = last.cls;
    if (!d.num && last.num && !/^\d+$/.test(last.num)) d.num = last.num;
    if (JSON.stringify(d) === was) return false;
    haptic();
    return true;
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
      // перерисовать только если автозаполнение что-то подставило, и не трогая поле, куда уже перешёл фокус
      onChange: (v) => { d.payee = v.trim(); if (this.applyAuto(d.payee)) setTimeout(() => top() === this && this.rerender(), 150); },
      onBlur: () => setTimeout(() => sugg.replaceChildren(), 200),
      right: h('span', { class: 'chev', onclick: (e) => { e.preventDefault(); pickPayee(d.payee, d.category, (v) => { d.payee = v; this.applyAuto(v); }); } }),
    });
    this.payeeInput = c.input;
    c.input.dataset.f = 'payee';
    return [c, sugg];
  }

  categoryCell() {
    const d = this.d;
    if (d.splits.length) return cell({ label: t('Категория'), value: t('<--сплит-->'), onClick: () => this.openSplits() });
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
      detail: () => { this.flushInputs(); push(new RepeatScreen(this)); }, chevron: false,
    });
    const accCell = cell({ label: t('Счёт'), value: acc?.name, onClick: () => pickAccount(t('Счёт'), d.acc, (id) => { if (id !== d.acc) d.toAmount = null; d.acc = id; if (d.to === id) d.to = null; }) });

    let partyCells;
    if (d.type === 't') {
      partyCells = [cell({ label: t('Перевод на'), value: d.to ? M.accName(d.to) : '', placeholder: t('Выберите счёт'), onClick: () => pickAccount(t('Перевод на'), d.to, (id) => { if (id !== d.to) d.toAmount = null; d.to = id; }, d.acc) })];
    } else {
      partyCells = this.payeeCell();
    }
    const catCell = this.categoryCell();

    let amtCell;
    if (d.splits.length) {
      amtCell = cell({ label: t('Сумма'), value: money(this.splitTotal(), M.curOf(acc)), onClick: () => this.openSplits() });
    } else {
      const rateBtn = multi && d.type !== 't'
        ? h('button', { type: 'button', class: 'mini', onclick: (e) => { e.preventDefault(); this.flushInputs(); push(new ExchangeScreen(this)); } },
          d.fCur ? `${d.fCur} × ${fmtRate(d.fRate || 1)}` : '× 1')
        : null;
      amtCell = amountCell(t('Сумма'), d.amount, (v, prev) => {
        this.touched.amount = true;
        d.amount = Math.abs(v);
        if (d.fAmt && d.fRate) d.fAmt = Math.round(d.amount / d.fRate);
        this.syncXfer('amount', d.amount);
        // «−500» — меняем Расход/Доход (и обратно, если минус стёрли); поле с фокусом не трогаем
        if (d.type !== 't' && (v < 0) !== (prev < 0)) { d.type = d.type === 'w' ? 'd' : 'w'; this.rerender(); }
      }, { right: rateBtn, key: 'amount' });
      this.amountInputEl = amtCell.input;
    }

    const first = [dateCell, accCell];
    if (d.type === 't') first.push(...partyCells);
    else if (s.categoryFirst) first.push(catCell, ...partyCells);
    else first.push(...partyCells, catCell);
    first.push(amtCell);
    this.toAmtInput = null;
    if (d.type === 't') {
      const to = M.account(d.to);
      if (multi && to && M.curOf(to) !== M.curOf(acc)) {
        const toAmt = d.toAmount ?? M.convert(d.amount, d.acc, d.to);
        const toCell = amountCell(t('Зачислено'), toAmt, (v) => this.syncXfer('to', v), {
          right: h('span', { class: 'muted' }, M.curOf(to)), key: 'toAmt',
        });
        this.toAmtInput = toCell.input;
        first.push(toCell);
      }
      first.push(cell({ label: t('Категория'), value: d.category, placeholder: t('необязательно'), onClick: () => pickCategory(d.category, '', (v) => { d.category = v; }) }));
    }

    const f = s.txnFields;
    const second = [];
    if (f.num) {
      const nextBtn = acc?.chk ? h('button', { type: 'button', class: 'mini', onclick: (e) => { e.preventDefault(); d.num = String(acc.chk); this.render(); } }, t('След. №')) : null;
      const c = inputCell({ label: t('Номер'), value: d.num, placeholder: t('№ чека, Банкомат…'), onInput: (v) => (d.num = v), right: [nextBtn, h('span', { class: 'chev', onclick: (e) => { e.preventDefault(); pickFromList('ids', t('Номер'), d.num, (v) => { d.num = v; }); } })] });
      c.input.dataset.f = 'num';
      second.push(c);
    }
    if (f.cleared) second.push(switchCell(t('Проведена'), !!d.cleared, (v) => (d.cleared = v)));
    if (f.memo) {
      const c = inputCell({ label: t('Примечание'), value: d.memo, placeholder: t('Примечание'), onInput: (v) => (d.memo = v) });
      c.input.dataset.f = 'memo';
      second.push(c);
    }
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
    const f = this.opts.fromAcc; // открыли из журнала счёта-получателя — его балансы
    const a = (f && f === this.d.to && M.account(f)) || this.acc;
    return balanceBar([
      { label: M.balanceLabel('cleared'), cents: M.balance(a.id, 'cleared'), cur: M.curOf(a) },
      { label: M.balanceLabel('current'), cents: M.balance(a.id, 'current'), cur: M.curOf(a) },
    ]);
  }

  toolbar() {
    const acc = this.acc;
    return toolbar(
      this.templateMode ? null : { icon: 'dup', onClick: () => this.duplicate() },
      this.d.type !== 't' ? { icon: 'splits', onClick: () => this.openSplits() } : null,
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

  openSplits() { this.flushInputs(); push(new SplitsScreen(this)); }

  async save() {
    if (this.saving) return; // двойной тап «Сохранить»
    this.saving = true;
    if (await this.store()) pop(); else this.saving = false;
  }

  // Записать операцию (общее для «Сохранить» и «Дублировать»); false — не записана
  async store() {
    this.flushInputs();
    await new Promise((r) => setTimeout(r, 30)); // дать сработать onchange
    if (!this.validate()) return false;
    const d = this.d;
    if (d.splits.length === 1) {
      const sp = d.splits[0];
      d.category = sp.category; d.amount = Math.abs(sp.amount); d.type = sp.amount ? (sp.amount < 0 ? 'w' : 'd') : d.type;
      if (sp.memo && !d.memo) d.memo = sp.memo;
      if (sp.cls && !d.cls) d.cls = sp.cls;
      d.splits = [];
    }
    if (this.templateMode) {
      M.saveRepeatTemplate(d, this.rule, this.opts.repeatId);
      haptic('ok');
      return true;
    }
    let future = false;
    const r = d.rep && M.repeat(d.rep);
    if (r && !this.isNew && !this.ruleChanged && JSON.stringify(d) !== this.origJson) {
      const i = await actionSheet({ title: t('Это повторяющаяся операция'), buttons: [{ label: t('Изменить только эту') }, { label: t('Эту и все будущие') }] });
      if (i == null) return false;
      future = i === 1;
    }
    const x = M.saveTxn(d, { silent: true });
    d.id = x.id; d.seq = x.seq; // повторная запись — та же операция, а не копия
    if (this.ruleChanged) {
      const rr = M.applyRepeat(x, this.rule, x.rep);
      if (rr) x.rep = rr.id; else delete x.rep;
    } else if (future && r) {
      M.applyToFuture(r, x);
    }
    for (const f of this.fees.splice(0)) {
      M.saveTxn({
        acc: f.acc, type: 'w', date: x.date, amount: f.amount, payee: t('Комиссия'), category: 'Банк:Комиссии',
        cls: '', num: '', memo: x.payee ? t('за «{0}»', x.payee) : '', cleared: false, splits: [],
      }, { silent: true });
    }
    M.postDueRepeats();
    M.commit();
    haptic('ok');
    return true;
  }

  async duplicate() {
    if (this.saving) return;
    this.saving = true;
    this.flushInputs();
    const dirty = this.isNew || this.ruleChanged || this.fees.length || JSON.stringify(this.d) !== this.origJson;
    if (!(dirty ? await this.store() : this.validate())) { this.saving = false; return; }
    const copy = clone(this.d);
    delete copy.id; delete copy.seq; delete copy.rep; delete copy.mod; delete copy.opening;
    copy.date = today();
    copy.cleared = false;
    copy.toCleared = false;
    pop();
    setTimeout(() => push(new EditTxnScreen(copy)), 50);
    toast(t('Копия операции'));
  }

  // комиссия запишется при сохранении операции (отмена — без комиссии)
  addFee() {
    this.flushInputs();
    const acc = this.acc;
    this.fees.push({ acc: acc.id, amount: acc.fee });
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
    // при нуле знак берём из типа операции (−0 < 0 — ложь, и расход превращался в доход)
    if (d.splits.length === 1) {
      const sp = d.splits[0];
      d.category = sp.category; d.amount = Math.abs(sp.amount); d.type = (sp.amount || this.sign) < 0 ? 'w' : 'd';
      d.splits = [];
    } else if (d.splits.length) d.type = (this.p.splitTotal() || this.sign) < 0 ? 'w' : 'd';
    else d.amount = Math.abs(this.total);
    this.p.touched.amount = true;
    this.p.render(); // pop() перерисовал редактор до onClose
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
const prec = (r) => +r.toPrecision(10); // toFixed(6) портил мелкие курсы (VND: 8928,57 → 8927,50)
const rateStr = (r) => String(r).replace('.', M.state.settings.lang === 'ru' ? ',' : '.');

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
    this.amt = d.amount; // сумма по счёту: введённая вручную остаётся как есть
    this.order = ['fAmt', 'fRate']; // два последних правленых поля; третье считается
  }
  nav() { return { title: t('Курс'), left: backButton(t('Операция')), right: { label: t('Готово'), style: 'done', onClick: () => { document.activeElement?.blur(); this.apply(); } } }; }
  apply() {
    if (this.applied) return; // двойной тап «Готово»
    this.applied = true;
    const d = this.p.d;
    if (this.fCur === M.curOf(this.p.acc) && this.fRate === 1) { delete d.fCur; delete d.fRate; delete d.fAmt; }
    else { d.fCur = this.fCur; d.fRate = this.fRate; d.fAmt = this.fAmt; }
    d.amount = this.amt;
    this.p.touched.amount = true;
    pop();
  }
  // «Любые два значения — третье посчитается»: на каждый ввод пересчитываем поле, которое правили давнее всех
  set(k, v) {
    this[k] = v;
    this.order = [k, ...this.order.filter((x) => x !== k)].slice(0, 2);
    let c = ['fAmt', 'fRate', 'amt'].find((x) => !this.order.includes(x));
    if (c === 'fRate' && !(this.fAmt && this.amt)) {
      if (k !== 'amt' || !this.amt) return; // курс из нуля не посчитать
      c = 'fAmt'; // суммы в валюте нет — считаем её по курсу
    }
    if (c === 'amt') this.amt = Math.round(this.fAmt * this.fRate);
    else if (c === 'fAmt') this.fAmt = Math.round(this.amt / this.fRate);
    else this.fRate = prec(this.amt / this.fAmt);
    if (c === 'fRate') this.rateInp.value = rateStr(this.fRate); // соседнее поле — без render(), фокус не сбиваем
    else (c === 'amt' ? this.amtInp : this.fAmtInp).setCents(this[c]);
  }
  guessRate(code) {
    const acc = this.p.acc;
    const other = M.state.accounts.find((a) => a.currency === code);
    const homeRate = code === M.state.settings.home ? 1 : other ? M.rateOf(other) : 1;
    return prec(homeRate / M.rateOf(acc));
  }
  body() {
    const acc = this.p.acc;
    const fAmt = amountCell(t('Сумма в валюте'), this.fAmt, (v) => this.set('fAmt', Math.abs(v)));
    const rate = inputCell({
      label: t('Курс'), value: rateStr(this.fRate), inputmode: 'decimal',
      onInput: (v) => { const r = parseFloat(v.replace(',', '.')); if (r > 0) this.set('fRate', r); },
      onChange: () => { this.rateInp.value = rateStr(this.fRate); },
      right: h('button', { type: 'button', class: 'mini', onclick: (e) => { e.preventDefault(); this.set('fRate', prec(1 / this.fRate)); this.rateInp.value = rateStr(this.fRate); } }, '1/x'),
    });
    const amt = amountCell(t('Сумма по счёту'), this.amt, (v) => this.set('amt', Math.abs(v)), { right: h('span', { class: 'muted' }, M.curOf(acc)) });
    this.fAmtInp = fAmt.input; this.rateInp = rate.input; this.amtInp = amt.input;
    return [
      group([
        cell({ label: t('Валюта'), value: `${this.fCur} — ${currencyName(this.fCur)}`, onClick: () => push(new PickerScreen({
          title: t('Валюта'), value: this.fCur, items: allCurrencies().map((c) => ({ value: c, label: `${c} — ${currencyName(c)}` })),
          onPick: (v) => { this.fCur = v; this.set('fRate', this.guessRate(v)); },
        })) }),
        fAmt, rate, amt,
      ], { footer: t('Введите любые два значения — третье посчитается само.') }),
    ];
  }
}
