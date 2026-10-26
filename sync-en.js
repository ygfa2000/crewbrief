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
  for (const line of lines) {
    let m;
    if ((m = /^([A-Z]\d{4}[A-Z]{0,2})\s+(\d{2}\/\d{2}\/\d{4})\s*$/.exec(line))) {
      trip = { pairing: m[1], start: iso(m[2]), days: [], crew: [] };
      trips.push(trip); legNo = 0; day = null;
    } else if (!trip) {
      continue;
    } else if ((m = /^Block:\s*(\S+)\s+Credit:\s*(\S+)\s+TAFB:\s*(\S+)/.exec(line))) {
      Object.assign(trip, { block: m[1], credit: m[2], tafb: m[3] });
    } else if ((m = /^\w+day (\d{2}-\d{2}-\d{4})\s+Report:\s*(\S+)\s+Release:\s*(\S+)/.exec(line))) {
      day = { date: iso(m[1]), report: m[2], release: m[3], legs: [] };
      trip.days.push(day);
    } else if (/^\s+Flight\s+Tail\s+Org/.test(line)) {
      cut = cutter(line);
    } else if (day && cut && /^\s*\d+\.\s+\S/.test(line) && !/CA:/.test(line)) {
      const c = cut(line);
      legNo = Number(/^\s*(\d+)\./.exec(line)[1]) || legNo + 1;
      day.legs.push({
        no: legNo, date: day.date, flight: c.Flight, tail: c.Tail || null, from: c.Org, to: c.Dest,
        dep: c.Dep, arr: c.Arr, pax: c.Pax, block: c.Block, credit: c.Credit,
        dpu: c['D/PU'] || null, dhd: c.Dhd || null, turn: c.Turn || null,
      });
    } else if (day && (m = /Day Total:\s*(\S+)\s+(\S+)\s+Duty:\s*(\S+)/.exec(line))) {
      Object.assign(day, { dayBlock: m[1], dayCredit: m[2], duty: m[3] });
    } else if (day && (m = /^Hotel:\s*(.*?)\s{2,}Layover:\s*(\S+)/.exec(line))) {
      Object.assign(day, { hotel: m[1].trim(), layover: m[2] });
    } else if ((m = /^\s*(\d+)\.\s+CA:\s*(.*?)\s+FO:\s*(.*?)\s+FA:\s*(.*?)(?:\s+FF:\s*(.*?))?\s*$/.exec(line))) {
      trip.crew[Number(m[1]) - 1] = { ca: m[2], fo: m[3], fa: [m[4], m[5]].filter(Boolean) };
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

async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    const res = await fetch(path, { credentials: 'include' });
    if (res.ok) { await sleep(300); return res.text(); }
    if (res.status !== 403) throw new Error(`${path} → HTTP ${res.status}`);
  }
  throw new Error('Blocked by the site security check — reload the page and tap again');
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
    const months = [-1, 0, 1].map(k => new Date(now.getFullYear(), now.getMonth() + k, 1));
    let trips = [];
    for (const m of months) {
      const bid = `${m.getFullYear()}${pad(m.getMonth() + 1)}`;
      say(`Reading ${bid} schedule`);
      const txt = await get(`${atob('L1NLWVcvU2tlZFBsdXMvRXhwb3J0LmFzcHg=')}?Format=TXTDET&BidMonth=${bid}`);
      if (/<html/i.test(txt)) throw Object.assign(new Error('Login required - sign in and the sync runs again automatically'), { login: true });
      trips = trips.concat(parseTxtDet(txt));
    }
    const seen = new Set();
    trips = trips.filter(t => !seen.has(t.pairing + t.start) && seen.add(t.pairing + t.start));

    const from = new Date(now); from.setDate(from.getDate() - 1);
    const to = now;
    const legs = trips.flatMap(t => t.days.flatMap(d => d.legs)).filter(l => l.date >= ymd(from) && l.date <= ymd(to));
    const releases = {}, raws = {};
    let i = 0;
    for (const l of legs) {
      say(`Release ${++i}/${legs.length} (${l.flight} ${l.from})`);
      const [y, mo, d] = l.date.split('-');
      const html = await get(`${atob('L1NLWVcvQ3Jld01pc2MvRmxpZ2h0UmVsZWFzZS5hc3B4')}?flightnum=${encodeURIComponent(l.flight)}&origin=${l.from}&dtpFlightDate=${mo}%2f${d}%2f${y}`);
      const pre = new DOMParser().parseFromString(html, 'text/html').querySelector('pre');
      if (pre) {
        const key = `${l.date}-${l.flight}-${l.from}`;
        releases[key] = parseRelease(releaseTextLines(pre.textContent), pre.textContent);
        raws[key] = pre.textContent.replace(/[ \t]+$/gm, '');
      }
    }

    const flows = {};
    const tails = [...new Set(legs.filter(l => l.tail).map(l => `${l.date}|${l.tail}`))];
    i = 0;
    for (const dt of tails) {
      const [date, tail] = dt.split('|');
      say(`Flow ${++i}/${tails.length} (${tail})`);
      const [y, mo, d] = date.split('-');
      const q = `FlightDate=${encodeURIComponent(`${mo}/${d}/${y}`)}&Station=&AircraftTypes=&AircraftNumbers=${encodeURIComponent(tail + ',')}` +
        '&ShowTurnBacks=N&ShowCancelled=Y&TimeZone=UTC%20000&CodeShares=&ShowAllTails=N';
      flows[`${date}-${tail}`] = { at: new Date().toISOString(), flights: parseFlowBoard(await get(`${atob('L1NLWVcvRmxpZ2h0U2NyZWVuL0Zsb3dCb2FyZC5hc3B4')}?${q}`)) };
    }

    let opentime = null;
    try {
      say('Reading Open Time');
      const OT = atob('L1NLWVcvU2tlZFBsdXMvT3BlblRpbWUuYXNweA==');
      let html = await get(OT), how = 'GET';
      if (!/chkPairing_/.test(html) && /name="btnSearch"/.test(html)) {
        const res = await fetch(OT, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formOf(html, 'btnSearch') });
        html = res.ok ? await res.text() : '';
        how = `POST ${res.status}`;
      }
      opentime = /chkPairing_/.test(html) ? { at: new Date().toISOString(), trips: parseOpenTime(html) }
        : { at: new Date().toISOString(), trips: [], err: `${how} · ${html.length}B · no list` };
    } catch (e) { opentime = { at: new Date().toISOString(), trips: [], err: String(e.message || e).slice(0, 80) }; }

    if (typeof CB_DONE === 'function') CB_DONE();
    const payload = { syncedAt: now.toISOString(), trips, releases, flows, raws, opentime, script: typeof CB_SCRIPT_VER === 'string' ? CB_SCRIPT_VER : 'bookmark' };
    if (!CB_EXEC) {
      say(`Done — ${trips.length} trips, ${Object.keys(releases).length} releases, ${Object.keys(flows).length} flows · returning to the app…`);
      const d = await pack(payload);
      setTimeout(() => { location.href = `${CB_RET}#d=${d}`; }, 1200);
      return;
    }
    say('Saving');
    const res = await fetch(CB_EXEC, { method: 'POST', body: JSON.stringify({ k: CB_KEY, payload }) });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'Save failed');
    say(`Done — ${trips.length} trips, ${Object.keys(releases).length} releases, ${Object.keys(flows).length} flows · returning to the app…`);
    setTimeout(() => { location.href = APP; }, 1200);
  } catch (e) {
    if (e.login && typeof CB_WAIT === 'function') return CB_WAIT(say);
    if (typeof CB_DONE === 'function') CB_DONE();
    say(`Failed: ${e.message}`);
  }
}

run();

})();