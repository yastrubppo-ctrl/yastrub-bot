// Теплова карта України за добу — для відправки в Telegram о 00:00 (за Києвом).
// ОСНОВНИЙ шлях тепер — знімок головної мапи з index.html (див. midnight-job.mjs); цей файл дає розклад (heatmapDue)
// і запасний рендер PNG без браузера (renderHeatmapPng), якщо сторінка недоступна.
// Без залежностей (лише вбудований node:zlib). Той самий алгоритм і палітра, що у вікні «Статистика» на сайті (_stHeat).
//
// Підключення в боті (раз на хвилину / на кожному опитуванні новин):
//
//   import { readFileSync } from 'node:fs';
//   import { runMidnightHeatmap } from './heatmap.mjs';
//   const oblasts = JSON.parse(readFileSync('./ukraine-oblasts.json', 'utf8'));
//   state = await runMidnightHeatmap({
//     state, now: Date.now(), oblasts,
//     fetchRows: day => fetch(`${SITE}/api/stats?day=${day}`).then(r => r.json()).then(d => d.rows),   // [{ g, p:[[lat,lng,ts],…] }]
//     sendPhoto: (png, caption) => tgSendPhoto(CHANNEL_ID, png, caption),                              // Buffer + HTML-підпис
//   });
//   // state.heat.lastDay запобігає повторній відправці тієї ж доби
import zlib from 'node:zlib';

// ── Київський час ──
const kyivFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function kyivParts(ts) {
  const o = {}; for (const p of kyivFmt.formatToParts(new Date(ts))) o[p.type] = p.value;
  return { day: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour), minute: Number(o.minute) };
}
const prevDayOf = day => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

// Чи час слати? Після 00:00 за Києвом — карта за ПОПЕРЕДНЮ добу. graceMin — скільки хвилин після півночі ще вважаємо «вчасно»
// (якщо бот був недоступний рівно о 00:00). Повертає { day } або null.
export function heatmapDue(state, now = Date.now(), { graceMin = 180 } = {}) {
  const k = kyivParts(now);
  if (k.hour * 60 + k.minute >= graceMin) return null;
  const day = prevDayOf(k.day);
  if (state && state.heat && state.heat.lastDay === day) return null;
  return { day };
}

// ── Щільність: кожна ціль додає внесок у клітинку не більше одного разу (float-сітка) ──
const LAT0 = 44.0, LAT1 = 52.6, LNG0 = 21.9, LNG1 = 40.4, KX = Math.cos(48 * Math.PI / 180);
export function frame(W) { return { W, H: Math.round(W * (LAT1 - LAT0) / ((LNG1 - LNG0) * KX)) }; }

function densify(pts, step, X, Y) {            // точки [lat,lng,…] → піксельні точки з кроком ≤ step
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const x1 = X(pts[i][1]), y1 = Y(pts[i][0]);
    if (i === 0) { out.push([x1, y1, pts[i][0], pts[i][1]]); continue; }
    const x0 = X(pts[i - 1][1]), y0 = Y(pts[i - 1][0]);
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let j = 1; j <= n; j++) { const t = j / n; out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]); }
  }
  return out;
}

export function buildHeatGrid(rows, W) {
  const { H } = frame(W), R = Math.round(13 * W / 760), X = lng => (lng - LNG0) / (LNG1 - LNG0) * W, Y = lat => (LAT1 - lat) / (LAT1 - LAT0) * H;
  const grid = new Float32Array(W * H), cell = new Map(); let peak = 0, used = 0;
  for (const r of rows || []) {
    if (!r || !Array.isArray(r.p) || !r.p.length) continue;
    const pts = densify(r.p, 3 * W / 760, X, Y).filter(q => q[0] > -R && q[1] > -R && q[0] < W + R && q[1] < H + R);
    if (!pts.length) continue; used++;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const q of pts) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    x0 = Math.max(0, Math.floor(x0 - R)); y0 = Math.max(0, Math.floor(y0 - R)); x1 = Math.min(W - 1, Math.ceil(x1 + R)); y1 = Math.min(H - 1, Math.ceil(y1 + R));
    const bw = x1 - x0 + 1, loc = new Float32Array(bw * (y1 - y0 + 1));
    for (const q of pts) {
      const cx = q[0], cy = q[1];
      for (let y = Math.max(y0, Math.floor(cy - R)); y <= Math.min(y1, Math.ceil(cy + R)); y++)
        for (let x = Math.max(x0, Math.floor(cx - R)); x <= Math.min(x1, Math.ceil(cx + R)); x++) {
          const d = Math.hypot(x - cx, y - cy) / R; if (d >= 1) continue;
          const v = (1 - d) * (1 - d), i = (y - y0) * bw + (x - x0); if (v > loc[i]) loc[i] = v;
        }
    }
    for (let y = 0; y <= y1 - y0; y++) for (let x = 0; x < bw; x++) { const v = loc[y * bw + x]; if (v) grid[(y + y0) * W + x + x0] += v; }
    const cs = new Set(); for (const q of pts) cs.add(Math.floor(q[2] / 0.25) + ':' + Math.floor(q[3] / 0.25));
    for (const key of cs) { const v = (cell.get(key) || 0) + 1; cell.set(key, v); if (v > peak) peak = v; }
  }
  return { grid, W, H, peak, used };
}

// ── Малювання ──
const STOPS = [[0, [92, 104, 140]], [.3, [150, 112, 84]], [.55, [226, 138, 52]], [.8, [255, 150, 28]], [1, [255, 196, 60]]];
const colorAt = v => { let i = 1; while (i < STOPS.length - 1 && v > STOPS[i][0]) i++; const A = STOPS[i - 1], B = STOPS[i], t = Math.min(1, Math.max(0, (v - A[0]) / (B[0] - A[0]))); return A[1].map((x, j) => x + (B[1][j] - x) * t); };

function fillPolys(px, W, H, rings, X, Y, rgb) {         // скан-лінія, парно-непарне правило
  for (const ring of rings) {
    const P = ring.map(q => [X(q[0]), Y(q[1])]);
    let a = H, b = 0; for (const q of P) { a = Math.min(a, q[1]); b = Math.max(b, q[1]); }
    for (let y = Math.max(0, Math.floor(a)); y <= Math.min(H - 1, Math.ceil(b)); y++) {
      const xs = [], yy = y + 0.5;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, yi] = P[i], [xj, yj] = P[j];
        if ((yi > yy) !== (yj > yy)) xs.push(xi + (yy - yi) * (xj - xi) / (yj - yi));
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) { const o = (y * W + x) * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255; }
    }
  }
}
function strokeRing(px, W, H, ring, X, Y, rgb, alpha) {
  const blend = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; for (let c = 0; c < 3; c++) px[o + c] = px[o + c] * (1 - alpha) + rgb[c] * alpha; };
  for (let i = 1; i < ring.length; i++) {
    let x0 = Math.round(X(ring[i - 1][0])), y0 = Math.round(Y(ring[i - 1][1])); const x1 = Math.round(X(ring[i][0])), y1 = Math.round(Y(ring[i][1]));
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
    for (;;) { blend(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  }
}

// ── PNG без бібліотек ──
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
export function encodePng(rgba, W, H) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// rows: [{ g, p:[[lat,lng,ts],…] }]; oblasts: [{ name, rings:[[[lng,lat],…],…] }] (файл ukraine-oblasts.json)
// Повертає { png:Buffer, total, peak }
export function renderHeatmapPng(rows, oblasts, { width = 1520 } = {}) {
  const { W, H } = frame(width), X = lng => (lng - LNG0) / (LNG1 - LNG0) * W, Y = lat => (LAT1 - lat) / (LAT1 - LAT0) * H;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 8; px[i + 1] = 12; px[i + 2] = 22; px[i + 3] = 255; }        // фон
  const rings = (oblasts || []).flatMap(o => o.rings || []);
  fillPolys(px, W, H, rings, X, Y, [13, 22, 38]);                                                               // області
  const { grid, peak, used } = buildHeatGrid(rows, W);
  let mx = 1e-6; for (let i = 0; i < grid.length; i++) if (grid[i] > mx) mx = grid[i];
  for (let i = 0; i < grid.length; i++) {                                                                       // тепло
    const v = grid[i] / mx; if (v < .02) continue;
    const rgb = colorAt(Math.pow(v, .75)), a = Math.min(.96, .10 + .88 * Math.pow(v, .7)), o = i * 4;
    px[o] = px[o] * (1 - a) + rgb[0] * a; px[o + 1] = px[o + 1] * (1 - a) + rgb[1] * a; px[o + 2] = px[o + 2] * (1 - a) + rgb[2] * a;
  }
  for (const ring of rings) strokeRing(px, W, H, ring, X, Y, [0, 242, 255], 0.30);                              // межі областей
  // шкала «менше → більше» внизу ліворуч
  const lw = Math.round(W * 0.16), lh = Math.max(8, Math.round(H * 0.012)), lx = Math.round(W * 0.03), ly = H - lh - Math.round(H * 0.03);
  for (let x = 0; x < lw; x++) { const rgb = colorAt(x / (lw - 1)); for (let y = 0; y < lh; y++) { const o = ((ly + y) * W + lx + x) * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; } }
  return { png: encodePng(px, W, H), total: used, peak };
}

const plural = (n, f) => (n % 10 === 1 && n % 100 !== 11) ? f[0] : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) ? f[1] : f[2];
export function formatHeatCaption(day, { total, peak }, footerHtml) {
  const [y, m, d] = day.split('-');
  return `🔥 Теплова карта України за ${d}.${m}.${y}\nЦілей за добу: ${total}\n` +
    (peak ? `У найнасиченішій ділянці — ${peak} ${plural(peak, ['ціль', 'цілі', 'цілей'])}` : 'Маршрутів за цю добу не записано') + (footerHtml ? '\n\n' + footerHtml : '');
}

// Оркестратор: викликати регулярно. Повертає новий state (або той самий, якщо слати ще рано / вже відправлено).
export async function runMidnightHeatmap({ state, now = Date.now(), oblasts, fetchRows, sendPhoto, footerHtml, graceMin }) {
  const due = heatmapDue(state, now, { graceMin });
  if (!due) return state;
  const rows = await fetchRows(due.day);
  const { png, total, peak } = renderHeatmapPng(rows, oblasts);
  if (!total) return { ...state, heat: { ...(state && state.heat), lastDay: due.day } };   // порожня доба — не шлемо
  await sendPhoto(png, formatHeatCaption(due.day, { total, peak }, footerHtml));
  return { ...state, heat: { ...(state && state.heat), lastDay: due.day, sentAt: now } };
}
