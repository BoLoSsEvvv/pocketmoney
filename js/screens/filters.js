// Фильтры: список сохранённых и редактор
import { h, clone, longDate } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import {
  Screen, push, pop, popTo, group, cell, inputCell, checkCell, segmented, PickerScreen, datePicker, backButton,
  sectionHeader, chevron, swipeToDelete, toast, disclosure,
} from '../ui.js';
import { RegisterScreen } from './register.js';
import { categoryItems } from './txn.js';

export function filterSummary(f) {
  const parts = [];
  if (f.type !== 'all') parts.push({ w: t('расходы'), d: t('доходы'), t: t('переводы') }[f.type]);
  if (f.dates !== 'all') parts.push(f.dates === 'custom' ? `${f.from ? longDate(f.from) : '…'} – ${f.to ? longDate(f.to) : '…'}` : M.datePresetLabel(f.dates).toLowerCase());
  if (Array.isArray(f.accounts)) parts.push(f.accounts.map(M.accName).join(', '));
  if (f.accounts === 'current') parts.push(t('текущий счёт'));
  if (f.payee) parts.push(f.payee);
  if (f.category) parts.push(f.category);
  if (f.cls) parts.push(f.cls);
  if (f.num) parts.push('№ ' + f.num);
  if (f.cleared !== 'any') parts.push(f.cleared === 'yes' ? t('проведённые') : t('непроведённые'));
  if (f.memo) parts.push('«' + f.memo + '»');
  return parts.join(' • ') || t('все операции');
}

export class FiltersScreen extends Screen {
  constructor(reg) {
    super();
    this.reg = reg; // журнал, к которому применяется фильтр (или null — с главного экрана)
  }
  nav() {
    return {
      title: t('Фильтры'), left: backButton(this.reg ? t('Журнал') : t('Счета')),
      right: { icon: 'plus', onClick: () => push(new EditFilterScreen(M.emptyFilter(), { reg: this.reg, list: this })) },
    };
  }
  apply(f) {
    if (this.reg) {
      this.reg.filter = f;
      pop();
    } else push(new RegisterScreen({ filter: f, title: f.name || t('Фильтр'), back: t('Фильтры'), fixedFilter: true }));
  }
  body() {
    const reg = this.reg;
    const out = [];
    if (reg?.filter) {
      out.push(h('div', { class: 'row tap link', onclick: () => { reg.filter = null; pop(); } }, h('span', { class: 'grow' }, t('Сбросить фильтр'))));
      out.push(h('div', { class: 'row tap', onclick: () => pop() },
        h('span', { class: 'grow' }, t('Текущий фильтр'), h('div', { class: 'sub' }, filterSummary(reg.filter))),
        disclosure(() => push(new EditFilterScreen(clone(reg.filter), { reg, list: this })))));
    } else {
      out.push(h('div', { class: 'row tap link', onclick: () => push(new EditFilterScreen(M.emptyFilter(), { reg, list: this, temp: true })) },
        h('span', { class: 'grow' }, t('Новый временный фильтр…')), chevron()));
    }
    const list = M.state.filters.filter((f) => !reg?.acc || !Array.isArray(f.accounts) || f.accounts.includes(reg.acc));
    out.push(sectionHeader(t('Сохранённые')));
    for (const f of list) {
      const row = h('div', { class: 'row tap', onclick: () => this.apply(f) },
        h('span', { class: 'grow' }, f.name || t('Без названия'), h('div', { class: 'sub' }, filterSummary(f))),
        disclosure(() => push(new EditFilterScreen(clone(f), { reg, list: this }))));
      swipeToDelete(row, () => { M.state.filters = M.state.filters.filter((x) => x.id !== f.id); M.commit(); });
      out.push(row);
    }
    if (!list.length) out.push(h('div', { class: 'empty' }, t('Сохранённых фильтров нет. Нажмите «+».')));
    out.push(h('div', { class: 'empty', style: { fontSize: '14px' } }, t('Подсказка: в полях получателя, категории и класса можно использовать % (любые символы) и _ (один символ). Например, «Авто%».')));
    return out;
  }
}

export class EditFilterScreen extends Screen {
  constructor(f, { reg, list, temp } = {}) {
    super();
    this.f = f;
    this.reg = reg;
    this.list = list;
    this.temp = temp;
    this.bodyClass = 'pinstripe';
    this.noAutoRefresh = true;
  }
  nav() {
    return {
      title: this.f.id ? t('Фильтр') : t('Новый фильтр'),
      left: { label: t('Отменить'), onClick: () => pop() },
      right: { label: this.temp ? t('Показать') : t('Сохранить'), style: 'done', onClick: () => this.save() },
    };
  }
  async save() {
    document.activeElement?.blur?.();
    await new Promise((r) => setTimeout(r, 30));
    const f = this.f;
    if (!this.temp) {
      if (!f.name?.trim()) return toast(t('Введите название фильтра'));
      M.saveFilter(f);
    }
    if (this.reg) {
      this.reg.filter = f;
      popTo(this.reg);
    } else if (this.temp) {
      pop();
      setTimeout(() => push(new RegisterScreen({ filter: f, title: t('Фильтр'), back: t('Фильтры'), fixedFilter: true })), 50);
    } else pop();
  }
  body() {
    const f = this.f;
    const accLabel = f.accounts === 'all' ? t('Все счета') : f.accounts === 'current' ? t('Текущий счёт') : f.accounts.map(M.accName).join(', ');
    const wild = (label, key, list, items) => inputCell({
      label, value: f[key], placeholder: t('любой'), onInput: (v) => (f[key] = v.trim()),
      right: h('span', {
        class: 'chev', onclick: (e) => {
          e.preventDefault();
          push(new PickerScreen({ title: label, value: f[key], allowNew: true, items: items || M.state[list].map((v) => ({ value: v, label: v })), none: { label: t('любой'), value: '' }, onPick: (v) => { f[key] = v; } }));
        },
      }),
    });
    return [
      this.temp ? null : group([inputCell({ label: t('Название'), value: f.name, placeholder: t('Например, Отпуск 2026'), onInput: (v) => (f.name = v) })]),
      group([
        h('div', { class: 'cell' }, segmented([
          { value: 'all', label: t('Все') }, { value: 'w', label: t('Расход') }, { value: 'd', label: t('Доход') }, { value: 't', label: t('Перевод') },
        ], f.type, (v) => { f.type = v; this.render(); }, 'light')),
        cell({ label: t('Счета'), value: accLabel, onClick: () => this.pickAccounts() }),
        cell({ label: t('Даты'), value: M.datePresetLabel(f.dates), onClick: () => push(new PickerScreen({
          title: t('Даты'), value: f.dates, search: false, index: false,
          items: M.DATE_PRESETS.map((p) => ({ value: p, label: M.datePresetLabel(p) })), onPick: (v) => { f.dates = v; },
        })) }),
        f.dates === 'custom' ? cell({ label: t('С'), value: f.from ? longDate(f.from) : t('нет'), onClick: async () => { const v = await datePicker(f.from, { allowNone: true }); if (v != null) { f.from = v || null; this.render(); } } }) : null,
        f.dates === 'custom' ? cell({ label: t('По'), value: f.to ? longDate(f.to) : t('нет'), onClick: async () => { const v = await datePicker(f.to, { allowNone: true }); if (v != null) { f.to = v || null; this.render(); } } }) : null,
      ]),
      group([
        wild(t('Получатель'), 'payee', 'payees'),
        wild(t('Категория'), 'category', null, categoryItems()),
        wild(t('Класс'), 'cls', 'classes'),
        wild(t('Номер'), 'num', 'ids'),
        inputCell({ label: t('Примечание'), value: f.memo, placeholder: t('содержит'), onInput: (v) => (f.memo = v.trim()) }),
      ], { footer: t('% — любые символы, _ — один символ. «Еда%» найдёт «Еда:Продукты» и «Еда:Кафе».') }),
      group([
        checkCell(t('Неважно'), f.cleared === 'any', () => { f.cleared = 'any'; this.render(); }),
        checkCell(t('Проведённые'), f.cleared === 'yes', () => { f.cleared = 'yes'; this.render(); }),
        checkCell(t('Непроведённые'), f.cleared === 'no', () => { f.cleared = 'no'; this.render(); }),
      ], { title: t('Проведение') }),
    ];
  }
  pickAccounts() {
    const f = this.f;
    const isSel = (v) => (v === 'all' || v === 'current' ? f.accounts === v : Array.isArray(f.accounts) && f.accounts.includes(v));
    push(new PickerScreen({
      title: t('Счета'), search: false, index: false, multi: true, isSelected: isSel,
      items: [
        { value: 'all', label: t('Все счета') },
        { value: 'current', label: t('Текущий счёт'), sub: t('счёт журнала, из которого открыт фильтр') },
        ...M.sortedAccounts().map((a) => ({ value: a.id, label: a.name, icon: a.icon })),
      ],
      onPick: (v) => {
        if (v === 'all' || v === 'current') f.accounts = v;
        else {
          const arr = Array.isArray(f.accounts) ? [...f.accounts] : [];
          const i = arr.indexOf(v);
          if (i >= 0) arr.splice(i, 1); else arr.push(v);
          f.accounts = arr.length ? arr : 'all';
        }
      },
    }));
  }
}
