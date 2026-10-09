/* Dados compartilhados em tempo real (Firebase).
   - Cada pessoa entra uma vez com o código do ministério e o nome (login anônimo do Firebase).
   - Louvores e cultos ficam guardados no aparelho: abrem na hora e funcionam sem internet.
   - Ao abrir, só baixa o que mudou desde a última vez (economiza a cota gratuita).
   - O que alguém altera aparece na hora para todos. */
import { normSong, normList, normMeta, normEsc, escDoc, fromPrototype, songDoc, listDoc, sameJSON } from './model.js';
import { storeGet, storeSet, storeDel, today } from './util.js';
import { normCode } from './store-local.js';

export const FIREBASE_VERSION = '12.19.0';
const BASE = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
export const FIREBASE_URLS = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => BASE + f);

const ME_KEY = 'lm-me';
const SYNC_KEY = col => 'lm-sync-' + col;
const COUNT_KEY = 'lm-sync-count';
const OPEN_KEY = 'lm-log-open';
const DAY = 864e5;
const err = (code, cause) => Object.assign(new Error(code), { code, cause });
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(err('timeout')), ms))]);

export function createFirebaseStore(cfg) {
  let A = null, F = null, auth = null, db = null, user = null;
  let me = readMe();
  const state = { songs: new Map(), lists: new Map(), escala: new Map(), meta: normMeta({}) };
  const subs = new Set(), statusSubs = new Set();
  const status = { online: navigator.onLine !== false, pending: 0, synced: false, revoked: false, failed: 0 };
  const syncMax = { songs: 0, lists: 0, escala: 0 };
  let unsubs = [], started = false, flushT = null, changed = new Set(), changedRemote = false;

  function readMe() {
    try { const m = JSON.parse(storeGet('localStorage', ME_KEY) || 'null'); return m && m.uid && m.name ? m : null; } catch (e) { return null; }
  }
  function saveMe(m) {
    me = m;
    if (m) storeSet('localStorage', ME_KEY, JSON.stringify(m)); else storeDel('localStorage', ME_KEY);
  }
  function emitStatus() { const s = Object.assign({}, status); statusSubs.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } }); }
  window.addEventListener('online', () => { status.online = true; emitStatus(); });
  window.addEventListener('offline', () => { status.online = false; status.synced = false; emitStatus(); });

  function view() {
    return { songs: [...state.songs.values()], lists: [...state.lists.values()], escala: [...state.escala.values()], people: state.meta.people.slice(), prefs: JSON.parse(JSON.stringify(state.meta.prefs)) };
  }
  function flush(remote) {
    if (remote) changedRemote = true;
    if (flushT) return;
    flushT = setTimeout(() => {
      flushT = null;
      if (!changed.size) return;
      const c = changed, r = changedRemote;
      changed = new Set();
      changedRemote = false;
      const v = view();
      subs.forEach(fn => { try { fn(v, { changed: c, remote: r }); } catch (e) { console.error(e); } });
    }, 30);
  }

  async function load() {
    if (A) return;
    let mods;
    try { mods = await Promise.all(FIREBASE_URLS.map(u => import(u))); } catch (e) { throw err('load', e); }
    const appM = mods[0];
    A = mods[1];
    F = mods[2];
    const app = appM.initializeApp(cfg);
    auth = A.getAuth(app);
    try {
      db = F.initializeFirestore(app, {
        localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager(), cacheSizeBytes: F.CACHE_SIZE_UNLIMITED })
      });
    } catch (e) {
      db = F.initializeFirestore(app, { localCache: F.memoryLocalCache() });
    }
    user = await new Promise(res => { const off = A.onAuthStateChanged(auth, u => { off(); res(u); }); });
  }
  async function ensureAuth() {
    if (user) return user;
    if (navigator.onLine === false) throw err('offline');
    try {
      const c = await withTimeout(A.signInAnonymously(auth), 20000);
      user = c.user;
      return user;
    } catch (e) {
      const c = (e && e.code) || '';
      throw err(c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation' ? 'auth-disabled' : (c === 'auth/network-request-failed' || c === 'timeout') ? 'offline' : 'auth', e);
    }
  }

  /* ----- leitura ----- */
  function upsert(col, snap) {
    const d = snap.data({ serverTimestamps: 'estimate' });
    if (!d) return;
    const map = state[col];
    if (d.deleted) { if (map.delete(snap.id)) changed.add(snap.id); return; }
    const o = col === 'songs' ? normSong(Object.assign({}, d, { id: snap.id })) : col === 'escala' ? normEsc(Object.assign({}, d, { id: snap.id })) : normList(Object.assign({}, d, { id: snap.id }), state.meta.prefs);
    if (!sameJSON(map.get(o.id), o)) { map.set(o.id, o); changed.add(o.id); }
  }
  /* "since" é lido ANTES do que está guardado: assim nada que chegou no meio do caminho fica de fora */
  async function loadCache(since) {
    try {
      const [s, l] = await Promise.all(['songs', 'lists'].map(c => F.getDocsFromCache(F.collection(db, c))));
      s.forEach(d => upsert('songs', d));
      l.forEach(d => upsert('lists', d));
      try { (await F.getDocsFromCache(F.collection(db, 'escala'))).forEach(d => upsert('escala', d)); } catch (e) { since.escala = 0; }
      try { const m = await F.getDocFromCache(F.doc(db, 'meta', 'app')); if (m.exists()) state.meta = normMeta(m.data()); } catch (e) { /* ainda não guardado */ }
      /* se o aparelho perdeu parte do que estava guardado, baixa tudo de novo */
      const had = Number(storeGet('localStorage', COUNT_KEY) || 0);
      if (s.size + l.size < had) { since.songs = 0; since.lists = 0; since.escala = 0; }
    } catch (e) {
      since.songs = 0;
      since.lists = 0;
      since.escala = 0;
    }
    changed.add('meta');
    flush(true);
  }
  function onListenError(e) {
    /* acesso removido: para de ouvir; ao entrar de novo com o código, volta a sincronizar */
    if (e && e.code === 'permission-denied') { stop(); status.revoked = true; emitStatus(); }
  }
  function listen(since) {
    /* a própria entrada: nome, administrador e acesso removido aparecem na hora */
    if (me) {
      const uid0 = me.uid;
      unsubs.push(F.onSnapshot(F.doc(db, 'members', uid0), snap => {
        if (!me || me.uid !== uid0) return;
        if (!snap.exists()) {
          if (!snap.metadata.fromCache) { stop(); status.revoked = true; emitStatus(); }
          return;
        }
        const d = snap.data() || {};
        /* "administrador" só vale depois que o servidor confirmar (senha errada não pisca como administrador) */
        const nm = { uid: uid0, name: d.name || me.name, admin: snap.metadata.hasPendingWrites ? me.admin : !!d.admin };
        if (nm.name !== me.name || nm.admin !== me.admin) { saveMe(nm); changed.add('me'); flush(true); }
      }, onListenError));
    }
    ['songs', 'lists', 'escala'].forEach(col => {
      syncMax[col] = since[col];
      /* margem de 5 minutos: o que outra pessoa salvou bem perto da última sincronização não fica de fora */
      const from = Math.max(0, syncMax[col] - 300000);
      const q = F.query(F.collection(db, col), F.where('at', '>', F.Timestamp.fromMillis(from)));
      unsubs.push(F.onSnapshot(q, { includeMetadataChanges: true }, snap => {
        snap.docChanges().forEach(ch => {
          if (ch.type === 'removed') return; /* sair da consulta não é exclusão; excluir usa "deleted" */
          upsert(col, ch.doc);
          const at = ch.doc.get('at');
          if (at && typeof at.toMillis === 'function' && !ch.doc.metadata.hasPendingWrites) syncMax[col] = Math.max(syncMax[col], at.toMillis());
        });
        if (!snap.metadata.fromCache) {
          storeSet('localStorage', SYNC_KEY(col), String(syncMax[col]));
          storeSet('localStorage', COUNT_KEY, String(state.songs.size + state.lists.size));
        }
        status.synced = !snap.metadata.fromCache;
        emitStatus();
        flush(true);
      }, col === 'escala' ? () => {} : onListenError));
    });
    unsubs.push(F.onSnapshot(F.doc(db, 'meta', 'app'), snap => {
      if (!snap.exists()) return;
      const m = normMeta(snap.data());
      if (!sameJSON(m, state.meta)) { state.meta = m; changed.add('meta'); flush(true); }
    }, onListenError));
  }
  function start() {
    if (started) return;
    started = true;
    status.revoked = false;
    const since = { songs: Number(storeGet('localStorage', SYNC_KEY('songs')) || 0), lists: Number(storeGet('localStorage', SYNC_KEY('lists')) || 0), escala: Number(storeGet('localStorage', SYNC_KEY('escala')) || 0) };
    loadCache(since).then(() => { if (started) listen(since); });
  }
  function stop() {
    unsubs.forEach(u => { try { u(); } catch (e) { /* ok */ } });
    unsubs = [];
    started = false;
  }

  /* ----- escrita: aparece na hora na tela e vai para o servidor (ou fica na fila sem internet) ----- */
  /* lotes pequenos (cada gravação confere se a pessoa é membro; o Firebase limita essas conferências por envio)
     e todos entregues de uma vez: o Firebase guarda a fila no aparelho mesmo se o app for fechado sem internet */
  async function runWrites(writes) {
    const batches = [];
    for (let i = 0; i < writes.length; i += 10) {
      const b = F.writeBatch(db);
      writes.slice(i, i + 10).forEach(w => { if (w.merge) b.set(w.ref, w.data, { merge: true }); else b.set(w.ref, w.data); });
      batches.push(b);
    }
    status.pending += batches.length;
    emitStatus();
    await Promise.all(batches.map(b => b.commit().catch(e => {
      console.error(e);
      status.failed = (status.failed || 0) + 1; /* acesso removido é avisado pela própria entrada (members) */
    }).finally(() => { status.pending--; emitStatus(); })));
  }
  function commit(ops) {
    const x = ops || {};
    const by = me ? me.name : '';
    const at = F.serverTimestamp();
    const writes = [];
    (x.songs || []).forEach(s => {
      const so = normSong(Object.assign({}, s, { by }));
      if (!sameJSON(state.songs.get(so.id), so)) changed.add(so.id);
      state.songs.set(so.id, so);
      writes.push({ ref: F.doc(db, 'songs', so.id), data: Object.assign(songDoc(so), { by, at, deleted: false }) });
    });
    (x.lists || []).forEach(l => {
      const li = normList(Object.assign({}, l, { by }), state.meta.prefs);
      if (!sameJSON(state.lists.get(li.id), li)) changed.add(li.id);
      state.lists.set(li.id, li);
      writes.push({ ref: F.doc(db, 'lists', li.id), data: Object.assign(listDoc(li), { by, at, deleted: false }) });
    });
    (x.escala || []).forEach(e => {
      const es = normEsc(Object.assign({}, e, { by }));
      if (!sameJSON(state.escala.get(es.id), es)) changed.add(es.id);
      state.escala.set(es.id, es);
      writes.push({ ref: F.doc(db, 'escala', es.id), data: Object.assign(escDoc(es), { by, at, deleted: false }) });
    });
    (x.delEscala || []).forEach(id => {
      if (state.escala.delete(id)) changed.add(id);
      writes.push({ ref: F.doc(db, 'escala', id), data: { deleted: true, by, at }, merge: true });
    });
    (x.delSongs || []).forEach(id => {
      if (state.songs.delete(id)) changed.add(id);
      writes.push({ ref: F.doc(db, 'songs', id), data: { deleted: true, by, at }, merge: true });
    });
    (x.delLists || []).forEach(id => {
      if (state.lists.delete(id)) changed.add(id);
      writes.push({ ref: F.doc(db, 'lists', id), data: { deleted: true, by, at }, merge: true });
    });
    const people = (x.people || []).filter(Boolean);
    const reh = x.reh && Object.keys(x.reh).length ? x.reh : null;
    if (people.length || reh) {
      const meta = { at };
      if (people.length) { meta.people = F.arrayUnion(...people); state.meta = normMeta({ people: state.meta.people.concat(people), prefs: state.meta.prefs }); }
      if (reh) { meta.prefs = { reh }; Object.assign(state.meta.prefs.reh, reh); }
      writes.push({ ref: F.doc(db, 'meta', 'app'), data: meta, merge: true });
      changed.add('meta');
    }
    flush(false);
    return writes.length ? runWrites(writes) : Promise.resolve();
  }

  /* ----- histórico: quem abriu o app e o que foi alterado (só o administrador lê) ----- */
  function writeLog(t, what) {
    if (!me || !db) return Promise.resolve();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return F.setDoc(F.doc(db, 'log', id), { uid: me.uid, by: String(me.name || '').slice(0, 60), t, what: String(what || '').slice(0, 300), at: F.serverTimestamp() })
      .catch(e => console.warn('histórico', e && e.code));
  }

  return {
    mode: 'firebase',
    async init() {
      await load();
      if (user && me && me.uid === user.uid) { start(); return 'ready'; }
      if (user) {
        try {
          const s = await withTimeout(F.getDoc(F.doc(db, 'members', user.uid)), 12000);
          if (s.exists()) { const d = s.data(); saveMe({ uid: user.uid, name: d.name, admin: !!d.admin }); start(); return 'ready'; }
        } catch (e) { /* sem internet ou ainda não é membro */ }
      }
      saveMe(null);
      return 'join';
    },
    me: () => me,
    view,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    onStatus(fn) { statusSubs.add(fn); fn(Object.assign({}, status)); return () => statusSubs.delete(fn); },
    synced: () => status.synced,
    async isConfigured() {
      await load();
      await ensureAuth();
      try { const s = await withTimeout(F.getDoc(F.doc(db, 'config', 'public')), 12000); return s.exists(); } catch (e) { return null; }
    },
    async join(code, name0) {
      const name = String(name0 || '').slice(0, 60);
      await load();
      await ensureAuth();
      const c = normCode(code);
      if (!c) throw err('bad-code');
      const ref = F.doc(db, 'members', user.uid);
      try {
        const cur = await withTimeout(F.getDoc(ref), 12000);
        if (cur.exists()) {
          saveMe({ uid: user.uid, name: cur.data().name, admin: !!cur.data().admin });
          if (cur.data().name !== name) await this.rename(name);
          status.revoked = false;
          start();
          return;
        }
      } catch (e) { /* ainda não é membro: segue */ }
      try {
        await withTimeout(F.setDoc(ref, { name, code: c, admin: false, at: F.serverTimestamp() }), 20000);
      } catch (e) {
        if (e && e.code === 'permission-denied') {
          const ok = await this.isConfigured().catch(() => null);
          throw err(ok === false ? 'not-configured' : 'bad-code', e);
        }
        throw err(e && e.code === 'timeout' ? 'offline' : 'unknown', e);
      }
      saveMe({ uid: user.uid, name, admin: false });
      storeSet('localStorage', OPEN_KEY, today());
      writeLog('join', 'Entrou no app pela primeira vez');
      status.revoked = false;
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ok */ }
      start();
    },
    async setup(code, name0, seed) {
      const name = String(name0 || '').slice(0, 60);
      await load();
      await ensureAuth();
      const c = normCode(code);
      if (c.length < 6) throw err('short-code');
      const b = F.writeBatch(db);
      b.set(F.doc(db, 'members', user.uid), { name, code: c, admin: true, at: F.serverTimestamp() });
      b.set(F.doc(db, 'config', 'access'), { code: c, by: user.uid, at: F.serverTimestamp() });
      b.set(F.doc(db, 'config', 'public'), { ready: true, at: F.serverTimestamp() });
      try { await withTimeout(b.commit(), 20000); } catch (e) {
        if (e && e.code === 'permission-denied') throw err('already-configured', e);
        throw err(e && e.code === 'timeout' ? 'offline' : 'unknown', e);
      }
      saveMe({ uid: user.uid, name, admin: true });
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ok */ }
      start();
      if (seed) await this.importSeed(seed);
      else await runWrites([{ ref: F.doc(db, 'meta', 'app'), data: { people: [], prefs: { reh: {} }, at: F.serverTimestamp() }, merge: true }]);
    },
    async rename(name0) {
      const name = String(name0 || '').slice(0, 60);
      if (!me) return;
      await withTimeout(F.setDoc(F.doc(db, 'members', me.uid), { name }, { merge: true }), 20000).catch(e => { throw err(e && e.code === 'timeout' ? 'offline' : 'unknown', e); });
      saveMe(Object.assign({}, me, { name }));
    },
    async leave() {
      stop();
      saveMe(null);
      ['songs', 'lists', 'escala'].forEach(c => storeDel('localStorage', SYNC_KEY(c)));
      storeDel('localStorage', COUNT_KEY);
      try { await A.signOut(auth); } catch (e) { /* ok */ }
      try { await F.terminate(db); await F.clearIndexedDbPersistence(db); } catch (e) { /* ok */ }
    },
    async adminCode() {
      if (!me) return null;
      try { const s = await F.getDoc(F.doc(db, 'members', me.uid)); return s.exists() ? s.data().code || null : null; } catch (e) { return null; }
    },
    async changeCode(code) {
      const c = normCode(code);
      if (c.length < 6) throw err('short-code');
      const b = F.writeBatch(db);
      b.set(F.doc(db, 'config', 'access'), { code: c, by: me.uid, at: F.serverTimestamp() });
      b.set(F.doc(db, 'members', me.uid), { code: c }, { merge: true });
      try { await withTimeout(b.commit(), 20000); } catch (e) { throw err(e && e.code === 'timeout' ? 'offline' : (e && e.code) || 'unknown', e); }
      writeLog('edit', 'Mudou o código do ministério');
    },
    async importSeed(raw) {
      const d = fromPrototype(raw);
      writeLog('edit', 'Importou os dados do protótipo');
      return commit({ songs: d.songs, lists: d.lists, people: d.meta.people, reh: d.meta.prefs.reh });
    },
    log: what => writeLog('edit', what),
    logOpen() {
      if (!me || storeGet('localStorage', OPEN_KEY) === today()) return;
      storeSet('localStorage', OPEN_KEY, today());
      writeLog('open', 'Abriu o app');
    },
    async history(days) {
      const from = F.Timestamp.fromMillis(Date.now() - days * DAY);
      let snap;
      try { snap = await withTimeout(F.getDocs(F.query(F.collection(db, 'log'), F.where('at', '>', from))), 20000); } catch (e) {
        throw err(e && e.code === 'permission-denied' ? 'not-admin' : (e && e.code === 'timeout') || navigator.onLine === false ? 'offline' : 'unknown', e);
      }
      const out = [];
      snap.forEach(d => { const x = d.data({ serverTimestamps: 'estimate' }) || {}; out.push({ id: d.id, at: x.at && x.at.toMillis ? x.at.toMillis() : 0, by: x.by || '', uid: x.uid || '', t: x.t || 'edit', what: x.what || '' }); });
      out.sort((a, b) => b.at - a.at);
      /* o que passou de 8 dias é apagado (não precisa ficar guardado) */
      F.getDocs(F.query(F.collection(db, 'log'), F.where('at', '<', F.Timestamp.fromMillis(Date.now() - 8 * DAY)))).then(old => {
        const ids = [];
        old.forEach(d => ids.push(d.id));
        for (let i = 0; i < ids.length && i < 200; i += 10) {
          const b = F.writeBatch(db);
          ids.slice(i, i + 10).forEach(id => b.delete(F.doc(db, 'log', id)));
          b.commit().catch(() => {});
        }
      }).catch(() => {});
      return out;
    },
    /* ----- senha de administrador: quem souber vira administrador pelo próprio app ----- */
    async adminPass() {
      if (!me) return null;
      try { const s = await F.getDoc(F.doc(db, 'config', 'admin')); return s.exists() ? s.data().pass || null : ''; } catch (e) { return null; }
    },
    async setAdminPass(pass) {
      const c = normCode(pass);
      if (c.length < 6) throw err('short-pass');
      const b = F.writeBatch(db);
      b.set(F.doc(db, 'config', 'admin'), { pass: c, by: me.uid, at: F.serverTimestamp() });
      b.set(F.doc(db, 'members', me.uid), { adminPass: c }, { merge: true });
      try { await withTimeout(b.commit(), 20000); } catch (e) { throw err(e && e.code === 'timeout' ? 'offline' : (e && e.code) || 'unknown', e); }
      writeLog('edit', 'Mudou a senha de administrador');
    },
    async becomeAdmin(pass) {
      const c = normCode(pass);
      if (!c) throw err('bad-pass');
      if (navigator.onLine === false) throw err('offline');
      try { await withTimeout(F.setDoc(F.doc(db, 'members', me.uid), { admin: true, adminPass: c }, { merge: true }), 20000); } catch (e) {
        throw err(e && e.code === 'permission-denied' ? 'bad-pass' : e && e.code === 'timeout' ? 'offline' : 'unknown', e);
      }
      saveMe(Object.assign({}, me, { admin: true }));
      writeLog('edit', 'Entrou como administrador');
    },
    commit
  };
}
