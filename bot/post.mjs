import { chromium } from 'playwright';
import fs from 'node:fs';
import { pickNewEvents, formatEvents, toMapTriggers } from './launches.mjs';
import { heatmapDue } from './heatmap.mjs';

const { TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL, VERCEL_BYPASS } = process.env;
const SKIP_IF_EMPTY = process.env.SKIP_IF_EMPTY !== '0';
const KAB_ALERTS = process.env.KAB_ALERTS !== '0';                       // KAB_ALERTS=0 вимикає попередження про літаки
const KAB_COOLDOWN_MIN = Number(process.env.KAB_COOLDOWN_MIN || 60);
const NEWS_SEND = process.env.NEWS_SEND !== '0';                          // за замовчуванням пуски шле ЦЕЙ бот (один бот на все). NEWS_SEND=0 — не слати, квадрати на карті все одно блимають
const NEWS_LAUNCHES = process.env.NEWS_LAUNCHES !== '0';                 // NEWS_LAUNCHES=0 вимикає пуски БпЛА/балістики з новин
const NEWS_MAX_AGE_MIN = Number(process.env.NEWS_MAX_AGE_MIN || 20);     // беремо новини не старші за стільки хвилин
const WAIT_MS = Number(process.env.WAIT_MS || 25000);
const HOOKS_TIMEOUT_MS = Number(process.env.HOOKS_TIMEOUT_MS || 60000);   // скільки чекати, поки сайт віддасть функції бота
const BALLISTIC_THREAT_BLINK = process.env.BALLISTIC_THREAT_BLINK !== '0'; // червоні квадрати і для «загрози балістики», не лише для пусків
const ALERTS_LAYER = process.env.ALERTS_LAYER === '1';                       // за замовчуванням тривог на скрінах НЕМАЄ (заважають бачити цілі); ALERTS_LAYER=1 — увімкнути
const ALERT_OPACITY = Math.min(100, Math.max(10, Number(process.env.ALERT_OPACITY || 40)));   // «Відображення → Насиченість тривог», % (повзунок на сайті: 20–100)
const FRAME_BOUNDS = [[44.3, 22.1], [52.45, 40.3]];                        // межі України (з Кримом)
const FRAME_PADDING = Number(process.env.FRAME_PADDING || 18);              // відступ від країв кадру, px
// ── Періодичність повідомлень (хвилини). Один бот, різні типи: ──
const BALLISTIC_MIN = Number(process.env.BALLISTIC_MIN ?? 0.25);    // балістика: перше повідомлення — МИТТЄВО; наступні нові цілі збираються не довше ніж стільки хвилин (0.25 = 15 с, щоб залп не дав 10 повідомлень)
const LAUNCH_MIN    = Number(process.env.LAUNCH_MIN ?? 5);          // пуски БпЛА (+ доставка)
const MISSILE_MIN   = Number(process.env.MISSILE_MIN ?? 5);         // крилаті та інші ракети в повітрі (Х-101, Калібр, Іскандер-К…; балістика — окремо й миттєво; Герань-5 і Бандероль — це БпЛА)
const STRAT_MIN     = Number(process.env.STRAT_MIN ?? 30);         // стратегічна авіація: оновлення «де летять» раз на N хв (виліт, маневр, пуск — одразу)
const STRAT_ALERTS  = process.env.STRAT_ALERTS !== '0';            // STRAT_ALERTS=0 вимикає повідомлення про стратегічну авіацію
const SITUATION_MIN = Number(process.env.SITUATION_MIN ?? 10);      // загальна ситуація по БпЛА (шахеди, реактивні, Герань-5, Бандероль…)
const RUN_SEC       = Number(process.env.RUN_SEC ?? process.env.NEWS_WATCH_SEC ?? 0);   // скільки секунд працювати безперервно (0 = один прохід і вихід)
const POLL_SEC      = Number(process.env.POLL_SEC || 3);            // як часто перевіряти новини і цілі на карті (секунди)
const RELOAD_MIN    = Number(process.env.RELOAD_MIN || 30);         // перезавантажувати сторінку кожні N хв (проти витоків пам'яті у довгому запуску)
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
// чекаємо, поки карта домалює тайли (MapLibre: подія idle); на старому сайті без MapLibre — просто пауза
const waitMapIdle = (maxMs = 8000) => page.evaluate(ms => new Promise(res => {
  const ml = window.map && window.map._ml, t0 = Date.now();
  if (!ml) return setTimeout(() => res('pause'), Math.min(ms, 4000));
  const done = why => { clearTimeout(to); res(why); };
  const to = setTimeout(() => done('timeout'), ms);
  const chk = () => { if (ml.loaded() && ml.areTilesLoaded()) { setTimeout(() => done('idle ' + (Date.now() - t0) + ' мс'), 300); } else ml.once('idle', chk); };
  ml.triggerRepaint(); chk();
}), maxMs).catch(() => 'n/a');

// ── пам'ять між запусками (state/kab.json комітиться з workflow, лише якщо змінилась) ──
const STATE_FILE = new URL('../state/kab.json', import.meta.url);
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
state.kab = state.kab || {};
state.news = state.news || {};
state.news.sent = state.news.sent || {};
state.strat = state.strat || {};
state.strat.sent = state.strat.sent || {};     // які події стратегів уже пішли в канал (ключ → час)
state.strat.msgs = state.strat.v === 2 ? (state.strat.msgs || []) : [];   // v2: старі (хибні) новини з попередньої версії скидаємо
state.strat.v = 2;     // розпізнані новини про стратегів: сайт відновлює з них сценарій (позиції бортів) після перезапуску
state.stock = state.stock || { sent: {} };   // наявність БпЛА на пускових майданчиках: які снапшоти вже надіслано
state.sched = state.sched || {};   // коли востаннє слали кожен тип: ballistic / launch / missile / situation
function saveState() {
  const now = Date.now();
  for (const k of Object.keys(state.kab)) if (now - state.kab[k] > 24 * 3600000) delete state.kab[k];
  for (const k of Object.keys(state.news.sent)) if (now - state.news.sent[k].t > 24 * 3600000) delete state.news.sent[k];
  if (state.strat) { for (const k of Object.keys(state.strat.sent)) if (now - state.strat.sent[k] > 24 * 3600000) delete state.strat.sent[k];
    state.strat.msgs = (state.strat.msgs || []).filter(m => m && now - m.ts < 14 * 3600000).slice(-150); }
  for (const k of Object.keys(state.stock.sent)) if (now - state.stock.sent[k] > 3 * 864e5) delete state.stock.sent[k];
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
// синхронізація: бот працює цілодобово і відправляє журнали (пуски, стратеги, вибухи) на сервер — їх бачать усі пристрої
if (process.env.SYNC_KEY) await page.addInitScript(k => { try { localStorage.setItem('yastrub_sync_key', k); } catch (e) {} }, process.env.SYNC_KEY);
// стратегічна авіація: повертаємо сайту новини про стратегів з минулих запусків — він сам перемотає сценарій до «зараз»
await page.addInitScript(msgs => {
  try {
    const old = JSON.parse(localStorage.getItem('yastrub_strat_live2') || '[]'), seen = new Set(old.map(m => m.id));
    localStorage.setItem('yastrub_strat_live2', JSON.stringify(old.concat((msgs || []).filter(m => !seen.has(m.id))).sort((a, b) => a.ts - b.ts).slice(-150)));
  } catch (e) {}
}, state.strat.msgs);

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
// Новини беремо ОДРАЗУ, не чекаючи WAIT_MS (він потрібен лише карті): так пуски балістики йдуть у канал за секунди після завантаження стрічки.
const NEWS_WAIT_MS = Number(process.env.NEWS_WAIT_MS || 15000);           // скільки максимум чекати, поки сайт завантажить стрічку новин
const NEWS_WATCH_SEC = Number(process.env.NEWS_WATCH_SEC || 0);          // >0: ще стільки секунд перевіряти нові повідомлення кожні 8 с (швидші пуски без частого cron)
const footerHtml = await safe('__tgFooterHtml', () => page.evaluate(() => (typeof window.__tgFooterHtml === 'function' ? window.__tgFooterHtml() : '')), '');

// ── розклад: чи пора слати цей тип ──
const INTERVAL = { ballistic: BALLISTIC_MIN * 60000, ballisticLive: BALLISTIC_MIN * 60000, launch: LAUNCH_MIN * 60000, missile: MISSILE_MIN * 60000, situation: SITUATION_MIN * 60000, strat: STRAT_MIN * 60000 };
// Допуск на «розклад від cron»: у режимі одного проходу (RUN_SEC=0) запуски йдуть раз на N хв, і час перевірки гуляє на ±десятки секунд
// (черга GitHub, довжина запуску). Якщо вимагати рівно INTERVAL, то перевірка «через 9:55 замість 10:00» пропускається і повідомлення
// виходить лише раз на 2 запуски — тобто раз на 20 хв замість 10. Тому вважаємо «пора», коли минуло INTERVAL мінус допуск (не більше 30% інтервалу).
const SLACK_MS = RUN_SEC ? 0 : Number(process.env.SCHED_SLACK_SEC ?? 150) * 1000;
const due = k => Date.now() - (state.sched[k] || 0) >= INTERVAL[k] - Math.min(SLACK_MS, INTERVAL[k] * 0.3);
const mark = k => { state.sched[k] = Date.now(); saveState(); };
const mapReadyAt = Date.now() + WAIT_MS;                                  // карті потрібен час, щоб намалювати цілі

let mapTriggers = [];
const readNews = () => page.evaluate(() => {
  const arr = (window._dimapNewsHistory && window._dimapNewsHistory.length) ? window._dimapNewsHistory : (window._dimapNews || []);
  const strip = h => {
    try {
      const d = new DOMParser().parseFromString('<body>' + String(h || '').replace(/<br\s*\/?>/gi, ' \n ') + '</body>', 'text/html');
      return (d.body.textContent || '').replace(/[ \t]+/g, ' ').trim();
    } catch (e) { return String(h || '').replace(/<[^>]*>/g, ' '); }
  };
  return arr.map(n => ({ id: String(n.id != null ? n.id : (n.url || '')), date: n.date || null, text: strip(n.text) })).filter(n => n.text);
});
// одна передача: читає стрічку й шле нове. Балістика — окремим повідомленням і без очікування (лише пауза BALLISTIC_MIN між повідомленнями),
// пуски БпЛА/доставка — не частіше ніж раз на LAUNCH_MIN. Те, що не встигло піти через паузу, повернеться на наступній передачі (поки новина свіжа).
async function newsPass(label) {
  const raw = await readNews();
  const pick = pickNewEvents(raw, state, Date.now(), { maxAgeMin: NEWS_MAX_AGE_MIN });
  if (pick.active && pick.active.length) mapTriggers = toMapTriggers(pick.active, { threatToo: BALLISTIC_THREAT_BLINK });
  if (pick.events.length || label) console.log(`${label || 'Новини'}: ${pick.stats.total} у стрічці, свіжих ${pick.stats.fresh}, без дати ${pick.stats.noDate}; подій: ${pick.stats.parsed}; до публікації: ${pick.events.length}`);
  if (!NEWS_SEND || !pick.events.length) return pick.events.length;
  const channels = [
    ['ballistic', 'балістика', pick.events.filter(e => e.kind === 'ballistic')],
    ['launch', 'БпЛА/доставка', pick.events.filter(e => e.kind !== 'ballistic')],
  ];
  for (const [key, name, evs] of channels) {
    if (!evs.length || !due(key)) continue;
    const res = await sendText(formatEvents(evs, footerHtml));
    console.log(`Пуски з новин (${name}):`, JSON.stringify(res).slice(0, 200));
    if (res.ok) { evs.forEach(e => { const st = pick.stamps.find(([k]) => k === e.key); if (st) state.news.sent[st[0]] = st[1]; }); mark(key); }
    else console.log(`::warning::Новини (${name}) не надіслано: ${res.description}`);
  }
  return pick.events.length;
}


// ══ ОКРЕМЕ ПОПЕРЕДЖЕННЯ ПРО КАБи (літаки біля областей) ══
let lastKabCheck = 0;
async function kabPass() {
  if (!KAB_ALERTS || Date.now() - lastKabCheck < 30000) return;
  lastKabCheck = Date.now();
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


// ══ СКРІНШОТ КАРТИ ══
// Підготовка карти (стилі, шар «Окуповано», шар тривог, кадр, легенда) робиться ОДИН раз; далі лише знімаємо.
let shotReady = false;
async function prepareShot() {
  if (shotReady) return;
  shotReady = true;
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

// ── Шар тривог на мінімальній яскравості (насиченість ALERT_OPACITY %) ──
// Спершу ставимо насиченість (повзунок «Відображення»), потім вмикаємо шар — тоді тривоги одразу малюються приглушеними.
// Якщо сайт уже сам увімкнув шар (автозапуск через 1.5 с) — повторно НЕ перемикаємо, інакше вимкнемо.
if (ALERTS_LAYER) {
  const al = await safe('шар тривог', () => page.evaluate(async op => {
    if (typeof applyAlertOpacity !== 'function' || typeof toggleAlertsLayer !== 'function') return { ok: false, why: 'на сайті нема applyAlertOpacity/toggleAlertsLayer' };
    applyAlertOpacity(op);                                   // зберігає значення і (якщо шар уже активний) перемальовує
    const slider = document.querySelector('input.asp-slider[oninput*="applyAlertOpacity"]');
    if (slider) slider.value = op;
    if (!window.alertsEnabled) toggleAlertsLayer();          // вмикає шар, вантажить межі й тягне тривоги
    for (let i = 0; i < 40 && !window.alertsEnabled; i++) await new Promise(r => setTimeout(r, 250));
    try { if (typeof _loadHromada === 'function') await _loadHromada(); } catch (e) {}
    await updateAlerts();                                    // гарантовано дочекатись завантаження і малювання тривог
    let painted = -1;
    try { painted = Object.values(_oblast).filter(_isAlertColored).length; } catch (e) {}
    let paintedH = 0; try { paintedH = Object.values(_hromada).filter(_isAlertColored).length; } catch (e) {}   // тривоги по громадах/районах
    return { ok: !!window.alertsEnabled, opacity: alertSettings.alertOpacity, paintedOblasts: painted, paintedHromadas: paintedH };
  }, ALERT_OPACITY), null);
  console.log('Шар тривог:', al ? JSON.stringify(al) : '⚠️ НЕ вдалося ввімкнути', `(насиченість ${ALERT_OPACITY}%)`);
}
else {
  // сайт сам вмикає шар тривог через ~1.5 с після завантаження — на скрінах бота вимикаємо його, щоб жовті/червоні області не перекривали цілі
  const off = await safe('вимкнути тривоги', () => page.evaluate(async () => {
    for (let i = 0; i < 12 && !window.alertsEnabled; i++) await new Promise(r => setTimeout(r, 250));
    if (window.alertsEnabled && typeof toggleAlertsLayer === 'function') toggleAlertsLayer();
    await new Promise(r => setTimeout(r, 300));
    return !window.alertsEnabled;
  }), null);
  console.log('Шар тривог на скрінах:', off ? 'вимкнено' : '⚠️ не вдалося вимкнути');
}

// пуски: червона пульсуюча обводка навколо аеродрому / позиції пуску (БпЛА і балістика), аватарка маркера лишається видимою
const nBlink = await safe('__launchTrigger', () => page.evaluate(t => (window.__launchTrigger ? window.__launchTrigger(t) : -1), mapTriggers), -1);
console.log(`Тригери пусків на карті: ${nBlink} з ${mapTriggers.length}` + (nBlink === -1 ? ' (на сайті немає __launchTrigger — старий index.html?)' : ''));

// кадр: Україна по кордонах із відступом. zoomSnap=0 — інакше Leaflet округлює зум вниз до цілого і країна виглядає дрібною
await safe('кадр карти', frameUkraine);
await prepareShot2();
}
// кадр «Україна»: рівно зверху, на північ, по кордонах (після кадру стратегів повертаємось до нього)
function frameUkraine() { return page.evaluate(([bounds, pad]) => {
  const m = window.map;
  document.documentElement.classList.add('tg-shot');          // заморожує блимання у «увімкненому» стані
  if (m) {
    m.options.zoomSnap = 0; m.options.zoomDelta = 0.25;
    m.invalidateSize();
    m.fitBounds(bounds, { animate: false, padding: [pad, pad], maxZoom: 9 });
    // нова карта (MapLibre 3D): кадр завжди рівно зверху, на північ, без сцен/слідування камери
    try { if (window.LMFollow) LMFollow.stop(); if (window.LMScene) LMScene.stop(); } catch (e) {}
    if (m._ml) { m._ml.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); m._ml.jumpTo({ pitch: 0, bearing: 0 }); m.fitBounds(bounds, { animate: false, padding: [pad, pad], maxZoom: 9 }); }
  }
}, [FRAME_BOUNDS, FRAME_PADDING]); }
async function prepareShot2() {
await waitMapIdle(9000);
// ── ЛЕГЕНДА КАРТИ ──
// Будується прямо тут, у боті (не залежить від того, чи оновлено index.html на сайті): іконки — ВЛАСНІ svg з img/ сайту.
// Стоїть у вільному куті кадру (низ-ліво), масштабується під розмір вікна.
const LEGEND_ROWS = [
  { ic: ['geran2'],                       t: 'Поршневі БпЛА',       s: '80–250 км/год',   m: 'Герань-2 / Гербера' },
  { ic: ['geran3', 'geran4'],             t: 'Реактивні БпЛА',      s: '350–650 км/год',  m: 'Герань-3 / Герань-4' },
  { ic: ['banderol', 'geran5'],           t: 'Малі крилаті ракети', s: '580–700 км/год',  m: 'Бандероль / Герань-5' },
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
}
async function takeShot() {
  await prepareShot();
  await safe('__launchTrigger', () => page.evaluate(t => (window.__launchTrigger ? window.__launchTrigger(t) : -1), mapTriggers), -1);
  await page.waitForTimeout(600);
  await waitMapIdle(5000);                       // тайли й шари домальовані — скрін без «дірок»
  return page.screenshot({ type: 'jpeg', quality: 85 });
}
// ── Підпис до фото: Telegram дозволяє лише 1024 видимі символи. Довгий текст СКОРОЧУЄМО, щоб карта й текст ішли ОДНИМ повідомленням ──
const CAP_MAX = 1000;
const visLen = h => String(h).replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, '_').length;
function closeTags(h) {
  const st = []; String(h).replace(/<\/?([a-z]+)[^>]*>/gi, (m, t) => { t = t.toLowerCase(); if (m[1] === '/') { const i = st.lastIndexOf(t); if (i >= 0) st.splice(i, 1); } else st.push(t); return m; });
  return h + st.reverse().map(t => '</' + t + '>').join('');
}
function fitCaption(html) {
  html = String(html || '');
  if (visLen(html) <= CAP_MAX) return html;
  const parts = html.split('\n\n'), foot = parts.length > 1 ? parts.pop() : '';
  const lines = parts.join('\n\n').split('\n');
  const tail = n => '\n<i>…і ще ' + n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'рядок' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'рядки' : 'рядків') + ' — усе на карті</i>';
  let keep = lines.length, out = html;
  while (keep > 1) {
    keep--;
    const body = closeTags(lines.slice(0, keep).join('\n')) + tail(lines.length - keep);
    out = body + (foot ? '\n\n' + foot : '');
    if (visLen(out) <= CAP_MAX) return out;
  }
  // крайній випадок — один дуже довгий рядок: ріжемо видимий текст
  const plain = html.replace(/<[^>]*>/g, '');
  return plain.slice(0, CAP_MAX - 1) + '…';
}
// Підпис: спершу пробуємо ВЕСЬ текст. Якщо Telegram відмовить через довжину — карта з початком тексту,
// а решта ВІДПОВІДДЮ одразу під фото (без «…і ще N рядків»), нічого не губиться.
const TOO_LONG = d => /caption.*too long|MEDIA_CAPTION_TOO_LONG|too long/i.test(String(d || ''));
function splitCaption(html) {
  html = String(html || '');
  if (visLen(html) <= CAP_MAX) return { cap: html, rest: '' };
  const lines = html.split('\n'); let k = 0;
  while (k < lines.length && visLen(lines.slice(0, k + 1).join('\n')) <= CAP_MAX) k++;
  if (k === 0) { const plain = html.replace(/<[^>]*>/g, ''); return { cap: plain.slice(0, CAP_MAX), rest: plain.slice(CAP_MAX) }; }
  while (k > 1 && !lines[k - 1].trim()) k--;
  return { cap: closeTags(lines.slice(0, k).join('\n')), rest: lines.slice(k).join('\n').replace(/^\s+/, '') };
}
async function sendRest(rest, replyTo) {
  if (!rest || !rest.trim()) return;
  const b = new FormData(); b.append('chat_id', TG_CHAT_ID); b.append('parse_mode', 'HTML'); b.append('disable_web_page_preview', 'true');
  b.append('text', rest); if (replyTo) b.append('reply_to_message_id', String(replyTo));
  let r = await api('sendMessage', b);
  if (!r.ok) { const b2 = new FormData(); b2.append('chat_id', TG_CHAT_ID); b2.append('text', rest.replace(/<[^>]*>/g, '')); if (replyTo) b2.append('reply_to_message_id', String(replyTo)); r = await api('sendMessage', b2); }
  console.log('sendMessage (продовження)', JSON.stringify(r).slice(0, 160));
}
async function sendReport(text, shotBuf) {
  const shot = shotBuf || await takeShot();
  const form = new FormData();
  form.append('chat_id', TG_CHAT_ID);
  form.append('parse_mode', 'HTML');
  form.append('disable_web_page_preview', 'true');
  let ok = true;
  const check = (label, res) => { console.log(label, JSON.stringify(res).slice(0, 300)); if (!res || !res.ok) { ok = false; console.log(`::warning::Telegram ${label}: ${res && res.description}`); } };
  // карта + ВЕСЬ текст у підписі
  form.append('caption', String(text));
  form.append('photo', new Blob([shot], { type: 'image/jpeg' }), 'map.jpg');
  let res = await api('sendPhoto', form);
  if (!res.ok && TOO_LONG(res.description)) {
    const { cap, rest } = splitCaption(text);
    const f3 = new FormData(); f3.append('chat_id', TG_CHAT_ID); f3.append('parse_mode', 'HTML');
    f3.append('caption', cap); f3.append('photo', new Blob([shot], { type: 'image/jpeg' }), 'map.jpg');
    res = await api('sendPhoto', f3);
    if (res.ok) await sendRest(rest, res.result && res.result.message_id);
  }
  if (!res.ok && /parse|entit|caption/i.test(String(res.description || ''))) {   // зламалась розмітка — шлемо той самий підпис простим текстом
    const f2 = new FormData(); f2.append('chat_id', TG_CHAT_ID);
    f2.append('caption', fitCaption(String(text).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')));
    f2.append('photo', new Blob([shot], { type: 'image/jpeg' }), 'map.jpg');
    res = await api('sendPhoto', f2);
  }
  check('sendPhoto', res);
  return ok;
}

// ── БАЛІСТИКА З КАРТИ (kn23, iskanderm, Кинджал, Орєшнік…): шлемо ТЕКСТ одразу, без скріншота (скрін додає секунди) ──
// Нова ціль = кількість балістичних цілей зросла. Перша — миттєво; наступні, що з'явились протягом BALLISTIC_MIN, йдуть одним повідомленням.
let ballSeen = 0;
async function ballisticLivePass() {
  const r = await page.evaluate(() => window.__tgBuild('ballistic'));
  if (!r.n) { ballSeen = 0; return; }
  if (r.n <= ballSeen) { ballSeen = r.n; return; }          // нових цілей нема (або частина вже зникла)
  if (!due('ballisticLive')) return;                         // зачекаємо до кінця паузи — відправиться на одній з наступних перевірок
  const res = await sendText(r.html);
  console.log(`Балістика (карта): цілей ${r.n}, було ${ballSeen}`, JSON.stringify(res).slice(0, 160));
  if (res.ok) { ballSeen = r.n; mark('ballisticLive'); }
}

// зведення по категорії цілей на карті: 'missile' (ракети, раз на MISSILE_MIN) і 'drone' (загальна ситуація по БпЛА, раз на SITUATION_MIN)
async function summaryPass(key, cat, label) {
  if (!due(key)) return;
  const r = await page.evaluate(c => window.__tgBuild(c), cat);
  console.log(`${label}: цілей ${r.n} | відсічено: ТОТ ${r.skippedOcc}, поза Україною ${r.skippedOutside}, літаки ${r.skippedPlanes} | DeepState: ${r.occReady}`);
  if (!r.n) {
    if (key === 'situation' && !SKIP_IF_EMPTY && await sendReport('✅ Активних цілей немає')) mark(key);
    return;                                           // порожнє зведення не надсилаємо і таймер не скидаємо
  }
  if (await sendReport(r.html)) mark(key);
}


// ── СТРАТЕГІЧНА АВІАЦІЯ (Ту-95 / Ту-160 / Ту-22М3 / МіГ-31К з новин) ──
// Сайт (StratSim) веде сценарій: де летять борти, рубіж, маневр, пуски. Бот шле ДВА скріни альбомом:
//   1) загальна карта України (як в інших звітах);  2) кадр польоту стратегів (борти, рубіж пуску, траєкторії ракет).
// Виліт, пусковий маневр, пуск, підліт ракет до кордону, повернення — ОДРАЗУ (незалежно від паузи); у польоті — оновлення раз на STRAT_MIN хв.
const STRAT_URGENT = { launch: 5, maneuver: 4, takeoff: 3, etaBorder: 2, rtb: 1 };
async function sendAlbum(text, shots) {
  const go = cap => {
    const fd = new FormData();
    fd.append('chat_id', TG_CHAT_ID);
    fd.append('media', JSON.stringify(shots.map((_, i) => ({ type: 'photo', media: 'attach://p' + i, ...(i === 0 ? { caption: cap, parse_mode: 'HTML' } : {}) }))));
    shots.forEach((b, i) => fd.append('p' + i, new Blob([b], { type: 'image/jpeg' }), 'p' + i + '.jpg'));
    return api('sendMediaGroup', fd);
  };
  let r = await go(String(text)), rest = '';                      // спершу весь текст підписом
  if (!r.ok && TOO_LONG(r.description)) { const sp = splitCaption(text); rest = sp.rest; r = await go(sp.cap); }
  console.log('sendMediaGroup', JSON.stringify(r).slice(0, 200));
  if (!r.ok) { console.log(`::warning::Telegram sendMediaGroup: ${r.description}`); return sendReport(text, shots[0]); }   // запасний шлях — одне фото
  if (rest) await sendRest(rest, r.result && r.result[0] && r.result[0].message_id);
  return true;
}
async function stratPass() {
  if (!STRAT_ALERTS) return;
  const st = await page.evaluate(() => {
    if (!window.StratSim || !StratSim.status) return null;
    try { StratSim.ingest(); } catch (e) {}
    return StratSim.status();
  });
  if (!st) return;
  // новини про стратегів — у state (наступний запуск бота відновить сценарій)
  if (JSON.stringify(st.msgs) !== JSON.stringify(state.strat.msgs)) { state.strat.msgs = st.msgs; saveState(); }
  const now = Date.now();
  // ── передислокації, тренування, підсумок за добу, ймовірність обстрілу — лише текстом, без скрінів ──
  const AIR = { summary: 1, reloc: 1, train: 1, prob: 1 };
  for (const e of (st.events || []).filter(e => AIR[e.k] && !state.strat.sent[e.key])) {
    state.strat.sent[e.key] = now;
    if (now - e.ts > 6 * 3600000) continue;                 // старе (після перезапуску) — не дублюємо
    if (e.k === 'prob' && e.summary) continue;              // ймовірність уже є в підсумку за добу
    const txt = await page.evaluate(([k, key]) => StratSim.airReport(k, key), [e.k, e.key]);
    if (!txt) continue;
    console.log(`Стратегічна авіація (без скрінів): ${e.k}`);
    const r = await sendText(txt + (footerHtml ? '\n\n' + footerHtml : ''));
    if (!r.ok) { console.log(`::warning::Telegram sendMessage: ${r.description}`); delete state.strat.sent[e.key]; }
    saveState();
  }
  const fresh = (st.events || []).filter(e => !AIR[e.k] && !state.strat.sent[e.key] && now - e.ts < 3 * 3600000);
  // «живі» групи — ті, про які є новини (розрахункове «повертаються» не рахується)
  const live = st.groups.filter(g => !g.auto && g.state !== 'gone');
  const launched = st.groups.some(g => g.launched);
  let kind = null;
  fresh.forEach(e => {
    let k = e.k;
    if (k === 'etaBorder') k = launched ? 'launch' : null;      // «підліт КР до кордону» без пуску зі стратегів — не наша тема (напр. Калібри)
    if (k && STRAT_URGENT[k] && (!kind || STRAT_URGENT[k] > STRAT_URGENT[kind])) kind = k;
  });
  if (!kind) {
    if (!live.length || !due('strat')) return;    // не термінове: піде в наступному оновленні
    kind = 'update';
  }
  if (!live.length && kind !== 'rtb') { fresh.forEach(e => { state.strat.sent[e.key] = now; }); saveState(); return; }
  const html = await page.evaluate(k => StratSim.reportHtml(k), kind);
  console.log(`Стратегічна авіація: ${kind}, груп ${st.groups.length}, нових подій ${fresh.length}`);
  const shot1 = await takeShot();                                     // 1) загальна інформація — Україна
  let shot2 = null;
  try {
    const ok = await page.evaluate(k => StratSim.frameView(k), kind);  // 2) політ стратегів
    if (ok) { await page.waitForTimeout(500); await waitMapIdle(7000); shot2 = await page.screenshot({ type: 'jpeg', quality: 85 }); }
  } finally {
    await safe('кадр карти', frameUkraine);
    await waitMapIdle(5000);
  }
  const text = html + (footerHtml ? '\n\n' + footerHtml : '');
  const ok = shot2 ? await sendAlbum(text, [shot1, shot2]) : await sendReport(text, shot1);
  if (ok) { fresh.forEach(e => { state.strat.sent[e.key] = now; }); mark('strat'); }
}

// ── О 00:00 за Києвом: загальний підсумок (БпЛА / стратегічна авіація / балістика / флот) + теплова карта ДОБИ на головній мапі ──
// Текст і оверлей дає сайт (window.__midnightReport / __midnightPrepare з нового index.html); кадр, легенда й тривоги — ті самі, що в інших звітах.
// Шлемо лише раз на добу (state.heat.lastDay) і лише протягом MIDNIGHT_GRACE_MIN хв після 00:00, щоб «станом на 00:00» не став «станом на 03:00».
const MIDNIGHT = process.env.MIDNIGHT !== '0';                              // MIDNIGHT=0 вимикає нічний підсумок
const MIDNIGHT_GRACE_MIN = Number(process.env.MIDNIGHT_GRACE_MIN ?? 45);
// ── Наявність БпЛА / балістики на пускових майданчиках — зведенням двічі на день (13:00 і 22:00 за Києвом) ──
const STOCK_SLOTS = (process.env.STOCK_SLOTS || '13:00,22:00').split(',').map(x => x.trim()).filter(Boolean);
const STOCK_WINDOW_MIN = Number(process.env.STOCK_WINDOW_MIN || 120);   // якщо бот запустився із запізненням — шле в межах 2 год після слоту
function kyivNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}
async function stockPass() {
  const k = kyivNow();
  const slot = STOCK_SLOTS.find(sl => { const [h, m] = sl.split(':').map(Number), t = h * 60 + (m || 0); return k.min >= t && k.min < t + STOCK_WINDOW_MIN; });
  if (!slot) return;
  const key = k.day + ' ' + slot;
  if (state.stock.sent[key]) return;
  const html = await page.evaluate(() => (window.StockWatch && StockWatch.digest ? StockWatch.digest(48) : ''));
  state.stock.sent[key] = Date.now(); saveState();
  if (!html) { console.log(`Наявність (${key}): даних за 48 год немає — пропускаю`); return; }
  console.log(`Наявність: зведення ${key}`);
  const r = await sendText(html + (footerHtml ? '\n\n' + footerHtml : ''));
  if (!r.ok) { console.log(`::warning::Telegram sendMessage: ${r.description}`); delete state.stock.sent[key]; saveState(); }
}

async function midnightPass() {
  const d = heatmapDue(state, Date.now(), { graceMin: MIDNIGHT_GRACE_MIN });   // { day:'YYYY-MM-DD' } — попередня доба, або null
  if (!d) return;
  const rep = await page.evaluate(() => (window.__midnightReport ? window.__midnightReport() : null));
  if (!rep) { console.log('::warning::Нічний підсумок: на сайті немає __midnightReport — оновіть index.html'); return; }
  await prepareShot();
  const prep = await safe('__midnightPrepare', () => page.evaluate(day => window.__midnightPrepare(day, { keepView: true }), d.day), null);
  console.log(`Нічний підсумок за ${d.day}: маршрутів ${prep ? prep.rows : '— (теплова карта не вдалась)'}, тайли ${prep ? prep.tiles : '—'}`);
  await safe('тригери', () => page.evaluate(t => (window.__launchTrigger ? window.__launchTrigger(t) : -1), mapTriggers), -1);
  await page.waitForTimeout(600);
  await waitMapIdle(6000);
  let ok = false;
  try {
    const shot = await page.screenshot({ type: 'jpeg', quality: 85 });
    ok = await sendReport(rep.html, shot);
  } finally {
    await safe('__midnightClear', () => page.evaluate(() => window.__midnightClear && window.__midnightClear()));
  }
  if (ok) { state.heat = { ...(state.heat || {}), lastDay: d.day, sentAt: Date.now(), rows: prep ? prep.rows : 0 }; saveState(); }
}

// ══ ГОЛОВНИЙ ЦИКЛ ══
// Перша передача новин — одразу (без очікування карти). Далі кожні POLL_SEC секунд: новини (балістика/пуски/доставка), ракети, загальна ситуація, КАБ.
// RUN_SEC=0 — один прохід (після очікування карти) і вихід; RUN_SEC>0 — безперервна робота, у GitHub Actions ставимо ~20000 (5 год 40 хв).
if (NEWS_LAUNCHES) {
  await page.waitForFunction(() => (window._dimapNewsHistory && window._dimapNewsHistory.length) || (window._dimapNews && window._dimapNews.length), null, { timeout: NEWS_WAIT_MS })
    .catch(() => console.log('⚠️ Стрічка новин не завантажилась за відведений час — пробую з тим, що є.'));
}
const endAt = Date.now() + RUN_SEC * 1000;
let lastReload = Date.now(), fails = 0;
console.log(`Старт: балістика ${BALLISTIC_MIN} хв, пуски БпЛА ${LAUNCH_MIN} хв, ракети ${MISSILE_MIN} хв, ситуація ${SITUATION_MIN} хв; працюю ${RUN_SEC || 0} с; допуск розкладу ${Math.round(SLACK_MS / 1000)} с`);
for (;;) {
  try {
    if (NEWS_LAUNCHES) await newsPass();
    if (!RUN_SEC && Date.now() < mapReadyAt) await page.waitForTimeout(mapReadyAt - Date.now());
    if (Date.now() >= mapReadyAt) {
      await safe('балістика', ballisticLivePass);
      await safe('ракети', () => summaryPass('missile', 'missile', 'Ракети'));
      await safe('ситуація', () => summaryPass('situation', 'drone', 'Ситуація БпЛА'));
      await safe('КАБ', kabPass);
      await safe('стратегічна авіація', stratPass);
      await safe('наявність БпЛА', stockPass);
      if (MIDNIGHT) await safe('нічний підсумок', midnightPass);
    }
    fails = 0;
  } catch (e) {
    fails++;
    console.log(`::warning::Цикл: ${one(e && e.message)} (підряд ${fails})`);
    if (fails >= 6) await fail('Сторінка не відповідає 6 разів поспіль — завершую, наступний запуск почне з нуля.');
  }
  if (!RUN_SEC || Date.now() + POLL_SEC * 1000 >= endAt) break;
  if (Date.now() - lastReload > RELOAD_MIN * 60000) {            // профілактичне перезавантаження
    lastReload = Date.now();
    await safe('reload', async () => { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); await hooksReady(); shotReady = false; });
  }
  await page.waitForTimeout(POLL_SEC * 1000);
}
saveState();
await browser.close();
console.log('Готово.');
