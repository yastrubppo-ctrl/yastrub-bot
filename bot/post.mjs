import { chromium } from 'playwright';

const { TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL, VERCEL_BYPASS } = process.env;
const SKIP_IF_EMPTY = process.env.SKIP_IF_EMPTY !== '0';
const WAIT_MS = Number(process.env.WAIT_MS || 25000);
if (!TG_BOT_TOKEN || !TG_CHAT_ID || !SITE_URL) { console.error('Потрібні TG_BOT_TOKEN, TG_CHAT_ID, SITE_URL'); process.exit(1); }

const api = (m, body) => fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${m}`, { method: 'POST', body }).then(r => r.json());

const siteOrigin = new URL(SITE_URL).origin;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5, timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
page.on('pageerror', e => console.log('pageerror:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 200)); });

// ключ Vercel додаємо ТІЛЬКИ до запитів на наш сайт
if (VERCEL_BYPASS) {
  await page.route('**/*', route => {
    const req = route.request();
    if (req.url().startsWith(siteOrigin)) {
      route.continue({ headers: { ...req.headers(), 'x-vercel-protection-bypass': VERCEL_BYPASS, 'x-vercel-set-bypass-cookie': 'true' } });
    } else {
      route.continue();
    }
  });
}

const resp = await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('HTTP статус сайту:', resp && resp.status());
console.log('Заголовок сторінки:', await page.title());

try {
  await page.waitForFunction(() => typeof window.__tgBuild === 'function', null, { timeout: 60000 });
} catch (e) {
  console.log('❌ Функція __tgBuild не з\'явилась.');
  console.log('Початок тексту сторінки:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
  console.log('Є L (leaflet)?', await page.evaluate(() => typeof window.L));
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(WAIT_MS);

let r = await page.evaluate(() => window.__tgBuild());
if (!r.n) { await page.waitForTimeout(10000); r = await page.evaluate(() => window.__tgBuild()); }
console.log('Цілей:', r.n);
if (!r.n && SKIP_IF_EMPTY) { await browser.close(); console.log('Цілей нема — пропускаю.'); process.exit(0); }

await page.addStyleTag({ content: '.leaflet-control-container{display:none!important}' }).catch(() => {});
const shot = await page.locator('#map').screenshot({ type: 'jpeg', quality: 85 }).catch(async () => page.screenshot({ type: 'jpeg', quality: 85 }));
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
