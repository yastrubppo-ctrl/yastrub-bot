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
// ── доставка: кількість, списки, кілька місць; запаси «в готовності» — не загроза ──
ok('«На Брянщину доставлено 20 балістичних ракет» → 20, тільки Брянщина', () => { const d = deliv('На Брянщину доставлено 20 балістичних ракет Іскандер-М'); assert.equal(d.length, 1); assert.equal(d[0].count, 20); });
ok('Список «На аеродроми доставлено:» → 3 окремі майданчики', () => { const d = deliv('На аеродроми доставлено:\nОрел (Цимбулово) — 70 одиниць (Герань-4/5);\nНавля — 40 одиниць;\nПриморсько-Ахтарськ — 30 одиниць'); assert.deepEqual(d.map(e => e.site.id + ':' + e.count), ['orel:70', 'nyavlya:40', 'akhtarsk:30']); });
ok('«Брянщина — 10 ракет, Курщина — 6 ракет» → кожна зі своєю кількістю', () => { const d = deliv('Доставка балістики: Брянщина — 10 ракет, Курщина — 6 ракет'); assert.deepEqual(d.map(e => (e.site.id || e.regionId) + ':' + e.count), ['bryansk:10', 'kursk:6']); });
ok('«В готовності 14 Іскандер-М… попереджень не отримували» → не загроза', () => assert.equal(parseNews('Станом на сьогодні, на Брянщині ворог має в готовності орієнтовно 14 балістичних ракет Іскандер-М\n\nПопереджень щодо ймовірних балістичних ударів ми наразі не отримували').length, 0));
// ── розширене розпізнавання ──
const one2 = t => mergeEvents(parseNews(t)).map(e => `${e.kind}/${e.status}@${(e.site && e.site.id) || e.regionId || '-'}`).join(' ');
ok('«Ракета з Таганрогу курсом на Запоріжжя» → балістика з Таганрогу', () => assert.equal(one2('Ракета з Таганрогу курсом на Запоріжжя'), 'ballistic/launch@taganrog'));
ok('«з Воронезької області» → Воронеж', () => assert.equal(one2('Пуск балістичної ракети з Воронезької області'), 'ballistic/launch@voronezh'));
ok('«Угроза баллистики с севера! Брянск» → регіон з окремого рядка', () => assert.equal(one2('Угроза баллистики с севера! Брянск'), 'ballistic/threat@bryansk'));
ok('«Загроза балістики знята» → нічого', () => assert.equal(one2('Загроза балістики знята'), ''));
ok('«Іскандер-К з Курщини» → пуск ракет з Курщини', () => { assert.equal(one2('Іскандер-К з Курщини на Суми'), 'ballistic/launch@kursk'); assert.ok(formatEvents(mergeEvents(parseNews('Іскандер-К з Курщини на Суми')), '').startsWith('🚀🔴 Пуски ракет Іскандер-К')); });
ok('«Ще група з Приморська-Ахтарська» → БпЛА', () => assert.equal(one2('Ще група з Приморська-Ахтарська'), 'drone/launch@akhtarsk'));
ok('«10+ шахедів» → 10', () => assert.equal(mergeEvents(parseNews('Пуски БпЛА з Курщини 10+ шахедів'))[0].normal, 10));
ok('«Ворог готує пуски» → можливі', () => assert.equal(mergeEvents(parseNews('Ворог готує пуски шахедів з Ахтарська'))[0].possible, true));
ok('«Балістика на Харків!» → у повітрі', () => assert.equal(one2('Балістика на Харків!'), 'ballistic/launch@-'));
ok('«Ракетна небезпека! Пуск з Бєлгородщини» → балістика', () => assert.equal(one2('Ракетна небезпека! Пуск з Бєлгородщини'), 'ballistic/launch@belgorod'));
ok('«Пуски з Сак» → Саки', () => assert.equal(one2('Пуски з Сак'), 'drone/launch@saky'));
console.log('Усього перевірок:', n);

// ── ТОЧНІСТЬ: області-«щини», неявні пуски, «швидкісна ціль», заперечення, напрямок, підліт ──
const one1 = t => mergeEvents(parseNews(t));
const ids = t => one1(t).map(e => e.kind + ':' + (e.site ? e.site.id : e.regionId) + ':' + (e.status || ''));
ok('Курщина / Орловщина / Брянщина → майданчики', () => {
  assert.deepEqual(ids('Пуски шахедів з Курщини'), ['drone:kursk:launch']);
  assert.deepEqual(ids('Пуски ударних БпЛА з Орловщини'), ['drone:orel:launch']);
  assert.deepEqual(ids('Пуски шахедів з Брянщини'), ['drone:bryansk:launch']);
});
ok('неявний пуск БпЛА без слова «пуск»', () => {
  const e = one1('Шахеди з Міллерово у напрямку Харківщини');
  assert.equal(e.length, 1); assert.equal(e[0].site.id, 'millerovo'); assert.deepEqual(e[0].targets, ['Харківщина']);
  assert.deepEqual(ids('Групи БпЛА з Курська та Брянська курсом на Сумщину'), ['drone:kursk:launch', 'drone:bryansk:launch']);
});
ok('неявний пуск балістики: «Балістика з Курщини!», «Швидкісна ціль з Брянщини»', () => {
  assert.deepEqual(ids('Балістика з Курщини!'), ['ballistic:kursk:launch']);
  assert.deepEqual(ids('Швидкісна ціль з Брянщини на Чернігівщину'), ['ballistic:bryansk:launch']);
});
ok('без «з <локація>» неявного пуску нема', () => {
  assert.equal(one1('Шахеди над Сумщиною').length, 0);
  assert.equal(one1('Збито 20 шахедів з 25').length, 0);
  assert.equal(one1('Дрони з Харківщини летять на Полтаву').length, 0);
});
ok('заперечення: «пусків … немає»', () => {
  assert.equal(one1('Пусків шахедів з Курська поки немає').length, 0);
  assert.equal(one1('Нових пусків балістики з Брянська не було').length, 0);
  assert.equal(one1('Без нових пусків з Міллерово').length, 0);
});
ok('підліт через ~40 хв', () => assert.equal(one1('Пуски БпЛА з Чауди, підліт через ~40 хв')[0].note, 'підліт ~40 хв'));
// ── доставка: кількість, списки, кілька місць; запаси «в готовності» — не загроза ──
ok('«На Брянщину доставлено 20 балістичних ракет» → 20, тільки Брянщина', () => { const d = deliv('На Брянщину доставлено 20 балістичних ракет Іскандер-М'); assert.equal(d.length, 1); assert.equal(d[0].count, 20); });
ok('Список «На аеродроми доставлено:» → 3 окремі майданчики', () => { const d = deliv('На аеродроми доставлено:\nОрел (Цимбулово) — 70 одиниць (Герань-4/5);\nНавля — 40 одиниць;\nПриморсько-Ахтарськ — 30 одиниць'); assert.deepEqual(d.map(e => e.site.id + ':' + e.count), ['orel:70', 'nyavlya:40', 'akhtarsk:30']); });
ok('«Брянщина — 10 ракет, Курщина — 6 ракет» → кожна зі своєю кількістю', () => { const d = deliv('Доставка балістики: Брянщина — 10 ракет, Курщина — 6 ракет'); assert.deepEqual(d.map(e => (e.site.id || e.regionId) + ':' + e.count), ['bryansk:10', 'kursk:6']); });
ok('«В готовності 14 Іскандер-М… попереджень не отримували» → не загроза', () => assert.equal(parseNews('Станом на сьогодні, на Брянщині ворог має в готовності орієнтовно 14 балістичних ракет Іскандер-М\n\nПопереджень щодо ймовірних балістичних ударів ми наразі не отримували').length, 0));
console.log('Усього перевірок:', n);

// ── пуски без слова «шахед», «3х з брянська» ──
ok('«Пуски з Брянська, 2 групи» → БпЛА, 2 групи', () => { const e = one1('Пуски з Брянська, 2 групи'); assert.equal(e.length, 1); assert.equal(e[0].site.id, 'bryansk'); assert.equal(e[0].normal, 2); assert.equal(e[0].unit, 'groups'); });
ok('«3х з брянська реактивні» → 3 реактивні', () => { const e = one1('3х з брянська реактивні'); assert.equal(e.length, 1); assert.equal(e[0].jetN, 3); });
ok('«Пуски КР з Брянська» — не БпЛА; РСЗВ — не реактивні БпЛА', () => { assert.equal(one1('Пуски КР з Брянська').filter(e => e.kind === 'drone').length, 0); assert.equal(one1('Реактивна система залпового вогню з Курська').length, 0); });
// ── доставка: кількість, списки, кілька місць; запаси «в готовності» — не загроза ──
ok('«На Брянщину доставлено 20 балістичних ракет» → 20, тільки Брянщина', () => { const d = deliv('На Брянщину доставлено 20 балістичних ракет Іскандер-М'); assert.equal(d.length, 1); assert.equal(d[0].count, 20); });
ok('Список «На аеродроми доставлено:» → 3 окремі майданчики', () => { const d = deliv('На аеродроми доставлено:\nОрел (Цимбулово) — 70 одиниць (Герань-4/5);\nНавля — 40 одиниць;\nПриморсько-Ахтарськ — 30 одиниць'); assert.deepEqual(d.map(e => e.site.id + ':' + e.count), ['orel:70', 'nyavlya:40', 'akhtarsk:30']); });
ok('«Брянщина — 10 ракет, Курщина — 6 ракет» → кожна зі своєю кількістю', () => { const d = deliv('Доставка балістики: Брянщина — 10 ракет, Курщина — 6 ракет'); assert.deepEqual(d.map(e => (e.site.id || e.regionId) + ':' + e.count), ['bryansk:10', 'kursk:6']); });
ok('«В готовності 14 Іскандер-М… попереджень не отримували» → не загроза', () => assert.equal(parseNews('Станом на сьогодні, на Брянщині ворог має в готовності орієнтовно 14 балістичних ракет Іскандер-М\n\nПопереджень щодо ймовірних балістичних ударів ми наразі не отримували').length, 0));
console.log('Усього перевірок:', n);
