// Розбір новин про пуски БпЛА та балістики (укр + рос, із помилками і змішаними розкладками).
// Вихід: події { kind:'drone'|'ballistic', status:'launch'|'threat', site, region, groups, jet, droneType, missiles, note }

// ── Майданчики пусків БпЛА (id збігаються з shahedLaunchPads на карті) ──
const SITES = [
  { id: 'akhtarsk',  name: 'Приморсько-Ахтарськ', region: 'Краснодарський край', re: /приморс\p{L}*[-\s]?ахтар|прим[-.\s]?ахтар|ахтарс|ахтарк/u },
  { id: 'kursk',     name: 'Курськ',              region: 'Курська обл.',        re: /курськ|курск|курщин|халін|халин/u },
  { id: 'millerovo', name: 'Міллерово',           region: 'Ростовська обл.',     re: /м[іи]ллер[еоі]в/u },
  { id: 'donetsk',   name: 'Донецьк',             region: 'окупований',          re: /донецьк(?:а|у|ом|ому)?(?![\p{L}])(?!\s+обл)|донецк(?![\p{L}])/u },   // не «Донецька область»
  { id: 'gvard',     name: 'Гвардійське',         region: 'Крим',                re: /гвард[іие][йи]с[ь]?к/u },
  { id: 'chauda',    name: 'Чауда',               region: 'Крим',                re: /чауд/u },
  { id: 'orel',      name: 'Орел',                region: 'Орловська обл.',      re: /цимбулов|орловщин|(?:^|[^\p{L}])(?:орл(?:а|у|ом|і|е|ові)?|орел|орёл)(?![\p{L}])/u },   // не «Орлівка»
  { id: 'shatalovo', name: 'Шаталове',            region: 'Смоленська обл.',     re: /шатал[оа]в/u },
  { id: 'nyavlya',   name: 'Навля',               region: 'Брянська обл.',       re: /нявл|навл[яеі]/u },
  { id: 'berdyansk', name: 'Бердянськ',           region: 'окупований',          re: /бердянськ|бердянск/u },
  // без позначки на карті:
  { id: 'yeysk',     name: 'Єйськ',               region: 'Краснодарський край', re: /[єе][йи]ськ|ейск/u },
  { id: 'saky',      name: 'Саки',                region: 'Крим',                re: /(?:^|[^\p{L}])сак(?:и|ів|ах|ам)?(?![\p{L}])/u },
  { id: 'bryansk',   name: 'Брянськ',             region: 'Брянська обл.',       re: /брянськ|брянск|брянщин/u },
  { id: 'mozdok',    name: 'Моздок',              region: 'Північна Осетія',     re: /моздок/u },
  { id: 'morozovsk', name: 'Морозовськ',          region: 'Ростовська обл.',     re: /морозовськ|морозовск/u },
  { id: 'engels',    name: 'Енгельс',             region: 'Саратовська обл.',    re: /енгельс|энгельс/u },
  // акваторія (пуски з моря): маркера аеродрому нема, на карті — тимчасова точка в морі; у доставці не бере участі
  { id: 'azov',      name: 'Азовське море',       region: 'акваторія',           re: /азовськ\p{L}*\s+мор|азовск\p{L}*\s+мор|акватор\p{L}*\s+азов/u },
];
const NO_DELIVERY = new Set(['azov']);   // у море нічого не «доставляють»

// ── Регіони для балістики («з Брянську» → Брянська область) ──
const REGIONS = [
  { id: 'kursk',     name: 'Курська область',       re: /курськ|курск|курщин/u },
  { id: 'bryansk',   name: 'Брянська область',      re: /брянськ|брянск|брянщин/u },
  { id: 'voronezh',  name: 'Воронезька область',    re: /воронеж|воронез/u },
  { id: 'belgorod',  name: 'Бєлгородська область',  re: /[бб][єе]лгород/u },
  { id: 'taganrog',  name: 'Ростовська область (Таганрог)', re: /таганрог/u },   // до загального «Ростов»
  { id: 'taganrog',  name: 'Ростовська область',    re: /ростов/u },              // на карті один маркер — Таганрог
  { id: 'krasnodar', name: 'Краснодарський край',   re: /краснодар|[єе][йи]ськ|ейск|ахтарськ|ахтарск/u },
  { id: 'astrakhan', name: 'Астраханська область (Капустін Яр)', re: /астрахан|капуст[іи]н/u },
  { id: 'crimea',    name: 'Крим',                  re: /(?:^|[^\p{L}])крим|(?:^|[^\p{L}])крым/u },
  { id: 'smolensk',  name: 'Смоленська область',    re: /смоленськ|смоленск|смоленщин|шатал/u },
  { id: 'oryol',     name: 'Орловська область',     re: /орловськ|орловск|орловщин|(?:^|[^\p{L}])(?:орл(?:а|у|ом|і|е|ові)?|орел)(?![\p{L}])|цимбулов/u },
  { id: 'donetsk',   name: 'Донеччина (окупована)', re: /донецьк(?:а|у|ом|ому)?(?![\p{L}])(?!\s+обл)|донецк(?![\p{L}])/u },
];

const MISSILES = [
  ['Іскандер-М', /[іиi]скандер(?!-?\s?к(?![\p{L}]))/u],      // «Іскандер-К» — крилата, її не чіпаємо
  ['КН-23',      /[kк][нh]-?\s?23/u],
  ['Іскандер-К', /[іиi]скандер-?\s?к(?![\p{L}])/u],
  ['С-300',      /(?:^|[^\p{L}])[cс]-?\s?300/u],
  ['С-400',      /(?:^|[^\p{L}])[cс]-?\s?400/u],
  ['Кинджал',    /кинджал|кинжал|[хx]-?47/u],
  ['Циркон',     /[цз][иі]ркон/u],
  ['Точка-У',    /точк[аиіу]-?\s?[уu](?![\p{L}])|тот?чка-?у/u],
  ['Орєшнік',    /[оo]р[єе]шн[іи]к/u],
  ['Фатех',      /фат[еє]х|fath-?3/u],
];

// ── Словники розпізнавання ──
// «БР» як окреме слово = балістична ракета. С-300/С-400 рахуємо балістикою лише коли у реченні немає БпЛА (там це «типу С-300»).
const BALL_STRONG = /баліст|баллист|швидкісн\p{L}*\s+ц[іi]л|скоростн\p{L}*\s+ц[еі]л|(?:^|[^\p{L}])бр(?![\p{L}])|[іиi]скандер(?!-?\s?к(?![\p{L}]))|[kк][нh]-?\s?23|кинджал|кинжал|[хx]-?47|[цз][иі]ркон|точк[аиіу]-?\s?[уu](?![\p{L}])|[оo]р[єе]шн[іи]к|фат[еє]х/u;
const BALL_WEAK   = /(?:^|[^\p{L}])[cс]-?\s?(?:300|400)/u;
const DRONE_RE    = /бпла|бпак|шахед|shahed|герань|geran|гербер|дрон|мопед|безп[іи]лот|беспилот|камікадзе|камикадзе|бандерол|banderol|реактивн(?!\p{L}*\s+(?:систем|артил|снаряд))/u;
const BANDEROL_RE = /бандерол|banderol/u;
const THREAT_RE   = /можлив|ймов[іи]рн|в[іі]рогідн|загроз|небезпек|возможн|вероятн|угроз|опасн|готу(?:ють|єтьс|ються|ют|є|ет)(?![\p{L}])|готу(?:єтьс|ется)|підготов|подготов|готов\p{L}*\s+(?:до|к)\s|очіку|ожида/u;
const LAUNCH_RE   = /(?:^|[^\p{L}])(?:пуск|запуск|запущен|запустил|запустили|запущено|стартува|стартов|старт(?![\p{L}])|взл[её]т|злет|злетіл|вилет|вилітає|виліт|вышл|вийшл|вийшов|випущен|випустил|кинул)/u;
const NEG_RE      = /(?:загроз|угроз|небезпек)\p{L}*[^.!?]{0,30}(?:знят|скасов|минул|отмен|снят)|(?:знят|скасов|отмен|снят)\p{L}*\s+(?:загроз|угроз)|отбой|(?:пуск|запуск)\p{L}*[^.!?]{0,40}(?:нем[аєе]|не\s+(?:було|зафікс|фікс))|без\s+нових\s+пуск|в[іи]дб[іо]й|відсутн|не\s+(?:зафіксов|фіксу|відбув|зафиксир|фиксир|було)|нем[аєе]є?\s+(?:пуск|запуск)|без\s+пуск/u;
// доставка / переміщення: «доставили шахеди залізницею», «прибув ешелон з БР», «доставка БР до Нявлі»
const STOCK_RE    = /(?:в|у)\s+готовност|в\s+наявност|наявн\p{L}*\s+(?:має|мають|є|перебува)|має\s+(?:в|у)\s+(?:готовн|наявн)|(?:запас|залишок)\p{L}*\s+(?:бпла|шахед|ракет|іскандер)/u;
const DELIV_RE    = /достав|дов[еі]з|дов[оі]з|зав[еі]з|зав[оі]з|прив[еі]з|прив[оі]з|прибув|прибул|надійшов|надійшл|ешелон|эшелон|потяг|поезд|вагон|залізни[чц]|железнодорож|перекид|переброс|розвантаж|разгруз|парті(?:я|ї)\s+(?:шахед|бпла|ракет)/u;
const TRANSPORTS = [
  ['залізницею',    /ешелон|эшелон|потяг|поезд|вагон|залізни[чц]|железнодорож|(?:^|[^\p{L}])жд(?![\p{L}])|цистерн/u],
  ['автотранспортом', /фур|колон|автотранспорт|вантажів|грузовик|камаз|трейлер|тягач|автомоб/u],
  ['повітрям',      /літак|самол[её]т|ил-?76|іл-?76|борт|вертол/u],
  ['морем',         /судн|корабл|паром|порт(?![\p{L}])|морем/u],
];

// ── Емодзі НЕ враховуємо ──
// ⚠️ лишається лише як межа блоків повідомлення (невидимий роздільник U+2063), решта піктограм (🚆📦🇺🇦 …) стають пробілом.
// Тож і «🚆 Нявля — 40 шт», і «Нявля — 40 шт» розбираються однаково.
const BLOCK = '\u2063';
export function stripEmoji(s) {
  return String(s == null ? '' : s)
    .replace(/\u26A0\uFE0F?/gu, '\n' + BLOCK + '\n')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F\u20E3]/gu, ' ')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n');
}

// Нормалізація: нижній регістр, ё→е, апострофи, латинські «двійники» не чіпаємо (вони у регексах)
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[’`ʼ]/g, "'");

const plural = n => (n % 10 === 1 && n % 100 !== 11) ? 'група'
  : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) ? 'групи' : 'груп';

// Куди летять / що атакуватимуть: «атакувати Миколаївщину/Одещину», «на Одещину», «у бік Херсонщини»
const TARGET_REGIONS = [
  ['Миколаївщина', /миколаїв|николаев/u], ['Одещина', /одес|одещ|одесс/u], ['Херсонщина', /херсон/u],
  ['Запоріжжя', /запор[іi]ж|запорож/u], ['Дніпропетровщина', /дніпр|днепр/u], ['Харківщина', /харків|харьков/u],
  ['Полтавщина', /полтав/u], ['Сумщина', /сумщин|сумськ|(?:^|[^\p{L}])сум(?:и|ах|ами)(?![\p{L}])/u],
  ['Чернігівщина', /черніг|чернигов/u], ['Київщина', /київ|киев/u], ['Кіровоградщина', /кіровоград|кропивниц/u],
  ['Черкащина', /черкащ|черкас/u], ['Вінниччина', /вінниц|вінничч/u], ['Житомирщина', /житомир/u],
  ['Львівщина', /львів|львов/u], ['Донеччина', /донеччин/u],
];
const TARGET_TRIGGER = /(?:атакув\p{L}*|ударит\p{L}*|удар\p{L}*\s+по|ц[іе]л\p{L}*|курсом\s+на|(?:у|в)\s+напрямк\p{L}*|в\s+направлени\p{L}*|(?:у|в)\s+б[іi]к|(?:^|[^\p{L}])(?:на|по))\s+([^.!?;]+)/u;
function targetsIn(t) {
  const m = TARGET_TRIGGER.exec(t); if (!m) return [];
  return TARGET_REGIONS.filter(([, re]) => re.test(m[1])).map(([n]) => n);
}

const siteIn = t => SITES.filter(s => s.re.test(t));
const regionObjIn = t => REGIONS.find(r => r.re.test(t)) || null;
const regionIn = t => (regionObjIn(t) || {}).name || null;

// Невідомий майданчик: «з Ейська», «с Моздока» — беремо слово з великої літери після прийменника
const GENERIC_PLACE = /(?:^|[\s(])(?:з|із|с|со|из|від|от)\s+([A-ZА-ЯІЇЄҐ][\p{L}'\-]{3,}(?:\s+[A-ZА-ЯІЇЄҐ][\p{L}'\-]{3,})?)/u;

// ── Кількість БпЛА в тексті: «10 звичайних, 8 реактивних», «12 БпЛА», «3 групи» ──
// Повертає { normal, jet, unq }: normal/jet — числа з прямою вказівкою типу, unq — число без типу (лише «N БпЛА / шахедів / груп»).
const NOT_MORE = '(?!\\d|[:.]\\d)';   // не відкушувати частину числа і не брати час «22:00»
function droneCounts(st) {
  const num = re => { const m = re.exec(st); return m ? Number(m[1]) : null; };
  const jet = num(/(\d{1,3})\s*(?:шт\.?\s*)?(?:реактивн|jet)\p{L}*/u)
    ?? num(new RegExp('реактивн\\p{L}*(?:\\s+(?:бпла|шахед\\p{L}*|дрон\\p{L}*))?\\s*[-–—:(]?\\s*(\\d{1,3})' + NOT_MORE, 'u'));
  const normal = num(/(\d{1,3})\s*(?:шт\.?\s*)?(?:звичайн|поршнев|класичн)\p{L}*/u)
    ?? num(new RegExp('(?:звичайн|поршнев|класичн)\\p{L}*(?:\\s+(?:бпла|шахед\\p{L}*|дрон\\p{L}*))?\\s*[-–—:(]?\\s*(\\d{1,3})' + NOT_MORE, 'u'));
  const unq = num(/(\d{1,3})\+?\s*(?:бпла|шахед\p{L}*|shahed|дрон\p{L}*|бандерол\p{L}*|banderol|груп\p{L}*)/u) ?? num(/(?:^|[^\p{L}\d])(\d{1,3})\s*[хx×](?![\p{L}\d])/u);   // «3х з Брянська»
  return { normal, jet, unq };
}
// дописує кількості в подію (бере максимум, якщо одну й ту саму подію бачимо кілька разів)
function applyCounts(ev, st) {
  const c = droneCounts(st);
  const jetWord = /реактивн/u.test(st);
  let normal = c.normal, jetN = c.jet;
  if (normal == null && jetN == null && c.unq != null) { if (jetWord) jetN = c.unq; else normal = c.unq; }   // «3 групи реактивних» → реактивні
  // «3 групи, реактивні»: окремий сегмент лише з типом (без числа) — число з попереднього сегмента належить реактивним
  if (jetWord && normal == null && jetN == null && ev.normal != null && ev.jetN == null) { ev.jetN = ev.normal; ev.normal = null; }
  if (normal != null) ev.normal = Math.max(ev.normal || 0, normal);
  if (jetN != null) ev.jetN = Math.max(ev.jetN || 0, jetN);
  if (/груп/u.test(st)) ev.unit = 'groups';
  if (jetWord) ev.jet = true;
}
const HAS_COUNT = /реактивн|звичайн|поршнев|класичн|\d{1,3}\s*(?:бпла|шахед|shahed|дрон|бандерол|banderol|груп)|(?:^|[^\p{L}\d])\d{1,3}\s*[хx×](?![\p{L}\d])/u;


// ── Доставка: «на Нявлю доставили ешелон з шахедами», «БР доставляють залізницею до Курська», «доставка 20 шахедів в Єйськ» ──
const DELIV_PLACE = /(?:^|[\s(])(?:[Дд]о|[Нн]а|[Вв]|[Уу]|[Вв]о|[Кк])\s+([A-ZА-ЯІЇЄҐ][\p{L}'\-]{3,}(?:\s+[A-ZА-ЯІЇЄҐ][\p{L}'\-]{3,})?)/u;
// «Мукачеве: прибув ешелон…», «Харків — 20 од.» — назва місця на початку рядка (без прийменника)
const LEAD_PLACE  = /^\s*([A-ZА-ЯІЇЄҐ][\p{L}'\-]{3,}(?:\s+[A-ZА-ЯІЇЄҐ][\p{L}'\-]{3,})?)\s*[:—–]/u;
const HEADER_WORD = /шахед|бпла|дрон|ракет|баліст|(?:^|[^\p{L}])бр(?![\p{L}])|бандерол|достав|ешелон|потяг|вагон|оновлен|увага|терміново|важлив|нове|нова|зведен|за добу|разом/u;
// Українські області й міста — це НІКОЛИ не пускова локація: такі події відкидаємо (навіть коли немає прийменника чи великої літери)
const UA_PLACE = /(?<![\p{L}])(?:харків|харьков|київ|киев|київщин|одес|одещин|миколаїв|херсон|запоріж|дніпр|полтав|сумщин|сумськ|сум(?:и|ах|ами)(?![\p{L}])|черніг|черкас|вінниц|вінничч|житомир|львів|львов|волин|рівн|луцьк|тернопіл|хмельниц|івано-франк|закарпат|мукачев|ужгород|чернівц|кропивниц|кіровоград|кременчу|кривий\s+р[іі]г|кривого\s+рогу|маріупол|мелітопол|бердичів|ізмаїл|чугуїв|куп'янськ|краматорськ|слов'янськ|покровськ|бахмут|авдіївк|павлоград|нікопол|генічеськ|каховк|донеччин|луганськ|луганщин)\p{L}*/u;
function parseDelivery(clause, t, { ball, drone }) {
  const cargo = [];
  if (drone) cargo.push('shahed');
  if (ball) cargo.push('ballistic');
  if (!cargo.length) cargo.push('missile');
  const transport = (TRANSPORTS.find(([, re]) => re.test(t)) || [null])[0];
  const missiles = MISSILES.filter(([, re]) => re.test(t)).map(([n]) => n);
  const cm = /(\d{1,4})\s*(?:шт\.?\s*)?(?:(?:балістичн|крилат|реактивн|ударн|нов)\p{L}*\s+)?(?:бпла|шахед\p{L}*|shahed|дрон\p{L}*|ракет\p{L}*|бр(?![\p{L}])|вагон\p{L}*|ешелон\p{L}*|эшелон\p{L}*|одиниц\p{L}*|од(?![\p{L}]))/u.exec(t);
  const count = cm ? Number(cm[1]) : null;
  const unitWagons = !!(cm && /вагон/u.test(cm[0]));
  const unitTrains = !!(cm && /[еэ]шелон/u.test(cm[0]));
  const mm = /(?:герань|geran)-?\s?(\d(?:\s?\/\s?\d)*)/u.exec(t);
  const model = mm ? 'Герань-' + mm[1].replace(/\s/g, '') : null;
  const jet = /реактивн|jet/u.test(t) || (!!mm && mm[1].split('/').every(n => /^[345]$/.test(n.trim())));
  const base = { kind: 'delivery', status: 'delivery', cargo, transport, missiles, count, unitWagons, unitTrains, model, jet };
  // Доставка працює ТІЛЬКИ на пускові локації (SITES) та їхні регіони. Усе інше — відкидаємо.
  const sites = siteIn(t).filter(s => !NO_DELIVERY.has(s.id));
  if (sites.length) return sites.map(site => ({ ...base, site, region: site.region }));
  const ro = regionObjIn(t);
  if (ro) {
    if (!REGION_TO_SITES[ro.id]) return [];             // Воронеж, Бєлгород, Астрахань… — пускових майданчиків там нема             // Воронеж, Бєлгород, Астрахань… — пускових майданчиків там нема
    return [{ ...base, site: { id: null, name: ro.name, region: null }, region: ro.name, regionId: ro.id }];
  }
  // невідоме місце (Мукачеве, Харків, Харківщина…) — це не аеродром зі списку SITES: подію не створюємо
  if (UA_PLACE.test(t) || DELIV_PLACE.test(clause)) return [];
  const lead = LEAD_PLACE.exec(clause);
  if (lead && !HEADER_WORD.test(norm(lead[1]))) return [];
  return [{ ...base, site: { id: null, name: 'місце не уточнено', region: null }, region: null }];
}

// «Орел (Цимбулово) — 70 одиниць (Герань-4/5);» — пункт списку під заголовком доставки
const LIST_LINE = /^\s*[-•*–]?\s*([^—–:]{2,60}?)\s*[—–-]\s*(\d{1,4})\s*(?:од(?:иниц\p{L}*|\.)?|шт\.?|бпла)?\s*(?:\(([^)]*)\))?/u;
function extractDeliveryLists(text, events) {
  const keep = [];
  let ctx = null, ctxBlock = -1, bi = 0;
  for (const block of text.split(BLOCK)) {
    bi++;
    if (ctx && ctxBlock !== bi - 1) ctx = null;          // заголовок «…а саме:» діє і через порожній рядок, але не далі
    for (const line of block.split('\n')) {
      const t = norm(line);
      if (!t.trim()) continue;
      const drone = DRONE_RE.test(t), ball = BALL_STRONG.test(t) || (!drone && BALL_WEAK.test(t));
      if ((drone || ball) && DELIV_RE.test(t) && /:\s*$/.test(line.trim())) { ctx = { drone, ball }; ctxBlock = bi; continue; }
      if (DELIV_RE.test(t) && /:\s*$/.test(line.trim()) && /аеродром|майданчик|локаці|пусков/u.test(t)) { ctx = { drone: !/ракет/u.test(t), ball: /ракет/u.test(t) }; ctxBlock = bi; continue; }   // «На аеродроми доставлено:»   // заголовок списку
      const m = ctx && LIST_LINE.exec(line.replace(/^[\s\/|!❗️⚠️‼️]+/u, ''));
      if (m) {
        ctxBlock = bi;
        // «8 балістичних/гіперзвукових ракет + 7 крилатих ракет типу Іскандер-К» — сумуємо
        const plus = [...line.slice(line.indexOf(m[2]) + m[2].length).matchAll(/\+\s*(\d{1,4})/gu)].reduce((a, x) => a + Number(x[1]), 0);
        if (plus) m[2] = String(Number(m[2]) + plus);
        const synth = `${m[1]} — ${m[2]} од. ${m[3] || ''}`;
        const evs = parseDelivery(synth, norm(synth), ctx);
        evs.forEach(e => { e.count = Number(m[2]); });
        events.push(...evs);
        continue;
      }
      ctx = null;
      keep.push(line);
    }
    keep.push(BLOCK);
  }
  return keep.join('\n');
}

export function parseNews(rawText) {
  const events = [];
  const text = extractDeliveryLists(stripEmoji(rawText), events);
  // підліт: «Подлет после 22:00»
  const tm = /(?:подл[её]т|п[іи]дл[іи]т)\D{0,20}?(п[іи]сля|после|до)?\s*(\d{1,2})[:.](\d{2})/iu.exec(text);
  const tr = !tm && /(?:подл[её]т|п[іи]дл[іи]т)\D{0,12}?(?:через|за|~|≈|около|близько)\s*~?\s*(\d{1,3})\s*(?:хв|мин)/iu.exec(text);   // «підліт через ~40 хв»
  const note = tm ? ('підліт ' + (tm[1] ? (/до/i.test(tm[1]) ? 'до ' : 'після ') : 'близько ') + tm[2].padStart(2, '0') + ':' + tm[3])
    : tr ? ('підліт ~' + tr[1] + ' хв') : null;

  // кліни: розділяємо за ⚠️, крапками/знаками з пробілом, переносами та «+»
  const clauses = text.split(/\u2063+|\n|(?<!\d)\+|(?<!(?:^|\s)од\.)(?<=[.!?])\s+/u).map(s => s.trim()).filter(Boolean);
  let lastEvs = [], ballCtx = false;                                             // події останнього речення з БпЛА/БР — їм дописуємо «цілі» з наступного речення
  for (const clause of clauses) {
    const t = norm(clause);
    if (NEG_RE.test(t)) continue;                               // «відбій», «пусків не зафіксовано»
    // «Станом на сьогодні на Брянщині в готовності ~14 Іскандер-М…», «в наявності 310 реактивних БпЛА…» — це запаси, а не пуск/загроза (облік — у stock.js на сайті)
    if (STOCK_RE.test(t) && !LAUNCH_RE.test(t)) continue;
    if (/попереджен\p{L}*[^.!?]{0,80}не\s+отрим|не\s+отрим\p{L}*[^.!?]{0,40}попереджен|попереджен\p{L}*[^.!?]{0,40}(?:нема|відсутн)/u.test(t)) continue;
    // «Угроза баллистики с севера! Брянск» — короткий окремий рядок з регіоном уточнює балістику без регіону
    if (lastEvs.length && t.length < 28 && !LAUNCH_RE.test(t) && regionObjIn(t) && lastEvs.every(e => e.kind === 'ballistic' && !e.regionId)) {
      const ro = regionObjIn(t); lastEvs.forEach(e => { e.regionId = ro.id; e.region = ro.name; }); continue;
    }
    if (lastEvs.length && !DRONE_RE.test(t) && !BALL_STRONG.test(t) && (THREAT_RE.test(t) || /атакув|ударит|курсом/u.test(t))) {
      const tg = targetsIn(t);                                  // «Ймовірно спробують атакувати Миколаївщину/Одещину.»
      if (tg.length) { lastEvs.forEach(e => { e.targets = [...new Set([...(e.targets || []), ...tg])]; }); continue; }
    }
    const isThreat = THREAT_RE.test(t);
    const isLaunch = LAUNCH_RE.test(t);
    const prevBall = ballCtx; ballCtx = /ракетн\p{L}*\s+(?:небезпек|загроз|опасн)|балісти|баллисти/u.test(t) && !DRONE_RE.test(t);
    // «Пуски з Брянська, 2 групи» — без слова «шахед»: пускова локація БпЛА зі списку + пуск, без ознак ракет → це БпЛА
    const drone = DRONE_RE.test(t) || (isLaunch && !BALL_STRONG.test(t) && !/ракет|(?:^|[^\p{L}])кр(?![\p{L}])|крилат|калібр|х-?\d/u.test(t) && siteIn(t).length > 0)
      || (/(?:^|[^\p{L}])(?:ще\s+)?груп[аиу]?(?![\p{L}])/u.test(t) && !/ракет/u.test(t) && siteIn(t).length > 0);   // «Ще група з Приморська-Ахтарська»
    // «Ракета з Таганрогу курсом на Запоріжжя» — одиночна ракета з району пусків БР (не крилата) = балістика
    const fromM = /(?:^|\s)(?:з|із|с|со|из)\s+([^.!?,;()«»]+)/u.exec(t);
    const ballImplied = !drone && /(?:^|[^\p{L}])ракет/u.test(t) && !/крилат|калібр|калибр|(?:^|[^\p{L}])[хx]-?\s?\d{2}|[іиi]скандер-?\s?к(?![\p{L}])|циркон|онікс|оникс|кр(?![\p{L}])/u.test(t) && !!(fromM && regionObjIn(fromM[1]));
    const iskK = !drone && /[іиi]скандер-?\s?к(?![\p{L}])/u.test(t) && !!(fromM && regionObjIn(fromM[1]));   // «Іскандер-К з Курщини» — той самий комплекс, квадрат району пусків
    const ctxBall = prevBall && !drone && (isLaunch || isThreat) && !!(fromM && regionObjIn(fromM[1]));   // попереднє речення — «Ракетна небезпека!»
    const ball = BALL_STRONG.test(t) || ballImplied || iskK || ctxBall || (!drone && BALL_WEAK.test(t));
    const cargo = ball || drone || /ракет/u.test(t);
    // ── ДОСТАВКА (БР / шахеди): окремий тип події ──
    if (cargo && DELIV_RE.test(t) && !(isLaunch && !/достав|ешелон|эшелон|потяг|поезд|вагон/u.test(t))) {
      // «Брянщина — 10 ракет, Воронежчина — 6 ракет» — кілька місць в одному реченні: кожне окремо, зі своєю кількістю
      const pairs = clause.match(/[—–-]\s*\d{1,4}\s/gu) || [];
      if (pairs.length > 1) {
        clause.split(/[,;]|\s(?:а|і|й|та)\s/u).forEach(seg => { const ts = norm(seg); if (/\d/.test(ts)) events.push(...parseDelivery(seg, ts, { ball, drone })); });
      } else events.push(...parseDelivery(clause, t, { ball, drone }));
      continue;
    }
    // Неявний пуск: канали часто пишуть без слова «пуск» — «Шахеди з Міллерово…», «Балістика з Курщини!», «Групи БпЛА з Курська…».
    // Рахуємо пуском, лише якщо після «з/із/с/из» стоїть відома пускова локація (для БпЛА) або регіон (для балістики).
    let implied = false;
    if (!isThreat && !isLaunch && (ball || drone)) {
      const fm = /(?:^|[\s(])(?:з|із|зі|с|со|из|від)\s+(?:район\p{L}*\s+|аеродром\p{L}*\s+|бок\p{L}*\s+|бік\p{L}*\s+)?([^.!?;()«»]+)/u.exec(t);
      if (fm && ((drone && siteIn(fm[1]).length) || (ball && !drone && regionObjIn(fm[1])))) implied = true;
      if (!implied && ball && !drone && BALL_STRONG.test(t) && /(?:^|\s)(?:на|по|курсом\s+на)\s+\p{L}/u.test(t)) implied = true;   // «Балістика на Харків!» — вже в повітрі
    }
    if (!(isThreat || isLaunch || implied) || !(ball || drone)) continue;
    if (ball && drone && isLaunch && !isThreat) {                // «пуски шахедів та БР»: окремо додаємо балістику
      const where0 = /(?:^|\s)(?:з|із|с|со|из)\s+([^.!?,;()«»]+)/u.exec(t);
      const ros0 = []; for (const r of REGIONS) if (where0 && r.re.test(where0[1]) && !ros0.some(x => x.id === r.id)) ros0.push(r);
      const mis0 = MISSILES.filter(([, re]) => re.test(t)).map(([n]) => n);
      if (BALL_STRONG.test(t)) {
        if (!ros0.length) events.push({ kind: 'ballistic', status: 'launch', region: null, regionId: null, missiles: mis0 });
        else for (const ro of ros0) events.push({ kind: 'ballistic', status: 'launch', region: ro.name, regionId: ro.id, missiles: mis0 });
      }
    }
    const made = events.length;
    if (ball && !drone) {                         // ── БАЛІСТИКА ──
      const missiles = MISSILES.filter(([, re]) => re.test(t)).map(([n]) => n);
      // регіон беремо після «з/із/с/из» — щоб «типу С-300» не плутати з місцем
      const after = /(?:^|\s)(?:з|із|с|со|из)\s+([^.!?,;()«»]+)/u.exec(t);
      // «з Брянська та Курська» → по події на кожен регіон (кожен має свій квадрат на карті)
      const where = after ? after[1] : '';
      const ros = []; for (const r of REGIONS) if (r.re.test(where) && !ros.some(x => x.id === r.id)) ros.push(r);
      const status = ((isLaunch || implied) && !isThreat) ? 'launch' : 'threat';
      if (!ros.length) events.push({ kind: 'ballistic', status, region: null, regionId: null, missiles });
      else for (const ro of ros) events.push({ kind: 'ballistic', status, region: ro.name, regionId: ro.id, missiles });
      lastEvs = events.slice(made);
      continue;
    }
    if (drone) {                                  // ── БпЛА ──
      const droneAll = /реактивн|jet|герань-?3|geran-?3/u.test(t);
      const segs = clause.split(/\s*[,;]\s*|\s+(?:та|и|і)\s+/u).filter(Boolean);
      let any = false, last = null;
      for (const seg of segs) {
        const st = norm(seg);
        const sites = siteIn(st);
        let site = sites[0] || null;
        // Невідомі слова після «з/із/с» (Харківщини, Криму, Азовського, Мукачеве…) за майданчик НЕ вважаємо:
        // це регіони й міста, а не пускові локації. Майданчик — лише зі списку SITES.
        if (!site) {            // «…з Міллерово, 8 реактивних» — сегмент без місця дописує кількість до попередньої події
          if (last && HAS_COUNT.test(st)) applyCounts(last, st);
          continue;
        }
        const gm = /(\d{1,3})\s*груп/u.exec(st);
        const ev = {
          kind: 'drone', status: 'launch', site,
          groups: gm ? Number(gm[1]) : null,
          jet: /реактивн/u.test(st) || (droneAll && segs.length === 1),
          droneType: BANDEROL_RE.test(t) ? 'banderol' : /shahed|шахед|герань|geran/u.test(t) ? 'shahed' : 'unknown',
          possible: isThreat,                       // «Можливі пуски …» — карта блимає як зазвичай, але в тексті підписано «можливі»
          targets: targetsIn(t),
          note,
          normal: null, jetN: null, unit: 'drones',
        };
        applyCounts(ev, st);
        events.push(ev);
        last = ev;
        any = true;
      }
      void any;
      lastEvs = events.slice(made);
    }
  }
  return events;
}

// ── Злиття подій одного повідомлення/запуску (максимум груп, об'єднання ракет) ──
export function mergeEvents(list) {
  const m = new Map();
  for (const e of list) {
    const key = e.kind === 'drone' ? `drone|${e.site.id || e.site.name}` + (e.droneType === 'banderol' ? '|banderol' : '')
      : e.kind === 'delivery' ? `deliv|${e.site.id || e.site.name}`
      : `bal|${e.status}|${e.region || 'any'}`;
    const o = m.get(key);
    if (!o) { m.set(key, { ...e, key }); continue; }
    if (e.groups != null) o.groups = Math.max(o.groups || 0, e.groups);
    if (e.kind === 'drone') {
      o.possible = !!(o.possible && e.possible);                // підтверджений пуск перекриває «можливий»
      if (e.targets && e.targets.length) o.targets = [...new Set([...(o.targets || []), ...e.targets])];
    }
    if (e.jet) o.jet = true;
    if (e.normal != null) o.normal = Math.max(o.normal || 0, e.normal);
    if (e.jetN != null) o.jetN = Math.max(o.jetN || 0, e.jetN);
    if (e.unit === 'groups') o.unit = 'groups';
    if (e.note && !o.note) o.note = e.note;
    if (e.missiles) o.missiles = [...new Set([...(o.missiles || []), ...e.missiles])];
    if (e.kind === 'delivery') {
      o.cargo = [...new Set([...(o.cargo || []), ...(e.cargo || [])])];
      if (e.transport && !o.transport) o.transport = e.transport;
      if (e.count != null && (o.count == null || e.count > o.count)) { o.count = e.count; o.unitWagons = e.unitWagons; o.unitTrains = e.unitTrains; }
    }
  }
  // «загальну» тривогу без місця прибираємо, якщо є така сама з конкретним регіоном;
  // типи ракет із загальної тривоги додаємо до конкретних
  const out = [...m.values()];
  const located = out.filter(e => e.kind === 'ballistic' && e.status === 'threat' && e.region);
  const generic = out.filter(e => e.kind === 'ballistic' && e.status === 'threat' && !e.region);
  if (located.length && generic.length) {
    const mis = [...new Set(generic.flatMap(g => g.missiles || []))];
    located.forEach(e => { e.missiles = [...new Set([...(e.missiles || []), ...mis])]; });
    return out.filter(e => !generic.includes(e));
  }
  return out;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Текст повідомлення для каналу ──
export function formatEvents(events, footerHtml) {
  const blocks = [];
  // балістика — першою: це найтерміновіше
  for (const status of ['launch', 'threat']) {
    const bs = events.filter(e => e.kind === 'ballistic' && e.status === status);
    if (!bs.length) continue;
    const onlyK = bs.every(e => (e.missiles || []).length && e.missiles.every(m => m === 'Іскандер-К'));   // крилаті «Іскандер-К» з тих самих комплексів
    const head = onlyK ? (status === 'launch' ? '🚀🔴 Пуски ракет Іскандер-К' : '🚨 Загроза пусків ракет Іскандер-К') : status === 'launch' ? '🚀🔴 Пуски балістики' : '🚨 Загроза застосування балістики';
    const lines = bs.map(b => {
      const mis = b.missiles && b.missiles.length ? b.missiles.join(' / ') : '';
      return '📍 ' + esc(b.region || 'місце не уточнено') + (mis ? ' — ' + esc(mis) : '');
    });
    blocks.push(head + '\n' + lines.join('\n'));
  }
  const drones = events.filter(e => e.kind === 'drone');
  if (drones.length) {
    const types = new Set(drones.map(d => d.droneType));
    const typeHead = types.size === 1 && types.has('shahed') ? ' (Shahed)' : types.size === 1 && types.has('banderol') ? ' (Бандероль)' : '';
    const lines = drones.map(d => {
      const place = d.site.region ? `${d.site.name} (${d.site.region})` : d.site.name;
      const parts = [];
      if (types.size > 1 && d.droneType === 'banderol') parts.push('Бандероль');
      if (d.groups != null) parts.push(`${d.groups} ${plural(d.groups)}`);
      else if (d.normal || d.jetN) {                                   // «…з Курська, 3 групи» / «10 звичайних, 8 реактивних»
        const u = n => d.unit === 'groups' ? ' ' + plural(n) : '';
        if (d.normal) parts.push(`${d.normal}${u(d.normal)} звичайних`);
        if (d.jetN) parts.push(`${d.jetN}${u(d.jetN)} реактивних`);
      }
      if (d.jet && !d.jetN) parts.push('реактивні');
      if (d.possible) parts.push('можливі пуски');
      if (d.note) parts.push(d.note);
      return '📍 ' + esc(place) + (parts.length ? ' — ' + esc(parts.join(', ')) : '')
        + (d.targets && d.targets.length ? ' → ' + esc(d.targets.join(' / ')) : '');
    });
    blocks.push('🚀 Пуски БпЛА' + typeHead + '\n' + lines.join('\n'));
  }
  const dl = events.filter(e => e.kind === 'delivery');
  if (dl.length) {
    const CARGO = { shahed: 'Shahed / БпЛА', ballistic: 'БР', missile: 'ракети' };
    const lines = dl.map(d => {
      const place = d.site.region ? `${d.site.name} (${d.site.region})` : d.site.name;
      const parts = [(d.cargo || []).map(c => CARGO[c] || c).join(' + ')];
      if (d.model) parts.push(d.model + (d.jet ? ' (реактивні)' : ''));
      else if (d.jet) parts.push('реактивні');
      if (d.missiles && d.missiles.length) parts.push(d.missiles.join(' / '));
      if (d.count != null) parts.push(d.count + (d.unitWagons ? ' вагонів' : d.unitTrains ? ' ешелонів' : ' шт.'));
      if (d.transport) parts.push(d.transport);
      return (d.transport === 'залізницею' ? '🚆 ' : '📦 ') + esc(place) + ' — ' + esc(parts.filter(Boolean).join(', '));
    });
    blocks.push('📦 Доставка\n' + lines.join('\n'));
  }
  return blocks.length ? blocks.join('\n\n') + (footerHtml ? '\n\n' + footerHtml : '') : '';
}

// ── Що з новин варто публікувати зараз ──
// raw: [{ id, date, text }]; state.news.sent: { [key]: { t, g } }
// Повертає { events, stamps:[[key,{t,g}]], stats }. Нічого не змінює у state.
const TTL_MIN = { drone: 45, launch: 45, threat: 60, delivery: 180 };
export function pickNewEvents(raw, state, now, { maxAgeMin = 20 } = {}) {
  const sent = (state && state.news && state.news.sent) || {};
  const stats = { total: raw.length, fresh: 0, noDate: 0, parsed: 0 };
  const events = [];
  for (const n of raw) {
    const ts = Date.parse(n.date);
    if (!isFinite(ts)) { stats.noDate++; continue; }            // без дати не ризикуємо повторами
    if (now - ts > maxAgeMin * 60000 || ts - now > 10 * 60000) continue;
    stats.fresh++;
    const ev = parseNews(n.text);
    stats.parsed += ev.length;
    events.push(...ev);
  }
  const merged = mergeEvents(events);
  const out = [], stamps = [];
  for (const e of merged) {
    const ttl = (e.kind === 'drone' ? TTL_MIN.drone : TTL_MIN[e.status] || 60) * 60000;
    const prev = sent[e.key];
    const more = (e.groups || 0) > ((prev && prev.g) || 0);
    const mis = (e.missiles || []).length;
    const moreMis = mis > ((prev && prev.m) || 0);              // з'явився новий тип ракети — це нова інформація
    const moreCnt = e.kind === 'delivery' && (e.count || 0) > ((prev && prev.c) || 0);   // доставка: число зросло (40 → 70)
    const confirmed = !!(prev && prev.p && !e.possible);          // було «можливі пуски», тепер — пуск
    if (prev && now - prev.t <= ttl && !more && !moreMis && !moreCnt && !confirmed) continue;   // уже публікували нещодавно
    out.push(e);
    stamps.push([e.key, { t: now, g: e.groups || 0, m: mis, c: e.count || 0, p: e.possible ? 1 : 0 }]);
  }
  return { events: out, stamps, stats, active: merged };
}

// ── Тригери для карти: що саме підсвітити блимаючим квадратиком ──
// drone → синій (точка пуску БпЛА), ballistic → червоний (регіон пуску балістики).
// Крилаті ракети / Ту-95 / стратегічні аеродроми сюди не потрапляють взагалі.
// threatToo=false — червоні квадрати лише для підтверджених пусків, без «загрози».
export function toMapTriggers(events, { threatToo = true } = {}) {
  const out = [], seen = new Set();
  for (const e of events || []) {
    let t = null;
    if (e.kind === 'drone' && e.site && e.site.id) t = { kind: 'drone', siteId: e.site.id };
    else if (e.kind === 'ballistic' && e.regionId && (threatToo || e.status === 'launch')) t = { kind: 'ballistic', regionId: e.regionId };
    if (!t) continue;
    const k = t.kind + '|' + (t.siteId || t.regionId);
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

// ── Окремі скріни пусків БпЛА ──
// Координати — з AIRBASES на сайті (де стоїть маркер аеродрому). Майданчики без маркера (Єйськ, Брянськ…) сюди не входять.
export const SITE_COORDS = {
  gvard: [45.112869, 33.976757], chauda: [45.002157, 35.839296], akhtarsk: [46.057578, 38.229532],
  berdyansk: [46.812301, 36.753085], donetsk: [48.073588, 37.727429], millerovo: [48.953259, 40.296037],
  kursk: [51.753603, 36.291073], nyavlya: [52.82544, 34.4996], orel: [52.97, 36.07],
  shatalovo: [54.334013, 32.47851], saky: [45.133333, 33.583333],
};
// Зони пусків без аеродрому (акваторії): на карті — тимчасова точка в морі, у доставці участі не беруть.
export const ZONE_COORDS = { azov: [46.25, 36.55] };
// events — це pick.active (злиті події). Повертає по одному завданню на аеродром, де відома кількість БпЛА.
export function toLaunchShots(events) {
  const out = [];
  for (const e of events || []) {
    if (e.kind !== 'drone' || !e.site || !(SITE_COORDS[e.site.id] || ZONE_COORDS[e.site.id])) continue;
    const normal = e.normal || 0, jetN = e.jetN || 0;
    if (!normal && !jetN) continue;
    const [lat, lng] = SITE_COORDS[e.site.id] || ZONE_COORDS[e.site.id];
    out.push({ key: e.key, siteId: e.site.id, name: e.site.name, region: e.site.region || null, lat, lng, normal, jetN, unit: e.unit || 'drones', note: e.note || null, droneType: e.droneType || null, possible: !!e.possible });
  }
  return out;
}
// підпис до фото
export function formatShotCaption(j, footerHtml) {
  const unit = n => j.unit === 'groups' ? plural(n) : '';
  const parts = [];
  if (j.normal) parts.push(`${j.normal} ${unit(j.normal)} звичайних`.replace('  ', ' '));
  if (j.jetN) parts.push(`${j.jetN} ${unit(j.jetN)} реактивних`.replace('  ', ' '));
  const place = j.region ? `${j.name} (${j.region})` : j.name;
  return '🚀 ' + (j.droneType === 'banderol' ? 'Пуск Бандеролей' : 'Пуск БпЛА') + ' — ' + esc(place) + '\n' + esc(parts.join(' + ')) + (j.note ? '\n' + esc(j.note) : '') + (footerHtml ? '\n\n' + footerHtml : '');
}


// ══════════════════════════════════════════════════════════════
// ── ОБЛІК ДОСТАВКИ ПО АЕРОДРОМАХ (для попапа на карті) ──
// Правила:
//  • числа з різних повідомлень за ОДИН день по одному місцю/типу не складаємо, а беремо як «оновлення загальної кількості»:
//    було 40, пізніше написали 70 → додаємо 30 (разом 70). Менше або те саме число (повтор з іншого каналу) ігноруємо.
//  • без вказаного місця («доставили 70 шахедів») ділимо порівну між усіма аеродромами з маркером на карті;
//  • лише область/регіон («в Крим», «на Брянщину») — ділимо між аеродромами цього регіону;
//  • вагони та ешелони рахуємо окремо від штук; значення з поділом/оцінкою позначаємо як «орієнтовні» (Est).
// ══════════════════════════════════════════════════════════════
const SITE_TO_MAP = { yeysk: 'akhtarsk', bryansk: 'nyavlya', morozovsk: 'millerovo' };   // майданчики без маркера → найближчий із маркером
const REGION_TO_SITES = {
  kursk: ['kursk'], bryansk: ['nyavlya'], oryol: ['orel'], smolensk: ['shatalovo'], krasnodar: ['akhtarsk'],
  crimea: ['gvard', 'chauda', 'saky'], donetsk: ['donetsk'], taganrog: ['millerovo'],
};
const kyivDay = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
const hashStr = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

// ділить n на ids порівну; залишок розкидає по колу (зсув залежить від salt, щоб «зайві» не діставались завжди першим)
function splitEven(n, ids, salt) {
  const k = ids.length, base = Math.floor(n / k), rem = n % k, off = hashStr(salt) % k;
  const out = ids.map(id => [id, base]);
  for (let i = 0; i < rem; i++) out[(off + i) % k][1] += 1;
  return out.filter(([, v]) => v > 0);
}

// куди віднести подію: масив id аеродромів, [] = «усі» (пул), null = місце відоме, але маркера на карті нема
function deliveryTargets(ev) {
  const sid = ev.site && ev.site.id;
  if (sid) { const m = SITE_COORDS[sid] ? sid : SITE_TO_MAP[sid]; return m ? { ids: [m], est: false, key: m } : null; }
  if (ev.regionId) { const ids = REGION_TO_SITES[ev.regionId]; return ids ? { ids, est: ids.length > 1, key: ev.regionId } : null; }
  if (ev.site && ev.site.name && ev.site.name !== 'місце не уточнено') return null;
  return { ids: Object.keys(SITE_COORDS), est: true, key: 'pool' };
}

// raw: [{ date, text }]. Повертає { today, bySite: { [siteId]: { days:{ 'YYYY-MM-DD': {drone,droneEst,ballistic,ballisticEst,missile,missileEst,wagons,trains} }, transports[], models[], lastTs, lastDelta } } }
export function aggregateDeliveries(raw, { now = Date.now(), days = 7 } = {}) {
  const from = now - days * 864e5;
  const items = (raw || []).map(n => ({ ts: Date.parse(n.date), text: stripEmoji(n.text) }))
    .filter(n => isFinite(n.ts) && n.ts >= from && n.ts <= now + 10 * 60000 && DELIV_RE.test(norm(n.text)))
    .sort((a, b) => a.ts - b.ts);
  const bySite = {}, groups = new Map();
  const site = id => bySite[id] || (bySite[id] = { days: {}, transports: [], models: [], lastTs: 0, lastDelta: 0 });
  const add = (id, day, metric, n) => { const d = site(id).days[day] || (site(id).days[day] = {}); d[metric] = (d[metric] || 0) + n; };
  for (const it of items) {
    const day = kyivDay(it.ts);
    for (const ev of parseNews(it.text)) {
      if (ev.kind !== 'delivery') continue;
      const tg = deliveryTargets(ev);
      if (!tg) continue;
      const kind = (ev.cargo || []).includes('shahed') ? 'drone' : (ev.cargo || []).includes('ballistic') ? 'ballistic' : 'missile';
      const unit = ev.unitWagons ? 'wagons' : ev.unitTrains ? 'trains' : 'items';
      const metric = unit === 'items' ? kind : unit;
      if (tg.key !== 'pool') for (const id of tg.ids) {
        const s = site(id);
        if (ev.transport && !s.transports.includes(ev.transport)) s.transports.push(ev.transport);
        if (ev.model && !s.models.includes(ev.model)) s.models.push(ev.model);
        s.lastTs = Math.max(s.lastTs, it.ts);
      }
      if (ev.count == null) continue;
      const gk = day + '|' + metric + '|' + tg.key;
      const g = groups.get(gk) || { max: 0 };
      if (ev.count <= g.max) continue;                       // повтор / менше число — вже враховано
      const delta = ev.count - g.max; g.max = ev.count; groups.set(gk, g);
      const parts = tg.ids.length === 1 ? [[tg.ids[0], delta]] : splitEven(delta, tg.ids, gk + ':' + g.max);
      for (const [id, v] of parts) {
        add(id, day, metric + (tg.est && unit === 'items' ? 'Est' : ''), v);
        const s = site(id); s.lastTs = Math.max(s.lastTs, it.ts); s.lastDelta = v;
      }
    }
  }
  return { today: kyivDay(now), bySite };
}

// підсумок по одному аеродрому: { today:{...}, week:{...}, transports, models, lastTs, lastDelta }
export function siteSummary(agg, siteId) {
  const s = agg && agg.bySite[siteId];
  const sum = days => days.reduce((a, d) => { for (const k in d) a[k] = (a[k] || 0) + d[k]; return a; }, {});
  if (!s) return { today: {}, week: {}, transports: [], models: [], lastTs: 0, lastDelta: 0 };
  return { today: s.days[agg.today] || {}, week: sum(Object.values(s.days)), transports: s.transports, models: s.models, lastTs: s.lastTs, lastDelta: s.lastDelta };
}

// ══════════════════════════════════════════════════════════════
// ── ПІДСУМОК О 00:00 (загальна інформація до теплової карти) ──
// facts = midnightFacts(news, live, { now }):
//   news — [{ date, text }] новини за добу (рахуємо останні `hours` годин);
//   live — стан головної мапи зараз (window.__midnightState()): { drones, missiles, ballistic, strategic:{tu95:n,…}, ships:[{sea}] }
// Правила:
//   • на мапі є БпЛА → «БпЛА зафіксовані в повітряному просторі, можливі пуски протягом ночі», нема → «не зафіксовано»;
//   • були повідомлення про виліт стратегічної авіації (Ту-95/160/22М3, МіГ-31К) → «були зафіксовані вильоти»;
//   • балістика: пуски / загроза з новин за добу (+ балістика на мапі);
//   • флот у Чорному/Азовському (Каспійському) морі → «флот активний».
// ══════════════════════════════════════════════════════════════
const STRAT_TYPES = [
  ['Ту-95МС',  /ту-?\s?95/u], ['Ту-160', /ту-?\s?160/u], ['Ту-22М3', /ту-?\s?22/u], ['МіГ-31К', /м[іи]г-?\s?31/u],
];
const STRAT_RE   = /ту-?\s?95|ту-?\s?160|ту-?\s?22|м[іи]г-?\s?31|стратег\p{L}*\s+(?:авіац|авиац)|стратегическ\p{L}*\s+авиац/u;
const STRAT_OUT  = /виліт|вилет|вилітає|вилітіл|вилетіл|злет|взл[её]т|злетіл|підняли|піднялис|подн[яи]лис|(?:в|у)\s+повітр[іяї]|(?:в|у)\s+воздух|бойов\p{L}*\s+(?:курс|чергув)|на\s+курс/u;
const STRAT_END  = /відб[іи]й|посадк|повернул|повернув|приземл|сіл[иа]\s+на\s+аеродром/u;
const FLEET_RE   = /флот|корабл|корабел|ракетоносі|ракетоносц|носі\p{L}*\s+калібр|калібр|підводн|подводн|(?:^|[^\p{L}])нк(?![\p{L}])/u;
const FLEET_ON   = /вийш|вийд|вихід|вивед|вивели|акватор|(?:в|у)\s+мор[іе]|на\s+бойов|вахт/u;
const FLEET_OFF  = /нем[аєе]є?(?![\p{L}])|відсутн|не\s+вияв|не\s+зафікс|повернул|зайшл|в\s+базі|у\s+базі|на\s+базі|0\s+носі|відб[іи]й/u;
const SEAS = [['Чорного моря', /чорн\p{L}*\s+мор|черн\p{L}*\s+мор/u], ['Азовського моря', /азовськ|азовск/u], ['Каспійського моря', /каспі|каспи/u]];
const CLAUSE_SPLIT = /\u2063+|\n|\+|(?<!(?:^|\s)од\.)(?<=[.!?])\s+/u;

export function midnightFacts(news, live, { now = Date.now(), hours = 24 } = {}) {
  live = live || {};
  const strat = new Set(), seas = new Set(), evs = [];
  let fleet = false;
  for (const n of news || []) {
    const ts = Date.parse(n.date);
    if (!isFinite(ts) || now - ts > hours * 3600e3 || ts - now > 10 * 60000) continue;
    const text = stripEmoji(n.text);
    evs.push(...parseNews(n.text).filter(e => e.kind === 'ballistic'));
    for (const clause of text.split(CLAUSE_SPLIT).map(x => x.trim()).filter(Boolean)) {
      const t = norm(clause);
      if (STRAT_RE.test(t) && STRAT_OUT.test(t) && !STRAT_END.test(t) && !NEG_RE.test(t)) {
        const found = STRAT_TYPES.filter(([, re]) => re.test(t)).map(([nm]) => nm);
        (found.length ? found : ['стратегічна авіація']).forEach(x => strat.add(x));
      }
      if (FLEET_RE.test(t) && !FLEET_OFF.test(t) && !NEG_RE.test(t)) {
        const sea = SEAS.filter(([, re]) => re.test(t)).map(([nm]) => nm);
        if (FLEET_ON.test(t) || (sea.length && /калібр|ракетоносі|ракетоносц/u.test(t))) { fleet = true; sea.forEach(x => seas.add(x)); }
      }
    }
  }
  const bal = mergeEvents(evs).filter(e => e.kind === 'ballistic');
  const uniq = a => [...new Set(a.filter(Boolean))];
  const liveStrat = Object.entries(live.strategic || {}).filter(([, v]) => v > 0);
  const ships = live.ships || [];
  ships.forEach(sh => { if (sh && sh.sea) seas.add(sh.sea); });
  return {
    air: { drones: live.drones || 0, missiles: live.missiles || 0, ballistic: live.ballistic || 0 },
    strat: { departed: [...strat], live: liveStrat },
    ballistic: {
      launches: uniq(bal.filter(e => e.status === 'launch').map(e => e.region || 'місце не уточнено')),
      threats: uniq(bal.filter(e => e.status === 'threat').map(e => e.region || 'місце не уточнено')),
      missiles: uniq(bal.flatMap(e => e.missiles || [])),
    },
    fleet: { active: fleet || ships.length > 0, seas: [...seas], live: ships.length },
  };
}

const STRAT_LIVE_NAME = { tu95: 'Ту-95МС', tu160: 'Ту-160', tu22m3: 'Ту-22М3', mig31: 'МіГ-31К' };
export function formatMidnight(f, { now = Date.now(), footerHtml } = {}) {
  const [y, m, d] = kyivDay(now).split('-');
  const L = ['🌙 Станом на 00:00, ' + d + '.' + m + '.' + y, ''];
  // повітряний простір
  L.push(f.air.drones > 0
    ? '🛵 БпЛА зафіксовані в повітряному просторі України (' + f.air.drones + '), можливі пуски протягом ночі.'
    : '✅ У повітряному просторі України БпЛА не зафіксовано.');
  if (f.air.missiles > 0) L.push('🚀 Ракети в повітряному просторі: ' + f.air.missiles + '.');
  // стратегічна авіація
  const sl = f.strat.live.map(([k, v]) => (STRAT_LIVE_NAME[k] || k) + (v > 1 ? ' ×' + v : ''));
  if (f.strat.departed.length || sl.length) {
    const names = [...new Set([...f.strat.departed.filter(x => x !== 'стратегічна авіація'), ...f.strat.live.map(([k]) => STRAT_LIVE_NAME[k] || k)])];
    L.push('✈️ Були зафіксовані вильоти стратегічної авіації' + (names.length ? ' (' + esc(names.join(', ')) + ')' : '') + '.'
      + (sl.length ? ' Зараз у повітрі: ' + esc(sl.join(', ')) + '.' : ''));
  } else L.push('✈️ Вильотів стратегічної авіації не зафіксовано.');
  // балістика
  const b = f.ballistic, mis = b.missiles.length ? ' (' + esc(b.missiles.join(' / ')) + ')' : '';
  if (b.launches.length) L.push('🚀🔴 Були пуски балістики з: ' + esc(b.launches.join(', ')) + mis + '.');
  if (b.threats.length) L.push('🚨 Загроза застосування балістики: ' + esc(b.threats.join(', ')) + (b.launches.length ? '' : mis) + '.');
  if (f.air.ballistic > 0) L.push('🚀 Балістика в повітряному просторі: ' + f.air.ballistic + '.');
  if (!b.launches.length && !b.threats.length && !(f.air.ballistic > 0)) L.push('🟢 Загрози балістики не зафіксовано.');
  // флот
  L.push(f.fleet.active
    ? '🚢 Флот активний — виведено в ' + (f.fleet.seas.length ? 'акваторію ' + esc(f.fleet.seas.join(' та ')) : 'море') + '.'
    : '⚓ Вихід флоту в море не зафіксовано.');
  return L.join('\n') + (footerHtml ? '\n\n' + footerHtml : '');
}

// ── ПРИКЛАДИ ПОВІДОМЛЕНЬ (без емодзі; з емодзі розбір працює так само — вони відкидаються) ──
// mins — «скільки хвилин тому» від now. Корисно для перевірки: node launches.mjs --demo
export function makeSampleNews(now = Date.now()) {
  const m = (mins, text, ch) => ({ id: 'demo' + mins + ch, date: new Date(now - mins * 60000).toISOString(), text, channel: ch });
  return [
    m(1700, 'На Курськ доставили 25 шахедів залізницею', 'канал А'),                                   // вчора → потрапить у «за 7 днів»
    m(320, 'Шахеди. На Нявлю доставили ешелон з шахедами, близько 40 одиниць', 'канал А'),
    m(300, 'Нявля: надійшов ешелон із шахедами, 40 шт.', 'канал Б'),                                    // повтор з іншого каналу — не дублюється
    m(260, 'Приморсько-Ахтарськ: доставка шахедів залізницею, 2 ешелони', 'канал А'),
    m(200, 'Доставили 40 шахедів, розподіляють по аеродромах', 'канал В'),                              // без місця → порівну між аеродромами
    m(90,  'Оновлення: доставлено вже 70 шахедів. Розвантаження триває', 'канал В'),                    // було 40, стало 70 → додаємо 30
    m(75,  'Доставка шахедів на аеродроми:\n- Орел (Цимбулово) — 70 одиниць (Герань-4/5);\n- Курськ (Халіно) — 30 одиниць\n- Міллерово — 20 одиниць', 'канал Г'),
    m(60,  'Іл-76 завіз 25 шахедів до Шаталового', 'канал А'),
    m(50,  'Донецьк: доставка 20 шахедів автотранспортом', 'канал Б'),
    m(25,  'Донецьк: доставили вже 35 шахедів', 'канал Б'),                                             // +15
    m(40,  'На Брянщину залізницею привезли БР Іскандер, 12 одиниць', 'канал А'),
    m(35,  'Залізницею в Крим доставили 30 шахедів', 'канал В'),                                        // область → між аеродромами Криму
    m(20,  '⚠️🚆 Бердянськ — прибув потяг з шахедами 🇷🇺, 15 одиниць ⚠️', 'канал А'),                    // емодзі відкидаються
    m(10,  'Пуск шахедів з Міллерово, 10 звичайних, 8 реактивних', 'канал А'),                          // це пуск, а не доставка — в облік не йде
  ];
}

// node launches.mjs --demo
if (typeof process !== 'undefined' && process.argv && process.argv[1] && /launches[^/\\]*\.mjs$/.test(process.argv[1]) && process.argv.includes('--demo')) {
  const now = Date.now(), agg = aggregateDeliveries(makeSampleNews(now), { now });
  for (const id of Object.keys(SITE_COORDS)) console.log(id.padEnd(10), JSON.stringify(siteSummary(agg, id).today), JSON.stringify(siteSummary(agg, id).transports));
}
