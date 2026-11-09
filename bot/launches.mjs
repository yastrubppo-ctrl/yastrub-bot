// Розбір новин про пуски БпЛА та балістики (укр + рос, із помилками і змішаними розкладками).
// Вихід: події { kind:'drone'|'ballistic', status:'launch'|'threat', site, region, groups, jet, droneType, missiles, note }

// ── Майданчики пусків БпЛА (id збігаються з shahedLaunchPads на карті) ──
const SITES = [
  { id: 'akhtarsk',  name: 'Приморсько-Ахтарськ', region: 'Краснодарський край', re: /приморс\p{L}*[-\s]?ахтар|прим[-.\s]?ахтар|ахтарс|ахтарк/u },
  { id: 'kursk',     name: 'Курськ',              region: 'Курська обл.',        re: /курськ|курск|халін|халин/u },
  { id: 'millerovo', name: 'Міллерово',           region: 'Ростовська обл.',     re: /м[іи]ллер[еоі]в/u },
  { id: 'donetsk',   name: 'Донецьк',             region: 'окупований',          re: /донецьк|донецк/u },
  { id: 'gvard',     name: 'Гвардійське',         region: 'Крим',                re: /гвард[іие][йи]с[ь]?к/u },
  { id: 'chauda',    name: 'Чауда',               region: 'Крим',                re: /чауд/u },
  { id: 'orel',      name: 'Орел',                region: 'Орловська обл.',      re: /цимбулов|(?:^|[^\p{L}])(?:орл\p{L}*|орел|орёл)(?![\p{L}])/u },
  { id: 'shatalovo', name: 'Шаталове',            region: 'Смоленська обл.',     re: /шатал[оа]в/u },
  { id: 'nyavlya',   name: 'Нявля',               region: 'Брянська обл.',       re: /нявл|навл[яеі]/u },
  { id: 'berdyansk', name: 'Бердянськ',           region: 'окупований',          re: /бердянськ|бердянск/u },
  // без позначки на карті:
  { id: 'yeysk',     name: 'Єйськ',               region: 'Краснодарський край', re: /[єе][йи]ськ|ейск/u },
  { id: 'saky',      name: 'Саки',                region: 'Крим',                re: /(?:^|[^\p{L}])сак(?:и|ів|ах|ам)(?![\p{L}])/u },
  { id: 'bryansk',   name: 'Брянськ',             region: 'Брянська обл.',       re: /брянськ|брянск/u },
  { id: 'mozdok',    name: 'Моздок',              region: 'Північна Осетія',     re: /моздок/u },
  { id: 'morozovsk', name: 'Морозовськ',          region: 'Ростовська обл.',     re: /морозовськ|морозовск/u },
  { id: 'engels',    name: 'Енгельс',             region: 'Саратовська обл.',    re: /енгельс|энгельс/u },
];

// ── Регіони для балістики («з Брянську» → Брянська область) ──
const REGIONS = [
  { id: 'kursk',     name: 'Курська область',       re: /курськ|курск/u },
  { id: 'bryansk',   name: 'Брянська область',      re: /брянськ|брянск|брянщин/u },
  { id: 'voronezh',  name: 'Воронезька область',    re: /воронеж/u },
  { id: 'belgorod',  name: 'Бєлгородська область',  re: /[бб][єе]лгород/u },
  { id: 'taganrog',  name: 'Ростовська область (Таганрог)', re: /таганрог/u },   // до загального «Ростов»
  { id: 'taganrog',  name: 'Ростовська область',    re: /ростов/u },              // на карті один маркер — Таганрог
  { id: 'krasnodar', name: 'Краснодарський край',   re: /краснодар|[єе][йи]ськ|ейск|ахтарськ|ахтарск/u },
  { id: 'astrakhan', name: 'Астраханська область (Капустін Яр)', re: /астрахан|капуст[іи]н/u },
  { id: 'crimea',    name: 'Крим',                  re: /(?:^|[^\p{L}])крим|(?:^|[^\p{L}])крым/u },
  { id: 'smolensk',  name: 'Смоленська область',    re: /смоленськ|смоленск|шатал/u },
  { id: 'oryol',     name: 'Орловська область',     re: /орловськ|орловск|(?:^|[^\p{L}])орл|(?:^|[^\p{L}])орел|цимбулов/u },
  { id: 'donetsk',   name: 'Донеччина (окупована)', re: /донецьк|донецк/u },
];

const MISSILES = [
  ['Іскандер-М', /[іиi]скандер-?\s?м|[іиi]скандер/u],
  ['КН-23',      /[kк][нh]-?23/u],
  ['С-300',      /[cс]-?300/u],
  ['С-400',      /[cс]-?400/u],
  ['Кинджал',    /кинджал|кинжал/u],
  ['Циркон',     /циркон/u],
];

// Нормалізація: нижній регістр, ё→е, апострофи, латинські «двійники» не чіпаємо (вони у регексах)
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[’`ʼ]/g, "'");

const plural = n => (n % 10 === 1 && n % 100 !== 11) ? 'група'
  : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) ? 'групи' : 'груп';

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
  const unq = num(/(\d{1,3})\s*(?:бпла|шахед\p{L}*|shahed|дрон\p{L}*|груп\p{L}*)/u);
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
const HAS_COUNT = /реактивн|звичайн|поршнев|класичн|\d{1,3}\s*(?:бпла|шахед|shahed|дрон|груп)/u;

export function parseNews(rawText) {
  const text = String(rawText || '');
  const events = [];
  // підліт: «Подлет после 22:00»
  const tm = /(?:подл[её]т|п[іи]дл[іи]т)\D{0,20}?(п[іи]сля|после|до)?\s*(\d{1,2})[:.](\d{2})/iu.exec(text);
  const note = tm ? ('підліт ' + (tm[1] ? (/до/i.test(tm[1]) ? 'до ' : 'після ') : 'близько ') + tm[2].padStart(2, '0') + ':' + tm[3]) : null;

  // кліни: розділяємо за ⚠️, крапками/знаками з пробілом, переносами та «+»
  const clauses = text.split(/⚠️+|\n|\+|(?<=[.!?])\s+/u).map(s => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    const t = norm(clause);
    const isThreat = /можлив|загроз|угроз/u.test(t);
    const isLaunch = /(?:відбул\p{L}*|зафіксов\p{L}*|зафиксир\p{L}*)\s+пуск|(?:^|[^\p{L}])пуски/u.test(t);
    const ball = /баліст|баллист|[іиi]скандер|[kк][нh]-?23|[cс]-?300|[cс]-?400|кинджал|кинжал|циркон/u.test(t);
    const drone = /бпла|шахед|shahed|герань|geran|дрон/u.test(t);
    if (!(isThreat || isLaunch) || !(ball || drone)) continue;

    if (ball && !drone) {                         // ── БАЛІСТИКА ──
      const missiles = MISSILES.filter(([, re]) => re.test(t)).map(([n]) => n);
      // регіон беремо після «з/із/с/из» — щоб «типу С-300» не плутати з місцем
      const after = /(?:^|\s)(?:з|із|с|со|из)\s+([^.!?,;()«»]+)/u.exec(t);
      // «з Брянська та Курська» → по події на кожен регіон (кожен має свій квадрат на карті)
      const where = after ? after[1] : '';
      const ros = []; for (const r of REGIONS) if (r.re.test(where) && !ros.some(x => x.id === r.id)) ros.push(r);
      const status = (isLaunch && !isThreat) ? 'launch' : 'threat';
      if (!ros.length) events.push({ kind: 'ballistic', status, region: null, regionId: null, missiles });
      else for (const ro of ros) events.push({ kind: 'ballistic', status, region: ro.name, regionId: ro.id, missiles });
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
        if (!site) {
          const g = GENERIC_PLACE.exec(seg);
          if (g && !/(?:бпла|шахед)/iu.test(g[1])) site = { id: null, name: g[1].trim(), region: null };
        }
        if (!site) {            // «…з Міллерово, 8 реактивних» — сегмент без місця дописує кількість до попередньої події
          if (last && HAS_COUNT.test(st)) applyCounts(last, st);
          continue;
        }
        const gm = /(\d{1,3})\s*груп/u.exec(st);
        const ev = {
          kind: 'drone', status: 'launch', site,
          groups: gm ? Number(gm[1]) : null,
          jet: /реактивн/u.test(st) || (droneAll && segs.length === 1),
          droneType: /shahed|шахед|герань|geran/u.test(t) ? 'shahed' : 'unknown',
          note,
          normal: null, jetN: null, unit: 'drones',
        };
        applyCounts(ev, st);
        events.push(ev);
        last = ev;
        any = true;
      }
      void any;
    }
  }
  return events;
}

// ── Злиття подій одного повідомлення/запуску (максимум груп, об'єднання ракет) ──
export function mergeEvents(list) {
  const m = new Map();
  for (const e of list) {
    const key = e.kind === 'drone' ? `drone|${e.site.id || e.site.name}` : `bal|${e.status}|${e.region || 'any'}`;
    const o = m.get(key);
    if (!o) { m.set(key, { ...e, key }); continue; }
    if (e.groups != null) o.groups = Math.max(o.groups || 0, e.groups);
    if (e.jet) o.jet = true;
    if (e.normal != null) o.normal = Math.max(o.normal || 0, e.normal);
    if (e.jetN != null) o.jetN = Math.max(o.jetN || 0, e.jetN);
    if (e.unit === 'groups') o.unit = 'groups';
    if (e.note && !o.note) o.note = e.note;
    if (e.missiles) o.missiles = [...new Set([...(o.missiles || []), ...e.missiles])];
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
  const drones = events.filter(e => e.kind === 'drone');
  if (drones.length) {
    const allShahed = drones.every(d => d.droneType === 'shahed');
    const lines = drones.map(d => {
      const place = d.site.region ? `${d.site.name} (${d.site.region})` : d.site.name;
      const parts = [];
      if (d.groups != null) parts.push(`${d.groups} ${plural(d.groups)}`);
      if (d.jet) parts.push('реактивні');
      if (d.note) parts.push(d.note);
      return '📍 ' + esc(place) + (parts.length ? ' — ' + esc(parts.join(', ')) : '');
    });
    blocks.push('🚀 Пуски БпЛА' + (allShahed ? ' (Shahed)' : '') + '\n' + lines.join('\n'));
  }
  for (const status of ['launch', 'threat']) {
    const bs = events.filter(e => e.kind === 'ballistic' && e.status === status);
    if (!bs.length) continue;
    const head = status === 'launch' ? '🚀 Пуски балістики' : '🚨 Загроза застосування балістики';
    const lines = bs.map(b => {
      const mis = b.missiles && b.missiles.length ? b.missiles.join(' / ') : '';
      return '📍 ' + esc(b.region || 'місце не уточнено') + (mis ? ' — ' + esc(mis) : '');
    });
    blocks.push(head + '\n' + lines.join('\n'));
  }
  return blocks.length ? blocks.join('\n\n') + (footerHtml ? '\n\n' + footerHtml : '') : '';
}

// ── Що з новин варто публікувати зараз ──
// raw: [{ id, date, text }]; state.news.sent: { [key]: { t, g } }
// Повертає { events, stamps:[[key,{t,g}]], stats }. Нічого не змінює у state.
const TTL_MIN = { drone: 45, launch: 45, threat: 60 };
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
    const ttl = (e.kind === 'drone' ? TTL_MIN.drone : TTL_MIN[e.status]) * 60000;
    const prev = sent[e.key];
    const more = (e.groups || 0) > ((prev && prev.g) || 0);
    if (prev && now - prev.t <= ttl && !more) continue;       // уже публікували нещодавно
    out.push(e);
    stamps.push([e.key, { t: now, g: e.groups || 0 }]);
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
  kursk: [51.753603, 36.291073], nyavlya: [52.82544, 34.4996], orel: [53.3728, 35.80028],
  shatalovo: [54.334013, 32.47851], saky: [45.133333, 33.583333],
};
// events — це pick.active (злиті події). Повертає по одному завданню на аеродром, де відома кількість БпЛА.
export function toLaunchShots(events) {
  const out = [];
  for (const e of events || []) {
    if (e.kind !== 'drone' || !e.site || !SITE_COORDS[e.site.id]) continue;
    const normal = e.normal || 0, jetN = e.jetN || 0;
    if (!normal && !jetN) continue;
    const [lat, lng] = SITE_COORDS[e.site.id];
    out.push({ key: e.key, siteId: e.site.id, name: e.site.name, region: e.site.region || null, lat, lng, normal, jetN, unit: e.unit || 'drones', note: e.note || null });
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
  return '🚀 Пуск БпЛА — ' + esc(place) + '\n' + esc(parts.join(' + ')) + (j.note ? '\n' + esc(j.note) : '') + (footerHtml ? '\n\n' + footerHtml : '');
}
