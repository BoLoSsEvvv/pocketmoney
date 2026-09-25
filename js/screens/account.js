// Информация о счёте
import { h, clone, amountInput, evalAmount, evalNum, currencyName, allCurrencies, longDate, today } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import {
  Screen, push, pop, group, cell, inputCell, switchCell, PickerScreen, confirmBox, toast, datePicker, TG, haptic,
} from '../ui.js';

export const typeName = (ty) => ({
  checking: t('Текущий (дебетовая карта)'), savings: t('Сберегательный'), cash: t('Наличные'), credit: t('Кредитная карта'),
  creditline: t('Кредитная линия'), moneymarket: t('Вклад / депозит'), asset: t('Актив'), liability: t('Обязательство (долг)'),
  online: t('Онлайн (ссылка)'),
}[ty]);

export const ICON_SET = [
  '🏦', '💳', '💵', '💶', '💷', '💴', '💰', '🪙', '🐷', '👛', '👜', '💼', '🏠', '🏡', '🏢', '🚗', '🚙', '🏍️', '⛵', '✈️',
  '📈', '📉', '💹', '🧾', '🏧', '📱', '💻', '🛒', '🎁', '🎓', '🏥', '⛽', '🔧', '🌳', '🌻', '🐟', '🎣', '⚽', '🎲', '🎸',
  '👨', '👩', '👦', '👧', '👴', '👵', '❤️', '⭐', '🔒', '🌍', '🇷🇺', '🇺🇸', '🇪🇺', '🇬🇧', '🇨🇳', '🇹🇷', '🇰🇿', '🇧🇾', '🇦🇲', '🇬🇪',
];

export class AccountInfoScreen extends Screen {
  constructor(id) {
    super();
    this.bodyClass = 'pinstripe';
    this.noAutoRefresh = true;
    const s = M.state.settings;
    this.a = id ? clone(M.account(id)) : { name: '', type: 'checking', icon: '🏦', worth: true, currency: s.home, rate: 1 };
    this.isNew = !id;
    this.opening = 0;
  }
  nav() {
    return {
      title: this.isNew ? t('Новый счёт') : t('Счёт'),
      left: { label: t('Отменить'), onClick: () => pop() },
      right: { label: t('Сохранить'), style: 'done', onClick: () => this.save() },
    };
  }
  async save() {
    if (this.busy) return; // двойной тап «Сохранить»
    this.busy = true;
    document.activeElement?.blur?.();
    await new Promise((r) => setTimeout(r, 30));
    const a = this.a;
    a.name = (a.name || '').trim();
    if (!a.name) { this.busy = false; return toast(t('Введите название счёта')); }
    const saved = M.saveAccount(a);
    if (this.isNew && this.opening && a.type !== 'online') {
      M.saveTxn({
        acc: saved.id, type: this.opening < 0 ? 'w' : 'd', date: today(),
        amount: Math.abs(this.opening), payee: t('Начальный баланс'), category: '', cls: '', num: '', memo: '', cleared: true, splits: [], opening: true,
      });
    }
    haptic('ok');
    pop();
  }
  body() {
    const a = this.a;
    const s = M.state.settings;
    const link = (v, fn) => (v ? h('span', { class: 'disc', onclick: (e) => { e.preventDefault(); fn(); } }) : null);
    const openUrl = () => { const u = /^https?:/.test(a.url) ? a.url : 'https://' + a.url; TG?.openLink ? TG.openLink(u) : window.open(u, '_blank'); };
    const money2 = (label, key, hint) => inputCell({
      label, value: a[key] != null ? (a[key] < 0 ? '-' : '') + amountInput(a[key]) : '', placeholder: hint || '', inputmode: 'decimal',
      onInput: (v) => { const c = evalAmount(v); a[key] = v.trim() === '' ? null : c; },
    });
    const out = [
      group([
        inputCell({ label: t('Название'), value: a.name, placeholder: t('Например, Сбербанк'), onInput: (v) => (a.name = v) }),
        switchCell(t('В общем итоге'), a.worth, (v) => (a.worth = v)),
        cell({ label: t('Тип'), value: typeName(a.type), onClick: () => push(new PickerScreen({
          title: t('Тип счёта'), value: a.type, search: false, index: false,
          items: M.ACCOUNT_TYPES.map((ty) => ({ value: ty, label: typeName(ty) })), onPick: (v) => { a.type = v; },
        })) }),
        cell({ label: t('Значок'), value: h('span', { class: 'aicon sm' }, a.icon || '🏦'), onClick: () => push(new IconScreen(a)) }),
        cell({ label: t('Срок'), value: a.expires ? longDate(a.expires) : '', placeholder: t('Действует до'), onClick: async () => {
          const v = await datePicker(a.expires, { allowNone: true, title: t('Срок действия') });
          if (v != null) { a.expires = v || null; this.render(); }
        } }),
      ]),
    ];
    if (this.isNew && a.type !== 'online') {
      out.push(group([
        inputCell({
          label: t('Начальный баланс'), value: this.opening ? (this.opening < 0 ? '-' : '') + amountInput(this.opening) : '', placeholder: '0', inputmode: 'decimal',
          onInput: (v) => { this.opening = evalAmount(v) || 0; },
        }),
      ], { footer: t('Отрицательное значение — долг (например, для кредитной карты: -15000).') }));
    }
    out.push(group([
      inputCell({ label: t('Номер счёта'), value: a.number, placeholder: '', onInput: (v) => (a.number = v) }),
      inputCell({ label: t('Банк'), value: a.institution, placeholder: t('Учреждение'), onInput: (v) => (a.institution = v) }),
      inputCell({ label: t('Телефон'), value: a.phone, type: 'tel', onInput: (v) => (a.phone = v), right: link(a.phone, () => { location.href = 'tel:' + a.phone; }) }),
      inputCell({ label: t('Сайт'), value: a.url, type: 'url', placeholder: 'bank.ru', onInput: (v) => (a.url = v), right: link(a.url, openUrl) }),
    ]));
    if (a.type !== 'online') {
      const credit = M.isCreditish(a);
      out.push(group([
        money2(t('Комиссия'), 'fee', t('для кнопки +Комиссия')),
        money2(t('Лимит'), 'limit', credit ? t('кредитный лимит') : t('мин. остаток')),
        inputCell({ label: t('След. №'), value: a.chk, placeholder: t('номер чека'), inputmode: 'numeric', onInput: (v) => (a.chk = v) }),
      ], { footer: credit ? t('Лимит — кредитный лимит; баланс станет красным при его превышении.') : t('Лимит — минимальный остаток; баланс станет красным, если опустится ниже.') }));
    }
    if (s.multiCur) {
      out.push(group([
        cell({ label: t('Валюта'), value: `${a.currency || s.home} — ${currencyName(a.currency || s.home)}`, onClick: () => push(new CurrencyPicker(a.currency || s.home, (v) => {
          a.currency = v;
          if (v === s.home) a.rate = 1;
        })) }),
        (a.currency || s.home) !== s.home ? inputCell({
          label: t('Курс'), value: String(a.rate || 1).replace('.', s.lang === 'ru' ? ',' : '.'), inputmode: 'decimal',
          onInput: (v) => { const r = evalNum(v); if (r > 0) a.rate = r; },
          right: h('span', { class: 'muted' }, s.home),
        }) : null,
      ], { footer: (a.currency || s.home) !== s.home ? t('Сколько {0} стоит 1 {1}.', s.home, a.currency) : null }));
    }
    out.push(group([
      h('label', { class: 'cell' }, h('textarea', {
        class: 'inp', placeholder: t('Заметки'), value: a.notes || '', rows: 3, oninput: (e) => (a.notes = e.target.value),
      })),
    ]));
    if (!this.isNew) {
      out.push(group([h('div', {
        class: 'cell danger tap', onclick: async () => {
          const n = M.entriesOf(a.id).length;
          if (await confirmBox(t('Удалить счёт «{0}» и все его операции ({1})?', a.name, n), { ok: t('Удалить'), destructive: true })) {
            M.deleteAccount(a.id);
            pop();
          }
        },
      }, t('Удалить счёт'))], { cls: 'danger' }));
    }
    return out;
  }
}

class IconScreen extends Screen {
  constructor(a) { super(); this.a = a; this.bodyClass = 'pinstripe'; this.noAutoRefresh = true; }
  nav() { return { title: t('Значок'), left: { label: t('Назад'), style: 'back', onClick: () => pop() } }; }
  body() {
    return h('div', { class: 'iconpick' }, ICON_SET.map((ic) => h('span', {
      class: 'aicon' + (ic === this.a.icon ? ' sel' : ''), onclick: () => { this.a.icon = ic; haptic(); pop(); },
    }, ic)));
  }
}

export class CurrencyPicker extends PickerScreen {
  constructor(value, onPick) {
    const common = ['RUB', 'USD', 'EUR', 'CNY', 'GBP', 'KZT', 'BYN', 'TRY', 'AED', 'GEL', 'AMD', 'UAH'];
    const units = ['HRS', 'DAY', 'MIL', 'KMS', 'NON'];
    const all = allCurrencies();
    super({
      title: t('Валюта'), value, onPick,
      items: [
        ...common.map((c) => ({ value: c, label: `${c} — ${currencyName(c)}`, sub: t('часто используемые') })),
        ...units.map((c) => ({ value: c, label: currencyName(c), sub: t('не валюта') })),
        ...all.filter((c) => !common.includes(c)).map((c) => ({ value: c, label: `${c} — ${currencyName(c)}` })),
      ],
      index: false,
    });
  }
}
