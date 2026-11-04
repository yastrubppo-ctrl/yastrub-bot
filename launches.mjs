// Розбір новин про пуски: тип, кількість, місце. Підтримує укр+рос, кілька майданчиків в одному тексті,
// «групи», «загрозу» (статус threat) окремо від «пуску» (статус launch).

// Регулярки без \b — у JS він не працює з кирилицею.
export const SITES = [
  { name: 'Приморсько-Ахтарськ', re: /ахтар/i },
  { name: 'Цимбулов (Орел)', re: /цимбулов/i },
  { name: 'Орел', re: /(?<![а-яіїєґ])(орл[аеуі]|орел|орлом)(?![а-яіїєґ])/i },
  { name: 'Гвардійське (Крим)', re: /гвардейск|гвардійськ/i },
  { name: 'Міллерово', re: /мілер|міллер|миллер/i },
  { name: 'Донецьк', re: /донецьк|донецк/i },
  { name: 'Курськ', re: /курськ|курск(?!ой)/i },
  { name: 'Шаталове (Смоленська)', re: /шаталов/i },
  { name: 'Навля (Брянська)', re: /навл[яіюї]/i },
  { name: 'Мис Чауда (Крим)', re: /чауд/i },
  { name: 'Халіно (Курськ)', re: /халін|халин/i },
  { name: 'Єйськ', re: /єйськ|ейск/i },
  { name: 'Бердянськ', re: /бердянськ|бердянск/i },
  { name: 'Брянськ', re: /брянськ|брянск/i },
];
// області — для балістики (ключ → називний)
export const REGIONS = [
  [/курськ|курск|курщин/i, 'Курська обл.'], [/брянськ|брянск|брянщин/i, 'Брянська обл.'],
  [/бєлгород|белгород/i, 'Бєлгородська обл.'], [/воронез|воронеж/i, 'Воронезька обл.'],
  [/ростовськ|ростовск/i, 'Ростовська обл.'], [/краснодарськ|краснодарск|кубан/i, 'Краснодарський край'],
  [/астраханськ|астраханск/i, 'Астраханська обл.'], [/волгоградськ|волгоградск/i, 'Волгоградська обл.'],
  [/саратовськ|саратовск/i, 'Саратовська обл.'], [/смоленськ|смоленск/i, 'Смоленська обл.'],
  [/орловськ|орловск/i, 'Орловська обл.'], [/крим|крым/i, 'Крим (ТОТ)'],
  [/капустін|капустин/i, 'Капустін Яр (Астраханська)'], [/каспі/i, 'Каспійське море'], [/чорн\S*\s+мор/i, 'Чорне море'],
  [/донецьк|донецк/i, 'Донецька обл. (ТОТ)'],
];

export function plain(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').trim();
}

const RE_UAV = /шахед|шахід|герань|гербер|бпла|дрон|безпілот|безпилот|shahed/i;
const RE_BALL = /балісти|баллисти|іскандер|искандер|кинджал|кінжал|кн-?23|с-300|с-400/i;
const RE_NEG = /відбій|отбой|збито|збит[оі]|сбит|знищен|уничтожен|ліквідован/i;
const RE_DONE = /відбул|зафікс|зафикс|відбувся|произошл|стартувал|запущен/i;      // факт пуску
const RE_THREAT = /загроз|можлив|возможн|угроз/i;
const RE_LAUNCH = /пуск|запуск|вихід|виход|злет|взлет|група|групи|груп/i;
// перед назвою місця має стояти «з / із / зі / с / від / из» (+ «напрямку/району…»)
const RE_FROM = /(?:^|[\s(])(?:з|із|зі|с|со|від|из|от)\s+(?:(?:напрямку|району|території|направления|района|территории)\s+)?(?:[а-яіїєґ]+-)?$/i;
// продовження переліку: «…, Міллерево 2 групи та Донецьк 2 групи»
const RE_LIST = /(?:,|\sта|\sі|\sи|\s\+)\s*(?:[а-яіїєґ]+-)?$/i;

const NUM_WORDS = { одна: 1, один: 1, дві: 2, два: 2, три: 3, чотири: 4, "п'ять": 5, шість: 6, сім: 7, вісім: 8 };

// кількість одразу після назви місця: «Курська 11 груп», «Донецьк 2 групи», «(Орел) 2 групи»
function countAfter(text, end) {
  const tail = text.slice(end, end + 60);
  const m = tail.match(/^[а-яіїєґ]*\s*(?:\([^)]*\))?[\s,:—-]*(?:до\s+)?(\d{1,3})\s*(груп|шт|шахед|бпла|ракет)?/i);
  if (!m) return null;
  const rest = tail.slice(m[0].length, m[0].length + 25);
  return { n: +m[1], unit: m[2] && /груп/i.test(m[2]) ? 'груп' : 'шт', approx: /до\s+\d/i.test(m[0]), jet: /реактив/i.test(rest) };
}
// загальна кількість: «до 20 шахедів», «двох ракет»
function countGeneral(text, typeRe) {
  const src = typeRe.source;
  const m = text.match(new RegExp('(?:(до|~|≈|близько)\\s*)?(\\d{1,3})\\s*(?:шт\\.?\\s*)?[×xх]?\\s*(?:ударн\\S*\\s+)?(?:' + src + '|ракет\\S*)', 'i'));
  if (m) return { n: +m[2], unit: 'шт', approx: !!m[1] };
  for (const [w, n] of Object.entries(NUM_WORDS))
    if (new RegExp('(^|\\s)' + w + '\\s+(?:\\S+\\s+){0,2}(?:' + src + '|ракет)', 'i').test(text)) return { n, unit: 'шт', approx: false };
  return null;
}

// усі «місця» в тексті: [{name, idx, end}], лише ті, що стоять після «з/с/від»
function findPlaces(text, list, nameOf) {
  const all = [];
  for (const entry of list) {
    const re = new RegExp(Array.isArray(entry) ? entry[0].source : entry.re.source, 'ig');
    let m;
    while ((m = re.exec(text))) all.push({ name: nameOf(entry), idx: m.index, end: m.index + m[0].length });
  }
  all.sort((a, b) => a.idx - b.idx);
  const out = [];
  for (const p of all) {
    if (out.some(q => q.idx === p.idx)) continue;
    const before = text.slice(Math.max(0, p.idx - 30), p.idx);
    // «з Курська…» або продовження переліку після вже знайденого місця (не всередині дужок)
    if (RE_FROM.test(before) || (out.length && RE_LIST.test(before) && p.idx >= out[out.length - 1].end)) out.push(p);
  }
  return out;
}

function parseSegment(seg) {
  if (RE_NEG.test(seg)) return [];
  const ball = RE_BALL.test(seg), uav = RE_UAV.test(seg);
  if (!ball && !uav) return [];
  const type = ball ? 'ballistic' : 'uav';
  const status = RE_THREAT.test(seg) && !RE_DONE.test(seg) ? 'threat' : 'launch';
  if (status === 'launch' && !RE_LAUNCH.test(seg) && !RE_DONE.test(seg)) return [];
  // подвійні назви типу «Цимбулов (Орел)» — внутрішній збіг не рахується, бо перед ним нема «з»
  const places = type === 'uav'
    ? findPlaces(seg, SITES, s => s.name)
    : findPlaces(seg, REGIONS, r => r[1]);
  if (!places.length) return [];                                                  // місця нема — не постимо
  const gen = countGeneral(seg, type === 'uav' ? RE_UAV : RE_BALL);
  return places.map(p => {
    const c = countAfter(seg, p.end) || (places.length === 1 ? gen : null);
    return { type, status, place: p.name, count: c ? c.n : null, unit: c ? c.unit : 'шт', approx: !!(c && c.approx), jet: !!(c && c.jet) };
  });
}

// головна функція: повертає масив пусків/загроз із одного тексту новини
export function parseLaunches(rawText) {
  const text = plain(rawText).replace(/\u00a0/g, ' ');
  const segs = text.split(/⚠️+|🚀|✈️|\n+|(?<=[.!?])\s+(?=[A-ZА-ЯІЇЄҐ+])|(?=Загроза )|(?=Пуски )/u).map(s => s.trim()).filter(Boolean);
  const res = [], seen = new Set();
  for (const s of segs) for (const l of parseSegment(s)) {
    const k = l.type + l.status + l.place;
    if (!seen.has(k)) { seen.add(k); res.push(l); }
  }
  return res;
}

const plGroup = n => (n % 10 === 1 && n % 100 !== 11) ? 'група' : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) ? 'групи' : 'груп';
export function fmtLaunch(l) {
  const unit = l.unit === 'груп' ? plGroup(l.count) : 'шт.';
  const cnt = l.count ? `: ${l.approx ? 'до ' : ''}${l.count} ${unit}${l.jet ? ' (реактивні)' : ''}` : '';
  if (l.type === 'ballistic')
    return l.status === 'threat' ? `⚠️ <b>Загроза балістики</b>\n📍 Звідки: ${l.place}` : `🚀 <b>Пуск балістики</b>${cnt}\n📍 Звідки: ${l.place}`;
  return l.status === 'threat' ? `⚠️ <b>Можливі пуски БпЛА</b>\n📍 Майданчик: ${l.place}` : `🛩 <b>Пуск БпЛА</b>${cnt}\n📍 Майданчик: ${l.place}`;
}

// ключ дедуплікації між каналами: загрози — вікно 30 хв, пуски — 10 хв
export const launchKey = (l, date) => {
  const w = (l.status === 'threat' ? 30 : 10) * 60000;
  return [l.type, l.status, l.place, l.count || '?', Math.floor((+new Date(date) || Date.now()) / w)].join('|');
};
