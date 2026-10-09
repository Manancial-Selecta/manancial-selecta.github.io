/* Imitação do Firestore só para os testes.
   - "Servidor": localStorage 'mock-fs-db' (todas as abas veem o mesmo), avisos por BroadcastChannel.
   - "Cache do aparelho": localStorage 'mock-fs-cache'.
   - Regras: as mesmas ideias de firestore.rules (membro, código, administrador).
   - Sem internet: window.__mockOffline = true (gravações esperam; leituras vêm do cache). */
import { __currentUser } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const DBKEY = 'mock-fs-db', CACHEKEY = 'mock-fs-cache';
const SERVER_TS = { __sts: true };
const listeners = new Set();
/* o "servidor" vai junto com o aviso: o localStorage entre abas pode chegar atrasado */
let mem = null;
let bc = null;
try {
  bc = new BroadcastChannel('mock-fs');
  bc.onmessage = e => { if (e.data && e.data.db && (!mem || (e.data.db.__v || 0) > (mem.__v || 0))) mem = e.data.db; listeners.forEach(fn => fn()); };
} catch (e) { bc = null; }
window.__mockReads = 0;
window.__mockSetOnline = () => { window.__mockOffline = false; waiting.splice(0).forEach(r => r()); listeners.forEach(fn => fn()); };
const waiting = [];
const tick = () => new Promise(r => setTimeout(r, 5));
const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

export class Timestamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  static fromMillis(ms) { return new Timestamp(ms); }
}
export const CACHE_SIZE_UNLIMITED = -1;
export const persistentLocalCache = o => ({ kind: 'persistent', o });
export const persistentMultipleTabManager = () => ({});
export const memoryLocalCache = () => ({ kind: 'memory' });
export function initializeFirestore(app) { return { app }; }
export const doc = (db, col, id) => ({ type: 'doc', path: col + '/' + id, id, col });
export const collection = (db, col) => ({ type: 'col', col });
export const where = (field, op, value) => ({ field, op, value });
export const query = (c, ...filters) => ({ type: 'query', col: c.col, filters });
export const serverTimestamp = () => SERVER_TS;
export const arrayUnion = (...items) => ({ __union: items });
export async function terminate() {}
export async function clearIndexedDbPersistence() { localStorage.removeItem(CACHEKEY); }

function load() {
  let ls = {};
  try { ls = JSON.parse(localStorage.getItem(DBKEY) || '{}'); } catch (e) { ls = {}; }
  const best = mem && (mem.__v || 0) >= (ls.__v || 0) ? mem : ls;
  return JSON.parse(JSON.stringify(best));
}
const save = db => { mem = db; localStorage.setItem(DBKEY, JSON.stringify(db)); };
const cacheAll = () => { try { return JSON.parse(localStorage.getItem(CACHEKEY) || '{}'); } catch (e) { return {}; } };
function cacheSet(path, d) { const c = cacheAll(); c[path] = d === undefined ? null : d; localStorage.setItem(CACHEKEY, JSON.stringify(c)); }

/* ----- regras (resumo de firestore.rules) ----- */
const uidNow = () => { const u = __currentUser(); return u ? u.uid : null; };
const member = (db, u) => !!(u && db['members/' + u]);
function canRead(db, path) {
  const u = uidNow();
  if (!u) return false;
  const [col, id] = path.split('/');
  if (col === 'config') return id === 'public' || (id === 'admin' && member(db, u) && db['members/' + u].admin === true);
  if (col === 'members') return id === u; /* cada pessoa lê só a própria entrada */
  if (col === 'log') return member(db, u) && db['members/' + u].admin === true;
  return member(db, u);
}
function canWrite(before, after, path, u) {
  if (!u) return false;
  const [col, id] = path.split('/');
  const nd = after[path];
  if (col === 'config' && id === 'access') {
    if (!before[path]) return !!(after['members/' + u] && after['members/' + u].admin === true && typeof nd.code === 'string' && nd.code.length >= 6 && nd.by === u);
    return member(before, u) && before['members/' + u].admin === true && typeof nd.code === 'string' && nd.code.length >= 6;
  }
  if (col === 'config' && id === 'public') return !!(after['members/' + u] && after['members/' + u].admin === true);
  if (col === 'config' && id === 'admin') return member(before, u) && before['members/' + u].admin === true && typeof nd.pass === 'string' && nd.pass.length >= 6 && nd.by === u;
  if (col === 'escala') return member(before, u) && before['members/' + u].admin === true;
  if (col === 'log') {
    if (!nd) return member(before, u) && before['members/' + u].admin === true; /* apagar */
    if (before[path]) return false;
    return member(before, u) && nd.uid === u && Object.keys(nd).every(k => ['uid', 'by', 't', 'what', 'at'].includes(k))
      && nd.by === before['members/' + u].name && typeof nd.what === 'string' && nd.what.length <= 300 && ['open', 'edit', 'join'].includes(nd.t) && !!(nd.at && nd.at.__ts);
  }
  if (col === 'members') {
    if (id !== u) return false;
    if (!nd || typeof nd.name !== 'string' || !nd.name || nd.name.length > 60) return false;
    const old = before[path];
    if (!old) {
      if (!Object.keys(nd).every(k => ['name', 'code', 'admin', 'at'].includes(k))) return false;
      const acc = before['config/access'];
      if (acc) return nd.admin === false && nd.code === acc.code;
      return nd.admin === true && !!after['config/access'] && after['config/access'].code === nd.code;
    }
    if (!Object.keys(nd).every(k => ['name', 'code', 'admin', 'at', 'adminPass'].includes(k))) return false;
    const passAfter = (after['config/admin'] || {}).pass, passBefore = (before['config/admin'] || {}).pass;
    const same = nd.admin === old.admin
      && (nd.code === old.code || (old.admin === true && nd.code === (after['config/access'] || {}).code))
      && ((nd.adminPass || '') === (old.adminPass || '') || (old.admin === true && nd.adminPass === passAfter));
    const promote = old.admin === false && nd.admin === true && nd.code === old.code && passBefore !== undefined && nd.adminPass === passBefore;
    return same || promote;
  }
  return member(before, u);
}

/* ----- gravação ----- */
let lastTs = 0;
function resolve(v, now) {
  if (v === SERVER_TS) return { __ts: now };
  if (v instanceof Timestamp) return { __ts: v.ms };
  if (Array.isArray(v)) return v.map(x => resolve(x, now));
  if (v && typeof v === 'object' && !v.__union) { const o = {}; Object.keys(v).forEach(k => { if (v[k] !== undefined) o[k] = resolve(v[k], now); }); return o; }
  return v;
}
const isMap = v => v && typeof v === 'object' && !Array.isArray(v) && !('__ts' in v) && !v.__union;
function merge(old, upd) {
  const out = Object.assign({}, old || {});
  Object.keys(upd).forEach(k => {
    const v = upd[k];
    if (v && v.__union) out[k] = [...new Set([...(Array.isArray(out[k]) ? out[k] : []), ...v.__union])];
    else if (isMap(v)) out[k] = merge(isMap(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  });
  return out;
}
async function commitWrites(writes) {
  if (window.__mockOffline) await new Promise(r => waiting.push(r));
  await tick();
  const before = load(), after = JSON.parse(JSON.stringify(before));
  /* hora do "servidor": sempre anda para frente, para todas as abas */
  const now = lastTs = Math.max(Date.now(), lastTs + 1, (before.__last || 0) + 1);
  after.__last = now;
  after.__v = (before.__v || 0) + 1;
  writes.forEach(w => { if (w.del) { delete after[w.path]; return; } const data = resolve(w.data, now); after[w.path] = w.merge ? merge(after[w.path], data) : merge({}, data); });
  const u = uidNow();
  for (const w of writes) if (!canWrite(before, after, w.path, u)) throw denied();
  save(after);
  writes.forEach(w => cacheSet(w.path, after[w.path]));
  if (bc) bc.postMessage({ db: after });
  listeners.forEach(fn => fn());
}
export const setDoc = (ref, data, opts) => commitWrites([{ path: ref.path, data, merge: !!(opts && opts.merge) }]);
export function writeBatch() {
  const writes = [];
  return {
    set(ref, data, opts) { writes.push({ path: ref.path, data, merge: !!(opts && opts.merge) }); return this; },
    delete(ref) { writes.push({ path: ref.path, del: true }); return this; },
    commit() { return commitWrites(writes); }
  };
}

/* ----- leitura ----- */
function toClient(v) {
  if (Array.isArray(v)) return v.map(toClient);
  if (v && typeof v === 'object') { if ('__ts' in v) return new Timestamp(v.__ts); const o = {}; Object.keys(v).forEach(k => { o[k] = toClient(v[k]); }); return o; }
  return v;
}
function snap(ref, d, fromCache) {
  const has = d !== undefined && d !== null;
  return { id: ref.id, ref, exists: () => has, data: () => (has ? toClient(d) : undefined), get: f => (has ? toClient(d[f]) : undefined), metadata: { hasPendingWrites: false, fromCache: !!fromCache } };
}
export async function getDoc(ref) {
  if (window.__mockOffline) {
    const c = cacheAll();
    if (ref.path in c) return snap(ref, c[ref.path], true);
    throw Object.assign(new Error('offline'), { code: 'unavailable' });
  }
  await tick();
  const db = load();
  if (!canRead(db, ref.path)) throw denied();
  window.__mockReads++;
  cacheSet(ref.path, db[ref.path]);
  return snap(ref, db[ref.path]);
}
export async function getDocFromCache(ref) {
  const c = cacheAll();
  if (!(ref.path in c)) throw Object.assign(new Error('not cached'), { code: 'unavailable' });
  return snap(ref, c[ref.path], true);
}
export async function getDocsFromCache(c) {
  const all = cacheAll(), out = [];
  Object.keys(all).forEach(p => { if (p.startsWith(c.col + '/') && all[p]) out.push(snap({ path: p, id: p.split('/')[1] }, all[p], true)); });
  return { size: out.length, docs: out, forEach: fn => out.forEach(fn) };
}
const matches = (d, filters) => (filters || []).every(f => f.field === 'at' && f.op === '>' ? !!(d && d.at && d.at.__ts > f.value.ms) : f.field === 'at' && f.op === '<' ? !!(d && d.at && d.at.__ts < f.value.ms) : true);
export async function getDocs(q) {
  if (window.__mockOffline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
  await tick();
  const db = load();
  if (!canRead(db, q.col + '/x')) throw denied();
  const out = [];
  Object.keys(db).forEach(p => { if (p.startsWith(q.col + '/') && db[p] && matches(db[p], q.filters)) out.push(snap({ path: p, id: p.split('/')[1] }, db[p])); });
  window.__mockReads += Math.max(1, out.length);
  return { size: out.length, docs: out, forEach: fn => out.forEach(fn) };
}
export function onSnapshot(target, a, b, c) {
  let next, error;
  if (typeof a === 'function') { next = a; error = b; } else { next = b; error = c; }
  let alive = true, started = false;
  const seen = new Map();
  const deliver = () => {
    if (!alive || window.__mockOffline) return;
    const db = load();
    const probe = target.type === 'doc' ? target.path : target.col + '/x';
    if (!canRead(db, probe)) { alive = false; if (error) error(denied()); return; }
    if (target.type === 'doc') {
      const d = db[target.path], j = JSON.stringify(d === undefined ? null : d);
      if (started && seen.get(target.path) === j) return;
      started = true;
      seen.set(target.path, j);
      window.__mockReads++;
      cacheSet(target.path, d);
      next(snap(target, d));
      return;
    }
    const changes = [];
    Object.keys(db).forEach(p => {
      if (!p.startsWith(target.col + '/')) return;
      const d = db[p];
      if (!matches(d, target.filters)) return;
      const j = JSON.stringify(d);
      if (seen.get(p) === j) return;
      changes.push({ type: seen.has(p) ? 'modified' : 'added', doc: snap({ path: p, id: p.split('/')[1] }, d) });
      seen.set(p, j);
      cacheSet(p, d);
    });
    window.__mockReads += Math.max(1, changes.length);
    if (!changes.length && started) return;
    started = true;
    next({ docChanges: () => changes, metadata: { fromCache: false, hasPendingWrites: false }, size: changes.length });
  };
  setTimeout(deliver, 5);
  listeners.add(deliver);
  return () => { alive = false; listeners.delete(deliver); };
}
