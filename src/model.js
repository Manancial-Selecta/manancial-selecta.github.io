/* Formato dos dados: louvores, cultos e preferências (igual ao protótipo, mais a cifra de teclado) */
import { defaultKind, defaultReh } from './domain.js';
import { isIso, mergeNames } from './util.js';

const str = v => (v == null ? '' : String(v));
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function normSong(s) {
  const o = obj(s);
  const bpm = o.bpm ? Math.round(Number(o.bpm)) || null : null;
  const keys = {};
  Object.entries(obj(o.keys)).forEach(([k, e]) => { if (e && e.k) keys[k] = { n: str(e.n), k: str(e.k) }; });
  return {
    id: str(o.id),
    title: str(o.title).trim(),
    version: str(o.version),
    play: str(o.play),
    key: str(o.key),
    bpm,
    yt: str(o.yt),
    cifra: str(o.cifra),
    cifraKb: str(o.cifraKb),
    keyKb: str(o.keyKb),
    keys,
    up: Number(o.up) || 0,
    by: str(o.by)
  };
}

export function normItem(it) {
  const o = obj(it);
  return { songId: str(o.songId), key: str(o.key), version: str(o.version), obs: str(o.obs), join: !!o.join, mode: o.mode === 'manual' ? 'manual' : 'auto' };
}

export function normList(l, prefs) {
  const o = obj(l);
  const date = isIso(o.date) ? o.date : '';
  const kind = typeof o.kind === 'string' ? o.kind : (date ? defaultKind(date) : '');
  const name = str(o.name);
  let reh = o.reh === undefined ? (date ? defaultReh(date, kind, name, prefs) : null) : o.reh;
  if (reh && !(typeof reh.time === 'string' && /^\d{1,2}:\d{2}$/.test(reh.time))) reh = null;
  if (reh) reh = { date: isIso(reh.date) ? reh.date : date, time: reh.time };
  return {
    id: str(o.id),
    date,
    minister: str(o.minister),
    kind,
    name,
    reh,
    aviso: str(o.aviso),
    items: Array.isArray(o.items) ? o.items.filter(it => it && it.songId).map(normItem) : [],
    diz: o.diz && o.diz.songId ? normItem(o.diz) : null,
    up: Number(o.up) || 0,
    by: str(o.by)
  };
}

export function normMeta(m) {
  const o = obj(m);
  const reh = {};
  Object.entries(obj(obj(o.prefs).reh)).forEach(([k, v]) => { if (v && v.t) reh[k] = { d: Number(v.d) || 0, t: str(v.t) }; });
  return { people: Array.isArray(o.people) ? mergeNames(o.people) : [], prefs: { reh } };
}

/* dados exportados do protótipo → formato do app */
export function fromPrototype(d) {
  const src = obj(d);
  const meta = normMeta({ people: src.people, prefs: src.prefs });
  return {
    songs: (Array.isArray(src.songs) ? src.songs : []).map(normSong).filter(s => s.id && s.title),
    lists: (Array.isArray(src.lists) ? src.lists : []).map(l => normList(l, meta.prefs)).filter(l => l.id && l.date),
    meta
  };
}

/* o que vai para o banco: sem campos internos */
export function songDoc(s) { const o = normSong(s); delete o.by; return o; }
export function listDoc(l) { const o = normList(l, null); delete o.by; return o; }

export const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
