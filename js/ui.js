// Навигация и элементы интерфейса в стиле iPhone OS 3.
import { h, append, money, parse, iso, addMonths, today, monthYear, weekdayNames, pad } from './util.js';
import { state } from './model.js';
import { t } from './i18n.js';

export const TG = window.Telegram?.WebApp;
export const haptic = (kind = 'select') => {
  try {
    if (kind === 'select') TG?.HapticFeedback?.selectionChanged();
    else if (kind === 'ok') TG?.HapticFeedback?.notificationOccurred('success');
    else if (kind === 'warn') TG?.HapticFeedback?.notificationOccurred('warning');
    else TG?.HapticFeedback?.impactOccurred(kind);
  } catch {}
};

// ---------- иконки ----------
const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" width="22" height="22" fill="currentColor" aria-hidden="true">${body}</svg>`;
export const ICONS = {
  gear: svg('<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm9.4 4.9-2.1-.3a7.6 7.6 0 0 1-.6 1.5l1.3 1.7-2.3 2.3-1.7-1.3c-.5.3-1 .5-1.5.6l-.3 2.1h-3.3l-.3-2.1a7.6 7.6 0 0 1-1.5-.6l-1.7 1.3-2.3-2.3 1.3-1.7a7.6 7.6 0 0 1-.6-1.5l-2.1-.3v-3.3l2.1-.3c.1-.5.3-1 .6-1.5L3.7 6.3 6 4l1.7 1.3c.5-.3 1-.5 1.5-.6L9.5 2.6h3.3l.3 2.1c.5.1 1 .3 1.5.6L16.3 4l2.3 2.3-1.3 1.7c.3.5.5 1 .6 1.5l2.1.3v3.3z"/>'),
  plus: svg('<path d="M10.5 3h3v7.5H21v3h-7.5V21h-3v-7.5H3v-3h7.5z"/>'),
  eye: svg('<path d="M12 5C6.5 5 2.4 9.2 1 12c1.4 2.8 5.5 7 11 7s9.6-4.2 11-7c-1.4-2.8-5.5-7-11-7zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-2.3a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"/>'),
  search: svg('<path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-2.1 2.1-5.1-5.1A7 7 0 1 1 10 3zm0 2.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8z"/>'),
  action: svg('<path d="M3 11h3v7h12v-7h3v10H3zM12 2l5.5 5.5-2 2-2.1-2V15h-2.8V7.5l-2.1 2-2-2z"/>'),
  calendar: svg('<path d="M3 5h18v16H3zm2 5v9h14v-9z" fill-rule="evenodd"/><rect x="6" y="2" width="2.5" height="5" rx="1"/><rect x="15.5" y="2" width="2.5" height="5" rx="1"/><path d="M11 12h2.2v6H11.4v-4.2l-1.2.6-.5-1.3z"/>'),
  trash: svg('<path d="M9 2h6l1 2h5v2H3V4h5zM5 8h14l-1.2 14H6.2zm4 2v10h1.6V10zm4.4 0v10H15V10z"/>'),
  dup: svg('<path d="M5 3h2v4h4v2H7v4H5V9H1V7h4zm10 6h2v4h4v2h-4v4h-2v-4h-4v-2h4z"/>'),
  splits: svg('<path d="M2 5h8v3H2zm0 5.5h8v3H2zM2 16h8v3H2zm10-9.5 3-1.5h7v3h-6.3L13 9.5zm0 5 1.4-1.5H22v3h-7.6zm0 5 1.4-1.5H22v3h-7.6z"/>'),
  chart: svg('<path d="M3 20h18v2H3zM5 11h3v8H5zm5-6h3v14h-3zm5 3h3v11h-3z"/>'),
};

// ---------- навигация ----------
const app = () => document.getElementById('app');
const stack = [];
export const top = () => stack[stack.length - 1];
export const depth = () => stack.length;

const backOk = () => TG?.BackButton && TG.isVersionAtLeast?.('6.1');
function syncBack() {
  if (!backOk()) return;
  if (stack.length > 1) TG.BackButton.show(); else TG.BackButton.hide();
}

export function setRoot(screen) {
  for (const s of stack) s.el.remove();
  stack.length = 0;
  stack.push(screen);
  screen.render();
  app().append(screen.el);
  syncBack();
}

export function push(screen) {
  const prev = top();
  stack.push(screen);
  screen.render();
  screen.el.classList.add('enter');
  app().append(screen.el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    screen.el.classList.remove('enter');
    prev?.el.classList.add('behind');
  }));
  setTimeout(() => prev && top() !== prev && prev.el.classList.add('hidden'), 360);
  syncBack();
  haptic('light');
}

export function pop(n = 1) {
  if (stack.length <= 1) return;
  n = Math.min(n, stack.length - 1);
  const leaving = stack.splice(stack.length - n, n);
  const cur = top();
  cur.el.classList.remove('hidden');
  cur.render();
  cur.onReturn?.();
  requestAnimationFrame(() => {
    cur.el.classList.remove('behind');
    const last = leaving[leaving.length - 1];
    last.el.classList.add('enter');
    for (const s of leaving.slice(0, -1)) s.el.remove();
    setTimeout(() => last.el.remove(), 360);
  });
  leaving.forEach((s) => s.onClose?.());
  syncBack();
}

export function popTo(screen) {
  const i = stack.indexOf(screen);
  if (i >= 0) pop(stack.length - 1 - i);
}

export function refresh() {
  const s = top();
  if (s && !s.noAutoRefresh) s.render();
  // скрытые экраны перерисуются при возврате
}

export function initBack() {
  if (backOk()) TG.BackButton.onClick(() => {
    if (closeModal()) return;
    const s = top();
    if (s?.onBack) s.onBack(); else pop();
  });
}

export class Screen {
  constructor() {
    this.el = h('div', { class: 'screen' });
  }
  nav() { return { title: '' }; }
  body() { return null; }
  render() {
    const prevScroll = this.scroller?.scrollTop;
    const n = this.nav();
    const parts = [navbar(n)];
    if (n.sub) parts.push(n.sub);
    this.scroller = h('div', { class: 'content ' + (this.bodyClass || '') });
    append(this.scroller, this.body());
    parts.push(this.scroller);
    const f = this.footer?.();
    if (f) parts.push(f);
    const tb = this.toolbar?.();
    if (tb) parts.push(tb);
    this.el.replaceChildren(...parts);
    if (prevScroll != null) this.scroller.scrollTop = prevScroll;
    this.afterRender?.(prevScroll != null);
  }
}

// ---------- панели ----------
export function barButton(spec) {
  if (!spec) return h('span', { class: 'bb-spacer' });
  const cls = ['bb', spec.style || 'plain', spec.icon && !spec.label ? 'icon' : ''].join(' ');
  const b = h('button', { class: cls, type: 'button', onclick: (ev) => { ev.stopPropagation(); spec.onClick?.(ev); } });
  if (spec.icon) b.insertAdjacentHTML('beforeend', ICONS[spec.icon]);
  if (spec.label) b.append(h('span', null, spec.label));
  if (spec.disabled) b.disabled = true;
  return b;
}

export function backButton(label, onClick) {
  return { label, style: 'back', onClick: onClick || (() => (top()?.onBack ? top().onBack() : pop())) };
}

export function navbar({ title, left, right, titleEl }) {
  return h('div', { class: 'navbar' },
    h('div', { class: 'nb-left' }, barButton(left)),
    h('div', { class: 'nb-title' }, titleEl || title),
    h('div', { class: 'nb-right' }, barButton(right)));
}

export function toolbar(...items) {
  return h('div', { class: 'toolbar' }, ...items.map((i) => (i === '|' ? h('span', { class: 'flex' }) : i && !(i instanceof Node) ? barButton(i) : i)));
}

export function segmented(options, value, onChange, cls = '') {
  return h('div', { class: 'seg ' + cls },
    options.map((o) => h('button', {
      type: 'button', class: o.value === value ? 'sel' : '',
      onclick: () => { if (o.value !== value) { haptic(); onChange(o.value); } },
    }, o.label)));
}

export function subbar(...kids) {
  return h('div', { class: 'subbar' }, ...kids);
}

// Чёрная строка баланса ◄ ► ; slots: [{label, cents, cur, red}]
export function balanceBar(slots, onTap) {
  return h('div', { class: 'balbar' },
    h('span', { class: 'arr l' }, '◀'),
    slots.map((s, i) => h('div', { class: 'slot' + (slots.length === 1 ? ' single' : ''), onclick: () => { haptic(); onTap?.(i); } },
      h('div', { class: 'lbl' }, s.label),
      h('div', { class: 'v' + (s.red ? ' red' : '') }, s.text ?? money(s.cents, s.cur)))),
    h('span', { class: 'arr r' }, '▶'));
}

export function sectionHeader(text, { right, collapsed, onToggle } = {}) {
  return h('div', { class: 'sechdr', onclick: onToggle },
    h('span', { class: 'st' }, text),
    right != null ? h('span', { class: 'sr' }, right) : null,
    onToggle ? h('span', { class: 'coll' }, collapsed ? '▼' : '▲') : null);
}

// ---------- ячейки ----------
export const chevron = () => h('span', { class: 'chev' });
export const disclosure = (onClick) => h('span', { class: 'disc', onclick: (e) => { e.stopPropagation(); onClick(); } });

export function ring(on, onClick) {
  const style = state.settings.toggleStyle;
  return h('span', {
    class: (style === 'check' ? 'chk' : 'ring') + (on ? ' on' : ' off'),
    onclick: (e) => { e.stopPropagation(); haptic(); onClick?.(); },
  });
}

export function switchEl(on, onChange) {
  const el = h('span', { class: 'sw' + (on ? ' on' : '') },
    h('span', { class: 'track' },
      h('span', { class: 'on-l' }, t('ВКЛ')),
      h('span', { class: 'knob' }),
      h('span', { class: 'off-l' }, t('ВЫКЛ'))));
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    on = !on;
    el.classList.toggle('on', on);
    haptic();
    onChange(on);
  });
  return el;
}

export function group(cells, { title, footer, cls } = {}) {
  return [
    title ? h('div', { class: 'gtitle' }, title) : null,
    h('div', { class: 'group ' + (cls || '') }, cells.filter(Boolean)),
    footer ? h('div', { class: 'gfoot' }, footer) : null,
  ];
}

// label/value ячейка сгруппированной таблицы
export function cell({ label, value, placeholder, onClick, chevron: ch, detail, valueClass, right, cls, labelClass }) {
  return h('div', { class: 'cell' + (onClick ? ' tap' : '') + (cls ? ' ' + cls : ''), onclick: onClick },
    label != null ? h('span', { class: 'lbl ' + (labelClass || '') }, label) : null,
    h('span', { class: 'val ' + (valueClass || '') + (value == null || value === '' ? ' ph' : '') }, value == null || value === '' ? placeholder || '' : value),
    right || null,
    detail ? disclosure(detail) : null,
    ch ?? onClick ? chevron() : null);
}

export function inputCell({ label, value, placeholder, onInput, onChange, type = 'text', inputmode, onFocus, onBlur, right, autocomplete = 'off', cls }) {
  const inp = h('input', {
    class: 'inp', type, value: value ?? '', placeholder: placeholder || '', inputmode, autocomplete, autocapitalize: 'sentences',
    oninput: (e) => onInput?.(e.target.value), onchange: (e) => onChange?.(e.target.value), onfocus: onFocus, onblur: onBlur,
    enterkeyhint: 'done', onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
  });
  const c = h('label', { class: 'cell ' + (cls || '') }, label != null ? h('span', { class: 'lbl' }, label) : null, inp, right || null);
  c.input = inp;
  return c;
}

export function switchCell(label, on, onChange, hint) {
  return h('div', { class: 'cell' }, h('span', { class: 'lbl wide' }, label, hint ? h('div', { class: 'hint' }, hint) : null), switchEl(on, onChange));
}

export function checkCell(label, checked, onClick, cls) {
  return h('div', { class: 'cell tap ' + (cls || ''), onclick: onClick }, h('span', { class: 'lbl wide plain' }, label), checked ? h('span', { class: 'check' }, '✓') : null);
}

export function deleteCircle(onClick) {
  return h('span', { class: 'delc', onclick: (e) => { e.stopPropagation(); onClick(); } });
}

export function roundPlus(onClick) {
  return h('span', { class: 'rplus', onclick: (e) => { e.stopPropagation(); haptic('light'); onClick(); } }, '+');
}

// ---------- свайп для удаления ----------
export function swipeToDelete(row, onDelete) {
  let x0 = null, y0 = null, open = false, dx = 0;
  const btn = h('button', { class: 'swipe-del', type: 'button', onclick: (e) => { e.stopPropagation(); onDelete(); } }, t('Удалить'));
  row.append(btn);
  const close = () => { open = false; row.classList.remove('swiped'); };
  row.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; }, { passive: true });
  row.addEventListener('touchmove', (e) => {
    if (x0 == null) return;
    dx = e.touches[0].clientX - x0;
    if (Math.abs(e.touches[0].clientY - y0) > 20) x0 = null;
  }, { passive: true });
  row.addEventListener('touchend', () => {
    if (x0 == null) return;
    if (dx < -40 && !open) {
      document.querySelectorAll('.swiped').forEach((r) => r.classList.remove('swiped'));
      open = true; row.classList.add('swiped'); haptic();
    } else if (dx > 40 && open) close();
    x0 = null;
  });
  row.addEventListener('click', (e) => {
    if (open && e.target !== btn) { e.stopImmediatePropagation(); close(); }
  }, true);
}

// ---------- перетаскивание для сортировки ----------
export function sortable(container, onDone) {
  container.querySelectorAll('.grab').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const row = handle.closest('[data-id]');
      const rows = [...container.querySelectorAll('[data-id]')];
      const startY = e.clientY;
      const hgt = row.offsetHeight;
      const idx = rows.indexOf(row);
      let target = idx;
      row.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dy = ev.clientY - startY;
        row.style.transform = `translateY(${dy}px)`;
        target = Math.max(0, Math.min(rows.length - 1, idx + Math.round(dy / hgt)));
        rows.forEach((r, i) => {
          if (r === row) return;
          let shift = 0;
          if (i > idx && i <= target) shift = -hgt;
          if (i < idx && i >= target) shift = hgt;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        rows.forEach((r) => (r.style.transform = ''));
        row.classList.remove('dragging');
        const ids = rows.map((r) => r.dataset.id);
        ids.splice(idx, 1);
        ids.splice(target, 0, row.dataset.id);
        if (target !== idx) onDone(ids);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  });
}

// ---------- модальные окна ----------
let modal = null;
function openModal(el, onClose) {
  closeModal();
  const ov = h('div', { class: 'overlay' }, el);
  document.body.append(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  modal = { ov, onClose };
  if (backOk() && stack.length <= 1) TG.BackButton.show();
  return ov;
}
export function closeModal() {
  if (!modal) return false;
  const { ov, onClose } = modal;
  modal = null;
  ov.classList.remove('show');
  setTimeout(() => ov.remove(), 250);
  onClose?.();
  syncBack();
  return true;
}

export function actionSheet({ title, buttons }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
    const sheet = h('div', { class: 'asheet' },
      title ? h('div', { class: 'as-title' }, title) : null,
      buttons.map((b, i) => h('button', {
        type: 'button', class: 'as-btn' + (b.destructive ? ' destr' : ''),
        onclick: () => { finish(i); b.onClick?.(); },
      }, b.label)),
      h('button', { type: 'button', class: 'as-btn cancel', onclick: () => finish(null) }, t('Отменить')));
    const ov = openModal(sheet, () => finish(null));
    ov.classList.add('bottom');
    ov.addEventListener('click', (e) => { if (e.target === ov) finish(null); });
  });
}

export function alertBox({ title, message, buttons = [{ label: 'OK', value: true }], input }) {
  return new Promise((resolve) => {
    let done = false;
    let inp = null;
    const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
    if (input) {
      inp = h('input', {
        class: 'al-inp', type: 'text', value: input.value ?? '', placeholder: input.placeholder || '',
        inputmode: input.inputmode, autocomplete: 'off',
        onkeydown: (e) => { if (e.key === 'Enter') finish({ ok: true, value: inp.value }); },
      });
    }
    const box = h('div', { class: 'alert' },
      title ? h('div', { class: 'al-title' }, title) : null,
      message ? h('div', { class: 'al-msg' }, message) : null,
      inp,
      h('div', { class: 'al-btns' + (buttons.length > 2 ? ' vert' : '') },
        buttons.map((b) => h('button', {
          type: 'button', class: 'al-btn' + (b.primary ? ' primary' : '') + (b.destructive ? ' destr' : ''),
          onclick: () => finish(input ? { ok: b.value !== false && b.value !== null, value: inp.value, button: b.value } : b.value),
        }, b.label))));
    openModal(box, () => finish(input ? { ok: false } : null));
    if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 80);
  });
}

export const confirmBox = (message, { ok = 'OK', title, destructive } = {}) =>
  alertBox({ title, message, buttons: [{ label: t('Отменить'), value: false }, { label: ok, value: true, primary: !destructive, destructive }] });

export async function promptBox(title, value = '', opts = {}) {
  const r = await alertBox({
    title, message: opts.message,
    input: { value, placeholder: opts.placeholder, inputmode: opts.inputmode },
    buttons: [{ label: t('Отменить'), value: false }, { label: opts.ok || 'OK', value: true, primary: true }],
  });
  return r?.ok ? r.value : null;
}

let toastTimer;
export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast' }, msg);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2200);
}

// Календарь (сетка месяца с кнопками «Сегодня» и «Отменить»)
export function datePicker(value, { title, allowNone } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
    let month = (value || today()).slice(0, 8) + '01';
    const box = h('div', { class: 'calendar' });
    const draw = () => {
      const first = parse(month);
      const offset = (first.getDay() + 6) % 7;
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < offset; i++) cells.push(h('span', { class: 'cd blank' }));
      for (let d = 1; d <= days; d++) {
        const ds = month.slice(0, 8) + pad(d);
        cells.push(h('button', {
          type: 'button',
          class: 'cd' + (ds === value ? ' sel' : '') + (ds === today() ? ' today' : '') + ([5, 6].includes((offset + d - 1) % 7) ? ' we' : ''),
          onclick: () => finish(ds),
        }, d));
      }
      box.replaceChildren(...[
        title ? h('div', { class: 'cal-title' }, title) : null,
        h('div', { class: 'cal-head' },
          h('button', { type: 'button', class: 'cal-nav', onclick: () => { month = addMonths(month, -12); draw(); } }, '«'),
          h('button', { type: 'button', class: 'cal-nav', onclick: () => { month = addMonths(month, -1); draw(); } }, '‹'),
          h('span', { class: 'cal-month' }, monthYear(month)),
          h('button', { type: 'button', class: 'cal-nav', onclick: () => { month = addMonths(month, 1); draw(); } }, '›'),
          h('button', { type: 'button', class: 'cal-nav', onclick: () => { month = addMonths(month, 12); draw(); } }, '»')),
        h('div', { class: 'cal-wd' }, weekdayNames().map((w) => h('span', null, w))),
        h('div', { class: 'cal-grid' }, cells),
        h('div', { class: 'cal-btns' },
          h('button', { type: 'button', class: 'al-btn', onclick: () => finish(null) }, t('Отменить')),
          allowNone ? h('button', { type: 'button', class: 'al-btn', onclick: () => finish('') }, t('Нет')) : null,
          h('button', { type: 'button', class: 'al-btn primary', onclick: () => finish(today()) }, t('Сегодня')))].filter(Boolean));
      // свайп по месяцам
    };
    draw();
    let sx = null;
    box.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
    box.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) { month = addMonths(month, dx < 0 ? 1 : -1); draw(); }
      sx = null;
    });
    openModal(box, () => finish(null));
  });
}

// ---------- экран выбора из списка ----------
// items: [{value, label, indent, sub}] ; onPick(value) ; allowNew — можно ввести своё значение
export class PickerScreen extends Screen {
  constructor(opts) {
    super();
    this.o = opts;
    this.q = '';
    this.mode = opts.linked?.items?.length ? 'linked' : 'all';
    this.noAutoRefresh = true;
  }
  nav() {
    const o = this.o;
    return {
      title: o.title,
      left: backButton(o.back || t('Назад')),
      right: o.onAdd ? { icon: 'plus', onClick: o.onAdd } : o.multi ? { label: t('Готово'), style: 'done', onClick: () => { o.onDone?.(); pop(); } } : null,
      sub: o.search !== false ? this.searchBar() : null,
    };
  }
  searchBar() {
    const inp = h('input', {
      class: 'search-inp', type: 'search', placeholder: this.o.allowNew ? t('Поиск или новое значение') : t('Поиск'), value: this.q, autocomplete: 'off',
      oninput: (e) => { this.q = e.target.value; this.renderList(); },
      onkeydown: (e) => { if (e.key === 'Enter' && this.o.allowNew && this.q.trim()) this.pick(this.q.trim()); },
    });
    this.searchInput = inp;
    return h('div', { class: 'searchbar' }, inp);
  }
  items() {
    const o = this.o;
    let items = this.mode === 'linked' ? o.linked.items.map((v) => (typeof v === 'string' ? { value: v, label: v } : v)) : o.items;
    if (this.q) {
      const q = this.q.toLowerCase();
      items = items.filter((i) => String(i.label).toLowerCase().includes(q));
    }
    return items;
  }
  pick(v) {
    const o = this.o;
    if (o.multi) { o.onPick(v); this.renderList(); return; }
    haptic();
    const stay = o.onPick(v);
    if (!stay) pop();
  }
  body() {
    this.listEl = h('div', { class: 'plist' });
    this.renderList();
    return this.listEl;
  }
  renderList() {
    const o = this.o;
    const items = this.items();
    const rows = [];
    if (o.allowNew && this.q.trim() && !items.some((i) => String(i.label).toLowerCase() === this.q.trim().toLowerCase())) {
      rows.push(h('div', { class: 'row tap newval', onclick: () => this.pick(this.q.trim()) }, h('span', { class: 'grow' }, t('Добавить «{0}»', this.q.trim()))));
    }
    if (o.none) rows.push(h('div', { class: 'row tap', onclick: () => this.pick(o.none.value ?? '') }, h('span', { class: 'grow muted' }, o.none.label), (o.value ?? '') === (o.none.value ?? '') ? h('span', { class: 'check' }, '✓') : null));
    let letter = null;
    const useIndex = o.index !== false && items.length > 20 && !this.q;
    for (const i of items) {
      const L = String(i.label).charAt(0).toUpperCase();
      const anchor = useIndex && L !== letter ? (letter = L) : null;
      const selected = o.multi ? o.isSelected(i.value) : i.value === o.value;
      rows.push(h('div', { class: 'row tap' + (i.indent ? ' indent' : ''), 'data-letter': anchor, onclick: () => this.pick(i.value) },
        i.icon ? h('span', { class: 'aicon sm' }, i.icon) : null,
        h('span', { class: 'grow' }, i.label, i.sub ? h('div', { class: 'sub' }, i.sub) : null),
        selected ? h('span', { class: 'check' }, '✓') : null));
    }
    if (!rows.length) rows.push(h('div', { class: 'empty' }, t('Пусто')));
    this.listEl.replaceChildren(...rows);
    this.renderIndex(items, useIndex);
  }
  renderIndex(items, useIndex) {
    this.indexEl?.remove();
    this.indexEl = null;
    if (useIndex && this.el.contains(this.listEl)) {
      const letters = [...new Set(items.map((i) => String(i.label).charAt(0).toUpperCase()))];
      this.indexEl = h('div', { class: 'azindex' }, letters.map((l) => h('span', {
        onclick: () => this.listEl.querySelector(`[data-letter="${CSS.escape(l)}"]`)?.scrollIntoView({ block: 'start' }),
      }, l)));
      this.el.append(this.indexEl);
    }
  }
  footer() {
    const o = this.o;
    if (!o.linked?.items?.length) return null;
    return h('div', { class: 'toolbar' }, h('span', { class: 'flex' }),
      segmented([{ value: 'linked', label: o.linked.label }, { value: 'all', label: t('Все') }], this.mode, (v) => { this.mode = v; this.render(); }),
      h('span', { class: 'flex' }));
  }
  afterRender(again) {
    this.renderIndex(this.items(), this.o.index !== false && this.items().length > 20 && !this.q);
    if (!again && this.o.value) {
      const sel = this.listEl.querySelector('.check')?.closest('.row');
      sel?.scrollIntoView({ block: 'center' });
    }
  }
}
