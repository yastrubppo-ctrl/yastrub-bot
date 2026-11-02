
import { chromium } from 'playwright';
import fs from 'node:fs';

const { TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL } = process.env;
const SKIP_IF_EMPTY = process.env.SKIP_IF_EMPTY !== '0';   // не постити, якщо цілей нема
const WAIT_MS = Number(process.env.WAIT_MS || 25000);        // час, щоб сайт підтягнув цілі з DIMAP
if (!TG_BOT_TOKEN || !TG_CHAT_ID || !SITE_URL) { console.error('Потрібні TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL'); process.exit(1); }

const api = (m, body) => fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${m}`, { method: 'POST', body })
  .then(r => r.json());

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5, timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => typeof window.__tgBuild === 'function', null, { timeout: 60000 });
await page.waitForTimeout(WAIT_MS);

// зведення (з повторною спробою, якщо цілі ще не з'явились)
let r = await page.evaluate(() => window.__tgBuild());
if (!r.n) { await page.waitForTimeout(10000); r = await page.evaluate(() => window.__tgBuild()); }
console.log('Цілей:', r.n);

// ── ОКРЕМІ ПОПЕРЕДЖЕННЯ: літак біля області → «Загроза КАБів у … області» ──
// Шлемо одразу (до скриншота), окремим повідомленням. Кулдаун не дає повторювати те саме по області.
try {
  const ALERT_COOLDOWN_MIN = Number(process.env.ALERT_COOLDOWN_MIN || 30);
  const STATE_FILE = new URL('./alert-state.json', import.meta.url);
  const alerts = Array.isArray(r.alerts) ? r.alerts : [];
  console.log('Попереджень про КАБи:', alerts.length);
  if (alerts.length) {
    let state = {};
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
    const now = Date.now();
    for (const a of alerts) {
      if (now - (state[a.key] || 0) < ALERT_COOLDOWN_MIN * 60000) { console.log('Кулдаун, пропускаю:', a.key); continue; }
      const f = new FormData();
      f.append('chat_id', TG_CHAT_ID);
      f.append('parse_mode', 'HTML');
      f.append('disable_web_page_preview', 'true');
      f.append('text', a.html);
      const res = await api('sendMessage', f);
      console.log('Попередження', a.key, res.ok ? 'надіслано' : res);
      if (res.ok) state[a.key] = now;
    }
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {}
  }
} catch (e) { console.log('Помилка попереджень (основний пост не зачіпаю):', e.message); }
if (!r.n && SKIP_IF_EMPTY) { await browser.close(); console.log('Цілей нема — пропускаю.'); process.exit(0); }

// прибираємо зайве з екрана перед скріншотом (модалки/панелі), лишаємо карту
await page.addStyleTag({ content: '.leaflet-control-container{display:none!important}' }).catch(() => {});
const shot = await page.locator('#map').screenshot({ type: 'jpeg', quality: 85 }).catch(async () => page.screenshot({ type: 'jpeg', quality: 85 }));
await browser.close();

const text = r.n ? r.html : '✅ Активних цілей немає';
const form = new FormData();
form.append('chat_id', TG_CHAT_ID);
form.append('parse_mode', 'HTML');
form.append('disable_web_page_preview', 'true');
if (text.length <= 1000) {                         // підпис до фото має ліміт 1024
  form.append('caption', text);
  form.append('photo', new Blob([shot], { type: 'image/jpeg' }), 'map.jpg');
  console.log(await api('sendPhoto', form));
} else {                                           // довге зведення: фото окремо, текст окремо
  const f1 = new FormData(); f1.append('chat_id', TG_CHAT_ID); f1.append('photo', new Blob([shot], { type: 'image/jpeg' }), 'map.jpg');
  console.log(await api('sendPhoto', f1));
  form.append('text', text);
  console.log(await api('sendMessage', form));
}
