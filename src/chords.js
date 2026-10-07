/* Desenhos dos acordes: violão (formas conhecidas + busca) e teclado (notas do acorde).
   Escrita brasileira: C9 = C com nona (sem sétima), D4 = Dsus4, A2 = Asus2, A7M = maj7,
   B° = diminuto de 4 notas, Bm7(b5), E7(9), G/B... */
import { noteInfo, mod12, chordTok, NEUTRAL_RE, LETTERS, LPC } from './music.js';

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/* ===== Fórmula do acorde: [semitons, passos de letra] a partir da tônica ===== */
export function chordFormula(sufRaw) {
  let s = String(sufRaw || '').replace(/\s+/g, '');
  const f = { third: [4, 2], fifth: [7, 4], sev: null, six: false, ext: [], sus: null, power: false };
  let m;
  if ((m = /^(°|º|dim)/.exec(s))) {
    f.third = [3, 2]; f.fifth = [6, 4]; f.sev = [9, 6]; s = s.slice(m[0].length);
  } else if ((m = /^ø7?/.exec(s))) {
    f.third = [3, 2]; f.fifth = [6, 4]; f.sev = [10, 6]; s = s.slice(m[0].length);
  } else if ((m = /^(min|mi|m(?!aj)|-)/.exec(s))) {
    f.third = [3, 2]; s = s.slice(m[0].length);
  } else if ((m = /^(aug|\+)(?!\d)/.exec(s))) {
    f.fifth = [8, 4]; s = s.slice(m[0].length);
  }
  const RE = /maj9|maj7|M9|M7|7M|9M|7\+|add9|add2|add11|add4|add13|sus4|sus2|sus|b13|-13|#11|\+11|b9|-9|#9|\+9|b5|-5|#5|\+5|13|11|9|7|6|5|4|2|\+/g;
  while ((m = RE.exec(s))) {
    switch (m[0]) {
      case 'maj7': case 'M7': case '7M': case '7+': f.sev = [11, 6]; break;
      case 'maj9': case 'M9': case '9M': f.sev = [11, 6]; f.ext.push([14, 1]); break;
      case 'add9': case 'add2': case '9': f.ext.push([14, 1]); break;
      case 'add11': case '11': f.ext.push([17, 3]); break;
      case 'add4': f.ext.push([5, 3]); break;
      case 'add13': case '13': f.ext.push([21, 5]); break;
      case 'sus4': case 'sus': case '4': f.sus = [5, 3]; break;
      case 'sus2': case '2': f.sus = [2, 1]; break;
      case 'b13': case '-13': f.ext.push([20, 5]); break;
      case '#11': case '+11': f.ext.push([18, 3]); break;
      case 'b9': case '-9': f.ext.push([13, 1]); break;
      case '#9': case '+9': f.ext.push([15, 1]); break;
      case 'b5': case '-5': f.fifth = [6, 4]; break;
      case '#5': case '+5': case '+': f.fifth = [8, 4]; break;
      case '7': if (!f.sev) f.sev = [10, 6]; break;
      case '6': f.six = true; break;
      case '5': f.power = true; break;
      default: break;
    }
  }
  if (f.power) return { tones: [[0, 0], [7, 4]], required: [0, 7] };
  const third = f.sus || f.third;
  const all = [[0, 0], third, f.fifth];
  if (f.six) all.push([9, 5]);
  if (f.sev) all.push(f.sev);
  f.ext.forEach(e => all.push(e));
  const seen = new Set(), tones = [];
  all.forEach(t => { if (!seen.has(t[0])) { seen.add(t[0]); tones.push(t); } });
  tones.sort((a, b) => a[0] - b[0]);
  /* no violão dá para deixar de fora a quinta justa e as tensões do meio */
  const required = [0, third[0]];
  if (f.fifth[0] !== 7) required.push(f.fifth[0]);
  if (f.six) required.push(9);
  if (f.sev) required.push(f.sev[0]);
  if (f.ext.length) required.push(Math.max(...f.ext.map(e => e[0])));
  return { tones, required: [...new Set(required)] };
}

/* acorde escrito (ex.: "A/C#", "Bm7(b5)") → tônica, baixo, notas */
export function chordInfo(name) {
  const raw = String(name || '').trim().replace(/^\((.*)\)$/, '$1');
  const c = chordTok(raw);
  if (!c) return null;
  const f = chordFormula(c.suf);
  const rootPc = noteInfo(c.root).pc;
  const bassPc = c.bass ? noteInfo(c.bass).pc : rootPc;
  const slash = bassPc !== rootPc;
  const pcs = new Set(f.tones.map(t => mod12(rootPc + t[0])));
  const req = new Set(f.required.map(i => mod12(rootPc + i)));
  const qual = [...new Set(f.tones.map(t => mod12(t[0])))].sort((a, b) => a - b).join(',');
  const minor = f.tones.some(t => t[0] === 3) && !f.tones.some(t => t[0] === 4);
  return {
    name: raw, root: c.root, suf: c.suf, bass: slash ? c.bass : null, rootPc, bassPc, tones: f.tones, pcs, req, qual, minor,
    sig: rootPc + ':' + qual + (slash ? '/' + bassPc : '')
  };
}

/* nome da nota de cada intervalo (E° = E G Bb Db; C#7 = C# F G# B) */
const SIMPLE = { 'E#': 'F', 'B#': 'C', Fb: 'E', Cb: 'B' };
function spellTone(root, iv, st) {
  const L = LETTERS[(LETTERS.indexOf(root[0]) + st) % 7];
  const pc = mod12(noteInfo(root).pc + iv);
  let a = mod12(pc - LPC[L]);
  if (a > 6) a -= 12;
  const nm = a === 0 ? L : a === 1 ? L + '#' : a === -1 ? L + 'b' : (a > 0 ? SHARP : FLAT)[pc];
  return SIMPLE[nm] || nm;
}

/* ===== Violão ===== */
const TUNING = [40, 45, 50, 55, 59, 64]; /* MIDI: Mi grave → Mi agudo (cordas 6 → 1) */
const parseFrets = s => String(s).trim().split(s.length > 6 ? /\s+/ : '').map(c => (c === 'x' || c === 'X') ? -1 : +c);

/* formas conhecidas (cordas 6 → 1). Cada uma é conferida nos testes. */
const OPEN_SRC = {
  /* C */
  C: 'x32010', C7: 'x32310', C7M: 'x32000', C9: 'x32030', C6: 'x32210', C4: 'x33011', C2: 'x30033',
  'C7(9)': 'x32333', 'C6(9)': 'x32233', 'C+': 'x32110',
  'C/E': '032010', 'C/G': '332010', 'C/B': 'x22010', 'C/D': 'xx0010', 'C/Bb': 'x12010',
  /* D */
  D: 'xx0232', Dm: 'xx0231', D7: 'xx0212', Dm7: 'xx0211', D7M: 'xx0222', D4: 'xx0233', D2: 'xx0230', D9: 'xx0230',
  D6: 'xx0202', Dm6: 'xx0201', 'D7(4)': 'xx0213', 'D7(9)': 'x5455x',
  'D/F#': '200232', 'D/A': 'x00232', 'D/C': 'x30232', 'D/E': '0x0232', 'D/G': '3x0232',
  'Dm/C': 'x30231', 'Dm/F': 'xx3231',
  /* E */
  E: '022100', Em: '022000', E7: '020100', Em7: '020000', E7M: '021100', E4: '022200', E2: '024400', E9: '022102',
  Em9: '022002', E6: '022120', Em6: '022020', 'E7(4)': '020200', 'E7(9)': '020102', E5: '022xxx',
  'E/G#': '4x2100', 'E/B': 'x22100', 'E/D': 'xx0100', 'E/F#': '2x2100',
  'Em/B': 'x22000', 'Em/D': 'xx0000', 'Em/G': '3x2000',
  /* F */
  F7M: 'xx3210', F9: 'xx3213', 'F/A': 'x03211', 'F/C': 'x33211', 'F/G': '3x3211',
  'F#m7(11)': '2x2200', 'F#/A#': 'x1432x',
  /* G */
  G: '320003', G7: '320001', G7M: '320002', G9: '3x0203', G6: '320000', G4: '330013', G2: '3x0233', 'G7(4)': '3x3013',
  'G/B': 'x20003', 'G/D': 'xx0003', 'G/F#': '2x0003', 'G/F': '1x0003', 'G/A': 'x00003',
  /* A */
  A: 'x02220', Am: 'x02210', A7: 'x02020', Am7: 'x02010', A7M: 'x02120', A4: 'x02230', A2: 'x02200', A9: 'x02420',
  A6: 'x02222', Am6: 'x02212', Am9: 'x02410', 'A7(4)': 'x02030', 'A7(9)': 'x02423', A5: 'x022xx',
  'A/C#': 'x42220', 'A/E': '002220', 'A/G': '3x2220', 'A/G#': '4x2220', 'A/B': 'x22220',
  'Am/G': '3x2210', 'Am/C': 'x32210', 'Am/E': '002210', 'Am/F#': '2x2210',
  /* B */
  B7: 'x21202', Bm7: 'x20202', 'B7(9)': 'x2122x', 'Bm7(11)': 'x20200',
  'B/D#': 'x6444x', 'Bm/A': 'x04432', 'Bb/D': 'xx0331', 'Bb/F': 'xx3331'
};
/* no Brasil, "D9" costuma ser tocado sem a terça (xx0230) */
const LOOSE = new Set(['D9']);

const OPEN = new Map();
Object.entries(OPEN_SRC).forEach(([nm, sh]) => {
  const ci = chordInfo(nm);
  if (ci && !OPEN.has(ci.sig)) OPEN.set(ci.sig, { frets: parseFrets(sh), loose: LOOSE.has(nm) });
});
export const KNOWN_SHAPES = OPEN_SRC;

/* formas móveis (pestana): deslocamento de cada corda em relação à casa da tônica */
const N = null;
const TEMPLATES = {
  '0,4,7': [[0, [0, 2, 2, 1, 0, 0]], [1, [N, 0, 2, 2, 2, 0]], [2, [N, N, 0, 2, 3, 2]]],
  '0,3,7': [[0, [0, 2, 2, 0, 0, 0]], [1, [N, 0, 2, 2, 1, 0]], [2, [N, N, 0, 2, 3, 1]]],
  '0,4,7,10': [[0, [0, 2, 0, 1, 0, 0]], [1, [N, 0, 2, 0, 2, 0]], [2, [N, N, 0, 2, 1, 2]]],
  '0,3,7,10': [[0, [0, 2, 0, 0, 0, 0]], [1, [N, 0, 2, 0, 1, 0]], [2, [N, N, 0, 2, 1, 1]]],
  '0,4,7,11': [[0, [0, N, 1, 1, 0, N]], [1, [N, 0, 2, 1, 2, 0]], [2, [N, N, 0, 2, 2, 2]]],
  '0,5,7': [[0, [0, 2, 2, 2, 0, 0]], [1, [N, 0, 2, 2, 3, 0]], [2, [N, N, 0, 2, 3, 3]]],
  '0,2,7': [[1, [N, 0, 2, 2, 0, 0]], [2, [N, N, 0, 2, 3, 0]]],
  '0,5,7,10': [[0, [0, 2, 0, 2, 0, 0]], [1, [N, 0, 2, 0, 3, 0]], [2, [N, N, 0, 2, 1, 3]]],
  '0,3,6,10': [[0, [0, N, 0, 0, -1, N]], [1, [N, 0, 1, 0, 1, N]], [2, [N, N, 0, 1, 1, 1]]],
  '0,3,6,9': [[0, [0, N, -1, 0, -1, N]], [1, [N, 0, 1, -1, 1, N]], [2, [N, N, 0, 1, 0, 1]]],
  '0,7': [[0, [0, 2, 2, N, N, N]], [1, [N, 0, 2, 2, N, N]]],
  '0,4,7,9': [[0, [0, N, -1, 1, 0, N]], [1, [N, 0, 2, 2, 2, 2]], [2, [N, N, 0, 2, 0, 2]]],
  '0,3,7,9': [[0, [0, N, -1, 0, 0, N]], [1, [N, 0, 2, 2, 1, 2]], [2, [N, N, 0, 2, 0, 1]]],
  '0,2,4,7': [[1, [N, 0, -1, -3, 0, N]]],
  '0,2,3,7': [[1, [N, 0, -2, -3, 0, N]]],
  '0,2,4,7,10': [[0, [0, N, 0, 1, 0, 2]], [1, [N, 0, -1, 0, 0, N]]],
  '0,2,3,7,10': [[0, [0, N, 0, 0, 0, 2]], [1, [N, 0, -2, 0, 0, N]]],
  '0,2,4,7,11': [[1, [N, 0, -1, 1, 0, N]]],
  '0,4,8': [[1, [N, 0, -1, -2, -2, N]]],
  '0,2,4,7,9': [[1, [N, 0, -1, -1, 0, 0]]],
  '0,1,4,7,10': [[1, [N, 0, -1, 0, -1, N]]],
  '0,3,4,7,10': [[1, [N, 0, -1, 0, 1, N]]],
  '0,4,7,9,10': [[0, [0, N, 0, 1, 2, N]]],
  '0,3,5,7,10': [[1, [N, 0, 0, 0, 1, N]], [0, [0, N, 0, 0, -2, N]]]
};
function templateKeys(ci) {
  const out = new Set();
  (TEMPLATES[ci.qual] || []).forEach(([s, offs]) => {
    const r0 = mod12(ci.rootPc - TUNING[s]);
    [r0, r0 + 12].forEach(r => {
      const fr = offs.map(o => o === null ? -1 : r + o);
      if (fr.some((v, i) => offs[i] !== null && v < 0) || Math.max(...fr) > 15) return;
      out.add(fr.join(','));
    });
  });
  return out;
}

/* avalia uma forma: é tocável? quão fácil e cheia ela é? (menor = melhor) */
function judge(frets, ci, loose) {
  let low = -1;
  for (let s = 0; s < 6; s++) if (frets[s] >= 0) { low = s; break; }
  if (low < 0) return null;
  let high = 5;
  while (frets[high] < 0) high--;
  const count = new Map();
  let n = 0, interior = 0, opens = 0, fretted = 0, minF = 99, maxF = 0;
  for (let s = low; s <= high; s++) {
    const f = frets[s];
    if (f < 0) { interior++; continue; }
    n++;
    const pc = (TUNING[s] + f) % 12;
    count.set(pc, (count.get(pc) || 0) + 1);
    if (f === 0) opens++; else { fretted++; if (f < minF) minF = f; if (f > maxF) maxF = f; }
  }
  const top = 5 - high;
  if (n < 3 || interior > 1) return null;
  if ((TUNING[low] + frets[low]) % 12 !== ci.bassPc) return null;
  for (const p of count.keys()) if (!ci.pcs.has(p) && p !== ci.bassPc) return null;
  for (const p of ci.req) if (!count.has(p) && !(loose && p !== ci.rootPc)) return null;
  if (ci.bass && !count.has(ci.rootPc)) return null;
  if (!fretted) { minF = 0; maxF = 0; }
  const span = maxF - minF;
  if (span > 3) return null;
  if (opens && maxF > 5) return null;
  let fingers = fretted, barre = null;
  if (fretted > 4) {
    /* com 5 ou 6 notas presas e abertura de 3 casas, a nota mais grave tem de ser do indicador (ex.: Bsus4 x24452) */
    if (span === 3 && frets[low] !== minF) return null;
    /* pestana: o indicador deitado na casa mais baixa, ou um dedo deitado nas cordas de cima (ex.: C7(9) x32333);
       embaixo dela não pode haver corda solta, abafada ou presa numa casa mais baixa */
    let best = null;
    const vals = [...new Set(frets.filter(f => f > 0))].sort((a, b) => a - b);
    for (const bf of vals) {
      let from = -1, to = -1, under = 0;
      if (bf === minF) {
        for (let k = low; k <= high; k++) if (frets[k] === bf) { if (from < 0) from = k; to = k; }
      } else {
        if (frets[high] !== bf) continue;
        to = high;
        from = high;
        while (from - 1 >= low && frets[from - 1] >= bf) from--;
        while (frets[from] !== bf) from++;
      }
      if (to <= from) continue;
      let ok = true;
      for (let k = from; k <= to; k++) { if (frets[k] < bf) ok = false; else if (frets[k] === bf) under++; }
      if (!ok) continue;
      const fg = fretted - under + 1;
      if (fg <= 4 && (!best || fg < best.fg)) best = { fg, barre: { fret: bf, from, to } };
    }
    if (!best) {
      /* sem pestana: cordas vizinhas na mesma casa podem ser presas por um dedo só (ex.: Bm6 x24434) */
      let segs = 0;
      for (let k = low; k <= high; k++) if (frets[k] > 0 && !(k > low && frets[k - 1] === frets[k])) segs++;
      if (segs > 4 || span === 3) return null;
      best = { fg: segs, barre: null };
    }
    fingers = best.fg;
    barre = best.barre;
  }
  let tripled = 0;
  count.forEach((v, p) => { if (v >= 3 && p !== ci.rootPc && p !== ci.bassPc) tripled++; });
  let score = minF * 1.6 + [0, 0, 0.8, 2.5][span] + fingers * 0.7 + (6 - n) * 1.5 + (n === 3 ? 1.5 : 0) + interior * 2 + top * 1.2 + (barre ? 1.2 : 0) + tripled * 0.8;
  if (minF <= 3) score -= opens * 0.5;
  return { frets: frets.slice(), score, barre, minF, maxF, n };
}

function searchShapes(ci) {
  const tones = new Set(ci.pcs);
  tones.add(ci.bassPc);
  const tpl = ci.bass ? new Set() : templateKeys(ci);
  const found = new Map();
  for (let w = 0; w <= 12; w++) {
    const cands = TUNING.map(open => {
      const list = [-1];
      if (w <= 3 && tones.has(open % 12)) list.push(0);
      for (let f = Math.max(1, w); f <= w + 3; f++) if (tones.has((open + f) % 12)) list.push(f);
      return list;
    });
    const frets = new Array(6);
    const rec = (s, started) => {
      if (s === 6) {
        if (!started) return;
        const key = frets.join(',');
        if (found.has(key)) return;
        const r = judge(frets, ci, false);
        if (!r) return;
        if (tpl.has(key)) r.score -= 10; /* forma de pestana conhecida */
        found.set(key, r);
        return;
      }
      if (!started && s > 3) return; /* precisa de pelo menos 3 cordas */
      for (const f of cands[s]) {
        if (!started && f >= 0 && (TUNING[s] + f) % 12 !== ci.bassPc) continue;
        frets[s] = f;
        rec(s + 1, started || f >= 0);
      }
    };
    rec(0, false);
  }
  return [...found.values()].sort((a, b) => a.score - b.score);
}

/* lista de formas: a mais conhecida primeiro, depois outras posições no braço */
const shapeCache = new Map();
export function guitarShapes(name, max) {
  const key = String(name || '').trim().replace(/^\((.*)\)$/, '$1');
  let all = shapeCache.get(key);
  if (!all) {
    all = [];
    const ci = chordInfo(key);
    if (ci) {
      const known = OPEN.get(ci.sig);
      if (known) {
        const r = judge(known.frets, ci, known.loose);
        if (r) all.push(r);
      }
      let found = searchShapes(ci);
      if (ci.bass && found.length) {
        /* acorde com baixo: prefere a forma do acorde sem o baixo, só acrescentando ou trocando a nota grave */
        const base = guitarShapes(ci.root + ci.suf, 1)[0];
        if (base) {
          const baseN = base.frets.filter(f => f >= 0).length;
          found.forEach(r => {
            let diff = 0, same = 0;
            for (let s = 0; s < 6; s++) {
              if (base.frets[s] < 0) continue;
              if (r.frets[s] === base.frets[s]) same++;
              else if (r.frets[s] >= 0) diff++;
            }
            r.score += diff ? diff * 1.2 : (same >= baseN - 1 ? -10 : 0);
          });
          found = found.sort((a, b) => a.score - b.score);
        }
      }
      const seen = new Set(all.map(r => r.frets.join(',')));
      found.forEach(r => { if (!seen.has(r.frets.join(','))) all.push(r); });
    }
    shapeCache.set(key, all);
  }
  const lim = max || 3;
  const out = [];
  for (const r of all) {
    if (out.length >= lim) break;
    if (out.every(o => Math.abs(o.minF - r.minF) >= 2)) out.push(r);
  }
  return out.map(r => ({ name: key, frets: r.frets, barre: r.barre, minF: r.minF, maxF: r.maxF }));
}
export const guitarShape = name => guitarShapes(name, 1)[0] || null;

/* ===== Teclado: notas do acorde em posição fechada ===== */
export function keyboardNotes(name) {
  const ci = chordInfo(name);
  if (!ci) return null;
  const notes = [];
  let base = ci.rootPc;
  if (ci.bass) {
    notes.push({ n: ci.bassPc, bass: true });
    if (base <= ci.bassPc) base += 12;
  }
  ci.tones.forEach(t => notes.push({ n: base + t[0], bass: false }));
  const names = [];
  if (ci.bass) names.push(SIMPLE[ci.bass] || ci.bass);
  ci.tones.forEach(t => { const nm = spellTone(ci.root, t[0], t[1]); if (!names.includes(nm)) names.push(nm); });
  return { name: ci.name, notes, names };
}

/* ===== Acordes da cifra, na ordem em que aparecem ===== */
export function chordsOfLines(lines) {
  const seen = new Set(), out = [];
  lines.forEach(l => {
    if (l.type !== 'chords') return;
    l.text.replace(/^\s*\[[^\]]*\]/, '').trim().split(/\s+/).forEach(t => {
      if (!t || NEUTRAL_RE.test(t) || !chordTok(t)) return;
      const nm = t.replace(/^\((.*)\)$/, '$1');
      if (!seen.has(nm)) { seen.add(nm); out.push(nm); }
    });
  });
  return out;
}

/* ===== Desenhos (SVG) ===== */
const escX = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function guitarSVG(name, shape) {
  const sh = shape === undefined ? guitarShape(name) : shape;
  const W = 80, H = 104;
  const head = `<svg class="dg gt" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escX(name)} no violão">`;
  const title = `<text class="dg-n" x="${W / 2}" y="12" text-anchor="middle">${escX(name)}</text>`;
  if (!sh) return head + title + `<text class="dg-q" x="${W / 2}" y="62" text-anchor="middle">?</text></svg>`;
  const x0 = 15, dx = 11, y0 = 30, dy = 14, rows = 5;
  const start = sh.maxF <= 4 ? 1 : sh.minF;
  let g = '';
  for (let i = 0; i <= rows; i++) g += `<line class="dg-l" x1="${x0}" y1="${y0 + i * dy}" x2="${x0 + 5 * dx}" y2="${y0 + i * dy}"/>`;
  for (let s = 0; s < 6; s++) g += `<line class="dg-l" x1="${x0 + s * dx}" y1="${y0}" x2="${x0 + s * dx}" y2="${y0 + rows * dy}"/>`;
  if (start === 1) g += `<rect class="dg-nut" x="${x0 - 1}" y="${y0 - 3}" width="${5 * dx + 2}" height="3.5" rx="1"/>`;
  else g += `<text class="dg-f" x="${x0 - 4}" y="${y0 + dy * 0.5 + 3.5}" text-anchor="end">${start}</text>`;
  sh.frets.forEach((f, s) => {
    const cx = x0 + s * dx;
    if (f < 0) g += `<text class="dg-x" x="${cx}" y="${y0 - 6}" text-anchor="middle">×</text>`;
    else if (f === 0) g += `<circle class="dg-o" cx="${cx}" cy="${y0 - 9}" r="2.8"/>`;
  });
  if (sh.barre) {
    const yy = y0 + (sh.barre.fret - start + 0.5) * dy;
    g += `<rect class="dg-dot" x="${x0 + sh.barre.from * dx - 4.5}" y="${yy - 4.5}" width="${(sh.barre.to - sh.barre.from) * dx + 9}" height="9" rx="4.5"/>`;
  }
  sh.frets.forEach((f, s) => {
    if (f <= 0) return;
    if (sh.barre && f === sh.barre.fret && s >= sh.barre.from && s <= sh.barre.to) return;
    g += `<circle class="dg-dot" cx="${x0 + s * dx}" cy="${y0 + (f - start + 0.5) * dy}" r="4.5"/>`;
  });
  return head + title + g + '</svg>';
}

export function keyboardSVG(name) {
  const kb = keyboardNotes(name);
  if (!kb) return `<svg class="dg kb" viewBox="0 0 128 84" width="128" height="84"><text class="dg-n" x="64" y="12" text-anchor="middle">${escX(name)}</text><text class="dg-q" x="64" y="52" text-anchor="middle">?</text></svg>`;
  const lo = Math.floor(Math.min(...kb.notes.map(x => x.n)) / 12);
  let hi = Math.floor(Math.max(...kb.notes.map(x => x.n)) / 12);
  if (hi - lo < 1) hi = lo + 1;
  const octs = hi - lo + 1;
  const ww = 9, wh = 44, bw = 6, bh = 27, y0 = 19;
  const W = octs * 7 * ww + 2, H = y0 + wh + 17;
  const on = new Map(kb.notes.map(x => [x.n - lo * 12, x.bass ? 'bass' : 'on']));
  const WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]];
  let g = '';
  for (let o = 0; o < octs; o++) {
    WHITE.forEach((pc, i) => {
      const st = on.get(o * 12 + pc);
      g += `<rect class="kw${st ? ' ' + st : ''}" x="${1 + (o * 7 + i) * ww}" y="${y0}" width="${ww}" height="${wh}" rx="1.5"/>`;
    });
  }
  for (let o = 0; o < octs; o++) {
    BLACK.forEach(([pc, i]) => {
      const st = on.get(o * 12 + pc);
      g += `<rect class="kb-k${st ? ' ' + st : ''}" x="${1 + (o * 7 + i + 1) * ww - bw / 2}" y="${y0}" width="${bw}" height="${bh}" rx="1"/>`;
    });
  }
  return `<svg class="dg kb" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escX(name)} no teclado: ${escX(kb.names.join(', '))}">` +
    `<text class="dg-n" x="${W / 2}" y="12" text-anchor="middle">${escX(name)}</text>` + g +
    `<text class="dg-t" x="${W / 2}" y="${H - 4}" text-anchor="middle">${escX(kb.names.join(' · '))}</text></svg>`;
}
