import assert from 'node:assert/strict';
import fs from 'node:fs';
import { heatmapDue, renderHeatmapPng, formatHeatCaption, runMidnightHeatmap, kyivParts } from './heatmap.mjs';
const oblasts = JSON.parse(fs.readFileSync('./ukraine-oblasts.json', 'utf8'));
// київська північ: 18.11.2026 00:05 за Києвом = 17.11 22:05 UTC (UTC+2 взимку)
const t0 = Date.parse('2026-11-17T22:05:00Z');
assert.deepEqual(kyivParts(t0), { day: '2026-11-18', hour: 0, minute: 5 });
assert.deepEqual(heatmapDue({}, t0), { day: '2026-11-17' });
assert.equal(heatmapDue({}, Date.parse('2026-11-18T10:00:00Z')), null);                 // удень — рано
assert.equal(heatmapDue({ heat: { lastDay: '2026-11-17' } }, t0), null);                // вже слали
assert.deepEqual(heatmapDue({}, Date.parse('2026-07-17T21:05:00Z')), { day: '2026-07-17' });   // літній час UTC+3
console.log('✓ розклад 00:00 за Києвом (зима/літо, без повторів)');

// синтетична доба: траєкторії з майданчиків на міста
const from = [[51.75, 36.29], [52.83, 34.5], [48.95, 40.3], [46.06, 38.23], [46.25, 36.55], [45.11, 33.98]];
const to = [[50.45, 30.52], [46.48, 30.72], [49.99, 36.23], [50.0, 36.2], [48.46, 35.04], [47.84, 35.14], [49.59, 34.55], [51.5, 31.3], [46.63, 32.62]];
const rows = []; let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
for (let i = 0; i < 260; i++) { const a = from[(rnd() * from.length) | 0], b = to[(rnd() * to.length) | 0], p = []; for (let k = 0; k <= 12; k++) { const t = k / 12; p.push([a[0] + (b[0] - a[0]) * t + (rnd() - .5) * .15, a[1] + (b[1] - a[1]) * t + (rnd() - .5) * .15, 1700000000 + k * 60]); } rows.push({ g: 'shahed', p }); }
const t1 = Date.now(); const r = renderHeatmapPng(rows, oblasts, { width: 1100 });
console.log('рендер', Date.now() - t1, 'мс; ціль:', r.total, 'пік:', r.peak, 'розмір PNG:', r.png.length);
assert.equal(r.total, 260); assert.ok(r.png.slice(1, 4).toString() === 'PNG');
fs.writeFileSync('heat-test.png', r.png);
console.log(formatHeatCaption('2026-11-17', r));

let sent = null, st = await runMidnightHeatmap({ state: {}, now: t0, oblasts, fetchRows: async d => (assert.equal(d, '2026-11-17'), rows), sendPhoto: async (png, cap) => { sent = { n: png.length, cap }; } });
assert.ok(sent && st.heat.lastDay === '2026-11-17');
sent = null; st = await runMidnightHeatmap({ state: st, now: t0 + 60000, oblasts, fetchRows: async () => rows, sendPhoto: async () => { sent = 1; } });
assert.equal(sent, null);
console.log('✓ оркестратор відправляє один раз за добу');
