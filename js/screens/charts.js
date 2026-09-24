// Графики на canvas: глянцевые круговые диаграммы и столбики (денежный поток, чистые активы)
import { h, money, addMonths, addDays, monthStart, today, monthName } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';

export const PALETTE = ['#d8262f', '#2f9e2f', '#2566d8', '#f08c00', '#9c36b5', '#10a5b5', '#e64980', '#e8c30a', '#5c940d', '#7b4a24', '#a61e4d', '#1864ab', '#868e96', '#ff6b00', '#3bc9db', '#845ef7'];

function setupCanvas(canvas, w, hgt) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Глянцевая «пилюля»-диаграмма с центром «−» или «+»
export function pieCanvas(slices, hub, onTap) {
  const size = 220;
  const canvas = h('canvas');
  const ctx = setupCanvas(canvas, size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 10;
  const total = slices.reduce((a, s) => a + s.value, 0);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#999'; ctx.fill();
  ctx.restore();
  const angles = [];
  if (total > 0) {
    let a = -Math.PI / 2;
    for (const s of slices) {
      const da = (s.value / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + da); ctx.closePath();
      ctx.fillStyle = s.color; ctx.fill();
      angles.push([a, a + da]);
      a += da;
    }
  } else {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#c8c8c8'; ctx.fill();
  }
  // глянец
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.05, cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,.65)');
  g.addColorStop(0.35, 'rgba(255,255,255,.18)');
  g.addColorStop(0.75, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.38)');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
  // центр
  const hr = r * 0.24;
  const hg = ctx.createRadialGradient(cx - hr * 0.3, cy - hr * 0.4, hr * 0.1, cx, cy, hr);
  if (hub === '-') { hg.addColorStop(0, '#ff9a9a'); hg.addColorStop(0.6, '#e81818'); hg.addColorStop(1, '#8e0000'); }
  else { hg.addColorStop(0, '#b6ffb0'); hg.addColorStop(0.6, '#21c21a'); hg.addColorStop(1, '#0b6d06'); }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 5;
  ctx.beginPath(); ctx.arc(cx, cy, hr, 0, Math.PI * 2); ctx.fillStyle = hg; ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - hr * 0.5, cy - 2.5, hr, 5);
  if (hub === '+') ctx.fillRect(cx - 2.5, cy - hr * 0.5, 5, hr);
  if (onTap) {
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * size - cx;
      const y = ((e.clientY - rect.top) / rect.height) * size - cy;
      if (Math.hypot(x, y) > r || Math.hypot(x, y) < hr) return;
      let ang = Math.atan2(y, x);
      if (ang < -Math.PI / 2) ang += Math.PI * 2;
      const i = angles.findIndex(([a, b]) => ang >= a && ang < b);
      if (i >= 0) onTap(i);
    });
  }
  return canvas;
}

// Столбики: data [{label, up, down, line}] ; sel — индекс выделенного
export function drawBars(canvas, data, sel) {
  const w = canvas.clientWidth || 320, hgt = canvas.clientHeight || 190;
  const ctx = setupCanvas(canvas, w, hgt);
  ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, w, hgt);
  const padX = 28, padY = 14;
  const n = data.length || 1;
  const upMax = Math.max(0, ...data.map((d) => Math.max(d.up, d.line, 0)));
  const downMax = Math.max(0, ...data.map((d) => -Math.min(d.down, d.line, 0)));
  const span = hgt - 2 * padY;
  let base;
  if (upMax && downMax) base = padY + (span * upMax) / (upMax + downMax);
  else if (downMax) base = padY;
  else if (upMax) base = hgt - padY;
  else base = hgt / 2;
  const sUp = upMax ? (base - padY) / upMax : 0;
  const sDown = downMax ? (hgt - padY - base) / downMax : 0;
  const y = (v) => (v >= 0 ? base - v * sUp : base - v * sDown);
  const bw = (w - 2 * padX) / n;
  data.forEach((d, i) => {
    const x = padX + i * bw + bw * 0.12;
    const ww = bw * 0.76;
    if (d.up > 0) {
      const g = ctx.createLinearGradient(x, 0, x + ww, 0);
      g.addColorStop(0, '#2f9a2f'); g.addColorStop(0.5, '#3fbf3f'); g.addColorStop(1, '#2a8a2a');
      ctx.fillStyle = g; ctx.fillRect(x, y(d.up), ww, base - y(d.up));
    }
    if (d.down < 0) {
      const g = ctx.createLinearGradient(x, 0, x + ww, 0);
      g.addColorStop(0, '#c41c2c'); g.addColorStop(0.5, '#ec2c3c'); g.addColorStop(1, '#b01424');
      ctx.fillStyle = g; ctx.fillRect(x, base, ww, y(d.down) - base);
    }
    if (i === sel) {
      ctx.strokeStyle = '#2f7bff'; ctx.lineWidth = 3;
      ctx.strokeRect(x - 1, Math.min(y(d.up), padY + 2), ww + 2, Math.max(y(d.down), hgt - padY - 2) - Math.min(y(d.up), padY + 2));
    }
  });
  ctx.strokeStyle = '#f5e83a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(padX - 6, base); ctx.lineTo(w - padX + 6, base); ctx.stroke();
  ctx.strokeStyle = '#ff8c1a'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = padX + i * bw + bw / 2;
    if (i === 0) ctx.moveTo(x, y(d.line)); else ctx.lineTo(x, y(d.line));
  });
  ctx.stroke();
  if (data[sel]) {
    const x = padX + sel * bw + bw / 2;
    ctx.beginPath(); ctx.arc(x, y(data[sel].line), 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe600'; ctx.fill(); ctx.strokeStyle = '#a07a00'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // стрелки
  ctx.fillStyle = '#bbb';
  ctx.beginPath(); ctx.moveTo(8, hgt / 2); ctx.lineTo(20, hgt / 2 - 8); ctx.lineTo(20, hgt / 2 + 8); ctx.fill();
  ctx.beginPath(); ctx.moveTo(w - 8, hgt / 2); ctx.lineTo(w - 20, hgt / 2 - 8); ctx.lineTo(w - 20, hgt / 2 + 8); ctx.fill();
  return { padX, bw };
}

export function monthsBack(n, endMonth) {
  const end = monthStart(endMonth || today());
  return Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1));
}

export function cashflowData(entries, months) {
  const map = M.monthly(entries, months[0].slice(0, 7), months[months.length - 1].slice(0, 7));
  return months.map((m) => {
    const g = map.get(m.slice(0, 7)) || { income: 0, expense: 0 };
    return { month: m, up: g.income, down: g.expense, line: g.income + g.expense };
  });
}

export function networthData(months) {
  return months.map((m) => {
    const end = addDays(addMonths(m, 1), -1);
    const nw = M.netWorthAt(end > today() ? today() : end);
    return { month: m, up: nw.assets, down: nw.debts, line: nw.net };
  });
}

// Интерактивный блок графика: заголовок + canvas + выбор месяца
export function chartBox(kind, entries, opts = {}) {
  let end = opts.endMonth || today();
  let sel = 11;
  const box = h('div', { class: 'chartbox' });
  const titleL = h('span');
  const titleR = h('span');
  const canvas = h('canvas');
  box.append(h('div', { class: 'ch-title' }, titleL, titleR), canvas);
  let data = [];
  const draw = () => {
    const months = monthsBack(12, end);
    data = kind === 'networth' ? networthData(months) : cashflowData(entries(), months);
    const d = data[sel];
    const [y] = d.month.split('-');
    titleL.textContent = `${kind === 'networth' ? t('Чистые активы') : t('Денежный поток')}: ${y} ${monthName(d.month)}`;
    titleR.textContent = money(d.line, null, { cents: false });
    titleR.style.color = d.line < 0 ? '#8a0000' : '#0d4d0d';
    drawBars(canvas, data, sel);
    opts.onSelect?.(d, data);
  };
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < 26) { end = addMonths(monthStart(end), -1); draw(); return; }
    if (x > rect.width - 26) { end = addMonths(monthStart(end), 1); draw(); return; }
    const padX = 28, bw = (rect.width - 2 * padX) / 12;
    const i = Math.floor((x - padX) / bw);
    if (i >= 0 && i < 12) { sel = i; draw(); }
  });
  requestAnimationFrame(() => requestAnimationFrame(draw));
  box.redraw = draw;
  return box;
}

export function accountsChart(kind) {
  return chartBox(kind, () => M.allEntries().filter((e) => e.dir === 'out' && M.account(e.acc)?.worth));
}
