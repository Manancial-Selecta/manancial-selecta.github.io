/* Lê a mensagem da escala que a líder manda no grupo do WhatsApp */
import { noteInfo, keyByPc } from './music.js';
import { titleCase, pad2, isoOf, dObj, today, mergeNames } from './util.js';

export function parseKeyToken(t) {
  const m = /^([A-G])([#B]?)(M?)$/i.exec(t);
  if (!m) return '';
  const root = m[1].toUpperCase();
  const acc = m[2] === '#' ? '#' : m[2] ? 'b' : '';
  const pc = noteInfo(root + acc).pc;
  return keyByPc(pc, !!m[3]) || '';
}

export function parseSongText(p) {
  let s = String(p || '').trim();
  let key = '', version = '';
  const tm = /\bTOM(?:\s*:\s*|\s+)(?:DE\s+|EM\s+)?([A-G][#B]?M?)(?![A-Z0-9#])/i.exec(s);
  if (tm) { key = parseKeyToken(tm[1]); s = s.slice(0, tm.index) + s.slice(tm.index + tm[0].length); }
  const pm = /\(([^)]*)\)/.exec(s);
  if (pm) {
    version = pm[1].replace(/[-–—,]\s*$/, '').replace(/^\s*[-–—,]/, '').trim();
    s = s.slice(0, pm.index) + s.slice(pm.index + pm[0].length);
  }
  const title = s.replace(/[-–—:,]+\s*$/, '').replace(/\s+/g, ' ').trim();
  return { title, version, key };
}

export function inferDate(d, m, y) {
  if (y) { let yy = +y; if (yy < 100) yy += 2000; return isoOf(new Date(yy, m - 1, d)); }
  const t = dObj(today());
  let dt = new Date(t.getFullYear(), m - 1, d);
  if ((t - dt) / 86400000 > 60) dt = new Date(t.getFullYear() + 1, m - 1, d);
  return isoOf(dt);
}

function splitOutside(s, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && ch === sep) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
/* "OCEANOS + RENDIDO ESTOU" ou "OH QUÃO LINDO/FOGO NUNCA DORME" viram louvores emendados */
export function splitMedley(txt) {
  return splitOutside(txt, '+').flatMap(part => {
    const sub = splitOutside(part, '/');
    return sub.length > 1 && sub.every(x => (x.match(/\p{L}/gu) || []).length >= 4) ? sub : [part];
  });
}

export function parseReh(s) {
  const t = /(\d{1,2})\s*(?:[hH]|:)\s*(\d{2})?/.exec(s);
  if (!t || +t[1] > 23) return null;
  const dmm = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(s);
  return { date: dmm ? inferDate(+dmm[1], +dmm[2]) : '', time: pad2(+t[1]) + ':' + (t[2] || '00') };
}

export function splitNames(s) {
  return String(s || '').split(/\s*(?:,|\/|&|\+|\s+E\s+)\s*/i)
    .map(x => x.replace(/[^\p{L}\s'.-]/gu, '').trim())
    .filter(x => x.length >= 2 && x.split(/\s+/).length <= 4)
    .map(titleCase);
}

const ROLE_RE = /^(MINISTR[OA]S?|BACKS?|BACKINGS?|BACK\s*VOCALS?|VOCAL|VOZ(?:ES)?|TECLADOS?|PIANO|BAIXO|BATERIA|GUITARRA|VIOL[ÃA]O|SAX(?:OFONE)?|VIOLINO|CAJ[ÓO]N|PERCUSS[ÃA]O|M[ÍI]DIA|SOM|PROJE[ÇC][ÃA]O|DATA\s*SHOW|TRANSMISS[ÃA]O|LIVE|FOTOS?|FOTOGRAFIA)\s*:\s*(.+)$/i;
const NUM_RE = /^(\d{1,2})\s*[).:\-–]\s*([^\d\s].*)$/;
const DIZ_RE = /^(D[IÍ]ZIMOS?(?:\s+E\s+OFERTAS?)?|OFERTAS?|OFERT[OÓ]RIO)\s*:?\s*(.*)$/i;

export function parseMessage(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim());
  const res = { date: '', minister: '', kind: '', reh: null, items: [], diz: null, aviso: '', people: [] };
  for (const l of lines) {
    const m = /\bDIA\s+(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/i.exec(l);
    if (m) { res.date = inferDate(+m[1], +m[2], m[3]); break; }
  }
  if (!res.date) {
    for (const l of lines) {
      if (/^ENSAIO/i.test(l)) continue;
      const m = /(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?(?!\d)/.exec(l);
      if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) { res.date = inferDate(+m[1], +m[2], m[3]); break; }
    }
  }
  for (const l of lines) {
    const m = /^MINISTR[OA]S?\s*:?\s*(.+)$/i.exec(l);
    if (m) { res.minister = titleCase(m[1]); break; }
  }
  /* tipo do culto pelo título da mensagem */
  for (const l of lines) {
    if (!/ESCALA|LOUVORES|CULTO|\bDIA\s+\d/i.test(l)) continue;
    if (/\bCEIA\b/i.test(l)) { res.kind = 'ceia'; break; }
    if (/\bJOVENS\b|\bJUVENTUDE\b/i.test(l)) { res.kind = 'jovens'; break; }
    if (/\bMULHERES\b|\bFEMININO\b/i.test(l)) { res.kind = 'mulheres'; break; }
  }
  const addSongs = txt => {
    const parts = splitMedley(txt);
    let lastIt = null;
    parts.forEach((part, i) => {
      const it = parseSongText(part);
      it.join = i < parts.length - 1;
      it.obs = '';
      if (it.title) { res.items.push(it); lastIt = it; }
    });
    if (lastIt) lastIt.join = false;
    return lastIt;
  };
  const numbered = lines.some(l => NUM_RE.test(l));
  const secStart = lines.findIndex(l => /^LOUVORES\s*:?$/i.test(l));
  const people = [];
  let last = null, inSec = false, dizNext = false, beforeSongs = true;
  lines.forEach((l, i) => {
    if (!l) { if (inSec && res.items.length) inSec = false; return; }
    const en = /^ENSAIO\s*:?\s*(.*)$/i.exec(l);
    if (en) { res.reh = parseReh(en[1]); return; }
    const ob = /^OBS\.?\s*:\s*(.+)$/i.exec(l);
    if (ob && last) { last.obs = (last.obs ? last.obs + ' ' : '') + ob[1].trim(); return; }
    const dz = DIZ_RE.exec(l);
    if (dz) {
      inSec = false;
      if (dz[2]) { const it = parseSongText(dz[2]); if (it.title) { it.obs = ''; res.diz = it; last = it; } } else dizNext = true;
      return;
    }
    const av = /^(?:⚠️|⚠|AVISO\s*:?)\s*(.+)$/i.exec(l);
    if (av) { res.aviso = (res.aviso ? res.aviso + ' ' : '') + av[1].trim(); return; }
    const rl = ROLE_RE.exec(l);
    if (rl) { people.push(...splitNames(rl[2])); return; }
    if (beforeSongs && /^[•·]/.test(l)) { people.push(...splitNames(l.replace(/^[•·]\s*/, ''))); return; }
    if (dizNext && !NUM_RE.test(l) && !/:/.test(l)) {
      dizNext = false;
      const it = parseSongText(l.replace(/^[•·\-–—]\s*/, ''));
      if (it.title) { it.obs = ''; res.diz = it; last = it; }
      return;
    }
    if (numbered) {
      const n = NUM_RE.exec(l);
      if (n) { beforeSongs = false; last = addSongs(n[2]) || last; }
      return;
    }
    if (secStart >= 0) {
      if (i === secStart) { inSec = true; beforeSongs = false; return; }
      if (!inSec) return;
      if (/:/.test(l)) { inSec = false; return; }
      last = addSongs(l.replace(/^[•·\-–—]\s*/, '')) || last;
      return;
    }
    /* sem números e sem o título LOUVORES: cada linha simples vira um louvor */
    if (/:/.test(l) || /\d{1,2}\s*\/\s*\d{1,2}/.test(l) || /^(ESCALA|LOUVORES|INSTRUMENTISTAS|MINISTR|CIFRAS|HTTP)/i.test(l)) return;
    last = addSongs(l.replace(/^[-–—]\s*/, '')) || last;
  });
  res.people = mergeNames(people);
  /* "⚠️ ENSAIO HOJE AS 18HS" no fim da mensagem também vale como horário do ensaio */
  if (!res.reh && /\bENSAIO\b/i.test(res.aviso)) res.reh = parseReh(res.aviso);
  if (res.reh && !res.reh.date) res.reh.date = res.date;
  return res;
}
