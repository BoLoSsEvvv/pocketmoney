// Точка входа
import { h, sha256 } from './util.js';
import { t } from './i18n.js';
import * as M from './model.js';
import * as storage from './storage.js';
import { setRoot, initBack, refresh, TG, toast, haptic } from './ui.js';
import { HomeScreen } from './screens/home.js';
import { pigEl } from './pig.js';

const HEADER = { blue: '#b4c0d0', green: '#a9cf94', purple: '#c7a9d2', gray: '#c4c4c4', coffee: '#c9935f' };

function applyTheme() {
  const s = M.state.settings;
  document.body.className = `theme-${s.theme}${s.rowStyle === 'short' ? ' short-rows' : ''}`;
  document.documentElement.style.setProperty('--fs', `${s.fontSize}px`);
  document.documentElement.lang = s.lang;
  try {
    if (TG?.isVersionAtLeast?.('6.1')) {
      TG.setHeaderColor(HEADER[s.theme] || HEADER.blue);
      TG.setBackgroundColor('#000000');
    }
    if (TG?.isVersionAtLeast?.('7.10')) TG.setBottomBarColor('#000000');
  } catch {}
}

let locked = false;
function lock() {
  if (locked || !M.state.settings.passHash) return Promise.resolve();
  locked = true;
  return new Promise((resolve) => {
    let code = '';
    const dots = h('div', { class: 'dots' });
    const draw = () => dots.replaceChildren(...Array.from({ length: Math.max(4, code.length) }, (_, i) => h('span', { class: i < code.length ? 'f' : '' })));
    const check = async () => {
      if ((await sha256(code)) === M.state.settings.passHash) {
        haptic('ok');
        el.remove();
        locked = false;
        resolve();
      } else {
        haptic('warn');
        dots.classList.add('shake');
        setTimeout(() => dots.classList.remove('shake'), 400);
        code = '';
        draw();
      }
    };
    const key = (label, fn, cls) => h('button', { type: 'button', class: cls || '', onclick: () => { haptic(); fn(); } }, label);
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => key(String(d), () => { code += d; draw(); }));
    const el = h('div', { class: 'lock' },
      pigEl('pig'),
      h('div', { class: 'ltitle' }, t('Введите пароль')),
      dots,
      h('div', { class: 'keypad' }, ...digits,
        key('⌫', () => { code = code.slice(0, -1); draw(); }, 'fn'),
        key('0', () => { code += '0'; draw(); }),
        key('OK', check, 'fn')));
    draw();
    document.body.append(el);
  });
}

async function main() {
  try {
    TG?.ready();
    TG?.expand();
    if (TG?.isVersionAtLeast?.('7.7')) TG.disableVerticalSwipes();
  } catch {}
  document.body.append(h('div', { class: 'splash', id: 'loading' }, pigEl('pig'), h('p', null, 'PocketMoney')));
  for (;;) {
    try {
      await M.load();
      break;
    } catch (e) {
      if (e.message !== 'cloud_read') throw e;
      await new Promise((resolve) => {
        const el = h('div', { class: 'splash' }, pigEl('pig'),
          h('p', null, t('Не удалось загрузить данные из облака Telegram.\nПроверьте интернет и попробуйте ещё раз.')),
          h('button', { type: 'button', class: 'as-btn', onclick: () => { el.remove(); resolve(); } }, t('Повторить')));
        document.body.append(el);
      });
    }
  }
  document.getElementById('loading')?.remove();
  applyTheme();
  M.onChange(() => { applyTheme(); refresh(); });
  storage.setErrorHandler((e) => toast(e.message === 'too_big' ? t('Слишком много данных для облака Telegram. Сделайте свёртку старых операций.') : t('Не удалось сохранить в облако Telegram')));
  if (storage.pushNeeded()) storage.save(M.state);
  initBack();
  setRoot(new HomeScreen());
  await lock();
  if (M.state.settings.multiCur && M.state.settings.autoRates) M.updateRates().catch(() => {});

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const s = M.state.settings;
    if (s.passHash && hiddenAt && Date.now() - hiddenAt >= (s.passDelay || 0) * 60000) lock();
    if (M.postDueRepeats()) M.commit(); else refresh();
  });
}

main().catch((e) => {
  console.error(e);
  document.body.append(h('div', { class: 'empty', style: { color: '#fff' } }, 'Ошибка запуска: ' + e.message));
});
