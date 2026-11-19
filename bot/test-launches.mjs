import assert from 'node:assert/strict';
import { parseNews, mergeEvents, formatEvents, toMapTriggers, toLaunchShots, aggregateDeliveries, siteSummary, makeSampleNews, pickNewEvents } from './launches.mjs';
const run = t => mergeEvents(parseNews(t));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✓', name); };

const MSG1 = '❗️Пуски Бандеролей з акваторії Азовського моря.\nЙмовірно спробують атакувати Миколаївщину/Одещину.';
const MSG2 = '❗️Можливі пуски Бандеролей з Курська!';

ok('Бандероль з Азовського моря → пуск, зона azov, цілі', () => {
  const e = run(MSG1); assert.equal(e.length, 1);
  assert.equal(e[0].kind, 'drone'); assert.equal(e[0].site.id, 'azov'); assert.equal(e[0].droneType, 'banderol');
  assert.equal(e[0].possible, false); assert.deepEqual(e[0].targets, ['Миколаївщина', 'Одещина']);
});
ok('Можливі пуски Бандеролей з Курська', () => {
  const e = run(MSG2); assert.equal(e.length, 1);
  assert.equal(e[0].site.id, 'kursk'); assert.equal(e[0].droneType, 'banderol'); assert.equal(e[0].possible, true);
});
ok('обидва повідомлення разом + текст', () => {
  const e = run(MSG1 + '\n' + MSG2); assert.equal(e.length, 2);
  const t = formatEvents(e); console.log(t.split('\n').map(l => '    ' + l).join('\n'));
  assert.match(t, /Пуски БпЛА \(Бандероль\)/); assert.match(t, /Азовське море \(акваторія\)/); assert.match(t, /→ Миколаївщина \/ Одещина/); assert.match(t, /можливі пуски/);
});
ok('карта: azov і kursk у тригерах', () => {
  const tr = toMapTriggers(run(MSG1 + '\n' + MSG2)); assert.deepEqual(tr.map(x => x.siteId).sort(), ['azov', 'kursk']);
});
ok('шахед з Курська та бандероль з Курська — окремі події', () => {
  const e = run('Пуски шахедів з Курська, 3 групи\nПуски бандеролей з Курська'); assert.equal(e.length, 2);
});
ok('шахеди без змін: 10 звичайних, 8 реактивних з Міллерово', () => {
  const e = run('Пуск шахедів з Міллерово, 10 звичайних, 8 реактивних'); assert.equal(e[0].normal, 10); assert.equal(e[0].jetN, 8); assert.equal(e[0].possible, false);
});
ok('скрін для азовської зони, якщо є кількість', () => {
  const sh = toLaunchShots(run('Пуски бандеролей з акваторії Азовського моря, 6 бандеролей')); assert.equal(sh.length, 1); assert.equal(sh[0].siteId, 'azov');
});
ok('«підтвердження» можливого пуску публікується повторно', () => {
  const now = Date.now(), a = pickNewEvents([{ date: new Date(now - 60000).toISOString(), text: MSG2 }], {}, now);
  assert.equal(a.events.length, 1);
  const st = { news: { sent: Object.fromEntries(a.stamps) } };
  const same = pickNewEvents([{ date: new Date(now - 30000).toISOString(), text: MSG2 }], st, now + 1000); assert.equal(same.events.length, 0);
  const conf = pickNewEvents([{ date: new Date(now - 30000).toISOString(), text: 'Пуски бандеролей з Курська' }], st, now + 1000); assert.equal(conf.events.length, 1);
});

// ── ДОСТАВКА: лише пускові локації ──
const deliv = t => parseNews(t).filter(e => e.kind === 'delivery');
for (const bad of [
  'Доставили шахеди в Харків', 'Мукачеве: прибув ешелон з шахедами', 'Харків — 20 од. шахедів',
  'Залізницею доставили 30 шахедів до Одеси', 'На Донеччину доставили 20 шахедів', 'Ешелон з БР прибув у Воронеж',
  'В Орлівку доставили 15 шахедів', 'Доставили 10 шахедів на Донецьку область', 'доставили шахеди в Азовське море',
  'Доставка шахедів:\n- Харків — 20 одиниць\n- Мукачеве — 15 одиниць',
]) ok('НЕ доставка: ' + bad.replace(/\n/g, ' | '), () => assert.equal(deliv(bad).length, 0, JSON.stringify(deliv(bad).map(e => e.site))));
for (const [good, id] of [
  ['На Нявлю доставили ешелон з шахедами', 'nyavlya'], ['Доставили 25 шахедів до Курська', 'kursk'], ['Іл-76 завіз 25 шахедів до Шаталового', 'shatalovo'],
  ['Бандеролі доставили на Курськ залізницею', 'kursk'], ['В Орел доставили 20 шахедів', 'orel'],
]) ok('доставка → ' + id + ': ' + good, () => { const d = deliv(good); assert.ok(d.length && d[0].site.id === id, JSON.stringify(d.map(e => e.site))); });
ok('доставка без місця все ще ділиться між аеродромами', () => assert.equal(deliv('Доставили 40 шахедів, розподіляють по аеродромах')[0].site.name, 'місце не уточнено'));
ok('демо-облік не змінився (Нявля 40, Донецьк 35)', () => {
  const now = Date.now(), agg = aggregateDeliveries(makeSampleNews(now), { now });
  assert.equal(siteSummary(agg, 'nyavlya').today.drone, 40); assert.equal(siteSummary(agg, 'donetsk').today.drone >= 35, true);
  assert.ok(!agg.bySite.azov);
});
console.log('\nУсього перевірок:', n);

// ── ПІДСУМОК О 00:00 ──
import { midnightFacts, formatMidnight } from './launches.mjs';
const NOW = Date.parse('2026-11-17T22:00:00Z');   // 00:00 за Києвом
const nw = (mins, text) => ({ date: new Date(NOW - mins * 60000).toISOString(), text });
const fmt = f => formatMidnight(f, { now: NOW });
ok('00:00: порожньо → усе «не зафіксовано»', () => {
  const t = fmt(midnightFacts([], {}, { now: NOW })); console.log(t.split('\n').map(l => '    ' + l).join('\n'));
  assert.match(t, /Станом на 00:00, 18\.11\.2026/); assert.match(t, /БпЛА не зафіксовано/); assert.match(t, /Вильотів стратегічної авіації не зафіксовано/);
  assert.match(t, /Загрози балістики не зафіксовано/); assert.match(t, /Вихід флоту в море не зафіксовано/);
});
ok('00:00: шахеди на мапі → зафіксовані, можливі пуски', () => {
  assert.match(fmt(midnightFacts([], { drones: 7 }, { now: NOW })), /БпЛА зафіксовані в повітряному просторі України \(7\), можливі пуски протягом ночі/);
});
ok('00:00: виліт Ту-95 → «були зафіксовані вильоти»', () => {
  const t = fmt(midnightFacts([nw(300, '✈️ Виліт Ту-95МС з Енгельса, курс на південь'), nw(200, 'Ту-160 в повітрі')], {}, { now: NOW }));
  assert.match(t, /Були зафіксовані вильоти стратегічної авіації \(Ту-95МС, Ту-160\)/);
});
ok('00:00: відбій/посадка Ту-95 НЕ рахується', () => assert.match(fmt(midnightFacts([nw(100, 'Відбій по Ту-95, літаки повернулись на аеродром')], {}, { now: NOW })), /Вильотів стратегічної авіації не зафіксовано/));
ok('00:00: стара новина (>24 год) ігнорується', () => assert.match(fmt(midnightFacts([nw(1600, 'Виліт Ту-95МС')], {}, { now: NOW })), /не зафіксовано/));
ok('00:00: балістика — пуски й загроза', () => {
  const t = fmt(midnightFacts([nw(120, '🚀 Пуски БР з Брянська, Іскандер'), nw(60, 'Загроза застосування балістики з Курська')], {}, { now: NOW }));
  assert.match(t, /Були пуски балістики з: Брянська область \(Іскандер-М\)/); assert.match(t, /Загроза застосування балістики: Курська область/);
});
ok('00:00: флот у Чорному морі → активний; «носіїв немає» → ні', () => {
  assert.match(fmt(midnightFacts([nw(90, '🚢 Ракетоносії вийшли в акваторію Чорного моря')], {}, { now: NOW })), /Флот активний — виведено в акваторію Чорного моря/);
  assert.match(fmt(midnightFacts([nw(90, 'У Чорному морі ракетоносіїв немає')], {}, { now: NOW })), /Вихід флоту в море не зафіксовано/);
  assert.match(fmt(midnightFacts([], { ships: [{ sea: 'Азовського моря' }] }, { now: NOW })), /акваторію Азовського моря/);
});
console.log('Усього перевірок:', n);
