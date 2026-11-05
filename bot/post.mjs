import { chromium } from 'playwright';
import fs from 'node:fs';
import { pickNewEvents, formatEvents, toMapTriggers } from './launches.mjs';

const { TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL, VERCEL_BYPASS } = process.env;
const SKIP_IF_EMPTY = process.env.SKIP_IF_EMPTY !== '0';
const KAB_ALERTS = process.env.KAB_ALERTS !== '0';                       // KAB_ALERTS=0 вимикає попередження про літаки
const KAB_COOLDOWN_MIN = Number(process.env.KAB_COOLDOWN_MIN || 60);
const NEWS_LAUNCHES = process.env.NEWS_LAUNCHES !== '0';                 // NEWS_LAUNCHES=0 вимикає пуски БпЛА/балістики з новин
const NEWS_MAX_AGE_MIN = Number(process.env.NEWS_MAX_AGE_MIN || 20);     // беремо новини не старші за стільки хвилин
const WAIT_MS = Number(process.env.WAIT_MS || 25000);
const BALLISTIC_THREAT_BLINK = process.env.BALLISTIC_THREAT_BLINK !== '0'; // червоні квадрати і для «загрози балістики», не лише для пусків
const FRAME_BOUNDS = [[44.3, 22.1], [52.45, 40.3]];                        // межі України (з Кримом)
const FRAME_PADDING = Number(process.env.FRAME_PADDING || 18);              // відступ від країв кадру, px
if (!TG_BOT_TOKEN || !TG_CHAT_ID || !SITE_URL) { console.error('Потрібні TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL'); process.exit(1); }

const api = (m, body) => fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${m}`, { method: 'POST', body }).then(r => r.json());
const siteOrigin = new URL(SITE_URL).origin;

// ── пам'ять між запусками (state/kab.json комітиться з workflow, лише якщо змінилась) ──
const STATE_FILE = new URL('../state/kab.json', import.meta.url);
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
state.kab = state.kab || {};
state.news = state.news || {};
state.news.sent = state.news.sent || {};
function saveState() {
  const now = Date.now();
  for (const k of Object.keys(state.kab)) if (now - state.kab[k] > 24 * 3600000) delete state.kab[k];
  for (const k of Object.keys(state.news.sent)) if (now - state.news.sent[k].t > 24 * 3600000) delete state.news.sent[k];
  fs.mkdirSync(new URL('../state/', import.meta.url), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
}
async function sendText(html) {
  const body = new FormData();
  body.append('chat_id', TG_CHAT_ID);
  body.append('parse_mode', 'HTML');
  body.append('disable_web_page_preview', 'true');
  body.append('text', html);
  return api('sendMessage', body);
}

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

await page.addInitScript(() => { try { localStorage.setItem('deepstateOccupiedVisible', '1'); } catch (e) {} });

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
const footerHtml = await page.evaluate(() => (typeof window.__tgFooterHtml === 'function' ? window.__tgFooterHtml() : ''));

// ══ 0) ПУСКИ БпЛА / БАЛІСТИКИ З НОВИН ══
let mapTriggers = [];
if (NEWS_LAUNCHES) {
  try {
    const raw = await page.evaluate(() => {
      const arr = (window._dimapNewsHistory && window._dimapNewsHistory.length) ? window._dimapNewsHistory : (window._dimapNews || []);
      const strip = h => {
        try {
          const d = new DOMParser().parseFromString('<body>' + String(h || '').replace(/<br\s*\/?>/gi, ' \n ') + '</body>', 'text/html');
          return (d.body.textContent || '').replace(/[ \t]+/g, ' ').trim();
        } catch (e) { return String(h || '').replace(/<[^>]*>/g, ' '); }
      };
      return arr.map(n => ({ id: String(n.id != null ? n.id : (n.url || '')), date: n.date || null, text: strip(n.text) })).filter(n => n.text);
    });
    const pick = pickNewEvents(raw, state, Date.now(), { maxAgeMin: NEWS_MAX_AGE_MIN });
    mapTriggers = toMapTriggers(pick.active, { threatToo: BALLISTIC_THREAT_BLINK });
    console.log(`Новини: ${pick.stats.total} у стрічці, свіжих ${pick.stats.fresh}, без дати ${pick.stats.noDate}; подій про пуски: ${pick.stats.parsed}; до публікації: ${pick.events.length}`);
    if (pick.events.length) {
      const res = await sendText(formatEvents(pick.events, footerHtml));
      console.log('Пуски з новин:', JSON.stringify(res).slice(0, 200));
      if (res.ok) { pick.stamps.forEach(([k, v]) => { state.news.sent[k] = v; }); saveState(); }
    }
  } catch (e) { console.log('⚠️ Новини про пуски: помилка', e && e.message); }
}

// ══ 1) ОКРЕМЕ ПОПЕРЕДЖЕННЯ ПРО КАБи (літаки біля областей) ══
if (KAB_ALERTS) {
  const pa = await page.evaluate(() => window.__tgPlaneAlerts());
  console.log(`Літаків-носіїв КАБ: ${pa.planes}; області загрози: ${pa.alerts.map(a => a.key).join(', ') || '—'}; DeepState: ${pa.occReady}`);
  const now = Date.now();
  if (!pa.occReady) console.log('⚠️ DeepState не завантажився — КАБ-попередження пропущено в цьому запуску.');
  const fresh = !pa.occReady ? [] : pa.alerts.filter(a => !state.kab[a.key] || now - state.kab[a.key] > KAB_COOLDOWN_MIN * 60000);
  if (fresh.length) {
    const res = await sendText(fresh.map(a => a.text).join('\n') + '\n\n' + pa.footerHtml);
    console.log('КАБ-попередження:', JSON.stringify(res).slice(0, 200));
    if (res.ok) { fresh.forEach(a => { state.kab[a.key] = now; }); saveState(); }
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
// шар «Окуповано» має бути ввімкнений гарантовано
let occOk = await page.evaluate(() => (window.__tgEnsureOccupied ? window.__tgEnsureOccupied() : false));
if (!occOk) {                              // запасний шлях: клік по кнопці шару
  await page.evaluate(() => { const b = document.getElementById('layer-occupied'); if (b && !b.classList.contains('active')) b.click(); });
  await page.waitForTimeout(6000);
  occOk = await page.evaluate(() => !!(document.getElementById('layer-occupied') || {}).classList?.contains('active'));
}
console.log('Шар «Окуповано»:', occOk ? 'увімкнено' : '⚠️ НЕ вдалося ввімкнути');

// блимаючі квадратики пусків: синій — БпЛА, червоний — балістика
const nBlink = await page.evaluate(t => (window.__launchTrigger ? window.__launchTrigger(t) : -1), mapTriggers);
console.log(`Тригери пусків на карті: ${nBlink} з ${mapTriggers.length}` + (nBlink === -1 ? ' (на сайті немає __launchTrigger — старий index.html?)' : ''));

// кадр: Україна по кордонах із відступом. zoomSnap=0 — інакше Leaflet округлює зум вниз до цілого і країна виглядає дрібною
await page.evaluate(([bounds, pad]) => {
  const m = window.map;
  document.documentElement.classList.add('tg-shot');          // заморожує блимання у «увімкненому» стані
  if (m) {
    m.options.zoomSnap = 0; m.options.zoomDelta = 0.25;
    m.invalidateSize();
    m.fitBounds(bounds, { animate: false, padding: [pad, pad], maxZoom: 9 });
  }
}, [FRAME_BOUNDS, FRAME_PADDING]);
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
