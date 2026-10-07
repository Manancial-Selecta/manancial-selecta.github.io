/* Imitação do login anônimo do Firebase: cada aba é uma pessoa (fica no sessionStorage). */
const KEY = 'mock-auth-user';
let cur = null;
try { cur = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { cur = null; }

export const __currentUser = () => cur;
export function getAuth(app) { return { app }; }
export function onAuthStateChanged(auth, cb) { setTimeout(() => cb(cur), 0); return () => {}; }
export async function signInAnonymously() {
  await new Promise(r => setTimeout(r, 10));
  if (window.__mockAuthDisabled) throw Object.assign(new Error('disabled'), { code: 'auth/operation-not-allowed' });
  if (window.__mockOffline) throw Object.assign(new Error('network'), { code: 'auth/network-request-failed' });
  cur = { uid: 'u' + Math.random().toString(36).slice(2, 10), isAnonymous: true };
  sessionStorage.setItem(KEY, JSON.stringify(cur));
  return { user: cur };
}
export async function signOut() { cur = null; sessionStorage.removeItem(KEY); }
