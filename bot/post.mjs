import { chromium } from 'playwright';
import fs from 'node:fs';
import { pickNewEvents, formatEvents, toMapTriggers } from './launches.mjs';

const { TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL, VERCEL_BYPASS } = process.env;
const SKIP_IF_EMPTY = process.env.SKIP_IF_EMPTY !== '0';
const KAB_ALERTS = process.env.KAB_ALERTS !== '0';                       // KAB_ALERTS=0 вимикає попередження про літаки
const KAB_COOLDOWN_MIN = Number(process.env.KAB_COOLDOWN_MIN || 60);
const NEWS_SEND = process.env.NEWS_SEND !== '0';                          // NEWS_SEND=0: НЕ слати пуски в Telegram (це роблять окремі боти), але квадрати на карті блимають
const NEWS_LAUNCHES = process.env.NEWS_LAUNCHES !== '0';                 // NEWS_LAUNCHES=0 вимикає пуски БпЛА/балістики з новин
const NEWS_MAX_AGE_MIN = Number(process.env.NEWS_MAX_AGE_MIN || 20);     // беремо новини не старші за стільки хвилин
const WAIT_MS = Number(process.env.WAIT_MS || 25000);
const HOOKS_TIMEOUT_MS = Number(process.env.HOOKS_TIMEOUT_MS || 60000);   // скільки чекати, поки сайт віддасть функції бота
const BALLISTIC_THREAT_BLINK = process.env.BALLISTIC_THREAT_BLINK !== '0'; // червоні квадрати і для «загрози балістики», не лише для пусків
const FRAME_BOUNDS = [[44.3, 22.1], [52.45, 40.3]];                        // межі України (з Кримом)
const FRAME_PADDING = Number(process.env.FRAME_PADDING || 18);              // відступ від країв кадру, px
if (!TG_BOT_TOKEN || !TG_CHAT_ID || !SITE_URL) { console.log('::error::Потрібні TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL (secrets/env у workflow)'); process.exit(1); }

const api = async (m, body) => {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${m}`, { method: 'POST', body });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { ok: false, description: `HTTP ${r.status}: ${t.slice(0, 200)}` }; }
  } catch (e) { return { ok: false, description: 'fetch: ' + (e && e.message) }; }
};
// виконує крок і не валить увесь запуск: помилка йде в анотацію ::warning::
const safe = async (label, fn, dflt) => {
  try { return await fn(); } catch (e) { console.log(`::warning::${label}: ${String(e && e.message).split('\n')[0].slice(0, 400)}`); return dflt; }
};
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
const one = x => String(x == null ? '' : x).split('\n')[0].slice(0, 400);   // анотація GitHub бере лише перший рядок
const fail = async msg => { console.log(`::error::${one(msg)}`); try { await browser.close(); } catch {} process.exit(1); };
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5, timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
const pageErrors = [];
page.on('pageerror', e => { pageErrors.push(e.message); console.log('pageerror:', e.message); });
page.on('requestfailed', r => { if (r.url().startsWith(siteOrigin)) console.log('requestfailed:', r.url(), (r.failure() || {}).errorText); });
page.on('response', r => { if (r.url().startsWith(siteOrigin) && r.status() >= 400) console.log('HTTP', r.status(), r.url()); });

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
const hooksReady = () => page.waitForFunction(() => typeof window.__tgBuild === 'function' && typeof window.__tgPlaneAlerts === 'function', null, { timeout: HOOKS_TIMEOUT_MS });
try {
  await hooksReady();
} catch (e) {
  console.log("⚠️ Функції бота не з'явились — перезавантажую сторінку й пробую ще раз…");
  try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); await hooksReady(); }
  catch (e2) {
    const diag = await page.evaluate(() => ({ title: document.title, tgBuild: typeof window.__tgBuild, tgPlaneAlerts: typeof window.__tgPlaneAlerts, map: typeof window.map, text: (document.body.innerText || '').slice(0, 200) })).catch(() => null);
    console.log('Діагностика сторінки:', JSON.stringify(diag));
    await fail(`Функції бота не з'явились на ${SITE_URL}. ` + (pageErrors.length ? 'Помилка на сторінці: ' + pageErrors[0] : 'Помилок JS немає — перевір, чи задеплоєні index.html і файли поруч (border-data.js, cities_extra.js), та VERCEL_BYPASS.'));
  }
}
await page.waitForTimeout(WAIT_MS);
const footerHtml = await safe('__tgFooterHtml', () => page.evaluate(() => (typeof window.__tgFooterHtml === 'function' ? window.__tgFooterHtml() : '')), '');

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
    if (NEWS_SEND && pick.events.length) {
      const res = await sendText(formatEvents(pick.events, footerHtml));
      console.log('Пуски з новин:', JSON.stringify(res).slice(0, 200));
      if (res.ok) { pick.stamps.forEach(([k, v]) => { state.news.sent[k] = v; }); saveState(); }
    }
  } catch (e) { console.log('⚠️ Новини про пуски: помилка', e && e.message); }
}

// ══ 1) ОКРЕМЕ ПОПЕРЕДЖЕННЯ ПРО КАБи (літаки біля областей) ══
if (KAB_ALERTS) {
  const pa = await safe('__tgPlaneAlerts', () => page.evaluate(() => window.__tgPlaneAlerts()), null);
  if (pa) {
    console.log(`Літаків-носіїв КАБ: ${pa.planes}; області загрози: ${pa.alerts.map(a => a.key).join(', ') || '—'}; DeepState: ${pa.occReady}`);
    const now = Date.now();
    if (!pa.occReady) console.log('⚠️ DeepState не завантажився — КАБ-попередження пропущено в цьому запуску.');
    const fresh = !pa.occReady ? [] : pa.alerts.filter(a => !state.kab[a.key] || now - state.kab[a.key] > KAB_COOLDOWN_MIN * 60000);
    if (fresh.length) {
      const res = await sendText(fresh.map(a => a.text).join('\n') + '\n\n' + pa.footerHtml);
      console.log('КАБ-попередження:', JSON.stringify(res).slice(0, 200));
      if (res.ok) { fresh.forEach(a => { state.kab[a.key] = now; }); saveState(); }
      else console.log(`::warning::КАБ-попередження не надіслано: ${res.description}`);
    }
  }
}

// ══ 2) ЗВЕДЕННЯ ПО ОБЛАСТЯХ + СКРІНШОТ ══
let r;
try {
  r = await page.evaluate(() => window.__tgBuild());
  if (!r.n) { await page.waitForTimeout(10000); r = await page.evaluate(() => window.__tgBuild()); }
} catch (e) { await fail('__tgBuild впав на сторінці: ' + (e && e.message)); }
console.log(`Цілей: ${r.n} | відсічено: ТОТ ${r.skippedOcc}, поза Україною ${r.skippedOutside}, літаки ${r.skippedPlanes} | DeepState: ${r.occReady}`);
if (!r.n && SKIP_IF_EMPTY) { await browser.close(); console.log('Цілей нема — пропускаю.'); process.exit(0); }

await page.addStyleTag({ content: `
  body > *:not(#map):not(.brand-badge):not(.clock-container):not(script):not(style) { display: none !important; }
  .leaflet-control-container { display: none !important; }
  #map { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; margin: 0 !important; }
` });
// шар «Окуповано» має бути ввімкнений гарантовано
let occOk = await safe('__tgEnsureOccupied', () => page.evaluate(() => (window.__tgEnsureOccupied ? window.__tgEnsureOccupied() : false)), false);
if (!occOk) {                              // запасний шлях: клік по кнопці шару
  await safe('layer-occupied', async () => {
    await page.evaluate(() => { const b = document.getElementById('layer-occupied'); if (b && !b.classList.contains('active')) b.click(); });
    await page.waitForTimeout(6000);
    occOk = await page.evaluate(() => !!(document.getElementById('layer-occupied') || {}).classList?.contains('active'));
  });
}
console.log('Шар «Окуповано»:', occOk ? 'увімкнено' : '⚠️ НЕ вдалося ввімкнути');

// пуски: червона пульсуюча обводка навколо аеродрому / позиції пуску (БпЛА і балістика), аватарка маркера лишається видимою
const nBlink = await safe('__launchTrigger', () => page.evaluate(t => (window.__launchTrigger ? window.__launchTrigger(t) : -1), mapTriggers), -1);
console.log(`Тригери пусків на карті: ${nBlink} з ${mapTriggers.length}` + (nBlink === -1 ? ' (на сайті немає __launchTrigger — старий index.html?)' : ''));

// кадр: Україна по кордонах із відступом. zoomSnap=0 — інакше Leaflet округлює зум вниз до цілого і країна виглядає дрібною
await safe('кадр карти', () => page.evaluate(([bounds, pad]) => {
  const m = window.map;
  document.documentElement.classList.add('tg-shot');          // заморожує блимання у «увімкненому» стані
  if (m) {
    m.options.zoomSnap = 0; m.options.zoomDelta = 0.25;
    m.invalidateSize();
    m.fitBounds(bounds, { animate: false, padding: [pad, pad], maxZoom: 9 });
  }
}, [FRAME_BOUNDS, FRAME_PADDING]));
await page.waitForTimeout(4000);
// ── ЛЕГЕНДА КАРТИ ──
// Будується прямо тут, у боті (не залежить від того, чи оновлено index.html на сайті): іконки — ВЛАСНІ svg з img/ сайту.
// Стоїть у вільному куті кадру (низ-ліво), масштабується під розмір вікна.
const LEGEND_ROWS = [
  { ic: ['geran2'],                       t: 'Поршневі БпЛА',       s: '80–250 км/год',   m: 'Герань-2 / Гербера' },
  { ic: ['geran3', 'geran4', 'geran5'],   t: 'Реактивні БпЛА',      s: '350–650 км/год',  m: 'Герань-3 / 4 / 5' },
  { ic: ['banderol'],                     t: 'Малі крилаті ракети', s: '400–600 км/год',  m: 'Бандероль / Філін' },
  { ic: ['x101'],                         t: 'Крилаті ракети',      s: '850–1100 км/год', m: 'Х-101' },
  { ic: ['kalibr', 'iskanderk'],          t: 'Крилаті ракети',      s: '850–1100 км/год', m: 'Калібр / Іскандер-К' },
  { ic: ['x59', 'x69'],                   t: 'Крилаті ракети',      s: '850–1100 км/год', m: 'Х-59 / Х-69' },
  { ic: ['kab'],                          t: 'КАБ',                 s: '',                m: 'Керована авіабомба' },
  { ic: ['su34', 'su35', 'su57'],         t: 'Тактична авіація',    s: '',                m: 'Су-34 / Су-35 / Су-57' },
  { ic: ['tu95', 'tu160', 'tu22m3'],      t: 'Стратегічна авіація', s: '',                m: 'Ту-95 / Ту-160 / Ту-22М3' },
];
const LEGEND_TITLE = 'Рух повітряних цілей над територією України';
const LEGEND_NOTE = 'Мапа ґрунтується на інформації з відкритих джерел та не містить військову таємницю. Уся інформація, що зображена на мапі, є у відкритому доступі.';
const legendInfo = await safe('легенда', () => page.evaluate(async ({ rows, title, note }) => {
  const old = document.getElementById('tg-legend'); if (old) old.remove();
  const host = document.getElementById('map'); if (!host) return { ok: false, why: 'нема #map' };
  const FF = "Inter,system-ui,-apple-system,'Segoe UI',Arial,sans-serif";
  const el = document.createElement('div');
  el.id = 'tg-legend';
  el.style.cssText = 'position:absolute;left:0;bottom:0;z-index:99999;pointer-events:none;transform-origin:left bottom;width:300px;box-sizing:border-box;padding:10px 12px 9px;border-radius:10px;background:rgba(8,13,24,.82);border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 22px rgba(0,0,0,.55);color:#fff;font-family:' + FF + ';';
  let h = '<div style="font:800 13px/1.18 ' + FF + ';letter-spacing:.03em;text-transform:uppercase;margin-bottom:5px">' + title + '</div>' +
          '<div style="font:500 8.5px/1.3 ' + FF + ';color:rgba(255,255,255,.62);margin-bottom:7px">' + note + '</div>';
  rows.forEach(r => {
    h += '<div style="display:flex;align-items:center;gap:8px;margin:0 0 5px">' +
         '<div style="display:flex;align-items:center;gap:2px;width:78px;flex:0 0 78px">' +
         r.ic.map(k => '<img data-leg="1" src="img/' + k + '.svg" style="width:22px;height:22px;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,.8))">').join('') + '</div>' +
         '<div style="font:600 10px/1.2 ' + FF + '">' + r.t + (r.s ? ' <span style="color:rgba(255,255,255,.6);font-weight:500">' + r.s + '</span>' : '') +
         '<div style="font:500 9px/1.2 ' + FF + ';color:rgba(255,255,255,.7)">' + r.m + '</div></div></div>';
  });
  // пуск — окремий блок: аватарка аеродрому з червоною обводкою
  h += '<div style="height:1px;background:rgba(255,255,255,.15);margin:7px 0"></div>' +
       '<div style="display:flex;align-items:center;gap:8px">' +
       '<div style="width:78px;flex:0 0 78px;display:flex;align-items:center;padding-left:3px">' +
       '<div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center">' +
       '<div style="width:24px;height:24px;box-sizing:border-box;background:#1e90ff;border:2px solid #fff;border-radius:5px;display:flex;align-items:center;justify-content:center"><img data-leg="1" src="img/bpl.png" style="width:70%;height:70%;object-fit:contain"></div>' +
       '<div style="position:absolute;inset:0;box-sizing:border-box;border:3px solid #ff1a1a;border-radius:9px;box-shadow:0 0 8px 3px rgba(255,26,26,.85)"></div></div></div>' +
       '<div style="font:600 10px/1.2 ' + FF + '">Зафіксовано пуск<div style="font:500 9px/1.2 ' + FF + ';color:rgba(255,255,255,.7)">червона обводка навколо аеродрому, звідки стався пуск</div></div></div>';
  el.innerHTML = h;
  host.appendChild(el);
  const sc = 0.85 * Math.max(0.6, Math.min(host.clientWidth / 1280, host.clientHeight / 900));   // 0.85 — щоб не зачіпати південно-західний край України
  el.style.left = Math.round(14 * sc) + 'px'; el.style.bottom = Math.round(14 * sc) + 'px'; el.style.transform = 'scale(' + sc + ')';
  const imgs = [...el.querySelectorAll('img[data-leg]')];
  await Promise.race([Promise.all(imgs.map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))), new Promise(r => setTimeout(r, 8000))]);
  let bad = 0; imgs.forEach(im => { if (!(im.complete && im.naturalWidth > 0)) { bad++; im.style.display = 'none'; } });   // битий/відсутній файл — ховаємо, а не показуємо «зламану» іконку
  const bb = el.getBoundingClientRect();
  return { ok: true, icons: imgs.length, broken: bad, box: [Math.round(bb.left), Math.round(bb.top), Math.round(bb.width), Math.round(bb.height)] };
}, { rows: LEGEND_ROWS, title: LEGEND_TITLE, note: LEGEND_NOTE }), null);
console.log('Легенда:', legendInfo ? JSON.stringify(legendInfo) : '⚠️ НЕ вдалося побудувати');
await page.waitForTimeout(500);
let shot;
try { shot = await page.screenshot({ type: 'jpeg', quality: 85 }); }
catch (e) { await fail('Не вдалося зробити скріншот: ' + (e && e.message)); }
await browser.close();

const text = r.n ? r.html : '✅ Активних цілей немає';
const form = new FormData();
form.append('chat_id', TG_CHAT_ID);
form.append('parse_mode', 'HTML');
form.append('disable_web_page_preview', 'true');
let sendOk = true;
const check = (label, res) => {
  console.log(label, JSON.stringify(res).slice(0, 300));
  if (!res || !res.ok) { sendOk = false; console.log(`::error::Telegram ${label}: ${res && res.description}`); }
};
if (text.length <= 1000) {
  form.append('caption', text);
  form.append('photo', new Blob([shot], { type: 'image/jpeg' }), 'map.jpg');
  check('sendPhoto', await api('sendPhoto', form));
} else {
  const f1 = new FormData(); f1.append('chat_id', TG_CHAT_ID); f1.append('photo', new Blob([shot], { type: 'image/jpeg' }), 'map.jpg');
  check('sendPhoto', await api('sendPhoto', f1));
  form.append('text', text);
  check('sendMessage', await api('sendMessage', form));
}
if (!sendOk) process.exit(1);
