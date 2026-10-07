/* ===== Teoria musical e cifras (funções puras) ===== */
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LPC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
const FLAT_KEYS = { F: 1, Bb: 1, Eb: 1, Ab: 1, Db: 1, Gb: 1, Dm: 1, Gm: 1, Cm: 1, Fm: 1, Bbm: 1, Ebm: 1 };
/* quantos "passos de letra" cada distância em semitons anda a partir da tônica */
const STEPS_MAJ = [0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
const STEPS_MIN = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
/* tons com formas abertas fáceis no violão (para sugerir capotraste) */
const EASY_KEYS = { C: 1, D: 1, E: 1, G: 1, A: 1, Am: 1, Em: 1, Dm: 1 };

const mod12 = n => ((n % 12) + 12) % 12;

function noteInfo(n) {
  const L = n[0];
  let a = 0;
  for (let i = 1; i < n.length; i++) {
    if (n[i] === '#') a++;
    else if (n[i] === 'b') a--;
  }
  return { L, a, pc: mod12(LPC[L] + a) };
}

function keyInfo(k) {
  const minor = /m$/.test(k);
  const n = noteInfo(minor ? k.slice(0, -1) : k);
  return { L: n.L, a: n.a, pc: n.pc, minor, name: k };
}

/* escreve uma nota (classe de altura) do jeito que um músico escreveria naquele tom */
function spell(key, pc) {
  const off = mod12(pc - key.pc);
  const steps = (key.minor ? STEPS_MIN : STEPS_MAJ)[off];
  const L = LETTERS[(LETTERS.indexOf(key.L) + steps) % 7];
  let a = mod12(pc - LPC[L]);
  if (a > 6) a -= 12;
  const odd = a > 1 || a < -1 || (a === 1 && (L === 'E' || L === 'B')) || (a === -1 && (L === 'F' || L === 'C'));
  if (odd) return (FLAT_KEYS[key.name] ? FLAT : SHARP)[pc];
  return L + (a === 1 ? '#' : a === -1 ? 'b' : '');
}

function keyByPc(pc, minor) {
  const list = minor ? MINOR_KEYS : MAJOR_KEYS;
  for (const k of list) if (keyInfo(k).pc === mod12(pc)) return k;
  return null;
}
function shiftKey(k, semis) {
  const ki = keyInfo(k);
  return keyByPc(ki.pc + semis, ki.minor);
}
function capoHint(k) {
  if (EASY_KEYS[k]) return null;
  for (let c = 1; c <= 7; c++) {
    const s = shiftKey(k, -c);
    if (EASY_KEYS[s]) return { capo: c, shape: s };
  }
  return null;
}

/* ---------- acordes ---------- */
const SUF_RE = /^(?:maj|min|dim|aug|sus|add|no|m|M|\+|-|°|º|ø|\d|\(|\)|#|b|\/|,|\.)*$/;
function parseChord(t) {
  const m = /^([A-G][#b]?)(.*)$/.exec(t);
  if (!m) return null;
  let suf = m[2], bass = null;
  const bm = /^(.*)\/([A-G][#b]?)$/.exec(suf);
  if (bm) { suf = bm[1]; bass = bm[2]; }
  if (!SUF_RE.test(suf)) return null;
  return { root: m[1], suf, bass };
}
function chordTok(t) {
  if (t.length > 2 && t[0] === '(' && t[t.length - 1] === ')') {
    const p = parseChord(t.slice(1, -1));
    if (p) { p.wrap = true; return p; }
  }
  return parseChord(t);
}
/* marcas que podem aparecer numa linha de acordes sem serem acordes: (2x), x2, |, %, N.C. */
const NEUTRAL_RE = /^(?:\(?\d+x\)?|\(?x\d+\)?|\|+:?|:?\|+|%|[-–—.*~/]+|N\.?C\.?)$/i;

function isTabLine(line) {
  return /^\s*[A-Ga-g][#b]?\s*\|/.test(line) && /-{2,}/.test(line) && /^[\sA-Ga-g#|\-\d/\\hpbrx~^.()*]+$/.test(line);
}

function analyzeLine(line) {
  if (!line.trim()) return { type: 'blank' };
  if (isTabLine(line)) return { type: 'tab' };
  let body = line, tag = null;
  const tm = /^(\s*)(\[[^\]]*\])(.*)$/.exec(line);
  if (tm) { tag = tm[2]; body = tm[3]; }
  const toks = body.trim() ? body.trim().split(/\s+/) : [];
  let ch = 0, other = 0;
  for (const t of toks) {
    if (NEUTRAL_RE.test(t)) continue;
    if (chordTok(t)) ch++; else other++;
  }
  if (ch > 0 && other === 0) return { type: 'chords', tag };
  if (tag && ch === 0 && other === 0) return { type: 'section', tag };
  return { type: 'lyric', tag };
}

/* converte o formato "[G]Letra" (acorde no meio da letra) para acorde em cima e letra embaixo */
function inlineToTwoLines(src) {
  return String(src || '').replace(/\r/g, '').split('\n').map(line => {
    if (!/\[[^\]]+\]/.test(line)) return line;
    const re = /\[([^\]]+)\]/g;
    let m, has = false;
    while ((m = re.exec(line))) { if (parseChord(m[1].trim())) { has = true; break; } }
    if (!has) return line;
    re.lastIndex = 0;
    let lyr = '', ch = '', last = 0;
    while ((m = re.exec(line))) {
      const inner = m[1].trim();
      if (!parseChord(inner)) continue;
      lyr += line.slice(last, m.index);
      last = m.index + m[0].length;
      let pos = lyr.length;
      if (ch.length && pos < ch.length + 1) pos = ch.length + 1;
      ch = ch.padEnd(pos, ' ') + inner;
    }
    lyr += line.slice(last);
    const out = [ch.replace(/\s+$/, '')];
    if (lyr.trim()) out.push(lyr.replace(/\s+$/, ''));
    return out.join('\n');
  }).join('\n');
}

function transposeTok(t, from, to) {
  const c = chordTok(t);
  if (!c) return t;
  const off = mod12(to.pc - from.pc);
  const r = spell(to, mod12(noteInfo(c.root).pc + off));
  const b = c.bass ? '/' + spell(to, mod12(noteInfo(c.bass).pc + off)) : '';
  const s = r + c.suf + b;
  return c.wrap ? '(' + s + ')' : s;
}

/* troca os acordes de uma linha mantendo cada um na mesma coluna (em cima da mesma sílaba) */
function mapChordLine(line, f) {
  let out = '';
  const tm = /^(\s*\[[^\]]*\])/.exec(line);
  const re = /\S+/g;
  if (tm) { out = tm[1]; re.lastIndex = tm[1].length; }
  let m;
  while ((m = re.exec(line))) {
    const t = m[0];
    const nt = (!NEUTRAL_RE.test(t) && chordTok(t)) ? f(t) : t;
    let pad = m.index - out.length;
    if (out.length && pad < 1) pad = 1;
    if (pad < 0) pad = 0;
    out += ' '.repeat(pad) + nt;
  }
  return out;
}

function processCifra(raw, fromK, toK) {
  const from = keyInfo(fromK), to = keyInfo(toK);
  return inlineToTwoLines(raw).split('\n').map(r => {
    const line = r.replace(/\t/g, '    ').replace(/\s+$/, '');
    const a = analyzeLine(line);
    if (a.type === 'chords') return { type: 'chords', text: mapChordLine(line, t => transposeTok(t, from, to)) };
    return { type: a.type, text: line };
  });
}

function chordsIn(text) {
  const out = [];
  inlineToTwoLines(text).split('\n').forEach(line => {
    const a = analyzeLine(line);
    if (a.type !== 'chords') return;
    const body = a.tag ? line.replace(/^\s*\[[^\]]*\]/, '') : line;
    body.trim().split(/\s+/).forEach(t => {
      if (NEUTRAL_RE.test(t)) return;
      const c = chordTok(t);
      if (!c) return;
      const q = /°|º|ø|dim/.test(c.suf) ? 'd' : (/^m(?!aj)/.test(c.suf) ? 'm' : 'M');
      out.push({ pc: noteInfo(c.root).pc, q });
    });
  });
  return out;
}
function countChordLines(text) {
  return inlineToTwoLines(text).split('\n').filter(l => analyzeLine(l).type === 'chords').length;
}

/* adivinha o tom pela cifra: acordes do campo harmônico + peso no primeiro e no último acorde */
function detectKey(text) {
  const cs = chordsIn(text);
  if (!cs.length) return null;
  const DIA = { 0: 'M', 2: 'm', 4: 'm', 5: 'M', 7: 'M', 9: 'm', 11: 'd' };
  let best = null;
  MAJOR_KEYS.concat(MINOR_KEYS).forEach(k => {
    const ki = keyInfo(k);
    const relMaj = ki.minor ? mod12(ki.pc + 3) : ki.pc;
    const tq = ki.minor ? 'm' : 'M';
    let s = 0;
    cs.forEach(c => {
      const want = DIA[mod12(c.pc - relMaj)];
      if (want === undefined) s -= 1;
      else s += (want === c.q ? 2 : 0.5);
    });
    const isT = c => c.pc === ki.pc && c.q === tq;
    if (isT(cs[0])) s += 3;
    if (isT(cs[cs.length - 1])) s += 4;
    s += cs.filter(isT).length * 0.5;
    if (!best || s > best.s) best = { k, s };
  });
  return best.k;
}

export {
  LETTERS, LPC, MAJOR_KEYS, MINOR_KEYS, mod12, noteInfo, keyInfo, spell, keyByPc, shiftKey, capoHint,
  parseChord, chordTok, NEUTRAL_RE, analyzeLine, inlineToTwoLines, transposeTok, processCifra,
  chordsIn, countChordLines, detectKey
};
