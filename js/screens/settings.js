// Настройки и справка
import { h, money, currencyName, fmtRate, sha256, longDate } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import * as storage from '../storage.js';
import {
  Screen, push, pop, group, cell, switchCell, checkCell, backButton, actionSheet, confirmBox, promptBox, toast,
  sectionHeader, chevron, swipeToDelete, alertBox, TG,
} from '../ui.js';
import { CurrencyPicker } from './account.js';
import { backup, importFile, exportMenu, demoState, deliverFile, toCSV, allQIF } from '../io.js';
import { pigEl } from '../pig.js';
import { VERSION } from '../config.js';

class PinScreen extends Screen {
  constructor() { super(); this.bodyClass = 'pinstripe'; }
}

export class SettingsScreen extends PinScreen {
  nav() { return { title: t('Настройки'), left: backButton('PocketMoney') }; }
  body() {
    const s = M.state.settings;
    const row = (label, Scr, value) => cell({ label, value, labelClass: 'wide plain', valueClass: 'right', onClick: () => push(new Scr()) });
    return [
      group([row(t('О программе'), AboutScreen), row(t('Справка'), HelpScreen)]),
      group([
        row(t('Пароль'), SecurityScreen, s.passHash ? t('Вкл.') : t('Выкл.')),
        row(t('Валюта'), CurrencyScreen, s.home + (s.multiCur ? ' +' : '')),
        row(t('Данные и копии'), DataScreen),
      ]),
      group([
        row(t('Оформление'), DisplayScreen),
        row(t('Ввод операций'), EntryScreen),
        row(t('Списки'), ListsScreen),
        row(t('Повторяющиеся'), RepeatSettingsScreen),
      ]),
      group([cell({
        label: t('Язык / Language'), value: s.lang === 'ru' ? 'Русский' : 'English', labelClass: 'wide plain', valueClass: 'right',
        onClick: async () => {
          const i = await actionSheet({ buttons: [{ label: 'Русский' }, { label: 'English' }] });
          if (i != null) { s.lang = i === 0 ? 'ru' : 'en'; M.commit(); }
        },
      })]),
      h('div', { class: 'gfoot' }, storage.hasCloud ? t('Данные хранятся в облаке Telegram и доступны на всех ваших устройствах.') : t('Приложение открыто вне Telegram: данные хранятся только в этом браузере.')),
    ];
  }
}

class AboutScreen extends PinScreen {
  nav() { return { title: t('О программе'), left: backButton(t('Настройки')) }; }
  body() {
    const st = M.state;
    return [
      h('div', { class: 'about' }, pigEl('pig'), h('h2', null, 'PocketMoney'), h('div', null, t('Классическая версия {0}', VERSION)),
        h('div', { class: 'muted', style: { fontSize: '14px', marginTop: '4px' } }, t('По мотивам PocketMoney от Catamount Software (2008–2013)'))),
      group([
        cell({ label: t('Счетов'), value: String(st.accounts.length), valueClass: 'right' }),
        cell({ label: t('Операций'), value: String(st.txns.length), valueClass: 'right' }),
        cell({ label: t('Повторов'), value: String(st.repeats.length), valueClass: 'right' }),
        cell({ label: t('Бюджетов'), value: String(st.budgets.length), valueClass: 'right' }),
      ]),
    ];
  }
}

class HelpScreen extends Screen {
  nav() { return { title: t('Справка'), left: backButton(t('Настройки')) }; }
  body() {
    const P = (title, ...ps) => [h('h3', null, title), ...ps.map((p) => h('p', null, p))];
    return h('div', { class: 'help' },
      P(t('Счета'),
        t('Главный экран — список счетов. Кольцо слева включает счёт в общий итог. Серый «+» справа — быстро добавить операцию в этот счёт.'),
        t('«Изм.» → «+» — новый счёт. В режиме «Изм.» можно удалять счета и менять их порядок, перетаскивая ≡.'),
        t('Чёрная строка внизу — баланс. Нажмите на неё, чтобы переключить: текущий, проведённый, будущий, доступно.')),
      P(t('Операции'),
        t('Откройте счёт, нажмите «+». Сверху выберите: Расход, Доход или Перевод. Начните вводить получателя — PocketMoney подставит категорию и сумму из прошлой операции с ним.'),
        t('В поле суммы работает калькулятор: 1200+350 или 3*450.'),
        t('Кнопка «сплит» внизу разбивает чек на несколько категорий. Синяя стрелка рядом с датой делает операцию повторяющейся.'),
        t('Кольцо в строке журнала — отметка «проведено» (сверено с банком). Смахните строку влево, чтобы удалить.')),
      P(t('Бюджеты'),
        t('Переключатель «Счета | Бюджеты» внизу главного экрана. Зелёная полоса — сколько потрачено, красная — перерасход. Оранжевая линия показывает, какая часть периода прошла.'),
        t('Кнопка с календарём меняет период просмотра, стрелки ◀ ▶ листают периоды.')),
      P(t('Фильтры и отчёты'),
        t('В журнале: «Отчёты» — круговые диаграммы по категориям, получателям, классам, счетам и по месяцам. Нажмите на строку отчёта, чтобы увидеть её операции.'),
        t('«Фильтр» — показать только нужные операции (период, категория, получатель…). Фильтры можно сохранять.'),
        t('«Сервис» — перейти к дате, скорректировать баланс, отметить всё проведённым, экспорт, свёртка старых операций.')),
      P(t('Данные'),
        t('Всё хранится в облаке Telegram и привязано к вашему аккаунту — телефон можно менять. Для надёжности иногда сохраняйте резервную копию: Настройки → Данные и копии.')));
  }
}

class SecurityScreen extends PinScreen {
  nav() { return { title: t('Пароль'), left: backButton(t('Настройки')) }; }
  body() {
    const s = M.state.settings;
    const delays = [0, 1, 5, 15, 60];
    const delayName = (m) => (m ? t('через {0} мин', m) : t('сразу'));
    return [
      group([
        s.passHash
          ? cell({ label: t('Выключить пароль'), labelClass: 'wide plain', onClick: async () => {
            if (await this.checkOld()) { s.passHash = null; M.commit(); toast(t('Пароль выключен')); }
          } })
          : cell({ label: t('Включить пароль'), labelClass: 'wide plain', onClick: () => this.setPass() }),
        s.passHash ? cell({ label: t('Сменить пароль'), labelClass: 'wide plain', onClick: async () => { if (await this.checkOld()) this.setPass(); } }) : null,
      ], { footer: t('Пароль из цифр будет спрашиваться при открытии. Если забыть пароль, данные не восстановить без резервной копии!') }),
      s.passHash ? group(delays.map((m) => checkCell(delayName(m), (s.passDelay || 0) === m, () => { s.passDelay = m; M.commit(); })), { title: t('Спрашивать после сворачивания') }) : null,
    ];
  }
  async checkOld() {
    const v = await promptBox(t('Текущий пароль'), '', { inputmode: 'numeric' });
    if (v == null) return false;
    if ((await sha256(v)) !== M.state.settings.passHash) { toast(t('Неверный пароль')); return false; }
    return true;
  }
  async setPass() {
    const a = await promptBox(t('Новый пароль'), '', { inputmode: 'numeric', message: t('Только цифры, любой длины') });
    if (!a) return;
    if (!/^\d+$/.test(a)) return toast(t('Только цифры'));
    const b = await promptBox(t('Повторите пароль'), '', { inputmode: 'numeric' });
    if (a !== b) return toast(t('Пароли не совпадают'));
    M.state.settings.passHash = await sha256(a);
    M.commit();
    toast(t('Пароль установлен'));
  }
}

class CurrencyScreen extends PinScreen {
  nav() { return { title: t('Валюта'), left: backButton(t('Настройки')) }; }
  body() {
    const s = M.state.settings;
    const out = [
      group([
        cell({ label: t('Основная'), value: `${s.home} — ${currencyName(s.home)}`, onClick: () => push(new CurrencyPicker(s.home, (v) => {
          const old = s.home;
          s.home = v;
          for (const a of M.state.accounts) if (!a.currency || a.currency === old && !s.multiCur) { a.currency = v; a.rate = 1; }
          M.commit();
        })) }),
        switchCell(t('Несколько валют'), s.multiCur, (v) => { s.multiCur = v; M.commit(); }, t('Счета в разных валютах с курсами')),
      ]),
    ];
    if (s.multiCur) {
      out.push(group([
        switchCell(t('Обновлять курсы при запуске'), s.autoRates, (v) => { s.autoRates = v; M.commit(); }),
        cell({ label: t('Обновить курсы сейчас'), labelClass: 'wide plain', onClick: async () => {
          toast(t('Загружаю курсы…'));
          try { const n = await M.updateRates(); toast(n ? t('Обновлено курсов: {0}', n) : t('Нет счетов в других валютах')); }
          catch { toast(t('Не удалось загрузить курсы')); }
        } }),
      ], { footer: M.state.ratesAt ? t('Последнее обновление: {0}', new Date(M.state.ratesAt).toLocaleString(s.lang === 'ru' ? 'ru-RU' : 'en-US')) : t('Курсы ЦБ РФ / open.er-api.com') }));
      const foreign = M.state.accounts.filter((a) => a.currency && a.currency !== s.home);
      if (foreign.length) {
        out.push(group(foreign.map((a) => cell({ label: a.name, value: `1 ${a.currency} = ${fmtRate(a.rate || 1)} ${s.home}`, valueClass: 'right' })), { title: t('Курсы по счетам'), footer: t('Курс счёта можно изменить вручную в карточке счёта.') }));
      }
    }
    return out;
  }
}

class DataScreen extends PinScreen {
  nav() { return { title: t('Данные'), left: backButton(t('Настройки')) }; }
  body() {
    const info = storage.sizeInfo(M.state);
    const pct = Math.round((info.chunks / info.maxChunks) * 100);
    return [
      group([
        cell({ label: t('Сохранить резервную копию'), labelClass: 'wide plain', onClick: () => backup() }),
        cell({ label: t('Восстановить / импорт из файла'), labelClass: 'wide plain', onClick: () => importFile() }),
      ], { title: t('Резервная копия'), footer: t('Копия — один файл .json со всеми данными. Отправьте его себе в «Избранное» Telegram.') }),
      group([
        cell({ label: t('Экспорт CSV / QIF…'), labelClass: 'wide plain', onClick: () => exportMenu() }),
      ], { footer: t('Импорт понимает файлы QIF (в том числе из старого PocketMoney и Quicken) и CSV с колонками «Дата» и «Сумма».') }),
      group([
        cell({ label: t('Размер данных'), value: `${Math.ceil(info.bytes / 1024)} КБ · ${pct}%`, valueClass: 'right' }),
        cell({ label: t('Где хранится'), value: storage.hasCloud ? t('облако Telegram') : t('этот браузер'), valueClass: 'right' }),
      ], { footer: t('Облако Telegram вмещает примерно 2 МБ сжатых данных — это десятки тысяч операций.') }),
      group([
        cell({ label: t('Загрузить пример'), labelClass: 'wide plain', onClick: async () => {
          if (await confirmBox(t('Заменить все данные примером (5 счетов, полгода операций, бюджеты)? Сначала сохраните копию, если нужно.'), { ok: t('Заменить'), destructive: true })) {
            M.replaceState(demoState());
            toast(t('Пример загружен'));
          }
        } }),
      ]),
      group([h('div', {
        class: 'cell danger tap', onclick: async () => {
          if (!(await confirmBox(t('Удалить ВСЕ счета, операции и настройки? Это нельзя отменить.'), { ok: t('Удалить всё'), destructive: true }))) return;
          const word = await promptBox(t('Точно?'), '', { message: t('Введите слово УДАЛИТЬ') });
          if ((word || '').trim().toUpperCase() !== t('УДАЛИТЬ')) return;
          const lang = M.state.settings.lang;
          const fresh = M.defaultState();
          fresh.settings.lang = lang;
          M.replaceState(fresh);
          toast(t('Все данные удалены'));
        },
      }, t('Удалить все данные'))], { cls: 'danger' }),
    ];
  }
}

class DisplayScreen extends PinScreen {
  nav() { return { title: t('Оформление'), left: backButton(t('Настройки')) }; }
  body() {
    const s = M.state.settings;
    const set = (k, v) => { s[k] = v; M.commit(); };
    const themes = [['blue', t('Синяя')], ['green', t('Зелёная')], ['purple', t('Фиолетовая')], ['gray', t('Серая')], ['coffee', t('Кофейная')]];
    return [
      group(themes.map(([k, label]) => checkCell(label, s.theme === k, () => set('theme', k))), { title: t('Тема') }),
      group([
        cell({ label: t('Размер шрифта'), value: `${s.fontSize} pt`, valueClass: 'right',
          right: h('span', { style: { display: 'flex', gap: '6px' } },
            h('button', { type: 'button', class: 'mini', onclick: (e) => { e.stopPropagation(); set('fontSize', Math.max(13, s.fontSize - 1)); } }, 'A−'),
            h('button', { type: 'button', class: 'mini', onclick: (e) => { e.stopPropagation(); set('fontSize', Math.min(24, s.fontSize + 1)); } }, 'A+')) }),
        checkCell(t('Обычные строки'), s.rowStyle === 'normal', () => set('rowStyle', 'normal')),
        checkCell(t('Короткие строки'), s.rowStyle === 'short', () => set('rowStyle', 'short')),
      ], { title: t('Строки') }),
      group([
        checkCell(t('Кольца'), s.toggleStyle === 'ring', () => set('toggleStyle', 'ring')),
        checkCell(t('Галочки'), s.toggleStyle === 'check', () => set('toggleStyle', 'check')),
      ], { title: t('Отметки') }),
      group([
        switchCell(t('Расходы красным'), s.redWithdrawals, (v) => set('redWithdrawals', v)),
        switchCell(t('Доходы чёрным'), s.blackDeposits, (v) => set('blackDeposits', v)),
        switchCell(t('Минус в скобках'), s.parens, (v) => set('parens', v), t('(1 234,00 ₽) вместо −1 234,00 ₽')),
      ], { title: t('Суммы') }),
    ];
  }
}

class EntryScreen extends PinScreen {
  nav() { return { title: t('Ввод операций'), left: backButton(t('Настройки')) }; }
  body() {
    const s = M.state.settings;
    const set = (k, v) => { s[k] = v; M.commit(); };
    const f = s.txnFields;
    const setF = (k, v) => { f[k] = v; M.commit(); };
    const focus = [['none', t('Ничего')], ['payee', t('Получатель')], ['category', t('Категория')], ['amount', t('Сумма')]];
    return [
      group(focus.map(([k, label]) => checkCell(label, s.focusFirst === k, () => set('focusFirst', k))), { title: t('Сначала заполнять') }),
      group([
        switchCell(t('Категория над получателем'), s.categoryFirst, (v) => set('categoryFirst', v)),
        switchCell(t('Дата последней операции'), s.lastDate, (v) => set('lastDate', v), t('Новые операции получают дату последней сохранённой, а не сегодняшнюю')),
      ]),
      group([
        switchCell(t('Автозаполнение'), s.autocomplete, (v) => set('autocomplete', v), t('По получателю подставлять категорию и сумму')),
        switchCell(t('Не подставлять сумму'), s.clearAmountOnAuto, (v) => set('clearAmountOnAuto', v)),
        switchCell(t('Не подставлять сплиты'), s.clearSplitsOnAuto, (v) => set('clearSplitsOnAuto', v)),
      ], { title: t('Автозаполнение') }),
      group([
        switchCell(t('Номер'), f.num, (v) => setF('num', v)),
        switchCell(t('Проведена'), f.cleared, (v) => setF('cleared', v)),
        switchCell(t('Примечание'), f.memo, (v) => setF('memo', v)),
        switchCell(t('Класс'), f.cls, (v) => setF('cls', v)),
      ], { title: t('Поля операции') }),
    ];
  }
}

class RepeatSettingsScreen extends PinScreen {
  nav() { return { title: t('Повторяющиеся'), left: backButton(t('Настройки')) }; }
  body() {
    const s = M.state.settings;
    const days = [0, 1, 3, 7, 15, 30];
    return [
      group([switchCell(t('Создавать автоматически'), s.postRepeats, (v) => { s.postRepeats = v; M.commit(); })], { footer: t('Повторяющиеся операции появляются в журнале сами при запуске приложения.') }),
      s.postRepeats ? group(days.map((d) => checkCell(d ? t('за {0} дн. до даты', d) : t('в день операции'), s.advanceDays === d, () => { s.advanceDays = d; M.commit(); })), { title: t('Создавать заранее') }) : null,
    ];
  }
}

const LIST_TITLES = () => ({ payees: t('Получатели'), categories: t('Категории'), classes: t('Классы'), ids: t('Номера') });

class ListsScreen extends PinScreen {
  nav() { return { title: t('Списки'), left: backButton(t('Настройки')) }; }
  body() {
    const s = M.state.settings;
    return [
      group([
        switchCell(t('Автозаполнение операций'), s.autocomplete, (v) => { s.autocomplete = v; M.commit(); }),
        switchCell(t('Добавлять новое в списки'), s.addToLists, (v) => { s.addToLists = v; M.commit(); }),
      ]),
      group(Object.entries(LIST_TITLES()).map(([k, label]) => cell({ label, value: String(M.state[k].length), labelClass: 'wide plain', valueClass: 'right', onClick: () => push(new ListEditScreen(k)) }))),
    ];
  }
}

class ListEditScreen extends Screen {
  constructor(list) { super(); this.list = list; }
  nav() {
    return {
      title: LIST_TITLES()[this.list], left: backButton(t('Списки')),
      right: { icon: 'plus', onClick: async () => { const v = await promptBox(t('Добавить'), '', { message: this.list === 'categories' ? t('Подкатегория — через двоеточие: Еда:Фрукты') : null }); if (v) M.addToList(this.list, v); } },
    };
  }
  body() {
    const items = M.state[this.list];
    if (!items.length) return h('div', { class: 'empty' }, t('Список пуст. Значения добавляются сами при вводе операций.'));
    return items.map((name) => {
      const sub = this.list === 'categories' && name.includes(':');
      const row = h('div', { class: 'row tap' + (sub ? ' indent' : ''), onclick: () => this.menu(name) },
        h('span', { class: 'grow' }, sub ? name.split(':').slice(1).join(':') : name, sub ? h('div', { class: 'sub' }, name.split(':')[0]) : null), chevron());
      swipeToDelete(row, () => this.remove(name));
      return row;
    });
  }
  async menu(name) {
    const buttons = [{ label: t('Переименовать') }];
    if (this.list === 'categories') buttons.push({ label: t('Добавить подкатегорию') });
    buttons.push({ label: t('Удалить'), destructive: true });
    const i = await actionSheet({ title: name, buttons });
    if (i == null) return;
    const action = buttons[i].label;
    if (action === t('Переименовать')) {
      const v = (await promptBox(t('Новое название'), name))?.trim();
      if (!v || v === name) return;
      const j = await actionSheet({ title: t('Переименовать «{0}» в «{1}»', name, v), buttons: [{ label: t('Везде (и в операциях)') }, { label: t('Только в списке') }] });
      if (j != null) M.renameInList(this.list, name, v, j === 0);
    } else if (action === t('Добавить подкатегорию')) {
      const v = (await promptBox(t('Подкатегория для «{0}»', name), ''))?.trim();
      if (v) M.addToList('categories', `${name}:${v}`);
    } else this.remove(name);
  }
  async remove(name) {
    const hasBudget = this.list === 'categories' && M.state.budgets.some((b) => b.category === name);
    if (hasBudget) {
      const i = await actionSheet({ title: t('У категории «{0}» есть бюджет', name), buttons: [{ label: t('Удалить из списка и бюджета'), destructive: true }, { label: t('Только из списка') }] });
      if (i == null) return;
      M.removeFromList(this.list, name, i === 0);
    } else M.removeFromList(this.list, name, false);
  }
}
