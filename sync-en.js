var CB_EXEC = '', CB_KEY = '', CB_RET = (typeof window.CB_RET === 'string' && window.CB_RET.indexOf('https://ygfa2000.github.io/crewbrief/') === 0) ? window.CB_RET : 'https://ygfa2000.github.io/crewbrief/en/';
(function(){

const COLS = ['Flight', 'Tail', 'Org', 'Dest', 'Dep', 'Arr', 'Pax', 'Block', 'Credit', 'D/PU', 'Dhd', 'Turn'];

function cutter(header) {
  const starts = COLS.map(c => header.indexOf(c));
  return line => {
    const o = {};
    COLS.forEach((c, i) => {
      const a = Math.max(0, starts[i] - 1);
      const b = i + 1 < COLS.length ? starts[i + 1] - 1 : undefined;
      o[c] = line.slice(a, b).trim();
    });
    return o;
  };
}

const iso = s => {
  const m = /(\d{2})[-/](\d{2})[-/](\d{4})/.exec(s);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

function parseTxtDet(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const trips = [];
  let trip = null, day = null, cut = null, legNo = 0;
  for (const [i, line] of lines.entries()) {
    let m;
    if ((m = /^([A-Z]\d{4}[A-Z]{0,2})\s+(\d{2}\/\d{2}\/\d{4})\s*$/.exec(line))
      || ((m = /^([A-Z0-9][A-Z0-9-]{1,11})\s+(\d{2}\/\d{2}\/\d{4})\b/.exec(line)) && /^Block:/.test(lines.slice(i + 1).find(x => x.trim()) || ''))) {
      trip = { pairing: m[1], start: iso(m[2]), days: [], crew: [] };
      trips.push(trip); legNo = 0; day = null;
    } else if (!trip) {
      continue;
    } else if ((m = /^Block:\s*(\S+)\s+Credit:\s*(\S+)\s+TAFB:\s*(\S+)/.exec(line))) {
      Object.assign(trip, { block: m[1], credit: m[2], tafb: m[3] });
    } else if ((m = /^\w+day (\d{2}-\d{2}-\d{4})\s+Report:\s*(\S+)\s+Release:\s*(\S+)/.exec(line))) {
      day = { date: iso(m[1]), report: m[2], release: m[3], legs: [] };
      trip.days.push(day);
    } else if (/^\s*Crew Members/.test(line)) {
      day = null;
    } else if (/^\s+Flight\s+Tail\s+Org/.test(line)) {
      cut = cutter(line);
    } else if (day && cut && /^\s*\d+\.\s+\S/.test(line) && !/^\s*\d+\.\s+[A-Z]{2}:/.test(line)) {
      const c = cut(line);
      legNo = Number(/^\s*(\d+)\./.exec(line)[1]) || legNo + 1;
      day.legs.push({
        no: legNo, date: day.date, flight: c.Flight, tail: c.Tail || null, from: c.Org, to: c.Dest,
        dep: c.Dep, arr: c.Arr, pax: c.Pax, block: c.Block, credit: c.Credit,
        dpu: c['D/PU'] || null, turn: c.Turn || null,
        dhd: c.Dhd && c.Dhd !== 'N' && /\d/.test(c.Flight || '') ? c.Dhd : null,
      });
    } else if (day && (m = /Day Total:\s*(\S+)\s+(\S+)\s+Duty:\s*(\S+)/.exec(line))) {
      Object.assign(day, { dayBlock: m[1], dayCredit: m[2], duty: m[3] });
    } else if (day && (m = /^Hotel:\s*(.*?)\s{2,}Layover:\s*(\S+)/.exec(line))) {
      Object.assign(day, { hotel: m[1].trim(), layover: m[2] });
    } else if ((m = /^\s*(\d+)\.\s+([A-Z]{2}:.*)$/.exec(line))) {
      const f = {};
      m[2].split(/(?:^|\s{2,}|\s(?=[A-Z]{2}:\s*\d{6}\b))([A-Z]{2}):/).slice(1).forEach((v, i, a) => { if (i % 2 && v.trim()) (f[a[i - 1]] ||= []).push(v.trim()); });
      trip.crew[Number(m[1]) - 1] = { ca: (f.CA || [''])[0], fo: (f.FO || [''])[0], fa: f.FA || [], ff: f.FF || [] };
    }
  }
  for (const t of trips) {
    const legs = t.days.flatMap(d => d.legs);
    legs.forEach(l => { l.crew = t.crew[l.no - 1] || null; });
    t.end = t.days.at(-1)?.date ?? t.start;
    delete t.crew;
  }
  return trips;
}

function parseFlowBoard(html) {
  const flights = [];
  const re = /showDetail\(this,1\)[^>]*?Detail="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    let f = m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").split(',');
    if (f.length > 40) f = [...f.slice(0, 23), f.slice(23, f.length - 16).join(','), ...f.slice(f.length - 16)];
    flights.push({
      tail: f[28] || f[0], flight: f[1], from: f[3], to: f[4],
      std: f[5], sta: f[6], stdZ: f[7], etd: f[9], eta: f[10],
      out: f[13], off: f[14], on: f[15], in: f[16],
      captain: f[21], delayCode: f[22], delayReason: f[23].trim(), delayMin: f[36],
      depGate: f[24], arrGate: f[25],
    });
  }
  return flights;
}

function parseCheckIn(html) {
  html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const me = /(\d{6})\s+[A-Za-z' .-]+?\s+-\s+[A-Z]{3}\s+\S+\s+(?:CA|FO|FA)\b/.exec(text);
  if (!me) return { checked: null, why: 'no-header' };
  const crew = html.search(/Crewmembers for Each Flight/i);
  if (crew < 0) return { checked: null, why: 'no-crew-table' };
  const at = html.indexOf(me[1], crew);
  if (at < 0) return { checked: null, why: 'not-in-crew-table' };
  const low = html.toLowerCase(), start = low.lastIndexOf('<td', at);
  if (start < crew) return { checked: null, why: 'no-cell' };
  const ends = [low.indexOf('</td', at), low.indexOf('<td', at)].filter(i => i > 0);
  const cell = html.slice(start, ends.length ? Math.min(...ends) : at + 200);
  const hit = checkMark(cell, at - start);
  return { checked: !!hit, hit: hit || '', why: hit ? '' : 'no-mark', shape: ckinCellShape(cell) };
}

const CK_SYMBOL = /[✓✔√☑✅]/;
const CK_ENTITY = /&#(?:0*(?:10003|10004|8730|9745|9989)|x0*(?:2713|2714|221a|2611|2705));|&(?:check|checkmark|radic);/i;
const CK_SAYS = /(?:^|[^a-z])(?:checked(?:[\s_-]?in)?|check[\s_-]?mark|tick(?:ed)?|confirmed)(?:[^a-z]|$)|^\s*ok\s*$/i;
const CK_ICON = /check(?![\s_-]?(?:in|box|out))|tick|glyphicon-ok|icon-ok/i;
const CK_NOT = /(?:^|[^a-z])(?:not|no|non|never|un[\s_-]?(?:check|confirm|verif|tick)\w*|yet|pending|required|needed|missing|awaiting|cross|close|times|blank|spacer|empty|transparent)(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])x(?:[^a-z0-9]|$)|checkbox(?!.*checked)/i;
const CK_HIDDEN = /display\s*:\s*none|visibility\s*:\s*hidden/i;
const CK_NEG_PART = /^(?:not|non|never|notchecked|unchecked|uncheck|unconfirmed|pending|required|needed|missing|awaiting|cross|close|times|x|spacer|blank|empty|transparent)$/i;
function ckNegAttr(k, v) {
  if (k === 'style') return CK_HIDDEN.test(v);
  if (k === 'class' || k === 'src') {
    const parts = v.split(/[\s_./-]+/).filter(Boolean);
    return parts.some(x => CK_NEG_PART.test(x)) || /^no$/i.test(parts[parts.length - 1] || '') && parts.length > 1 || (/checkbox/i.test(v) && !/checked/i.test(v));
  }
  if (/^(?:title|alt|aria-label)$/.test(k)) return CK_NOT.test(v);
  return false;
}
const CK_VOID = /^(?:img|input|br|hr|wbr|source|meta|link|area|col|embed|param|track)$/;
function dropMuted(cell) {
  let out = '', last = 0, skip = null, depth = 0, first = true;
  for (const m of cell.matchAll(/<(\/?)([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const close = m[1] === '/', tag = m[2].toLowerCase();
    if (skip) {
      if (tag === skip && !CK_VOID.test(tag)) depth += close ? -1 : /\/\s*$/.test(m[3]) ? 0 : 1;
      if (depth === 0) { skip = null; last = m.index + m[0].length; }
      continue;
    }
    const own = first && tag === 'td' && !close;
    first = false;
    if (close || own) continue;
    const attrs = tagAttrs(m[3]);
    const muted = attrs.some(a => a[0] === 'hidden') || attrs.some(a => ckNegAttr(a[0], a[1]));
    if (!muted) continue;
    out += cell.slice(last, m.index);
    last = m.index + m[0].length;
    if (!CK_VOID.test(tag) && !/\/\s*$/.test(m[3])) { skip = tag; depth = 1; }
  }
  return skip ? out : out + cell.slice(last);
}
const CK_SHAPE_ATTRS = /^(?:class|src|style)$/i, CK_TEXT_ATTRS = /^(?:title|alt|aria-label|id|name|data-[\w-]+)$/i;
function tagAttrs(rest) {
  const out = [], re = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(rest))) out.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']);
  return out;
}
function checkMark(raw, cut = raw.length) {
  const cell = dropMuted(`${raw.slice(0, cut)}\u0000${raw.slice(cut)}`.replace(/<!--[\s\S]*?(?:-->|$)/g, ''));
  cut = cell.indexOf('\u0000');
  const plain = cell.replace(/<[^>]*>/g, ' ');
  if (CK_SYMBOL.test(plain)) return 'symbol';
  if (CK_ENTITY.test(cell)) return 'entity';
  let picture = '', wing = 0, first = true;
  for (const m of cell.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase(), attrs = tagAttrs(m[2]), val = k => (attrs.find(a => a[0] === k) || [])[1];
    if (first && tag === 'td') { first = false; continue; }
    first = false;
    if (tag === 'input') {
      if (/checkbox|radio/i.test(val('type') || '') && attrs.some(a => a[0] === 'checked')) return 'checkbox-checked';
      continue;
    }
    const shapeVals = attrs.filter(a => CK_SHAPE_ATTRS.test(a[0])).map(a => a[1].replace(/font-family:[^;]*/gi, '')), textVals = attrs.filter(a => CK_TEXT_ATTRS.test(a[0])).map(a => a[1]);
    const font = `${val('face') || ''} ${val('style') || ''}`;
    if (/wingdings\s*2/i.test(font)) wing = 2; else if (/wingdings/i.test(font)) wing = wing || 1;
    if (attrs.some(a => a[0] === 'hidden' || ckNegAttr(a[0], a[1]))) continue;
    if (textVals.some(v => CK_SAYS.test(v))) return `${tag}-text`;
    if (shapeVals.some(v => CK_ICON.test(v))) return `${tag}-icon`;
    if ((tag === 'img' || tag === 'svg') && m.index < cut && cut >= 0 && !picture && ![...shapeVals, ...textVals].some(v => /check|tick/i.test(v))) picture = tag;
  }
  if (wing === 1 && /[üþ]|&#(?:252|254);|&uuml;|&thorn;/i.test(cell)) return 'wingdings';
  if (wing === 2 && /<[^>]*>\s*[PR]\s*</.test(cell)) return 'wingdings';
  return picture;
}
function ckinCellShape(cell) {
  return cell.replace(/<(\/?)([a-z][\w:-]*)\b([^>]*)>|([^<]+)/gi, (all, close, tag, rest, txt) => {
    if (txt != null) return txt.split(/(&#x?[0-9a-f]+;|&[a-z]+;)/i).map((part, i) => i % 2
      ? (CK_ENTITY.test(part) ? part : /^&(?:nbsp|#0*160|#x0*a0);$/i.test(part) ? ' ' : 'a')
      : part.replace(/\p{N}+/gu, '#').replace(/\p{L}+/gu, 'a')).join('').replace(/\s+/g, ' ');
    return `<${close}${tag.toLowerCase()}${close ? '' : tagAttrs(rest).map(a => ' ' + a[0]).join('')}>`;
  }).replace(/\s+/g, ' ').trim().slice(0, 300);
}

const unent = s => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plain = s => unent(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function absUrl(u, base) {
  u = u.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (!u || u[0] === '#' || /^[a-z][a-z0-9+.-]*:/i.test(u)) return '';
  const m = /^(https?:\/\/[^/?#]+)([^?#]*)/i.exec(base);
  if (!m) return '';
  if (u[0] === '/') return m[1] + u;
  const [path, rest] = /^([^?#]*)(.*)$/.exec(u).slice(1);
  const out = m[2].split('/').slice(0, -1);
  for (const x of path.split('/')) { if (x === '..') { if (out.length > 1) out.pop(); } else if (x !== '.') out.push(x); }
  return m[1] + out.join('/') + rest;
}
function linkOf(attrs, base) {
  const attr = k => { const m = new RegExp(`\\s${k}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs); return m ? unent(m[1] ?? m[2] ?? m[3]) : ''; };
  const href = attr('href').trim();
  if (/^tel:/i.test(href)) return '';
  const direct = absUrl(href, base);
  if (direct) return direct;
  const m = /['"]((?:https?:\/\/|\/\/)[^'"\s]+|[^'"\s]+\.(?:aspx|html?|php)(?:[?#][^'"]*)?)['"]/i.exec(`${attr('onclick')} ${/^javascript:/i.test(href) ? href : ''}`);
  return m ? absUrl(m[1], base) : '';
}
function cellShape(cell) {
  const tag = /<([a-z][a-z0-9]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi, shape = [];
  let m;
  while ((m = tag.exec(cell))) {
    const names = m[2].replace(/"[^"]*"|'[^']*'/g, '""').replace(/=\s*[^\s>]+/g, '=').match(/[a-z][a-z0-9-]*(?=\s*=)/gi) || [];
    const one = `${m[1].toLowerCase()}${names.length ? `[${names.map(x => x.toLowerCase()).join(',')}]` : ''}`;
    if (!shape.includes(one)) shape.push(one);
  }
  const text = plain(cell.replace(tag, ' ')).split(' ').filter(w => !/:\/\/|^\/\/|^www\.|[?=<>]|\.aspx|^javascript:/i.test(w)).join(' ');
  return { cell: text.slice(0, 200), shape: shape.join(' ').slice(0, 120) };
}
function parseHotels(html, base) {
  const out = [], re = /Hotel\s*:/gi;
  let m, prev = 0;
  while ((m = re.exec(html))) {
    const rest = html.slice(re.lastIndex, re.lastIndex + 1500);
    const stop = rest.search(/Layover\s*:|Hotel\s*:/i), cell = stop < 0 ? rest : rest.slice(0, stop);
    let name = '', url = '', a;
    const el = /<([a-z]+)\b([^>]*\b(?:href|onclick)\s*=[^>]*)>([\s\S]*?)<\/\1>/gi;
    while (!url && (a = el.exec(cell))) {
      const text = plain(a[3]), u = linkOf(a[2], base);
      if (u && /[A-Za-z]{2}/.test(text)) { name = text; url = u; }
    }
    if (!name) name = plain(cell).split('(')[0].trim();
    const d = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/g, before = plain(html.slice(prev, m.index));
    let last = null, x;
    while ((x = d.exec(before))) last = x;
    prev = re.lastIndex;
    if (name) out.push({ name, url, date: last ? `${last[3]}-${last[1].padStart(2, '0')}-${last[2].padStart(2, '0')}` : '', cell: stop < 0 ? '' : cell });
  }
  return out;
}
function hotelLinks(trip, html, base) {
  const items = parseHotels(html, base);
  if (!items.length) return null;
  const words = s => String(s).toLowerCase().match(/[a-z]{3,}/g) || [];
  const same = (a, b) => words(a).some(w => words(b).includes(w));
  const hd = trip.days.filter(d => d.hotel), days = {};
  hd.forEach((d, i) => {
    const it = items.length === hd.length ? items[i] : items.find(x => x.date === d.date) || items.find(x => words(x.name).join() === words(d.hotel).join());
    if (it && it.url && same(it.name, d.hotel)) days[d.date] = it.url;
  });
  return Object.keys(days).length ? { days } : { days, ...cellShape(items[0].cell) };
}

function parseOpenTime(html) {
  const cell = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const when = s => { const m = /(\d+)\/(\d+)\/(\d+) (\d+:\d+)/.exec(s); return m ? [`20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, m[4]] : ['', '']; };
  const trips = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/chkPairing_/.test(m[1])) continue;
    const cls = (/<td[^>]*\sclass=["']?(\w+)/i.exec(m[1]) || [])[1];
    const c = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x => cell(x[1]));
    if (c.length < 16 || c[12] !== 'Open') continue;
    const note = c[15];
    if (cls !== 'incentiverow' && !/incentive/i.test(note)) continue;
    const [date, report] = when(c[5]), [relDate, release] = when(c[6]);
    trips.push({ pairing: c[1], date, report, relDate, release, block: c[7], credit: c[8], tafb: c[9], days: +c[10] || 0,
      overnights: c[14].split(/,\s*/).filter(Boolean), note, pct: +((/(\d+)%/.exec(note) || [])[1] || 0) });
  }
  return trips;
}


async function pdfTextLines(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const rows = new Map();
    for (const it of items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find(k => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], s: it.str });
    }
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, r]) => {
        const text = r.sort((a, b) => a.x - b.x).map(c => c.s).join(' ').replace(/\s+/g, ' ').trim();
        if (text) lines.push(text);
      });
  }
  return lines.filter(l => !/^\d+\/\d+\/\d+, \d+:\d+ [AP]M/.test(l) && !/^https?:\/\//.test(l) && l !== 'Flight Release');
}

function releaseTextLines(text) {
  return text.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const num = s => (s == null ? null : Number(String(s).replace(/,/g, '')));

const hm = s => {
  const m = /^(\d+)\.(\d{2})$/.exec(s || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const fmtHM = min => (min == null ? '' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`);

function block(lines, title) {
  const i = lines.findIndex(l => l.trim() === title);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (/^-+$/.test(l)) { if (out.length) break; continue; }
    out.push(l);
  }
  return out;
}

function fuelRow(lines, label) {
  const re = new RegExp(`^${label.replace('/', '\\/')}\\s*-\\s*(?:([A-Z]{3,4})\\s*)?(?:-\\s*)?(\\d{2}\\.\\d{2})?\\s*(\\d+)`);
  for (const l of lines) {
    const m = re.exec(l);
    if (m) return { apt: m[1] || null, time: hm(m[2]), fuel: num(m[3]) };
  }
  return null;
}

function acarsRunways(lines) {
  const h = lines.findIndex((l, i) => /ACARS RUNWAYS/.test(lines[i - 1] || '') && /\bPMTOW\b/.test(l) && /\bEFP\b/.test(l));
  if (h < 0) return [];
  const out = [];
  for (const l of lines.slice(h + 1)) {
    if (/^-{3,}/.test(l)) break;
    const m = /^(\d{2}[LRC]?)(?:\/(\S+))?\s+(?:\S+\s+)?(\d{4,5})\s+(\d{4})\s+(.*?)(?:\s+NOTAMS\b.*)?$/.exec(l);
    if (m) out.push({ rwy: m[1], ix: m[2] || null, len: num(m[3]), pmtow: num(m[4]), efp: m[5].trim() });
  }
  return out;
}

function specialProcs(lines, raw) {
  const out = {};
  const src = raw ? raw.replace(/\r/g, '').split('\n') : lines;
  const t = src.findIndex(l => /SPECIAL ENG FAIL TAKEOFF PROCEDURES/.test(l));
  if (t < 0) return out;
  const head = src[t + 1] || '';
  const cols = raw ? [...head.matchAll(/\S+/g)].map(m => ({ name: m[0], at: m.index })) : [];
  let last = null;
  for (const line of src.slice(t + 2)) {
    if (/^\s*-{3,}/.test(line)) break;
    const l = line.replace(/\s+$/, '');
    if (!l.trim()) continue;
    const m = /^\s*(\d{2}[LRC]?)\b/.exec(l);
    if (!m) { if (last) out[last] = `${out[last]} ${l.trim()}`.trim(); continue; }
    last = m[1];
    if (/SEE COMPLEX/.test(l) || !cols.length) { out[last] = l.slice(m[0].length).replace(/\s+/g, ' ').trim(); continue; }
    const parts = cols.slice(1).map((c, i) => [c.name, l.slice(c.at, cols[i + 2] ? cols[i + 2].at : undefined).trim()]).filter(([, v]) => v);
    out[last] = parts.map(([k, v]) => `${k} ${v}`).join(' · ');
  }
  return out;
}

function parseRelease(lines, raw) {
  const text = lines.join('\n');
  const r = { warnings: [] };

  const head = /SKW(\d+)\/(\d{2}[A-Z]{3}\d{2})\/([A-Z]{3})\/([A-Z]{3})\/(N\w+)/.exec(text);
  if (head) Object.assign(r, { flight: head[1], date: head[2], from: head[3], to: head[4], tail: head[5] });
  else r.warnings.push('Header (SKW flight/date/route) not found');

  r.adsb = (/ADSB-\s*(\S+)/.exec(text) || [])[1] || null;

  const tas = /-N(\d{4})[FAMS]\d{3,4}\b/.exec(text);
  r.tas = tas ? Number(tas[1]) : null;
  const route = /-N\d{4}[FAMS]\d{3,4}\s+([\s\S]*?)\n-[A-Z]{4}\d{4}/.exec(text);
  r.route = route ? route[1].replace(/\s+/g, ' ').trim() : null;

  const hi = lines.findIndex(l => /^FLT TAIL FRM TO/.test(l));
  if (hi >= 0) {
    const row = lines.slice(hi + 1).find(l => !/^[-\s]+$/.test(l));
    const m = /^(\d+)\s+(N\w+)\s+([A-Z]{3})\s+([A-Z]{3})\s+(.*?)\s*(\S+)\s+(FL\d+)\s+(\d+)\s+(\d+)$/.exec(row || '');
    if (m) {
      const alts = m[5].trim().split(/\s+/).filter(Boolean);
      r.cruise = m[6]; r.fltlv = m[7]; r.minto = num(m[8]); r.rlsf = num(m[9]);
      r.altsFromTable = alts;
    } else r.warnings.push('Could not parse the FLT/TAIL row');
  }

  const idL = lines.find(l => /^ID\s*-/.test(l));
  const distL = lines.find(l => /^DIST\s*-/.test(l));
  const eteL = lines.find(l => /^ETE\s*-/.test(l));
  const vals = l => (l ? l.replace(/^\w+\s*-\s*/, '').trim().split(/\s+/) : []);
  const ids = vals(idL), dists = vals(distL), etes = vals(eteL);
  r.dest = { id: ids[0] || r.to, dist: num(dists[0]), ete: hm(etes[0]) };
  r.alt1 = ids[1] ? { id: ids[1], dist: num(dists[1]), ete: hm(etes[1]) } : null;
  r.alt2 = ids[2] ? { id: ids[2], dist: num(dists[2]), ete: hm(etes[2]) } : null;

  const mintoRow = fuelRow(lines, 'MINTO');
  r.mintoTime = mintoRow?.time ?? null;
  if (r.minto == null && mintoRow) r.minto = mintoRow.fuel;
  r.rlsFuel = fuelRow(lines, 'RLS FUEL')?.fuel ?? null;
  r.reserve = fuelRow(lines, 'RESERVE');
  r.hold = fuelRow(lines, 'HOLD');
  r.gaAlt = fuelRow(lines, 'GA/ALT');
  r.ldg = fuelRow(lines, 'LDG');
  r.taxiOut = fuelRow(lines, 'TAXI OUT');
  r.burnoff = fuelRow(lines, 'BURNOFF');
  r.contin = fuelRow(lines, 'CONTIN');
  r.taxiIn = fuelRow(lines, 'TAXI IN');
  r.gateFuel = fuelRow(lines, 'GATE')?.fuel ?? null;

  const w = re => (re.exec(text) || []).slice(1);
  const wt = label => num(w(new RegExp(`\\b${label}\\s*-\\s*(\\d+)`))[0]);
  r.weights = { payload: wt('PLN PAYLD'), pax: wt('BKD PAX'), maxPayload: wt('MAX PAYLD'), zfw: wt('PLN ZFW'), tow: wt('PLN TOW'), ldw: wt('PLN LDW') };
  const bow = w(/\bBOW\s*-\s*(-?[\d.]+)\s+(\d+)/);
  r.weights.bow = bow.length ? { index: bow[0], wt: num(bow[1]) } : null;
  const cargo = w(/MAX CARGO\s*-\s*(\d+)\/(\d+)/);
  r.weights.maxCargo = cargo.length ? { fwd: num(cargo[0]), aft: num(cargo[1]) } : null;
  r.weights.seats = num(w(/SEAT CNFG\s+(\d+)/)[0]);

  const rwy = k => { const m = new RegExp(`^${k}-\\s*([A-Z]{3,4})\\s+RWY\\s+(\\S+)\\s+FLAPS\\s+(\\S+)\\s+TEMP\\s+(\\S+)`, 'm').exec(text); return m ? { apt: m[1], rwy: m[2], flaps: m[3], temp: m[4] } : null; };
  r.takeoff = rwy('TAKEOFF');
  r.landing = rwy('LANDING');
  r.climb = w(/PLANNED CLIMB PROFILE-\s*(\S+)/)[0] || null;
  r.descent = w(/PLANNED DESCENT PROFILE-\s*(\S+)/)[0] || null;
  const wd = w(/AVG CRZ WIND DIR\s*-\s*(\d+)/)[0], ws = w(/AVG CRZ WIND SPD\s*-\s*(\d+)/)[0];
  r.crzWind = wd && ws ? { dir: wd, spd: Number(ws) } : null;
  const isa = w(/^ISADEV\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/m);
  r.isaDev = isa.length ? { clb: isa[0], crz: isa[1], dsc: isa[2] } : null;

  const disp = w(/DISPATCHER-\s*(.+?)\s+PHONE-\s*(\S+)/);
  r.dispatcher = disp.length ? { name: disp[0], phone: disp[1] } : null;
  r.pic = w(/^PIC-\s*(.+?)(?:\s+\d{6})?$/m)[0] || null;
  r.sic = w(/^SIC-\s*(.+?)(?:\s+\d{6})?$/m)[0] || null;

  const ti = lines.findIndex(l => /^TOC\s+\d{3}\s/.test(l));
  if (ti >= 0) {
    const fl = /^TOC\s+(\d{3})/.exec(lines[ti])[1];
    const nxt = /^(\d+)\s+(\d{2}\.\d{2})\s+(\d+)$/.exec(lines[ti + 1] || '');
    if (nxt && r.dest.dist != null && r.dest.ete != null) {
      const disR = num(nxt[1]), etr = hm(nxt[2]);
      r.toc = { fl: `FL${fl}`, distFromOrigin: r.dest.dist - disR, timeFromOrigin: r.dest.ete - etr, fuelRemain: num(nxt[3]) };
    } else r.warnings.push('Could not parse the line after TOC');
  } else r.warnings.push('TOC not found');

  const fi = lines.findIndex(l => /^A\/C \S+ TURNS TO FLT/.test(l));
  if (fi >= 0) {
    const m = /TURNS TO FLT (\d+) ([A-Z]{3})-([A-Z]{3})/.exec(lines[fi]);
    const t = /STD (\d{4}) LOCAL/.exec(lines[fi + 1] || '');
    if (m) r.next = { flight: m[1], from: m[2], to: m[3], std: t ? t[1] : null };
  }

  r.acarsRwys = acarsRunways(lines);
  r.seProc = specialProcs(lines, raw);

  r.remarks = block(lines, 'REMARKS').filter(l => !/^\*+$/.test(l));
  r.mel = block(lines, 'MEL / CDL');

  r.fixes = [];
  for (const l of lines) {
    const m = /^([A-Z][A-Z0-9]{1,5})\s+(?:\d{2,3}\s+)?([NS])(\d{2}) (\d{2}\.\d) ([EW])(\d{3}) (\d{2}\.\d)\b/.exec(l.trim());
    if (!m) continue;
    const lat = (m[2] === 'S' ? -1 : 1) * (Number(m[3]) + Number(m[4]) / 60), lon = (m[5] === 'W' ? -1 : 1) * (Number(m[6]) + Number(m[7]) / 60);
    const last = r.fixes[r.fixes.length - 1];
    if (!last || last[0] !== m[1]) r.fixes.push([m[1], Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000]);
    if (r.fixes.length > 1 && r.to && m[1].length === 4 && m[1].slice(1) === r.to) break;
  }
  return r;
}




const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const APP = (typeof CB_RET === 'string' && CB_RET) || `${CB_EXEC}?k=${CB_KEY}`;

function overlay() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:auto 12px 12px 12px;z-index:2147483647;background:#111;color:#fff;font:15px -apple-system,sans-serif;padding:14px 16px;border-radius:10px;box-shadow:0 4px 20px #0006';
  document.body.appendChild(el);
  return html => { el.innerHTML = `<b>Crew Brief</b> · ${html}`; };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pack(obj) {
  const gz = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  const b = new Uint8Array(await new Response(gz).arrayBuffer());
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const LIMIT_MS = { flow: 10000, bgFlow: 5000, page: 20000 };
const SAVE_RESERVE_MS = 1500, MIN_TRY_MS = 800;
let DEADLINE = 0;
const timeLeft = () => DEADLINE - SAVE_RESERVE_MS - Date.now();
const outOfTime = path => Object.assign(new Error(`${path.split('?')[0]} → sync time limit`), { timeout: true, deadline: true });
function within(ms, path, run) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const late = new Promise((_, no) => {
    timer = setTimeout(() => {
      if (ac) try { ac.abort(); } catch (e) {}
      no(Object.assign(new Error(`${path.split('?')[0]} → no answer in ${ms / 1000} s`), { timeout: true }));
    }, ms);
  });
  return Promise.race([run(ac ? ac.signal : undefined), late]).finally(() => { if (typeof clearTimeout === 'function') clearTimeout(timer); });
}

async function get(path, ms = LIMIT_MS.page, optional = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) {
      if (timeLeft() < 1500 * attempt + MIN_TRY_MS) throw outOfTime(path);
      await sleep(1500 * attempt);
    }
    const lim = Math.min(ms, timeLeft());
    if (lim < MIN_TRY_MS) throw outOfTime(path);
    const r = await within(lim, path, signal => fetch(path, { credentials: 'include', ...(signal ? { signal } : {}) })
      .then(async res => ({ ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' })));
    if (r.ok) { await sleep(300); return r.text; }
    if (r.status !== 403) throw new Error(`${path} → HTTP ${r.status}`);
  }
  throw Object.assign(new Error('Blocked by the site security check — reload the page and tap again'), { blocked: true });
}

const hmMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
const AIRPORT_UTC_BEHIND_MAX_H = 10;
function dutyOpenToday(d, now) {
  const rep = hmMin(d.report), rel = hmMin(d.release), ymdOk = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '');
  if (rep == null || rel == null || !ymdOk) return true;
  const overnight = rel < rep || (d.legs || []).some(l => { const a = hmMin(l.arr), b = hmMin(l.dep); return a != null && b != null && a < b; });
  const [y, m, dd] = d.date.split('-').map(Number);
  const latestRelease = Date.UTC(y, m - 1, dd + (overnight ? 1 : 0), 0, rel) + AIRPORT_UTC_BEHIND_MAX_H * 36e5;
  return now.getTime() < latestRelease + 2 * 36e5;
}

function formOf(html, button) {
  const dec = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const attr = (tag, k) => { const m = new RegExp(`\\s${k}="([^"]*)"`).exec(tag); return m ? dec(m[1]) : null; };
  const out = [];
  (html.match(/<input[^>]*>/g) || []).forEach(tag => {
    const name = attr(tag, 'name'), type = (attr(tag, 'type') || 'text').toLowerCase();
    if (!name || type === 'submit' || type === 'button' || type === 'image') return;
    if ((type === 'checkbox' || type === 'radio') && !/\schecked/.test(tag)) return;
    out.push([name, attr(tag, 'value') ?? (type === 'checkbox' ? 'on' : '')]);
  });
  (html.match(/<select[\s\S]*?<\/select>/g) || []).forEach(sel => {
    const name = attr(sel.slice(0, sel.indexOf('>') + 1), 'name');
    const opt = /<option[^>]*selected[^>]*>/.exec(sel) || /<option[^>]*>/.exec(sel);
    if (name && opt) out.push([name, attr(opt[0], 'value') ?? '']);
  });
  out.push([button, attr((new RegExp(`<input[^>]*name="${button}"[^>]*>`).exec(html) || [''])[0], 'value') || '']);
  return out.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

async function run() {
  if (!location.hostname.endsWith(atob('c2t5d2VzdG9ubGluZS5jb20='))) {
    alert('Tap this while logged in to the crew portal.');
    return;
  }
  const say = overlay();
  try {
    const now = new Date();
    DEADLINE = typeof CB_DEADLINE === 'number' && CB_DEADLINE > Date.now() ? CB_DEADLINE : Date.now() + (typeof CB_BG !== 'undefined' && CB_BG === true ? 17000 : 90000);
    const flowMs = typeof CB_BG !== 'undefined' && CB_BG === true ? LIMIT_MS.bgFlow : LIMIT_MS.flow;
    const months = [-1, 0, 1].map(k => new Date(now.getFullYear(), now.getMonth() + k, 1));
    const got = {};
    const readMonth = async k => {
      const m = months[k + 1];
      const bid = `${m.getFullYear()}${pad(m.getMonth() + 1)}`;
      say(`Reading ${bid} schedule`);
      const txt = await get(`${atob('L1NLWVcvU2tlZFBsdXMvRXhwb3J0LmFzcHg=')}?Format=TXTDET&BidMonth=${bid}`);
      if (/<html/i.test(txt)) throw Object.assign(new Error('Login required - sign in and the sync runs again automatically'), { login: true });
      got[k] = parseTxtDet(txt);
    };
    const dedupe = list => { const seen = new Set(); return list.filter(t => !seen.has(t.pairing + t.start) && seen.add(t.pairing + t.start)); };
    const readSoFar = () => dedupe([-1, 0, 1].filter(k => got[k]).flatMap(k => got[k]));
    let lite = null;
    if (typeof CB_BG !== 'undefined' && CB_BG === true) {
      const today = ymd(now), why = [];
      await readMonth(0);
      const covering = () => readSoFar().filter(t => t.start <= today && t.end >= today);
      if (!covering().length && now.getDate() <= 7) { why.push('early in month: trip may have started last month'); await readMonth(-1); }
      const cur = covering().sort((a, b) => a.start.localeCompare(b.start));
      if (cur.length) {
        const curMonth = today.slice(0, 7), last = cur[cur.length - 1];
        const nextOf = () => readSoFar().filter(t => t.start > last.start).sort((a, b) => a.start.localeCompare(b.start))[0];
        let next = nextOf();
        const n0 = why.length;
        if (!next) why.push('next trip not in this month');
        else if (next.start.slice(0, 7) > curMonth) why.push('next trip starts next month');
        if (cur.some(t => t.end.slice(0, 7) > curMonth) || (next && next.end.slice(0, 7) > curMonth)) why.push('trip runs into next month');
        if (why.length > n0) { await readMonth(1); next = nextOf(); }
        const mine = new Set(cur.concat(next ? [next] : []).map(t => t.pairing + t.start));
        lite = { only: mine, months: [-1, 0, 1].filter(k => got[k]).map(k => ymd(months[k + 1]).slice(0, 7)), why };
      }
    }
    if (!lite) for (const k of [-1, 0, 1]) if (!got[k]) await readMonth(k);
    let trips = readSoFar();
    const scoped = lite ? trips.filter(t => lite.only.has(t.pairing + t.start)) : trips;

    const from = new Date(now); from.setDate(from.getDate() - 1);
    const to = now;
    const yday = ymd(from);
    const legsOf = until => scoped.flatMap(t => t.days.flatMap(d => d.legs.map(l => ({ l, open: l.date !== yday || dutyOpenToday(d, now) }))))
      .filter(x => x.l.date >= yday && x.l.date <= ymd(until));
    const REL_SEEN = 'cbRelSeen';
    let relSeen = {};
    try { relSeen = JSON.parse(localStorage.getItem(REL_SEEN)) || {}; } catch (e) {}
    const rememberReleases = () => {
      Object.keys(releases).forEach(k => { relSeen[k] = k.slice(0, 10); });
      Object.keys(relSeen).forEach(k => { if (relSeen[k] < yday) delete relSeen[k]; });
      try { localStorage.setItem(REL_SEEN, JSON.stringify(relSeen)); } catch (e) {}
    };
    const legs = legsOf(to).filter(x => x.open || !relSeen[`${x.l.date}-${x.l.flight}-${x.l.from}`]).map(x => x.l);
    const releases = {}, raws = {}, skipped = { flow: [], release: [] };
    const STOP_AFTER = 2;
    const why = e => (e.deadline ? 'time limit' : 'timeout');
    let i = 0, stuck = 0;
    for (const l of legs) {
      ++i;
      const key = `${l.date}-${l.flight}-${l.from}`;
      if (stuck >= STOP_AFTER || timeLeft() < MIN_TRY_MS) { skipped.release.push(key); continue; }
      say(`Release ${i}/${legs.length} (${l.flight} ${l.from})`);
      const [y, mo, d] = l.date.split('-');
      let html;
      try {
        html = await get(`${atob('L1NLWVcvQ3Jld01pc2MvRmxpZ2h0UmVsZWFzZS5hc3B4')}?flightnum=${encodeURIComponent(l.flight)}&origin=${l.from}&dtpFlightDate=${mo}%2f${d}%2f${y}`, LIMIT_MS.page, true);
      } catch (e) {
        if (!e.timeout) throw e;
        if (!e.deadline) stuck++;
        skipped.release.push(key);
        say(`Release ${i}/${legs.length} (${l.flight} ${l.from}) skipped (${why(e)})`);
        continue;
      }
      const pre = new DOMParser().parseFromString(html, 'text/html').querySelector('pre');
      if (pre) {
        releases[key] = parseRelease(releaseTextLines(pre.textContent), pre.textContent);
        raws[key] = pre.textContent.replace(/[ \t]+$/gm, '');
      }
    }

    const flows = {};
    const flowTo = new Date(now); flowTo.setDate(flowTo.getDate() + 2);
    const flowLegs = legsOf(flowTo).filter(x => x.open).map(x => x.l);
    const tails = [...new Set(flowLegs.filter(l => l.tail).map(l => `${l.date}|${l.tail}`))];
    i = 0; stuck = 0;
    for (const dt of tails) {
      const [date, tail] = dt.split('|');
      ++i;
      if (stuck >= STOP_AFTER || timeLeft() < MIN_TRY_MS) { skipped.flow.push(`${date}-${tail}`); continue; }
      say(`Flow ${i}/${tails.length} (${tail})`);
      const [y, mo, d] = date.split('-');
      const q = `FlightDate=${encodeURIComponent(`${mo}/${d}/${y}`)}&Station=&AircraftTypes=&AircraftNumbers=${encodeURIComponent(tail + ',')}` +
        '&ShowTurnBacks=N&ShowCancelled=Y&TimeZone=UTC%20000&CodeShares=&ShowAllTails=N';
      try {
        flows[`${date}-${tail}`] = { at: new Date().toISOString(), flights: parseFlowBoard(await get(`${atob('L1NLWVcvRmxpZ2h0U2NyZWVuL0Zsb3dCb2FyZC5hc3B4')}?${q}`, flowMs, true)) };
      } catch (e) {
        if (!e.timeout) throw e;
        if (!e.deadline) stuck++;
        skipped.flow.push(`${date}-${tail}`);
        say(`Flow ${i}/${tails.length} (${tail}) skipped (${why(e)})`);
      }
    }

    const checkin = {}, tripPages = {}, CKIN_SEEN = 'cbCheckedIn', day0 = ymd(now);
    const inTrip = scoped.filter(t => t.start <= day0 && t.end >= day0);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CKIN_SEEN)) || {}; } catch (e) {}
    const ckinSeen = {};
    inTrip.forEach(t => { const k = `${t.pairing}|${t.start}`; if (saved[k] === t.end) ckinSeen[k] = t.end; });
    const tripPage = t => tripPages[t.pairing + t.start] || (tripPages[t.pairing + t.start] = get(`${atob('L1NLWVcvU2tlZFBsdXMvVHJpcERldGFpbC5hc3B4')}?PairingName=${encodeURIComponent(t.pairing)}&PairingDate=${t.start.replace(/-/g, '')}&OTPosition=&SBID=0`, LIMIT_MS.page, true));
    for (const t of inTrip) {
      const k = `${t.pairing}|${t.start}`;
      if (k in ckinSeen) { checkin[k] = { checked: true, why: 'remembered' }; continue; }
      say(`Check-in (${t.pairing})`);
      let html;
      try { html = await tripPage(t); } catch (e) { checkin[k] = { checked: null, why: e && e.blocked ? 'blocked' : e && e.deadline ? 'time-limit' : e && e.timeout ? 'timeout' : 'fetch-error' }; continue; }
      if (/<input[^>]*type=["']?password/i.test(html) || (!/Crewmembers for Each Flight/i.test(html) && /<form[^>]*log.?in/i.test(html))) { checkin[k] = { checked: null, why: 'login' }; continue; }
      if (html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim().length < 20) { checkin[k] = { checked: null, why: 'empty' }; continue; }
      try {
        const r = parseCheckIn(html);
        checkin[k] = r;
        if (r.checked) ckinSeen[k] = t.end;
      } catch (e) { checkin[k] = { checked: null, why: 'parse-error' }; }
    }
    try { localStorage.setItem(CKIN_SEEN, JSON.stringify(ckinSeen)); } catch (e) {}

    let opentime = null;
    if (!lite && timeLeft() >= MIN_TRY_MS) try {
      say('Reading Open Time');
      const OT = atob('L1NLWVcvU2tlZFBsdXMvT3BlblRpbWUuYXNweA==');
      let html = await get(OT, LIMIT_MS.page, true), how = 'GET';
      if (!/chkPairing_/.test(html) && /name="btnSearch"/.test(html)) {
        if (timeLeft() < MIN_TRY_MS) throw outOfTime(OT);
        const r = await within(Math.min(LIMIT_MS.page, timeLeft()), OT, signal => fetch(OT, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formOf(html, 'btnSearch'), ...(signal ? { signal } : {}) })
          .then(async res => ({ status: res.status, text: res.ok ? await res.text() : '' })));
        html = r.text;
        how = `POST ${r.status}`;
      }
      opentime = /chkPairing_/.test(html) ? { at: new Date().toISOString(), trips: parseOpenTime(html) }
        : { at: new Date().toISOString(), trips: [], err: `${how} · ${html.length}B · no list` };
    } catch (e) { opentime = { at: new Date().toISOString(), trips: [], err: String(e.message || e).slice(0, 80) }; }

    if (typeof CB_DONE === 'function') CB_DONE();
    const payload = { syncedAt: now.toISOString(), trips, releases, flows, raws, opentime, checkin, script: typeof CB_SCRIPT_VER === 'string' ? CB_SCRIPT_VER : 'bookmark' };
    if (lite) payload.lite = { months: lite.months, why: lite.why, trips: lite.only.size };
    if (skipped.flow.length || skipped.release.length) payload.skipped = skipped;
    const skipNote = skipped.flow.length || skipped.release.length ? ` · skipped: ${[skipped.flow.length && `Flow ${skipped.flow.length}`, skipped.release.length && `Release ${skipped.release.length}`].filter(Boolean).join(', ')}` : '';
    if (!CB_EXEC) {
      say(`Done — ${trips.length} trips, ${Object.keys(releases).length} releases, ${Object.keys(flows).length} flows${skipNote} · returning to the app…`);
      const d = await pack(payload);
      rememberReleases();
      setTimeout(() => { location.href = `${CB_RET}#d=${d}`; }, 1200);
      return;
    }
    say('Saving');
    const res = await fetch(CB_EXEC, { method: 'POST', body: JSON.stringify({ k: CB_KEY, payload }) });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'Save failed');
    rememberReleases();
    say(`Done — ${trips.length} trips, ${Object.keys(releases).length} releases, ${Object.keys(flows).length} flows${skipNote} · returning to the app…`);
    setTimeout(() => { location.href = APP; }, 1200);
  } catch (e) {
    if (e.login && typeof CB_WAIT === 'function') return CB_WAIT(say);
    if (typeof CB_DONE === 'function') CB_DONE();
    say(`Failed: ${e.message}`);
  }
}

run();

})();