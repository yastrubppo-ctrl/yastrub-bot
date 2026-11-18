// Звіт о 00:00 за Києвом: знімок ГОЛОВНОЇ мапи з тепловою картою за добу + підсумок текстом.
// Потрібна лише сторінка з index.html, відкрита в headless-браузері (Playwright або Puppeteer — підійде будь-який,
// використовується тільки page.evaluate). Викликати регулярно (раз на хвилину): сам вирішує, чи вже час, і не шле двічі.
//
//   import { runMidnightReport } from './midnight-job.mjs';
//   state = await runMidnightReport({
//     page,                                   // сторінка з відкритим index.html (та сама, що дає __tgBuild / __launchTrigger)
//     state, now: Date.now(),
//     sendPhoto: (png, captionHtml) => tgSendPhoto(CHANNEL_ID, png, captionHtml, { parse_mode: 'HTML' }),
//   });
//
// ⚠️ Не перевірено в реальному браузері (тут немає мережі): перший запуск зробіть вручну, дивіться консоль сторінки.
import { heatmapDue } from './heatmap.mjs';

export async function runMidnightReport({ page, state, now = Date.now(), sendPhoto, graceMin = 180 }) {
  const due = heatmapDue(state, now, { graceMin });             // { day: 'YYYY-MM-DD' } — ПОПЕРЕДНЯ доба, або null
  if (!due) return state;

  // 1) стан на 00:00 — спершу, щоб карта/оверлей нічого не змінили
  const report = await page.evaluate(() => window.__midnightReport());

  // 2) головна мапа: вся Україна + тепло за добу + дочекатись тайлів
  const prep = await page.evaluate(day => window.__midnightPrepare(day), due.day);

  // 3) знімок мапи (html2canvas, той самий, що кнопка «поділитись»)
  let png;
  try {
    const dataUrl = await page.evaluate(() => window.__midnightShot());
    png = Buffer.from(dataUrl.split(',')[1], 'base64');
  } catch (e) {
    // запасний шлях — скріншот елемента (Playwright): png = await page.locator('#map').screenshot({ type: 'png' });
    throw e;
  } finally {
    await page.evaluate(() => window.__midnightClear()).catch(() => {});
  }

  await sendPhoto(png, report.html);
  return { ...state, heat: { ...(state && state.heat), lastDay: due.day, sentAt: now, rows: prep.rows } };
}
