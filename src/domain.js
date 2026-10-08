/* Regras do ministério: tipos de culto, ensaio, cifras de violão e teclado, mensagem do WhatsApp */
import { detectKey, processCifra } from './music.js';
import { UP, dObj, dm, wd, hm, relDay, addDays, daysBetween, isIso, WD_UP, WD_HEAD, normKey } from './util.js';

/* ===== Tipos de culto ===== */
export const KINDS = { ceia: 'Culto de Ceia', jovens: 'Culto de Jovens', mulheres: 'Culto das Mulheres' };
export const KIND_CHIPS = [['', 'Comum'], ['ceia', 'Ceia'], ['jovens', 'Jovens'], ['mulheres', 'Mulheres'], ['outro', 'Outro']];
export const isFirstSunday = iso => { const d = dObj(iso); return d.getDay() === 0 && d.getDate() <= 7; };
/* todo primeiro domingo do mês é Culto de Ceia */
export const defaultKind = iso => isFirstSunday(iso) ? 'ceia' : '';
export const cultoName = l => l.kind === 'outro' ? (l.name || '').trim() : (KINDS[l.kind] || '');

/* ===== Ensaio ===== */
/* padrão: domingo 15h45 (inclusive Ceia) e sexta 19h00, no mesmo dia do culto */
export const REH_FIXED = { 0: '15:45', 5: '19:00' };
export const isFixedReh = (kind, iso) => (!kind || kind === 'ceia') && !!REH_FIXED[dObj(iso).getDay()];
export function rehKey(kind, name, iso) {
  if (kind === 'outro') return 'outro:' + normKey(name);
  if (kind && kind !== 'ceia') return kind;
  return 'wd' + dObj(iso).getDay();
}
export function defaultReh(iso, kind, name, prefs) {
  if (!isIso(iso)) return null;
  if (isFixedReh(kind, iso)) return { date: iso, time: REH_FIXED[dObj(iso).getDay()] };
  const p = prefs && prefs.reh ? prefs.reh[rehKey(kind, name, iso)] : null;
  return p && p.t ? { date: addDays(iso, p.d || 0), time: p.t } : null;
}
/* para Jovens, Mulheres e outros tipos, o app lembra o último horário usado */
export function rememberReh(prefs, l) {
  if (!l.reh || !l.reh.time || isFixedReh(l.kind, l.date)) return false;
  prefs.reh = prefs.reh || {};
  prefs.reh[rehKey(l.kind, l.name, l.date)] = { d: daysBetween(l.date, l.reh.date), t: l.reh.time };
  return true;
}
export function rehText(l) {
  const r = l.reh;
  if (!r || !r.time) return '';
  const rel = relDay(r.date);
  const when = rel ? rel.toLowerCase() + ' ' : (r.date && r.date !== l.date ? wd(r.date).toLowerCase() + ', ' + dm(r.date) + ' ' : '');
  return 'Ensaio ' + when + 'às ' + hm(r.time);
}

/* ===== Cifras: violão e teclado ===== */
export const INSTS = { gt: 'Violão', kb: 'Teclado' };
const filled = t => !!(t && String(t).trim());
export const hasCifra = so => !!(so && (filled(so.cifra) || filled(so.cifraKb) || filled(so.cifraS) || filled(so.cifraKbS)));
/* cifra simplificada (opcional) de cada instrumento */
export const hasSimple = (so, inst) => !!(so && filled(inst === 'kb' ? so.cifraKbS : so.cifraS));
/* a cifra do teclado é opcional: sem ela, o teclado usa a do violão.
   simple: usa a simplificada daquele instrumento, se houver */
export function cifraFor(so, inst, simple) {
  if (!so) return { text: '', key: null, fallback: false, simple: false };
  const pick = (t, k, fallback, s) => ({ text: so[t], key: so[k] || detectKey(so[t]), fallback, simple: !!s });
  if (simple && hasSimple(so, inst)) return inst === 'kb' ? pick('cifraKbS', 'keyKbS', false, true) : pick('cifraS', 'keyS', false, true);
  if (inst === 'kb' && filled(so.cifraKb)) return pick('cifraKb', 'keyKb', false);
  if (filled(so.cifra)) return pick('cifra', 'key', inst === 'kb');
  if (filled(so.cifraKb)) return pick('cifraKb', 'keyKb', inst === 'gt');
  /* só tem a simplificada */
  if (filled(so.cifraS)) return pick('cifraS', 'keyS', inst === 'kb', true);
  if (filled(so.cifraKbS)) return pick('cifraKbS', 'keyKbS', inst === 'gt', true);
  return { text: '', key: null, fallback: false, simple: false };
}

/* letra para quem canta: a colada no cadastro ou, sem ela, a da cifra sem os acordes.
   Volta linhas { t: 'sec' | 'ln' | 'blank', text } */
const NOTE_RE = /\b(capo|capotraste|afina[çc][ãa]o|tablatura|dedilhado|batida)\b/i;
export function lyricsOf(so) {
  if (!so) return { lines: [], auto: true };
  const out = [];
  const push = (t, text) => {
    if (t === 'blank' && (!out.length || out[out.length - 1].t === 'blank')) return;
    out.push({ t, text });
  };
  if (filled(so.letra)) {
    String(so.letra).replace(/\r/g, '').split('\n').forEach(line => {
      const l = line.replace(/\s+$/, '');
      const sec = /^\s*\[([^\]]+)\]\s*$/.exec(l);
      if (!l.trim()) push('blank', '');
      else if (sec) push('sec', sec[1].trim());
      else push('ln', l.trim());
    });
  } else {
    const src = [so.cifra, so.cifraKb, so.cifraS, so.cifraKbS].find(filled) || '';
    if (src) {
      processCifra(src, 'C', 'C').forEach(l => {
        if (l.type === 'blank') push('blank', '');
        else if (l.type === 'section') push('sec', l.text.trim().replace(/^\[([^\]]*)\].*$/, '$1').trim());
        else if (l.type === 'lyric') {
          const m = /^\s*\[([^\]]*)\]\s*(.*)$/.exec(l.text);
          if (m) { if (m[1].trim()) push('sec', m[1].trim()); if (m[2].trim()) push('ln', m[2].trim()); }
          else if (!NOTE_RE.test(l.text)) push('ln', l.text.trim());
        }
      });
    }
  }
  /* título de parte sem letra embaixo (Intro, Solo...) não serve para quem canta */
  const keep = out.filter((x, i) => {
    if (x.t !== 'sec') return true;
    for (let j = i + 1; j < out.length; j++) { if (out[j].t === 'ln') return true; if (out[j].t === 'sec') return false; }
    return false;
  });
  /* sem linha vazia logo depois do título nem duas seguidas */
  const fin = [];
  keep.forEach(x => { if (x.t === 'blank' && (!fin.length || fin[fin.length - 1].t !== 'ln')) return; fin.push(x); });
  while (fin.length && fin[fin.length - 1].t === 'blank') fin.pop();
  return { lines: fin, auto: !filled(so.letra) };
}
export function origKey(so) {
  if (!so) return null;
  if (so.key) return so.key;
  const c = cifraFor(so, 'gt');
  return c.key || null;
}
export const showKey = so => so.play || origKey(so) || '';

/* ===== Lista do culto ===== */
export const listSeq = l => l.items.concat(l.diz ? [l.diz] : []);
export function groupItems(items) {
  const groups = [];
  let cur = null;
  items.forEach(it => {
    if (!cur) { cur = [it]; groups.push(cur); } else cur.push(it);
    if (!it.join) cur = null;
  });
  return groups;
}
export function posOf(l, idx) {
  if (l.diz && idx === l.items.length) return { diz: true };
  let g = 0;
  for (let i = 0; i <= idx; i++) if (i === 0 || !l.items[i - 1].join) g++;
  const it = l.items[idx];
  return { g, n: groupItems(l.items).length, medley: !!(it.join || (idx > 0 && l.items[idx - 1].join)) };
}

/* ===== Mensagem do WhatsApp ===== */
export function itemText(it, songById) {
  const so = songById(it.songId);
  if (!so) return '';
  const v = (it.version || so.version || '').trim();
  if (it.key) return UP(so.title) + ' (' + (v ? UP(v) + ' - ' : '') + '*TOM ' + it.key + '* )';
  return UP(so.title) + (v ? ' (' + UP(v) + ')' : '');
}
export function waText(l, songById, appUrl) {
  const d = dObj(l.date), name = cultoName(l);
  const L = [`*LOUVORES ${WD_HEAD[d.getDay()]} DIA ${dm(l.date)}${name ? ' - ' + UP(name) : ''}*`];
  const top = [];
  if (l.minister) top.push(`*MINISTRO* : ${UP(l.minister)}`);
  if (l.reh && l.reh.time) top.push(`*ENSAIO* : ${WD_UP[dObj(l.reh.date).getDay()]} ${dm(l.reh.date)} ÀS ${UP(hm(l.reh.time))}`);
  if (top.length) L.push('', ...top);
  if (l.items.length) {
    L.push('');
    groupItems(l.items).forEach((g, i) => {
      L.push(`${i + 1}) ` + g.map(it => itemText(it, songById)).join(' + '));
      g.forEach(it => { if (it.obs) L.push('_Obs.: ' + it.obs + '_'); });
    });
  }
  if (l.diz) { L.push('', '*DÍZIMOS* : ' + itemText(l.diz, songById)); if (l.diz.obs) L.push('_Obs.: ' + l.diz.obs + '_'); }
  if (l.aviso) L.push('', '⚠️ ' + UP(l.aviso));
  L.push('', '*CIFRAS E VÍDEOS NO APP* :', appUrl + '#' + l.id);
  return L.join('\n');
}
