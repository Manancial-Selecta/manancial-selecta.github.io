/* Modo demonstração (sem Firebase): os dados ficam só neste aparelho.
   Serve para a prévia e para os testes. Abas abertas no mesmo aparelho se atualizam juntas. */
import { normSong, normList, normMeta, fromPrototype, sameJSON } from './model.js';
import { clone, storeGet, storeSet, storeDel, uid, mergeNames } from './util.js';

const DATA_KEY = 'lm-demo-data', ME_KEY = 'lm-demo-me', CODE_KEY = 'lm-demo-code';
const err = code => Object.assign(new Error(code), { code });
export const normCode = c => String(c || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function createLocalStore(opts) {
  const o = opts || {};
  const seed = fromPrototype(o.seed || {});
  const demoCode = normCode(o.demoCode || 'manancial');
  const subs = new Set(), statusSubs = new Set();
  let state = load();
  let bc = null;
  try {
    bc = new BroadcastChannel('lm-demo');
    bc.onmessage = () => {
      const prev = state;
      state = load();
      const changed = new Set();
      ['songs', 'lists'].forEach(col => {
        const ids = new Set([...prev[col].keys(), ...state[col].keys()]);
        ids.forEach(id => { if (!sameJSON(prev[col].get(id), state[col].get(id))) changed.add(id); });
      });
      if (!sameJSON(prev.meta, state.meta)) changed.add('meta');
      if (changed.size) emit(changed, true);
    };
  } catch (e) { bc = null; }

  function load() {
    let raw = null;
    try { raw = JSON.parse(storeGet('localStorage', DATA_KEY) || 'null'); } catch (e) { raw = null; }
    const src = raw && Array.isArray(raw.songs) ? fromPrototype(raw) : clone(seed);
    return { songs: new Map(src.songs.map(s => [s.id, s])), lists: new Map(src.lists.map(l => [l.id, l])), meta: src.meta };
  }
  function save() {
    storeSet('localStorage', DATA_KEY, JSON.stringify({ songs: [...state.songs.values()], lists: [...state.lists.values()], people: state.meta.people, prefs: state.meta.prefs }));
    if (bc) { try { bc.postMessage('x'); } catch (e) { /* ok */ } }
  }
  /* se o navegador não deixar guardar nada, vale a memória enquanto a página estiver aberta */
  let memMe, memCode = null;
  function readMe() {
    if (memMe !== undefined) return memMe;
    try { const m = JSON.parse(storeGet('localStorage', ME_KEY) || 'null'); return m && m.uid && m.name ? m : null; } catch (e) { return null; }
  }
  function setMe(m) { memMe = m || null; if (m) storeSet('localStorage', ME_KEY, JSON.stringify(m)); else storeDel('localStorage', ME_KEY); }
  const code = () => memCode || storeGet('localStorage', CODE_KEY) || demoCode;
  const setCode = c => { memCode = c; storeSet('localStorage', CODE_KEY, c); };
  function view() {
    return { songs: [...state.songs.values()], lists: [...state.lists.values()], people: state.meta.people.slice(), prefs: clone(state.meta.prefs) };
  }
  function emit(changed, remote) {
    const v = view();
    subs.forEach(fn => { try { fn(v, { changed, remote }); } catch (e) { console.error(e); } });
  }

  function commit(ops) {
    const x = ops || {}, changed = new Set(), by = (readMe() || {}).name || '';
    (x.songs || []).forEach(s => { const so = normSong(Object.assign({}, s, { by })); state.songs.set(so.id, so); changed.add(so.id); });
    (x.lists || []).forEach(l => { const li = normList(Object.assign({}, l, { by }), state.meta.prefs); state.lists.set(li.id, li); changed.add(li.id); });
    (x.delSongs || []).forEach(id => { if (state.songs.delete(id)) changed.add(id); });
    (x.delLists || []).forEach(id => { if (state.lists.delete(id)) changed.add(id); });
    if ((x.people || []).length) { state.meta.people = mergeNames(state.meta.people, x.people); changed.add('meta'); }
    if (x.reh) { Object.assign(state.meta.prefs.reh, x.reh); changed.add('meta'); }
    save();
    if (changed.size) emit(changed, false);
    return Promise.resolve();
  }

  return {
    mode: 'local',
    demoCode,
    async init() { return readMe() ? 'ready' : 'join'; },
    me: readMe,
    view,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    onStatus(fn) { statusSubs.add(fn); fn({ online: true, pending: 0, synced: true }); return () => statusSubs.delete(fn); },
    synced: () => true,
    async isConfigured() { return !!(memCode || storeGet('localStorage', CODE_KEY)); },
    async join(c, name) {
      if (normCode(c) !== normCode(code())) throw err('bad-code');
      setMe({ uid: uid('u'), name, admin: false });
    },
    async setup(c, name, seedData) {
      if (normCode(c).length < 6) throw err('short-code');
      setCode(normCode(c));
      setMe({ uid: uid('u'), name, admin: true });
      if (seedData) await this.importSeed(seedData);
    },
    async rename(name) { const m = readMe(); if (m) setMe(Object.assign({}, m, { name })); },
    async leave() { setMe(null); },
    async adminCode() { return code(); },
    async changeCode(c) {
      if (normCode(c).length < 6) throw err('short-code');
      setCode(normCode(c));
    },
    async importSeed(raw) {
      const d = fromPrototype(raw);
      return commit({ songs: d.songs, lists: d.lists, people: d.meta.people, reh: d.meta.prefs.reh });
    },
    commit
  };
}
