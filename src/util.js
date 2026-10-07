/* Utilidades gerais: DOM, texto, datas, armazenamento local */

export const $ = (s, el) => (el || document).querySelector(s);
export const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const normKey = s => norm(s).replace(/[^a-z0-9]/g, '');
export const UP = s => String(s || '').toLocaleUpperCase('pt-BR');
export const uid = p => (p || 's') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const byTitle = (a, b) => a.title.localeCompare(b.title, 'pt', { sensitivity: 'base' });
export const clone = o => JSON.parse(JSON.stringify(o));

export function storeGet(kind, k) { try { return window[kind].getItem(k); } catch (e) { return null; } }
export function storeSet(kind, k, v) { try { window[kind].setItem(k, v); } catch (e) { /* sem armazenamento */ } }
export function storeDel(kind, k) { try { window[kind].removeItem(k); } catch (e) { /* sem armazenamento */ } }

/* ===== Datas ===== */
export const pad2 = n => String(n).padStart(2, '0');
export const WD = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WD_UP = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
export const WD_HEAD = ['DO DOMINGO', 'DA SEGUNDA-FEIRA', 'DA TERÇA-FEIRA', 'DA QUARTA-FEIRA', 'DA QUINTA-FEIRA', 'DA SEXTA-FEIRA', 'DO SÁBADO'];
export const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MOL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
export const dObj = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const isoOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const addDays = (iso, n) => { const d = dObj(iso); d.setDate(d.getDate() + n); return isoOf(d); };
export const daysBetween = (a, b) => Math.round((dObj(b) - dObj(a)) / 86400000);
/* o app pode ficar aberto por dias: "hoje" é sempre calculado na hora */
export const today = () => isoOf(new Date());
export const wd = iso => WD[dObj(iso).getDay()];
export const wdShort = iso => wd(iso).slice(0, 3).toUpperCase();
export const dm = iso => { const d = dObj(iso); return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1); };
export const longDate = iso => { const d = dObj(iso); return wd(iso) + ', ' + d.getDate() + ' de ' + MOL[d.getMonth()]; };
export const relDay = iso => iso === today() ? 'Hoje' : iso === addDays(today(), 1) ? 'Amanhã' : '';
export const hm = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (+m[1]) + 'h' + m[2] : ''; };

/* ===== Nomes ===== */
export const SMALL_WORDS = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, em: 1, no: 1, na: 1, nos: 1, nas: 1, o: 1, a: 1, os: 1, as: 1, com: 1, por: 1 };
export function titleCase(s) {
  return String(s || '').trim().toLocaleLowerCase('pt-BR').split(/\s+/).map((w, i) =>
    (i > 0 && SMALL_WORDS[w]) ? w : w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1)
  ).join(' ');
}
export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(x => x && !SMALL_WORDS[x.toLowerCase()]);
  if (!w.length) return '';
  return UP(w[0].charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : ''));
}
export function mergeNames(...groups) {
  const map = new Map();
  groups.flat().forEach(n => { const t = String(n || '').trim(); if (t && !map.has(normKey(t))) map.set(normKey(t), t); });
  return [...map.values()];
}
