import { chromium } from 'playwright';
import fs from 'node:fs';

const { TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL, VERCEL_BYPASS } = process.env;
const SKIP_IF_EMPTY = process.env.SKIP_IF_EMPTY !== '0';
const KAB_ALERTS = process.env.KAB_ALERTS !== '0';                       // KAB_ALERTS=0 вимикає попередження про літаки
const KAB_COOLDOWN_MIN = Number(process.env.KAB_COOLDOWN_MIN || 60);     // не повторювати для тієї ж області частіше
const WAIT_MS = Number(process.env.WAIT_MS || 25000);
if (!TG_BOT_TOKEN || !TG_CHAT_ID || !SITE_URL) { console.error('Потрібні TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL'); process.exit(1); }

const api = (m, body) => fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${m}`, { method: 'POST', body }).then(r => r.json());
const siteOrigin = new URL(SITE_URL).origin;

// ── пам'ять між запусками (файл state/kab.json комітиться з workflow) ──
const STATE_FILE = new URL('../state/kab.json', import.meta.url);
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
state.kab = state.kab || {};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5, timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
page.on('pageerror', e => console.log('pageerror:', e.message));

if (VERCEL_BYPASS) {                       // ключ Vercel — ТІЛЬКИ до запитів на наш сайт
  await page.route('**/*', route => {
    const req = route.request();
    if (req.url().startsWith(siteOrigin)) route.continue({ headers: { ...req.headers(), 'x-vercel-protection-bypass': VERCEL_BYPASS, 'x-vercel-set-bypass-cookie': 'true' } });
    else route.continue();
  });
}

const resp = await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('HTTP статус сайту:', resp && resp.status(), '| Заголовок:', await page.title());
try {
  await page.waitForFunction(() => typeof window.__tgBuild === 'function' && typeof window.__tgPlaneAlerts === 'function', null, { timeout: 60000 });
} catch (e) {
  console.log("❌ Функції бота не з'явились (на сайті старий index.html?).");
  console.log('Початок тексту сторінки:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
  await browser.close(); process.exit(1);
}
await page.waitForTimeout(WAIT_MS);

// ══ 1) ОКРЕМЕ ПОПЕРЕДЖЕННЯ ПРО КАБи (літаки біля областей) ══
if (KAB_ALERTS) {
  const pa = await page.evaluate(() => window.__tgPlaneAlerts());
  console.log(`Літаків-носіїв КАБ: ${pa.planes}; області загрози: ${pa.alerts.map(a => a.key).join(', ') || '—'}; DeepState: ${pa.occReady}`);
  const now = Date.now();
  const fresh = pa.alerts.filter(a => !state.kab[a.key] || now - state.kab[a.key] > KAB_COOLDOWN_MIN * 60000);
  if (fresh.length) {
    const body = new FormData();
    body.append('chat_id', TG_CHAT_ID);
    body.append('parse_mode', 'HTML');
    body.append('disable_web_page_preview', 'true');
    body.append('text', fresh.map(a => a.text).join('\n') + '\n\n' + pa.footerHtml);
    const res = await api('sendMessage', body);
    console.log('КАБ-попередження:', JSON.stringify(res).slice(0, 200));
    if (res.ok) {
      fresh.forEach(a => { state.kab[a.key] = now; });
      Object.keys(state.kab).forEach(k => { if (now - state.kab[k] > 24 * 3600000) delete state.kab[k]; });   // чистимо старе
      fs.mkdirSync(new URL('../state/', import.meta.url), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
    }
  }
}

// ══ 2) ЗВЕДЕННЯ ПО ОБЛАСТЯХ + СКРІНШОТ ══
let r = await page.evaluate(() => window.__tgBuild());
if (!r.n) { await page.waitForTimeout(10000); r = await page.evaluate(() => window.__tgBuild()); }
console.log(`Цілей: ${r.n} | відсічено: ТОТ ${r.skippedOcc}, поза Україною ${r.skippedOutside}, літаки ${r.skippedPlanes} | DeepState: ${r.occReady}`);
if (!r.n && SKIP_IF_EMPTY) { await browser.close(); console.log('Цілей нема — пропускаю.'); process.exit(0); }

await page.addStyleTag({ content: `
  body > *:not(#map):not(.brand-badge):not(.clock-container):not(script):not(style) { display: none !important; }
  .leaflet-control-container { display: none !important; }
  #map { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; margin: 0 !important; }
` });
await page.evaluate(() => {
  const m = window.map;
  if (m) { m.invalidateSize(); m.fitBounds([[44.2, 22.1], [52.4, 40.3]], { animate: false, padding: [10, 10] }); }
});
await page.waitForTimeout(4000);
const shot = await page.screenshot({ type: 'jpeg', quality: 85 });
await browser.close();

const text = r.n ? r.html : '✅ Активних цілей немає';
const form = new FormData();
form.append('chat_id', TG_CHAT_ID);
form.append('parse_mode', 'HTML');
form.append('disable_web_page_preview', 'true');
if (text.length <= 1000) {
  form.append('caption', text);
  form.append('photo', new Blob([shot], { type: 'image/jpeg' }), 'map.jpg');
  console.log(await api('sendPhoto', form));
} else {
  const f1 = new FormData(); f1.append('chat_id', TG_CHAT_ID); f1.append('photo', new Blob([shot], { type: 'image/jpeg' }), 'map.jpg');
  console.log(await api('sendPhoto', f1));
  form.append('text', text);
  console.log(await api('sendMessage', form));
}
