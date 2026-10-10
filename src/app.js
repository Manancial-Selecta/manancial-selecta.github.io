/* ===== Louvores Manancial — app do ministério Adoração & Artes Manancial Selecta =====
   Abas Cultos e Louvores; página do culto (o link do WhatsApp abre aqui); louvor com vídeo em cima e
   cifra embaixo (violão ou teclado, com os desenhos dos acordes); editores do culto e do louvor.
   Todos os membros podem editar. Os dados vêm do armazenamento: Firebase (real) ou demonstração. */
import { MAJOR_KEYS, MINOR_KEYS, keyInfo, keyByPc, shiftKey, capoHint, chordTok, NEUTRAL_RE, analyzeLine, inlineToTwoLines, processCifra, countChordLines, detectKey } from './music.js';
import { $, $$, esc, norm, normKey, byTitle, clone, storeGet, storeSet, uid, isIso, dObj, isoOf, today, addDays, wd, wdShort, dm, longDate, relDay, hm, MO, titleCase, initials, mergeNames, daysBetween } from './util.js';
import { parseMessage } from './parse.js';
import { KIND_CHIPS, defaultKind, cultoName, REH_FIXED, isFixedReh, rehKey, defaultReh, rehText, hasCifra, hasSimple, cifraFor, lyricsOf, origKey, showKey, listSeq, groupItems, posOf, waText } from './domain.js';
import { guitarShapes, guitarSVG, keyboardSVG, keyboardNotes, chordsOfLines } from './chords.js';
import { ytId, ytWatch, ytThumb, ytEmbed, ytSearch } from './youtube.js';
import { ICON } from './icons.js';
import { createLocalStore } from './store-local.js';
import { EFN, songLabel, escNew, escLabel, daysOf, monName, listFor, viewOf, listFromView, dayMsg, monthMsg, headHTML, navHTML as escNavHTML, fieldsHTML, cultoEditHTML, readCultoHTML, gridHTML, mineHTML, weekListHTML, rolesOf, eid, dateSelectHTML, monthImage } from './escala-ui.js';

/* ===== Estado ===== */
const S = {
  tab: 'cultos', q: '', ready: false,
  inst: storeGet('localStorage', 'lm-inst') === 'kb' ? 'kb' : 'gt',
  chords: storeGet('localStorage', 'lm-chords') !== '0',
  letra: storeGet('localStorage', 'lm-letra') === '1',
  simple: storeGet('localStorage', 'lm-simple') === '1',
  status: { online: true, pending: 0, synced: true }
};
let CFG = {}, STORE = null, UNSUB = null;
let DATA = { songs: [], lists: [], escala: [], people: [], prefs: { reh: {} } };
let pendingHash = '';

const songById = id => DATA.songs.find(s => s.id === id);
const listById = id => DATA.lists.find(l => l.id === id);
const keyList = k => keyInfo(k).minor ? MINOR_KEYS : MAJOR_KEYS;
const ALL_KEYS = MAJOR_KEYS.concat(MINOR_KEYS);
function ministerKey(so, name) {
  const e = name && so && so.keys ? so.keys[normKey(name)] : null;
  return e ? e.k : null;
}
const sortedLists = () => DATA.lists.slice().sort((a, b) => a.date.localeCompare(b.date));
const upcomingLists = () => sortedLists().filter(l => l.date >= today());
const pastLists = () => sortedLists().filter(l => l.date < today()).reverse();
const allPeople = () => mergeNames(DATA.people, DATA.lists.map(l => l.minister)).sort((a, b) => a.localeCompare(b, 'pt'));
const appUrl = () => location.origin + location.pathname;
const meName = () => { const m = STORE && STORE.me(); return m ? m.name : ''; };
const isAdmin = () => { const m = STORE && STORE.me(); return !!(m && m.admin); };
const isDemo = () => !!(STORE && STORE.mode === 'local');
const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function matchSong(title, version, extra) {
  const k = normKey(title);
  if (!k) return null;
  const pool = DATA.songs.concat(extra || []);
  const same = pool.filter(s => normKey(s.title) === k);
  if (same.length > 1 && version) {
    const v = normKey(version);
    const byV = same.find(s => normKey(s.version) === v);
    if (byV) return byV;
  }
  if (same.length) return same[0];
  if (k.length >= 6) {
    const near = pool.filter(s => { const t = normKey(s.title); return t.length >= 6 && (t.includes(k) || k.includes(t)); });
    if (near.length === 1) return near[0];
  }
  return null;
}

/* ===== Gravar: aparece na hora e vai para todos ===== */
function apply(ops, log) {
  const changed = new Set();
  ['songs', 'lists', 'escala'].forEach(k => (ops[k] || []).forEach(x => changed.add(x.id)));
  ['delSongs', 'delLists'].forEach(k => (ops[k] || []).forEach(id => changed.add(id)));
  STORE.commit(ops);
  DATA = STORE.view();
  buildIndex();
  renderAll();
  stack.slice().forEach(p => refreshPanel(p, { changed, remote: false }));
  if (log && log.what) logChange(log.what, log.merge);
}
/* histórico (só o administrador vê): toques repetidos seguidos viram uma linha só */
const logWait = new Map();
function logChange(what, merge) {
  if (!STORE || !STORE.log) return;
  const k = merge || what;
  const w = logWait.get(k);
  if (w) clearTimeout(w.t);
  const entry = { what, t: setTimeout(() => { logWait.delete(k); STORE.log(what); }, merge ? 2500 : 0) };
  logWait.set(k, entry);
}
function flushLog() { logWait.forEach(w => { clearTimeout(w.t); if (STORE && STORE.log) STORE.log(w.what); }); logWait.clear(); }
window.addEventListener('pagehide', flushLog);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushLog(); });
function cultoLabel(l) {
  const n = cultoName(l), w = wd(l.date).toLowerCase() + ' ' + dm(l.date);
  return n ? n + ' (' + w + ')' : 'culto de ' + w;
}

/* ===== Abertos por último (só neste aparelho) ===== */
function recentIds() {
  try { const a = JSON.parse(storeGet('localStorage', 'lm-recent') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function pushRecent(id) {
  const a = recentIds().filter(x => x !== id);
  a.unshift(id);
  storeSet('localStorage', 'lm-recent', JSON.stringify(a.slice(0, 8)));
}

/* ===== Busca de louvores ===== */
let INDEX = [];
function lyricLines(so) {
  if (so.letra && so.letra.trim()) return lyricsOf(so).lines.filter(l => l.t === 'ln').map(l => ({ raw: l.text, n: norm(l.text) }));
  const t = so.cifra && so.cifra.trim() ? so.cifra : (so.cifraKb || '');
  if (!t.trim()) return [];
  return inlineToTwoLines(t).split('\n')
    .filter(l => analyzeLine(l).type === 'lyric')
    .map(l => l.replace(/^\s*\[[^\]]*\]\s*/, '').trim())
    .filter(Boolean)
    .map(x => ({ raw: x, n: norm(x) }));
}
function buildIndex() {
  INDEX = DATA.songs.map(so => ({ id: so.id, title: norm(so.title), head: norm(so.title + ' ' + (so.version || '')), lyr: lyricLines(so) }));
}
function searchSongs(q) {
  const nq = norm(q).trim();
  const words = nq.split(/\s+/).filter(Boolean);
  const all = t => words.every(w => t.includes(w));
  const out = [];
  INDEX.forEach(ix => {
    let rank = -1, snip = null;
    if (ix.title.startsWith(nq)) rank = 0;
    else if (ix.title.includes(nq)) rank = 1;
    else if (all(ix.head)) rank = 2;
    else {
      const l = ix.lyr.find(x => x.n.includes(nq)) || ix.lyr.find(x => all(x.n));
      if (l) { rank = 3; snip = l.raw; }
    }
    const so = songById(ix.id);
    if (rank >= 0 && so) out.push({ so, rank, snip });
  });
  out.sort((a, b) => a.rank - b.rank || byTitle(a.so, b.so));
  return out;
}
function highlight(raw, q) {
  const nq = norm(q).trim();
  const n = norm(raw);
  const i = n.indexOf(nq);
  if (!nq || i < 0 || n.length !== raw.length) return esc(raw);
  return esc(raw.slice(0, i)) + '<mark>' + esc(raw.slice(i, i + nq.length)) + '</mark>' + esc(raw.slice(i + nq.length));
}

const waLink = l => 'https://wa.me/?text=' + encodeURIComponent(waText(l, songById, appUrl()));

/* ===== Tela principal ===== */
function shell() {
  $('#root').innerHTML = `
  <div class="app" id="app" hidden>
    <header class="top">
      <button class="mark" id="me-btn" data-act="me-menu" aria-haspopup="menu" aria-expanded="false"></button>
      <div class="brand"><div class="b1">Adoração <i>&amp;</i> Artes</div><div class="b2">Manancial Selecta</div></div>
    </header>
    <div class="netbar" id="netbar" role="status" hidden></div>
    <section id="tab-cultos"></section>
    <section id="tab-louvores" hidden>
      <div class="vh" id="vh-louvores"></div>
      <div class="searchbar">
        <div class="search">${ICON.search}<input class="inp" id="q" type="search" enterkeyhint="go" placeholder="Nome, versão ou trecho da letra" autocomplete="off" aria-label="Buscar louvor"><button class="clear" data-act="clear" aria-label="Limpar busca" hidden>${ICON.x}</button></div>
      </div>
      <div id="list"></div>
    </section>
    <section id="tab-escala" hidden></section>
  </div>
  <nav class="tabbar" id="tabbar" aria-label="Seções" hidden><div class="in">
    <button data-act="tab" data-v="cultos">${ICON.cal}<span>Cultos</span></button>
    <button data-act="tab" data-v="louvores">${ICON.music}<span>Louvores</span></button>
    <button data-act="tab" data-v="escala">${ICON.users}<span>Escala</span></button>
  </div></nav>
  <div class="boot" id="boot" role="status"><span class="spin" aria-hidden="true"></span><span>Abrindo…</span></div>
  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>`;
}
function renderMe() {
  const b = $('#me-btn'), n = meName();
  if (!b) return;
  b.innerHTML = n ? `<span>${esc(initials(n))}</span>` : ICON.user;
  b.setAttribute('aria-label', n ? 'Conta: ' + n : 'Conta');
}
function renderTabs() {
  $$('.tabbar button').forEach(b => { if (b.dataset.v === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#tab-cultos').hidden = S.tab !== 'cultos';
  $('#tab-louvores').hidden = S.tab !== 'louvores';
  $('#tab-escala').hidden = S.tab !== 'escala';
}

function cardHTML(l, cls) {
  const d = dObj(l.date), name = cultoName(l), rel = relDay(l.date);
  const n = listSeq(l).length;
  const missing = listSeq(l).filter(it => !hasCifra(songById(it.songId))).length;
  const meta = [l.minister ? 'Ministro ' + l.minister : '', n + (n === 1 ? ' louvor' : ' louvores')].filter(Boolean).join(' · ');
  const reh = cls === 'past' ? '' : rehText(l);
  return `<button class="lcard${cls ? ' ' + cls : ''}" data-act="open-list" data-id="${esc(l.id)}">
    <span class="lday"><span class="w">${rel ? rel.toUpperCase() : wdShort(l.date)}</span><span class="d">${d.getDate()}</span><span class="m">${MO[d.getMonth()]}</span></span>
    <span class="lt">${name ? `<span class="kind">${esc(name)}</span>` : ''}<b>${esc(longDate(l.date))}</b><small>${esc(meta)}</small>${reh ? `<small class="rh">${ICON.clock}${esc(reh)}</small>` : ''}${missing && cls !== 'past' ? `<span class="chips"><span class="chip">${missing} sem cifra</span></span>` : ''}</span>
    <span class="chev">${ICON.chev}</span>
  </button>`;
}
function tipHTML() {
  if (isStandalone() || storeGet('localStorage', 'lm-tip-install') === '0') return '';
  return `<div class="tipcard"><span class="tic">${ICON.install}</span><p><b>Instale o app</b> na tela inicial: abre mais rápido e as cifras funcionam sem internet. <button class="linkbtn" data-act="install">Como instalar</button></p><button class="iconbtn sm" data-act="tip-close" aria-label="Fechar dica">${ICON.x}</button></div>`;
}
function renderCultos() {
  const el = $('#tab-cultos');
  const up = upcomingLists(), past = pastLists().slice(0, 6);
  let h = `<div class="vh"><div><h1>Cultos</h1><p>${up.length ? up.length + (up.length === 1 ? ' próximo' : ' próximos') : 'Nenhum culto marcado'}</p></div><button class="btn pri sm" data-act="new-list">${ICON.plus}Novo culto</button></div>`;
  h += tipHTML();
  if (!DATA.lists.length) {
    h += S.status.synced || isDemo()
      ? '<div class="empty"><p>Nenhum culto ainda.</p><p class="hint">Quando a líder mandar a escala, copie a mensagem e toque em "Novo culto". O app monta a lista sozinho.</p></div>'
      : '<div class="empty"><p>Carregando os cultos…</p></div>';
  } else {
    h += up.map((l, i) => cardHTML(l, i === 0 ? 'next' : '')).join('');
    if (past.length) h += '<div class="lbl mt2">Anteriores</div>' + past.map(l => cardHTML(l, 'past')).join('');
  }
  el.innerHTML = h;
}

const letterOf = t => { const c = norm(t).trim().charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
function rowHTML(so, snip, q) {
  const k = showKey(so);
  const meta = [so.version, so.bpm ? so.bpm + ' BPM' : ''].filter(Boolean).join(' · ');
  return `<button class="lrow" data-act="open" data-id="${esc(so.id)}">
    <span class="lt"><b>${esc(so.title)}</b>${meta ? `<small>${esc(meta)}</small>` : ''}${snip ? `<span class="snip">“${highlight(snip, q)}”</span>` : ''}${hasCifra(so) ? '' : '<span class="chips"><span class="chip">Sem cifra</span></span>'}</span>
    ${k ? `<span class="kmini" aria-label="Tom ${esc(k)}">${esc(k)}</span>` : ''}
  </button>`;
}
function renderSongs() {
  const songs = DATA.songs.slice().sort(byTitle);
  const withC = songs.filter(hasCifra).length;
  $('#vh-louvores').innerHTML = `<div><h1>Louvores</h1><p>${songs.length} ${songs.length === 1 ? 'cadastrado' : 'cadastrados'} · ${withC} com cifra</p></div><button class="btn pri sm" data-act="new">${ICON.plus}Novo louvor</button>`;
  const el = $('#list');
  const q = S.q.trim();
  $('[data-act="clear"]').hidden = !S.q;
  let h = '';
  if (!q) {
    const rec = recentIds().map(songById).filter(Boolean).slice(0, 8);
    if (rec.length) {
      h += '<div class="lbl mt">Abertos por último</div><div class="recent">' + rec.map(so => {
        const k = showKey(so);
        return `<button class="rchip${k ? '' : ' nok'}" data-act="open" data-id="${esc(so.id)}">${esc(so.title)}${k ? `<span class="kmini">${esc(k)}</span>` : ''}</button>`;
      }).join('') + '</div>';
    }
    if (!songs.length) h += `<div class="empty"><p>${S.status.synced || isDemo() ? 'Nenhum louvor cadastrado ainda.' : 'Carregando os louvores…'}</p><button class="btn pri" data-act="new">${ICON.plus}Cadastrar o primeiro</button></div>`;
    let cur = '';
    songs.forEach(so => {
      const L = letterOf(so.title);
      if (L !== cur) { cur = L; h += `<div class="letter" aria-hidden="true">${L}</div>`; }
      h += rowHTML(so);
    });
  } else {
    const res = searchSongs(q);
    h += `<div class="count"><span class="lbl">${res.length ? res.length + (res.length === 1 ? ' encontrado' : ' encontrados') : 'Nada encontrado'}</span></div>`;
    h += res.map(r => rowHTML(r.so, r.snip, q)).join('');
    if (!res.length) h += `<p class="emptyline">Nenhum louvor com “${esc(q)}”. <button class="linkbtn" data-act="new-from-q">Cadastrar “${esc(q)}”</button></p>`;
  }
  el.innerHTML = h;
}
function renderAll() {
  if (!S.ready) return;
  renderMe();
  renderTabs();
  renderCultos();
  renderSongs();
  renderEscala();
}

function renderStatus(s) {
  if ((s.failed || 0) > (S.status.failed || 0) && S.ready) toast('Não deu para salvar uma alteração. Confira e tente de novo.');
  S.status = s;
  if (s.revoked && S.ready) { openGate('join', 'Seu acesso foi removido ou expirou. Entre de novo com o código do ministério.'); return; }
  const el = $('#netbar');
  if (!el) return;
  const t = !s.online ? 'Sem internet. Mostrando o que está guardado no aparelho' + (s.pending ? '; suas alterações vão ser enviadas quando a internet voltar.' : '.') : '';
  el.hidden = !t;
  el.innerHTML = t ? `${ICON.offline}<span>${esc(t)}</span>` : '';
}

let toastT = null, toastFn = null;
function toast(msg, action) {
  const t = $('#toast');
  if (!t) return;
  toastFn = action ? action.fn : null;
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="tact" data-act="toast-act">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; toastFn = null; }, action ? 6000 : 2800);
}
function copyText(t, okMsg) {
  const fallback = () => {
    openSheet(`<h3>Mensagem</h3><p>Selecione o texto e copie.</p><textarea class="inp copyta" readonly>${esc(t)}</textarea>`);
    const ta = $('.copyta', sheetEl);
    ta.focus();
    ta.select();
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => toast(okMsg), fallback);
    else fallback();
  } catch (e) { fallback(); }
}

/* ===== Painéis, folhas e menu ===== */
const stack = [];
function openPanel(html, cls, noanim) {
  const p = document.createElement('div');
  p.className = 'panel ' + (cls || '') + (noanim ? ' noanim' : '');
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-modal', 'true');
  p.innerHTML = html;
  document.body.appendChild(p);
  stack.push(p);
  document.body.classList.add('locked');
  return p;
}
function removePanel(p) {
  const i = stack.indexOf(p);
  if (i < 0) return;
  stack.splice(i, 1);
  if (p._cleanup) p._cleanup();
  p.remove();
  if (!stack.length) document.body.classList.remove('locked');
}
function closePanel() { const p = stack[stack.length - 1]; if (p) removePanel(p); }
const topPanel = () => stack[stack.length - 1] || null;

let sheetEl = null;
function openSheet(html, ctx) {
  closeSheet();
  const s = document.createElement('div');
  s.className = 'scrim';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  s.addEventListener('click', e => { if (e.target === s) closeSheet(); });
  document.body.appendChild(s);
  s._ctx = ctx || {};
  sheetEl = s;
}
function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } exitAsk = false; }

let menuEl = null;
function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  const b = $('#me-btn');
  if (b) b.setAttribute('aria-expanded', 'false');
}

/* ===== Botão voltar do celular =====
   Enquanto houver algo aberto (tela, folha ou menu), fica uma entrada extra no histórico.
   O voltar do celular consome essa entrada e fecha só o que está por cima, em vez de sair do app. */
let backGuard = false, backSkip = 0, backQueued = false, exitAsk = false;
const backLayers = () => stack.length + (sheetEl ? 1 : 0) + (menuEl ? 1 : 0);
const appOpen = () => { const a = $('#app'); return !!a && !a.hidden && !$('#gate'); };
/* o Chrome ignora entradas do histórico criadas antes de a pessoa tocar na tela */
const touchedPage = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;
/* Chrome no Android (120+): CloseWatcher recebe o voltar do celular sem mexer no histórico.
   Fica sempre um vigia ativo; cada voltar fecha só o que está por cima e um vigia novo é criado. */
const HAS_CW = typeof window.CloseWatcher === 'function';
let watcher = null, cwBusy = false;
function wantBack() { return appOpen() && !exitAsk && (backLayers() > 0 || touchedPage()); }
function syncWatcher() {
  const need = wantBack();
  if (!need && watcher) { const w = watcher; watcher = null; w.destroy(); }
  else if (need && !watcher) {
    try {
      const w = new CloseWatcher();
      w.onclose = () => {
        if (watcher === w) watcher = null;
        if (cwBusy) return; /* vários vigias fechados juntos contam como um voltar só */
        cwBusy = true;
        setTimeout(() => { cwBusy = false; goBack(); queueSyncBack(); }, 0);
      };
      watcher = w;
    } catch (e) { /* sem vigia: o voltar segue o padrão do celular */ }
  }
}
function syncBack() {
  backQueued = false;
  if (HAS_CW) { syncWatcher(); return; }
  if (backSkip) return; /* esperando o histórico voltar; o popstate chama de novo */
  const need = wantBack();
  try {
    if (need && !backGuard) { history.pushState({ lmBack: 1 }, '', location.href); backGuard = true; }
    else if (!need && backGuard && !exitAsk) { backGuard = false; backSkip++; history.back(); }
  } catch (e) { /* navegador sem histórico: segue sem o voltar do celular */ }
}
function queueSyncBack() { if (!backQueued) { backQueued = true; Promise.resolve().then(syncBack); } }
/* editor com alteração não salva? */
const sigOf = d => JSON.stringify(d, (k, v) => (k && k[0] === '_' ? undefined : v));
function editorDirty(p) {
  if (!p || (p._kind !== 'form' && p._kind !== 'listedit')) return false;
  const paste = $('#le-paste', p);
  if (paste && paste.value.trim() && !$('[data-el="pastebox"]', p).classList.contains('closed')) return true;
  return !!p._snap && sigOf(p._d) !== p._snap;
}
let discardTarget = null;
function goBack() {
  if (menuEl) { closeMenu(); return; }
  if (sheetEl) { closeSheet(); return; }
  const p = topPanel();
  if (!p) { askExit(); return; }
  if (p._kind === 'song' && p._st.palco) { togglePalco(p); return; }
  if (editorDirty(p)) {
    discardTarget = p;
    openSheet(`<h3>Sair sem salvar?</h3><p>As alterações que você fez ainda não foram salvas.</p>
      <div class="sbtns"><button class="btn" data-act="discard-stay">Continuar editando</button><button class="btn danger" data-act="discard-go">Sair sem salvar</button></div>`);
    return;
  }
  removePanel(p);
}
/* na tela inicial: confirma antes de sair (o próximo voltar sai do app) */
function askExit() {
  if (!appOpen()) return;
  openSheet(`<h3>Sair do app?</h3><p>Aperte voltar de novo para sair.</p>
    <button class="btn pri wide" data-act="exit-stay">Continuar no app</button>`);
  exitAsk = true;
}
window.addEventListener('popstate', () => {
  if (HAS_CW) return;
  if (backSkip) { backSkip--; queueSyncBack(); return; }
  backGuard = false;
  goBack();
  queueSyncBack();
});
new MutationObserver(queueSyncBack).observe(document.body, { childList: true });
['click', 'keydown'].forEach(t => document.addEventListener(t, () => { if (HAS_CW ? !watcher : !backGuard) queueSyncBack(); }, true));
/* guarda como o editor estava antes da primeira mexida */
['input', 'change', 'click'].forEach(t => document.addEventListener(t, e => {
  const p = e.target && e.target.closest && e.target.closest('.panel');
  if (p && p._d && !p._snap && (p._kind === 'form' || p._kind === 'listedit')) p._snap = sigOf(p._d);
}, true));

/* ===== Entrar (código do ministério + nome) e configurar ===== */
const MSG = {
  'bad-code': 'Código errado. Confira com a liderança do ministério.',
  'offline': 'Sem internet. Para entrar pela primeira vez, conecte-se à internet.',
  'not-configured': 'O app ainda não foi configurado. Fale com quem administra.',
  'auth-disabled': 'A entrada anônima não está ativada no Firebase. Fale com quem administra.',
  'already-configured': 'O app já foi configurado. Use o código do ministério para entrar.',
  'short-code': 'O código precisa ter pelo menos 6 letras ou números.',
  'load': 'Não deu para carregar o app. Confira a internet e tente de novo.',
  'seed': 'Escolha o arquivo do protótipo (prototipo.json) ou desmarque a opção.',
  'seed-file': 'Esse arquivo não é o do protótipo. Escolha o prototipo.json.',
  'short-pass': 'A senha precisa ter pelo menos 6 letras ou números.',
  'bad-pass': 'Senha errada, ou o administrador ainda não criou a senha.',
  'not-admin': 'Só quem administra pode ver o histórico.'
};
const errMsg = e => MSG[e && e.code] || 'Não deu certo agora. Tente de novo em instantes.';

function brandHTML() {
  return `<div class="gbrand"><span class="glogo" aria-hidden="true">A<i>&amp;</i>A</span><div><div class="b1">Adoração <i>&amp;</i> Artes</div><div class="b2">Manancial Selecta</div></div></div>`;
}
function gateHTML(kind, msg) {
  const note = msg ? `<p class="note bad">${ICON.info}<span>${esc(msg)}</span></p>` : '';
  if (kind === 'setup') {
    return `<div class="gin">${brandHTML()}
      <h1>Configurar o app</h1>
      <p class="glead">Feito uma vez só, por quem administra. Escolha o código que o ministério vai usar para entrar.</p>
      ${note}
      <div class="field"><label for="g-code">Código do ministério</label><input class="inp" id="g-code" maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Pelo menos 6 letras ou números" enterkeyhint="next"></div>
      <div class="field"><label for="g-name">Seu nome</label><input class="inp" id="g-name" maxlength="60" autocomplete="name" placeholder="Nome e sobrenome" enterkeyhint="go"></div>
      <label class="check"><input type="checkbox" id="g-seed" checked><span>Trazer os louvores e cultos do protótipo</span></label>
      ${CFG.seed ? '' : seedFileHTML()}
      <p class="gerr" role="alert" hidden></p>
      <button class="btn pri wide" data-act="g-setup">Configurar</button>
      <p class="hint mt">Depois é só mandar o link do app e o código no grupo do ministério.</p>
      <p class="hint mt"><button class="linkbtn" data-act="g-tojoin">Já tem o código? Entrar</button></p>
    </div>`;
  }
  return `<div class="gin">${brandHTML()}
    <h1>Entrar</h1>
    <p class="glead">Cultos, louvores e cifras do ministério, sempre atualizados para todos.</p>
    ${note}
    <div class="field"><label for="g-code">Código do ministério</label><input class="inp" id="g-code" maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="next"></div>
    <div class="field"><label for="g-name">Seu nome</label><input class="inp" id="g-name" maxlength="60" autocomplete="name" placeholder="Nome e sobrenome" enterkeyhint="go"></div>
    <p class="gerr" role="alert" hidden></p>
    <button class="btn pri wide" data-act="g-join">Entrar</button>
    <p class="hint mt">Peça o código para a liderança do ministério. Você só precisa entrar uma vez neste aparelho.</p>
    ${isDemo() ? `<p class="note mt">${ICON.info}<span>Prévia: o código é <b>${esc(STORE.demoCode)}</b>. O que você mudar fica só neste aparelho.</span></p>` : ''}
  </div>`;
}
function openGate(kind, msg) {
  S.ready = false;
  closeMenu();
  closeSheet();
  while (stack.length) closePanel();
  $('#app').hidden = true;
  $('#tabbar').hidden = true;
  queueSyncBack();
  const boot = $('#boot');
  if (boot) boot.remove();
  let g = $('#gate');
  if (!g) { g = document.createElement('main'); g.id = 'gate'; g.className = 'gate'; $('#root').appendChild(g); }
  g.dataset.kind = kind;
  g.innerHTML = gateHTML(kind, msg);
  setTimeout(() => { const f = $('#g-code'); if (f) f.focus(); }, 60);
}
function gateErr(msg) {
  const el = $('.gerr');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}
function busy(btn, label) {
  if (!btn) return;
  if (label) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}
/* dados do protótipo: arquivo escolhido no aparelho (prototipo.json) ou, se existir, o que está junto do app */
const seedFileHTML = () => `<div class="field seedf" data-el="seedf"><label for="g-file">Arquivo do protótipo <span class="opt">(prototipo.json, que o Claude mandou)</span></label><input class="inp file" id="g-file" type="file" accept=".json,application/json"></div>`;
async function getSeed() {
  if (CFG.seed) return CFG.seed;
  const inp = $('#g-file');
  const f = inp && inp.files && inp.files[0];
  if (f) {
    try {
      const d = JSON.parse(await f.text());
      if (d && Array.isArray(d.songs)) return d;
    } catch (e) { /* arquivo errado */ }
    throw Object.assign(new Error('seed'), { code: 'seed-file' });
  }
  let r = null;
  try { r = await fetch(CFG.seedUrl || 'data/prototipo.json', { cache: 'no-store' }); } catch (e) { r = null; }
  if (!r || !r.ok) throw Object.assign(new Error('seed'), { code: 'seed' });
  return r.json();
}
async function doJoin(btn) {
  const code = $('#g-code').value, name = titleCase($('#g-name').value);
  if (!code.trim()) { gateErr('Escreva o código do ministério.'); $('#g-code').focus(); return; }
  if (!name) { gateErr('Escreva seu nome.'); $('#g-name').focus(); return; }
  gateErr('');
  busy(btn, 'Entrando…');
  try { await STORE.join(code, name); } catch (e) { busy(btn, false); gateErr(errMsg(e)); return; }
  enterApp();
  toast('Olá, ' + name.split(' ')[0] + '!');
}
async function doSetup(btn) {
  const code = $('#g-code').value, name = titleCase($('#g-name').value), withSeed = $('#g-seed').checked;
  if (code.trim().length < 6) { gateErr(MSG['short-code']); $('#g-code').focus(); return; }
  if (!name) { gateErr('Escreva seu nome.'); $('#g-name').focus(); return; }
  gateErr('');
  busy(btn, 'Configurando…');
  try {
    if (await STORE.isConfigured().catch(() => null) === true) throw Object.assign(new Error('configurado'), { code: 'already-configured' });
    const seed = withSeed ? await getSeed() : null;
    await STORE.setup(code, name, seed);
  } catch (e) { busy(btn, false); gateErr(errMsg(e)); return; }
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ok */ }
  enterApp();
  toast('Pronto! Agora mande o link e o código para o ministério.');
}
function enterApp() {
  const g = $('#gate');
  if (g) g.remove();
  const boot = $('#boot');
  if (boot) boot.remove();
  $('#app').hidden = false;
  $('#tabbar').hidden = false;
  S.ready = true;
  queueSyncBack();
  try { if (STORE.logOpen) STORE.logOpen(); } catch (e) { /* histórico é opcional */ }
  DATA = STORE.view();
  if (!UNSUB) UNSUB = STORE.subscribe(onData);
  if (DATA.lists.length && !upcomingLists().length) S.tab = 'louvores';
  buildIndex();
  renderAll();
  renderStatus(S.status);
  openFromHash();
}

/* ===== Conta ===== */
function openMeMenu() {
  if (menuEl) { closeMenu(); return; }
  const b = $('#me-btn'), r = b.getBoundingClientRect(), n = meName();
  const w = document.createElement('div');
  w.className = 'menuwrap';
  w.innerHTML = `<div class="menu" role="menu" aria-label="Conta">
    <div class="mhead"><span class="av">${esc(initials(n))}</span><span class="mtx"><b>${esc(n)}</b><small>${isAdmin() ? 'Administrador' : 'Membro do ministério'} · pode editar tudo</small></span></div>
    <button role="menuitem" data-act="rename">${ICON.edit}Trocar meu nome</button>
    <a role="menuitem" href="${esc(appShareLink())}" target="_blank" rel="noopener" data-act="share-app">${ICON.whats}Enviar o app no WhatsApp</a>
    ${isStandalone() ? '' : `<button role="menuitem" data-act="install">${ICON.install}Instalar o app</button>`}
    ${isAdmin() ? `<div class="msep">Administração</div>
      <button role="menuitem" data-act="history">${ICON.hist}Histórico (7 dias)</button>
      <button role="menuitem" data-act="code">${ICON.keyic}Código do ministério</button>
      <button role="menuitem" data-act="admin-pass">${ICON.shield}Senha de administrador</button>
      <button role="menuitem" data-act="import">${ICON.upload}Importar dados do protótipo</button>`
    : `<button role="menuitem" data-act="become-admin">${ICON.shield}Entrar como administrador</button>`}
    <button role="menuitem" data-act="leave">${ICON.logout}Sair deste aparelho</button>
  </div>`;
  w.addEventListener('click', e => { if (e.target === w) closeMenu(); });
  document.body.appendChild(w);
  const m = $('.menu', w);
  m.style.left = Math.max(8, r.left) + 'px';
  m.style.top = (r.bottom + 8) + 'px';
  menuEl = w;
  b.setAttribute('aria-expanded', 'true');
  const first = $('[role="menuitem"]', m);
  if (first) first.focus();
}
function openRename() {
  openSheet(`<h3>Trocar meu nome</h3><p>É o nome que aparece para o ministério.</p>
    <div class="field"><label for="rn-name">Seu nome</label><input class="inp" id="rn-name" maxlength="60" value="${esc(meName())}" autocomplete="name" enterkeyhint="go"></div>
    <p class="gerr" role="alert" hidden></p>
    <button class="btn pri wide" data-act="rename-go">Salvar</button>`);
  setTimeout(() => { const i = $('#rn-name'); if (i) i.focus(); }, 60);
}
async function doRename(btn) {
  const name = titleCase($('#rn-name').value);
  if (!name) { gateErr('Escreva seu nome.'); return; }
  busy(btn, 'Salvando…');
  try { await STORE.rename(name); } catch (e) { busy(btn, false); gateErr(errMsg(e)); return; }
  closeSheet();
  renderAll();
  toast('Nome salvo');
}
function openInstall() {
  const ev = window.__lmInstall;
  if (ev && !isIOS()) {
    window.__lmInstall = null;
    ev.prompt();
    if (ev.userChoice) ev.userChoice.then(c => { if (c && c.outcome === 'accepted') toast('App instalado'); }).catch(() => {});
    return;
  }
  const steps = isIOS()
    ? `<li>Abra o link do app no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b> <span class="ic">${ICON.share}</span></li><li>Escolha <b>Adicionar à Tela de Início</b> e toque em <b>Adicionar</b>.</li>`
    : `<li>Abra o link do app no <b>Chrome</b>.</li><li>Toque no menu <b>⋮</b>, no alto da tela.</li><li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li>`;
  openSheet(`<h3>Instalar o app</h3><p>Fica com ícone na tela inicial, abre em tela cheia e as cifras funcionam sem internet.</p>
    <ol class="steps">${steps}</ol>
    <button class="btn pri wide" data-act="sheet-done">Entendi</button>`);
}
async function openCode() {
  openSheet(`<h3>Código do ministério</h3><p>Quem tem o código e o link entra no app e pode editar.</p>
    <div class="codebox" data-el="code">…</div>
    <div class="field"><label for="cd-new">Mudar o código</label><input class="inp" id="cd-new" maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Novo código (pelo menos 6)"></div>
    <p class="hint mt">Quem já entrou continua com acesso. O código novo vale para quem entrar daqui para frente.</p>
    <p class="gerr" role="alert" hidden></p>
    <button class="btn pri wide" data-act="code-go">Mudar código</button>`);
  const c = await STORE.adminCode();
  const box = sheetEl && $('[data-el="code"]', sheetEl);
  if (box) box.textContent = c || 'Sem internet para mostrar agora';
}
async function doChangeCode(btn) {
  const c = $('#cd-new').value;
  if (c.trim().length < 6) { gateErr(MSG['short-code']); return; }
  busy(btn, 'Salvando…');
  try { await STORE.changeCode(c); } catch (e) { busy(btn, false); gateErr(errMsg(e)); return; }
  closeSheet();
  toast('Código alterado');
}
/* link do app para mandar a quem vai entrar (sem o código: a pessoa pede para a liderança) */
function appShareLink() {
  const t = '*Louvores Manancial* 🎶\nApp do ministério Adoração & Artes Manancial Selecta: cultos, louvores e cifras para violão e teclado.\n\n'
    + 'Abra o link, digite o código do ministério (peça para a liderança) e o seu nome. Depois é só instalar na tela inicial.\n\n' + appUrl();
  return 'https://wa.me/?text=' + encodeURIComponent(t);
}
/* senha de administrador: quem administra cria; quem souber vira administrador */
async function openAdminPass() {
  openSheet(`<h3>Senha de administrador</h3><p>Quem souber esta senha vira administrador pelo menu, sem mexer no Firebase.</p>
    <div class="codebox" data-el="pass">…</div>
    <div class="field"><label for="ap-new">${'Nova senha'}</label><input class="inp" id="ap-new" maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Pelo menos 6 letras ou números"></div>
    <p class="hint mt">Passe a senha só para quem vai administrar. Quem já é administrador continua sendo.</p>
    <p class="gerr" role="alert" hidden></p>
    <button class="btn pri wide" data-act="admin-pass-go">Salvar senha</button>`);
  const c = await STORE.adminPass();
  const box = sheetEl && $('[data-el="pass"]', sheetEl);
  if (box) { box.textContent = c === null ? 'Sem internet para mostrar agora' : c || 'Ainda sem senha'; box.classList.toggle('none', !c); }
}
async function doAdminPass(btn) {
  const c = $('#ap-new').value;
  if (c.trim().length < 6) { gateErr(MSG['short-pass']); return; }
  busy(btn, 'Salvando…');
  try { await STORE.setAdminPass(c); } catch (e) { busy(btn, false); gateErr(errMsg(e)); return; }
  closeSheet();
  toast('Senha de administrador salva');
}
function openBecomeAdmin() {
  openSheet(`<h3>Entrar como administrador</h3><p>Digite a senha de administrador que a liderança passou.</p>
    <div class="field"><label for="ba-pass">Senha</label><input class="inp" id="ba-pass" maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
    <p class="gerr" role="alert" hidden></p>
    <button class="btn pri wide" data-act="become-admin-go">Entrar como administrador</button>`);
  const i = $('#ba-pass');
  if (i) i.focus();
}
async function doBecomeAdmin(btn) {
  const c = $('#ba-pass').value;
  if (!c.trim()) { gateErr('Digite a senha.'); return; }
  busy(btn, 'Conferindo…');
  try { await STORE.becomeAdmin(c); } catch (e) { busy(btn, false); gateErr(e && e.code === 'offline' ? 'Sem internet. Conecte-se e tente de novo.' : errMsg(e)); return; }
  closeSheet();
  toast('Pronto! Agora você é administrador.');
}

/* histórico dos últimos 7 dias: quem abriu o app e o que foi alterado (só o administrador) */
const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function dayLabel(ms) {
  const iso = isoOf(new Date(ms)), t = today();
  if (iso === t) return 'Hoje';
  if (daysBetween(iso, t) === 1) return 'Ontem';
  return wd(iso) + ', ' + dm(iso);
}
async function openHistory() {
  const p = openPanel(`<div class="p-head"><div class="in"><button class="backbtn" data-act="close">${ICON.back}<span>Voltar</span></button></div></div>
    <div class="p-body"><div class="p-in" data-el="hist"><p class="hint">Carregando…</p></div></div>`, 'histp');
  p._kind = 'hist';
  let rows;
  try { rows = await STORE.history(7); } catch (e) {
    const el = $('[data-el="hist"]', p);
    if (el) el.innerHTML = `<p class="note bad">${ICON.info}<span>${esc(e && e.code === 'offline' ? 'Sem internet. O histórico precisa de internet.' : errMsg(e))}</span></p>`;
    return;
  }
  const el = $('[data-el="hist"]', p);
  if (el) el.innerHTML = historyHTML(rows);
}
function historyHTML(rows) {
  /* quem abriu: uma linha por pessoa, com a última vez e em quantos dias abriu */
  const people = new Map();
  rows.filter(r => r.t === 'open' || r.t === 'join').forEach(r => {
    const k = r.uid || r.by;
    const e = people.get(k) || { by: r.by, last: 0, days: new Set() };
    e.last = Math.max(e.last, r.at);
    e.days.add(isoOf(new Date(r.at)));
    if (r.at >= e.last) e.by = r.by;
    people.set(k, e);
  });
  const ppl = [...people.values()].sort((a, b) => b.last - a.last);
  const edits = rows.filter(r => r.t !== 'open');
  let h = `<h1 class="ptitle">Histórico</h1><p class="hint">Últimos 7 dias. Só quem administra vê esta tela.</p>`;
  h += `<div class="esec"><h2>Quem abriu o app</h2><span>${ppl.length ? ppl.length + (ppl.length === 1 ? ' pessoa' : ' pessoas') : ''}</span></div>`;
  h += ppl.length ? '<ul class="hlist">' + ppl.map(e => `<li><span class="av sm">${esc(initials(e.by))}</span><span class="ht"><b>${esc(e.by)}</b><small>${esc(dayLabel(e.last))} às ${hhmm(e.last)} · ${e.days.size === 1 ? '1 dia' : e.days.size + ' dias'}</small></span></li>`).join('') + '</ul>'
    : '<p class="emptyline">Ninguém abriu o app nestes dias (ou ainda não havia histórico).</p>';
  h += `<div class="esec"><h2>Alterações</h2><span>${edits.length ? edits.length : ''}</span></div>`;
  if (!edits.length) return h + '<p class="emptyline">Nenhuma alteração nestes dias.</p>';
  let cur = '';
  h += '<div class="hfeed">';
  edits.forEach(r => {
    const d = dayLabel(r.at);
    if (d !== cur) { cur = d; h += `<div class="subsec">${esc(d)}</div>`; }
    h += `<div class="hrow"><span class="hm">${hhmm(r.at)}</span><span class="ht"><b>${esc(r.by)}</b><span>${esc(r.what)}</span></span></div>`;
  });
  return h + '</div>';
}
function openImport() {
  openSheet(`<h3>Importar dados do protótipo</h3><p>Traz os louvores e cultos do protótipo para o app. O que tiver o mesmo nome no app é trocado pela versão do protótipo.</p>
    ${CFG.seed ? '' : seedFileHTML()}
    <p class="gerr" role="alert" hidden></p>
    <button class="btn pri wide" data-act="import-go">Importar</button>`);
}
async function doImport(btn) {
  busy(btn, 'Importando…');
  try { await STORE.importSeed(await getSeed()); } catch (e) { busy(btn, false); gateErr(errMsg(e)); return; }
  DATA = STORE.view();
  buildIndex();
  renderAll();
  closeSheet();
  toast('Dados do protótipo importados');
}
function openLeave() {
  openSheet(`<h3>Sair deste aparelho?</h3><p>Para entrar de novo, vai precisar do código do ministério. As cifras guardadas neste aparelho são apagadas.</p>
    <button class="btn danger wide" data-act="leave-go">Sair</button>`);
}
async function doLeave(btn) {
  busy(btn, 'Saindo…');
  try { await STORE.leave(); } catch (e) { /* segue */ }
  location.reload();
}

/* ===== Página do culto (o que o link do WhatsApp abre) ===== */
function openList(id, noanim) {
  const l = listById(id);
  if (!l) return;
  const p = openPanel(listPanelHTML(l), 'listp', noanim);
  p._kind = 'list';
  p._id = id;
}
function itemRowHTML(l, it, num, idx, joined) {
  const so = songById(it.songId);
  if (!so) return '';
  const ver = it.version || so.version;
  return `<div class="sroww${joined ? ' joined' : ''}"><button class="srow${joined ? ' joined' : ''}" data-act="open-item" data-list="${esc(l.id)}" data-idx="${idx}">
    <span class="n">${num}</span>
    <span class="t"><b>${esc(so.title)}</b>${ver ? `<small>${esc(ver)}</small>` : ''}${it.obs ? `<span class="obs">${esc(it.obs)}</span>` : ''}${hasCifra(so) ? '' : '<span class="chips"><span class="chip">Sem cifra</span></span>'}</span>
  </button><button class="kbtn" data-act="day-key" data-list="${esc(l.id)}" data-idx="${idx}" aria-label="Tom do dia de ${esc(so.title)}: ${esc(it.key || 'sem tom')}. Trocar">${it.key ? `<span class="kmini">${esc(it.key)}</span>` : '<span class="kmini none">—</span>'}</button></div>`;
}
/* setinhas para mudar a ordem (página do culto e editor) */
function mvHTML(act, i, n, extra, so) {
  const t = so ? esc(so.title) : '';
  return `<div class="mv"><button data-act="${act}" data-i="${i}" data-d="-1"${extra} ${i <= 0 ? 'disabled' : ''} aria-label="Subir ${t}">${ICON.up}</button><button data-act="${act}" data-i="${i}" data-d="1"${extra} ${i >= n - 1 ? 'disabled' : ''} aria-label="Descer ${t}">${ICON.down}</button></div>`;
}
/* página do culto: sobe ou desce o louvor (com a emenda junto) e salva para todos */
function moveGroup(id, gi, dir) {
  const l = listById(id);
  if (!l) return;
  const groups = groupItems(clone(l.items)), gj = gi + dir;
  if (gi < 0 || gj < 0 || gi >= groups.length || gj >= groups.length) return;
  [groups[gi], groups[gj]] = [groups[gj], groups[gi]];
  const items = [].concat(...groups);
  items.forEach((it, k) => { if (k === items.length - 1) it.join = false; });
  apply({ lists: [Object.assign(clone(l), { items, up: Date.now() })] }, { what: 'Mudou a ordem dos louvores · ' + cultoLabel(l), merge: 'order-' + l.id });
}
function listPanelHTML(l) {
  const seq = listSeq(l), d = dObj(l.date), name = cultoName(l), rel = relDay(l.date), reh = rehText(l);
  const rehHTML = reh
    ? `<button class="rehbtn" data-act="edit-reh" aria-label="${esc(reh)}. Editar ensaio">${ICON.clock}<span>${esc(reh)}</span><i>${ICON.edit}</i></button>`
    : `<button class="rehbtn add" data-act="edit-reh">${ICON.clock}<span>Definir ensaio</span></button>`;
  let h = `<div class="p-head"><div class="in">
      <button class="backbtn" data-act="close">${ICON.back}<span>Cultos</span></button>
      <span class="sp"></span>
      <button class="pill pri" data-act="edit-list" data-id="${esc(l.id)}">${ICON.edit}<span>Editar</span></button>
    </div></div>
    <div class="p-body"><div class="p-in">
    <section class="hero">
      <div class="wd">${esc(wd(l.date))}${name ? ' · ' + esc(name) : ''}${rel ? `<span class="tag">${rel}</span>` : ''}</div>
      <div class="dt"><span>${d.getDate()} ${MO[d.getMonth()]}</span></div>
      <div class="meta">${rehHTML}${l.minister ? `<span>${ICON.mic}Ministro ${esc(l.minister)}</span>` : ''}</div>
    </section>
    <div class="acts"><a class="btn pri" href="${esc(waLink(l))}" target="_blank" rel="noopener">${ICON.send}Enviar no WhatsApp</a><button class="btn" data-act="copy-list" data-id="${esc(l.id)}">${ICON.copy}Copiar</button></div>`;
  h += `<div class="esec"><h2>Louvores</h2><span>${seq.length ? seq.length + (seq.length === 1 ? ' louvor' : ' louvores') : ''}</span></div>`;
  let idx = 0;
  if (l.items.length) {
    const groups = groupItems(l.items), ng = groups.length;
    h += '<ol class="items">' + groups.map((g, gi) =>
      `<li class="grp${g.length > 1 ? ' medley' : ''}"><div class="gi">${g.map((it, k) => itemRowHTML(l, it, k === 0 ? String(gi + 1) : '+', idx++, k > 0)).join('')}</div>${ng > 1 ? mvHTML('mv-group', gi, ng, ` data-list="${esc(l.id)}"`, songById(g[0].songId)) : ''}</li>`
    ).join('') + '</ol>';
  }
  if (l.diz) h += `<div class="subsec">Dízimos</div><ol class="items"><li>${itemRowHTML(l, l.diz, '', idx, false)}</li></ol>`;
  if (!seq.length) h += `<p class="emptyline">Nenhum louvor ainda. <button class="linkbtn" data-act="edit-list" data-id="${esc(l.id)}">Adicionar louvores</button></p>`;
  if (l.aviso) h += `<div class="avisobox"><span class="lbl">Aviso</span><p>${esc(l.aviso)}</p></div>`;
  if (seq.length) h += '<p class="hint mt2">Toque num louvor para ver o vídeo e a cifra. Toque no tom para trocar o tom do dia de todos; as setas mudam a ordem.</p>';
  h += '</div></div>';
  return h;
}

/* folha para mudar só o ensaio, direto da página do culto */
const d0 = iso => dObj(iso).getDay();
function openRehSheet(l) {
  const r = l.reh || defaultReh(l.date, l.kind, l.name, DATA.prefs) || { date: l.date, time: '' };
  const name = cultoName(l);
  openSheet(`<h3>Ensaio</h3><p>${esc(name ? name + ' · ' + longDate(l.date) : longDate(l.date))}</p>
    <div class="row2">
      <div class="field"><label for="rh-date">Dia</label><input class="inp" type="date" id="rh-date" value="${esc(r.date || l.date)}"></div>
      <div class="field"><label for="rh-time">Horário</label><input class="inp" type="time" id="rh-time" value="${esc(r.time || '')}"></div>
    </div>
    ${isFixedReh(l.kind, l.date) ? `<p class="hint mt">Padrão: ${esc(wd(l.date).toLowerCase())} às ${hm(REH_FIXED[d0(l.date)])}, no mesmo dia.</p>` : '<p class="hint mt">O app guarda este horário para o próximo culto deste tipo.</p>'}
    <button class="btn pri wide" data-act="reh-save">Salvar ensaio</button>
    ${l.reh ? '<button class="txtbtn danger" data-act="reh-clear">Sem ensaio neste culto</button>' : ''}`, { list: l.id });
}
/* para Jovens, Mulheres e outros tipos, o app lembra o último horário usado */
function rehMemo(l) {
  if (!l.reh || !l.reh.time || isFixedReh(l.kind, l.date)) return null;
  return { [rehKey(l.kind, l.name, l.date)]: { d: daysBetween(l.date, l.reh.date), t: l.reh.time } };
}
function saveListPatch(id, patch, msg) {
  const cur = listById(id);
  if (!cur) return;
  const list = Object.assign(clone(cur), patch, { up: Date.now() });
  closeSheet();
  apply({ lists: [list], reh: rehMemo(list) }, { what: (list.reh ? 'Mudou o ensaio para ' + wd(list.reh.date).toLowerCase() + ' ' + dm(list.reh.date) + ' às ' + String(list.reh.time).replace(':', 'h') : 'Tirou o ensaio') + ' · ' + cultoLabel(list) });
  toast(msg);
}

/* ===== Louvor aberto: vídeo em cima, cifra embaixo ===== */
let MONO_RATIO = 0.5;
function measureMono() {
  try {
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-size:100px;font-family:"Ubuntu Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    s.textContent = 'MMMMMMMMMM';
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    if (w > 0) MONO_RATIO = w / 1000;
  } catch (e) { /* mantém o padrão */ }
}

/* se a cifra é maior e o tom do dia veio menor (ou o contrário), usa o relativo */
function sameMode(k, ref) {
  if (!k || !ref) return k;
  const a = keyInfo(k), b = keyInfo(ref);
  if (a.minor === b.minor) return k;
  return keyByPc(a.pc + (a.minor ? 3 : -3), b.minor) || k;
}
function baseKeyFor(so, ctx) {
  const l = ctx ? listById(ctx.list) : null;
  const it = l ? listSeq(l)[ctx.idx] : null;
  let base = (it && it.key) || so.play || origKey(so) || null;
  if (base && hasCifra(so)) base = sameMode(base, origKey(so));
  return base;
}

function openSong(id, ctx, noanim) {
  const so = songById(id);
  if (!so) return;
  pushRecent(id);
  const l = ctx ? listById(ctx.list) : null;
  const c = l ? ctx : null;
  const base = baseKeyFor(so, c);
  const st = { id, ctx: c, base, key: base, capo: 0, size: null, cur: 16, scroll: false, speed: 2, palco: false, lock: null, hideVideo: storeGet('localStorage', 'lm-hidevideo') === '1' };
  const p = openPanel(songPanelHTML(so, st), 'songp', noanim);
  p._st = st;
  p._kind = 'song';
  p._cleanup = () => {
    st.scroll = false;
    if (st.au && st.au.player) { st.au.player.close(); st.au.player = null; }
    if (st.lock) { try { st.lock.release(); } catch (e) { /* ok */ } st.lock = null; }
  };
  wireVideo(p);
  updateSongPanel(p, true);
}

/* tom do dia: muda na página do culto e vale para todos, na hora (na tela da cifra cada um vê o tom que quiser) */
function dayKeyCtx(l, idx) {
  const isDiz = !!(l.diz && idx === l.items.length);
  const it = isDiz ? l.diz : l.items[idx];
  return { isDiz, it, so: it ? songById(it.songId) : null };
}
function openDayKeySheet(listId, idx) {
  const l = listById(listId);
  if (!l) return;
  const { it, so } = dayKeyCtx(l, idx);
  if (!it || !so) return;
  const base = it.key || so.play || origKey(so);
  const list = base ? keyList(base) : ALL_KEYS;
  const hints = [];
  Object.keys(so.keys || {}).forEach(nk => { const e = so.keys[nk]; if (e && e.k) hints.push({ label: (e.n || nk) + ' canta em', k: e.k }); });
  if (so.play) hints.push({ label: 'Tom que cantamos', k: so.play });
  const ok = origKey(so);
  if (ok && ok !== so.play) hints.push({ label: 'Tom da cifra', k: ok });
  openSheet(`<h3>${esc(so.title)}</h3><p>Tom do dia · ${esc(cultoLabel(l))}. Muda para todos.</p>
    <div class="kgrid">${list.map(k => `<button class="kchip" data-act="day-key-set" data-v="${k}" aria-pressed="${k === it.key}">${k}</button>`).join('')}</div>
    <div class="hints">${hints.map(x => `<button class="hintbtn" data-act="day-key-set" data-v="${x.k}"><span>${esc(x.label)}</span><span class="kmini">${x.k}</span></button>`).join('')}<button class="hintbtn" data-act="day-key-set" data-v="" aria-pressed="${!it.key}"><span>Sem tom</span></button></div>`, { dayKey: true, list: listId, idx, songId: so.id });
}
function setDayKey(listId, idx, k) {
  const l = listById(listId);
  const ctx = sheetEl && sheetEl._ctx;
  closeSheet();
  if (!l) return;
  const nl = clone(l), { isDiz, so } = dayKeyCtx(l, idx);
  const it = isDiz ? nl.diz : nl.items[idx];
  if (!it || !so || (ctx && ctx.songId && ctx.songId !== so.id) || (it.key || '') === (k || '')) return;
  const old = it.key || '', oldMode = it.mode;
  it.key = k || '';
  it.mode = 'manual';
  nl.up = Date.now();
  const ops = { lists: [nl] };
  const minister = (nl.minister || '').trim(), mk = minister ? normKey(minister) : '';
  const oldMk = minister && so.keys && so.keys[mk] ? clone(so.keys[mk]) : null;
  if (minister && k) {
    const ns = clone(so);
    ns.keys = ns.keys || {};
    ns.keys[mk] = { n: minister, k };
    ns.up = Date.now();
    ops.songs = [ns];
  }
  apply(ops, { what: (k ? 'Mudou o tom do dia de ' + so.title + ' para ' + k : 'Tirou o tom do dia de ' + so.title) + ' · ' + cultoLabel(nl) });
  toast(k ? 'Tom do dia agora é ' + k + ' para todos' : 'Tom do dia removido', { label: 'Desfazer', fn: () => {
    const cl = listById(nl.id);
    if (!cl) return;
    const c2 = clone(cl), it2 = isDiz ? c2.diz : c2.items[idx];
    if (!it2 || it2.songId !== so.id) return;
    it2.key = old;
    it2.mode = oldMode || 'auto';
    c2.up = Date.now();
    const uops = { lists: [c2] }, cs = songById(so.id);
    if (minister && k && cs) {
      const s2 = clone(cs);
      s2.keys = s2.keys || {};
      if (oldMk) s2.keys[mk] = oldMk; else delete s2.keys[mk];
      s2.up = Date.now();
      uops.songs = [s2];
    }
    apply(uops, { what: 'Voltou o tom do dia de ' + so.title + (old ? ' para ' + old : '') + ' · ' + cultoLabel(c2) });
  } });
}
function itemOf(st) {
  const l = st.ctx ? listById(st.ctx.list) : null;
  return l ? listSeq(l)[st.ctx.idx] || null : null;
}
function titleHTML(so, st) {
  const it = itemOf(st);
  const ver = (it && it.version) || so.version;
  const meta = [ver, so.bpm ? so.bpm + ' BPM' : ''].filter(Boolean).join(' · ');
  return `<b>${esc(so.title)}</b>${meta ? `<small>${esc(meta)}</small>` : ''}`;
}
function whereText(st) {
  const l = st.ctx ? listById(st.ctx.list) : null;
  if (!l) return 'Repertório';
  const pos = posOf(l, st.ctx.idx);
  return wd(l.date) + ' · ' + (pos.diz ? 'dízimos' : 'louvor ' + pos.g + ' de ' + pos.n + (pos.medley ? ' · emenda' : ''));
}
function videoLink(so, st) {
  const id = ytId(so.yt), it = itemOf(st);
  return id ? ytWatch(id) : ytSearch(so.title + ' ' + ((it && it.version) || so.version || ''));
}
function videoBoxHTML(so, st) {
  const id = ytId(so.yt), link = videoLink(so, st);
  if (!id) return `<a class="vbox vnone" href="${esc(link)}" target="_blank" rel="noopener"><span class="vplay">${ICON.search}</span><span class="vt">Procurar no YouTube</span><small>Este louvor ainda não tem vídeo. Cole o link em Editar.</small></a>`;
  if (CFG.noEmbed) return `<a class="vbox" href="${esc(link)}" target="_blank" rel="noopener"><img class="vthumb" src="${esc(ytThumb(id))}" alt=""><span class="vplay">${ICON.play}</span><span class="vt">Assistir no YouTube</span></a>`;
  return `<button class="vbox" data-act="play-video" aria-label="Tocar o vídeo"><img class="vthumb" src="${esc(ytThumb(id))}" alt=""><span class="vplay">${ICON.play}</span></button>`;
}
function videoHTML(so, st) {
  return `<div class="video${st.hideVideo ? ' hid' : ''}" data-el="video" data-yt="${esc(ytId(so.yt))}">${videoBoxHTML(so, st)}
    <div class="vbar"><span data-el="where">${esc(whereText(st))}</span><span class="vbar-r"><a class="minilink vmini" data-el="ytlink" href="${esc(videoLink(so, st))}" target="_blank" rel="noopener">YouTube</a><button class="linkbtn" data-act="toggle-video">${st.hideVideo ? 'Mostrar vídeo' : 'Esconder vídeo'}</button></span></div>
  </div>`;
}
function wireVideo(p) {
  $$('img.vthumb', p).forEach(img => img.addEventListener('error', () => img.remove(), { once: true }));
}
function stopVideo(p) {
  const fr = $('.vframe', p);
  if (!fr) return;
  const so = songById(p._st.id);
  if (!so) return;
  const t = document.createElement('div');
  t.innerHTML = videoBoxHTML(so, p._st);
  fr.replaceWith(t.firstElementChild);
  wireVideo(p);
}
function playVideo(p) {
  const v = $('[data-el="video"]', p), box = $('.vbox', v);
  const id = v ? v.dataset.yt : '';
  if (!id || !box) return;
  const fr = document.createElement('div');
  fr.className = 'vbox vframe';
  fr.innerHTML = `<iframe src="${esc(ytEmbed(id))}" title="Vídeo do louvor" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  box.replaceWith(fr);
}
const obsHTML = st => { const it = itemOf(st); return it && it.obs ? `<p class="obsnote"><b>Obs.:</b> ${esc(it.obs)}</p>` : ''; };
const keysHTML = st => (st.base ? keyList(st.base) : MAJOR_KEYS).map(k => `<button class="kchip${k === st.base ? ' base' : ''}" data-act="key" data-v="${k}" aria-pressed="false">${k}</button>`).join('');

function songPanelHTML(so, st) {
  const l = st.ctx ? listById(st.ctx.list) : null;
  return `<div class="p-head"><div class="in">
      <button class="iconbtn" data-act="close" aria-label="Voltar">${ICON.back}</button>
      <div class="p-title" data-el="title">${titleHTML(so, st)}</div>
      <button class="iconbtn pri" data-act="edit" data-id="${esc(so.id)}" aria-label="Editar louvor">${ICON.edit}</button>
    </div></div>
    <div class="p-body"><div class="p-in">
      ${videoHTML(so, st)}
      <div data-el="obs">${obsHTML(st)}</div>
      <div class="keys" data-el="keys" role="group" aria-label="Tom">${keysHTML(st)}</div>
      <div class="kinfo" data-el="kinfo"></div>
      <div class="tools">
        <div class="tool" data-el="capotool"><span class="lbl2">Capo</span><button data-act="capo" data-d="-1" aria-label="Diminuir capotraste">−</button><span class="val" data-el="capo">0</span><button data-act="capo" data-d="1" aria-label="Aumentar capotraste">+</button></div>
        <div class="tool"><button data-act="size" data-d="-1" aria-label="Diminuir letra">A−</button><button data-act="size" data-d="1" aria-label="Aumentar letra">A+</button></div>
        <button class="tool tbtn" data-act="scroll" aria-pressed="false">${ICON.scroll}<span>Rolar</span></button>
        <div class="tool" data-el="speed" hidden><span class="lbl2">Velocidade</span><button data-act="speed" data-d="-1" aria-label="Mais devagar">−</button><span class="val" data-el="speedv">2</span><button data-act="speed" data-d="1" aria-label="Mais rápido">+</button></div>
        <button class="tool tbtn" data-act="palco" aria-pressed="false">${ICON.altar}<span>Modo altar</span></button>
        <button class="tool tbtn" data-act="audio" aria-pressed="false">${ICON.phones}<span>Áudio no tom</span></button>
      </div>
      <div class="abox" data-el="abox" hidden></div>
      <div class="instbar" data-el="instbar">
        <div class="seg seg3" role="group" aria-label="Ver"><button data-act="inst" data-v="gt" aria-pressed="false">Violão</button><button data-act="inst" data-v="kb" aria-pressed="false">Teclado</button><button data-act="inst" data-v="lt" aria-pressed="false">Letra</button></div>
      </div>
      <div class="varbar" data-el="varbar">
        <div class="seg sm" role="group" aria-label="Versão da cifra" data-el="varseg"><button data-act="var" data-v="0" aria-pressed="false">Principal</button><button data-act="var" data-v="1" aria-pressed="false">Simplificada</button></div>
        <button class="linkbtn" data-act="toggle-chords" data-el="chordsbtn">Esconder acordes</button>
      </div>
      <p class="instnote" data-el="instnote" hidden></p>
      <div class="dstrip" data-el="dstrip" role="list" aria-label="Acordes da cifra" hidden></div>
      <div class="cifra" data-el="cifra"></div>
      <div data-el="nav">${l ? navHTML(l, st.ctx.idx) : ''}</div>
    </div></div>`;
}

/* dados mudaram com o louvor aberto: atualiza sem recarregar o vídeo que está tocando */
function refreshSongPanel(p, remote) {
  const st = p._st, so = songById(st.id);
  if (!so) return;
  if (st.ctx) {
    const l = listById(st.ctx.list), seq = l ? listSeq(l) : [];
    if (!seq[st.ctx.idx] || seq[st.ctx.idx].songId !== st.id) {
      const i = seq.findIndex(x => x.songId === st.id);
      st.ctx = i >= 0 ? { list: l.id, idx: i } : null;
    }
  }
  const base = baseKeyFor(so, st.ctx);
  if (base !== st.base) {
    const own = st.key && st.key !== st.base;
    if (!own) st.key = base;
    if (remote && st.ctx && base) toast('O tom do dia mudou para ' + base + (own ? ' (você está vendo em ' + st.key + ')' : ''));
    st.base = base;
  }
  $('[data-el="title"]', p).innerHTML = titleHTML(so, st);
  $('[data-el="obs"]', p).innerHTML = obsHTML(st);
  $('[data-el="keys"]', p).innerHTML = keysHTML(st);
  const v = $('[data-el="video"]', p);
  if (v.dataset.yt !== ytId(so.yt)) {
    const t = document.createElement('div');
    t.innerHTML = videoHTML(so, st);
    v.replaceWith(t.firstElementChild);
    wireVideo(p);
  } else {
    $('[data-el="where"]', p).textContent = whereText(st);
    $('[data-el="ytlink"]', p).href = videoLink(so, st);
  }
  const l = st.ctx ? listById(st.ctx.list) : null;
  $('[data-el="nav"]', p).innerHTML = l ? navHTML(l, st.ctx.idx) : '';
  updateSongPanel(p, false);
}

function navHTML(l, i) {
  const seq = listSeq(l);
  const prev = seq[i - 1], next = seq[i + 1];
  const t = x => esc((songById(x.songId) || {}).title || '');
  const nextLbl = !next ? 'Próximo' : (l.diz && i + 1 === l.items.length) ? 'Dízimos' : seq[i].join ? 'Emenda com' : 'Próximo';
  return `<nav class="snav" aria-label="Ordem do culto">
    <button data-act="nav" data-d="-1" ${prev ? '' : 'disabled'}><small>Anterior</small><b>${prev ? t(prev) : '—'}</b></button>
    <button class="nx" data-act="nav" data-d="1" ${next ? '' : 'disabled'}><small>${nextLbl}</small><b>${next ? t(next) : 'Fim do culto'}</b></button>
  </nav>`;
}

function kinfoHTML(so, st) {
  const day = !!st.ctx, cf = cifraFor(so, S.inst, S.simple), orig = cf.key;
  const lines = [];
  if (S.letra) return st.base ? `<p>${day ? 'Tom do dia' : 'Tom'} <b>${st.base}</b></p>` : '';
  if (!st.base) lines.push(st.key ? `Vendo em <b>${st.key}</b>, só na sua tela` : 'Tom ainda não definido para este louvor.');
  else if (st.key === st.base) {
    const lbl = day ? 'Tom do dia' : (so.play ? 'Tom que cantamos' : 'Tom');
    lines.push(`${lbl} <b>${st.base}</b>${cf.text && orig && st.base !== orig ? ' · cifra escrita em ' + orig : ''}`);
  } else {
    lines.push(`Vendo em <b>${st.key}</b>, só na sua tela · <button class="linkbtn" data-act="key" data-v="${st.base}">Voltar para ${st.base}</button>`);
  }
  if (st.key && S.inst === 'gt') {
    if (st.capo > 0) lines.push(`Capo ${st.capo} · formas de <b>${shiftKey(st.key, -st.capo)}</b>, soando em ${st.key}`);
    else {
      const h = capoHint(st.key);
      if (h) lines.push(`Violão: capo ${h.capo} com formas de ${h.shape}? <button class="linkbtn" data-act="capo-set" data-v="${h.capo}">Usar</button>`);
    }
  }
  return lines.map(x => `<p>${x}</p>`).join('');
}

function chordLineHTML(text) {
  let html = '', i = 0;
  const tm = /^(\s*)(\[[^\]]*\])/.exec(text);
  if (tm) { html += tm[1] + '<span class="tg">' + esc(tm[2]) + '</span>'; i = tm[0].length; }
  html += text.slice(i).replace(/(\S+)|(\s+)/g, (m, tok, sp) => {
    if (sp) return sp;
    if (!NEUTRAL_RE.test(tok) && chordTok(tok)) return '<b>' + esc(tok) + '</b>';
    return '<span class="tg">' + esc(tok) + '</span>';
  });
  return html;
}
function lyricHTML(t) {
  const m = /^(\s*)(\[[^\]]*\])(.*)$/.exec(t);
  if (m) return esc(m[1]) + '<span class="tg">' + esc(m[2]) + '</span>' + esc(m[3]);
  return esc(t);
}

function renderLetra(p) {
  const so = songById(p._st.id), el = $('[data-el="cifra"]', p);
  const { lines } = lyricsOf(so);
  el.classList.add('letra');
  if (!lines.length) {
    el.innerHTML = `<div class="cempty"><p>Este louvor ainda não tem letra.</p><button class="btn pri" data-act="edit" data-id="${esc(so.id)}" data-tab="lt">${ICON.plus}Colar a letra</button></div>`;
    return;
  }
  el.innerHTML = lines.map(l => l.t === 'sec' ? `<div class="lsec">${esc(l.text)}</div>` : l.t === 'blank' ? '<div class="lgap"></div>' : `<p class="lln">${esc(l.text)}</p>`).join('');
  fitCifra(p);
}
function renderCifra(p) {
  const st = p._st, so = songById(st.id);
  const el = $('[data-el="cifra"]', p), strip = $('[data-el="dstrip"]', p), note = $('[data-el="instnote"]', p);
  if (S.letra) { note.hidden = true; strip.hidden = true; strip.innerHTML = ''; renderLetra(p); return; }
  el.classList.remove('letra');
  const cf = cifraFor(so, S.inst, S.simple);
  note.hidden = !(cf.text && cf.fallback);
  note.textContent = cf.fallback ? (S.inst === 'kb' ? 'Este louvor ainda não tem cifra de teclado. Mostrando a do violão.' : 'Este louvor só tem a cifra de teclado.') : '';
  if (!cf.text) {
    el.innerHTML = `<div class="cempty"><p>Este louvor ainda não tem cifra.</p><button class="btn pri" data-act="edit" data-id="${esc(so.id)}">${ICON.plus}Colar a cifra</button></div>`;
    strip.innerHTML = '';
    strip.hidden = true;
    return;
  }
  /* cifra sem acordes reconhecidos: mostra como está, sem trocar o tom */
  const known = cf.key, orig = known || 'C';
  const view = known ? (st.key || orig) : orig;
  const capo = S.inst === 'gt' ? st.capo : 0;
  const shown = known && capo ? shiftKey(view, -capo) : view;
  const moved = shown !== orig;
  const lines = processCifra(cf.text, orig, shown);
  let noted = false;
  el.innerHTML = lines.map(l => {
    if (l.type === 'blank') return '<div class="ln blank"></div>';
    if (l.type === 'tab') {
      let tn = '';
      if (moved && !noted) { noted = true; tn = '<div class="ln tabnote">A tablatura fica no tom original.</div>'; }
      return tn + `<div class="ln tab">${esc(l.text)}</div>`;
    }
    if (l.type === 'section') return `<div class="ln sec">${esc(l.text.trim().replace(/^\[([^\]]*)\]/, '$1'))}</div>`;
    if (l.type === 'chords') return `<div class="ln ch">${chordLineHTML(l.text)}</div>`;
    return `<div class="ln">${lyricHTML(l.text)}</div>`;
  }).join('');
  /* desenhos dos acordes, na ordem em que aparecem */
  const names = S.chords ? chordsOfLines(lines) : [];
  strip.hidden = !names.length;
  strip.innerHTML = names.map(n => `<button class="dchip" data-act="chord" data-v="${esc(n)}" role="listitem" aria-label="Acorde ${esc(n)}">${S.inst === 'gt' ? guitarSVG(n) : keyboardSVG(n)}</button>`).join('');
  fitCifra(p);
}

function fitCifra(p) {
  const st = p._st, el = $('[data-el="cifra"]', p);
  if (!el) return;
  let size;
  if (S.letra) {
    size = st.lsize || 20;
    if (st.palco) size += 6;
    st.cur = size;
    el.style.setProperty('--lsize', size + 'px');
    return;
  }
  if (st.size) size = st.size;
  else {
    const lens = $$('.ln', el).filter(n => !n.classList.contains('sec') && !n.classList.contains('tabnote')).map(n => n.textContent.length);
    const max = Math.max(24, ...lens);
    const w = el.clientWidth || 340;
    size = Math.max(13, Math.min(19, Math.floor(w / (max * MONO_RATIO))));
  }
  if (st.palco) size += 4;
  st.cur = size;
  el.style.setProperty('--csize', size + 'px');
}

function updateSongPanel(p, first) {
  const st = p._st, so = songById(st.id);
  if (!so) { removePanel(p); return; }
  const gt = S.inst === 'gt' && !S.letra;
  const cif = S.letra ? lyricsOf(so).lines.length > 0 : !!cifraFor(so, S.inst).text;
  $$('.kchip', p).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.key)));
  $('[data-el="keys"]', p).hidden = S.letra;
  $('[data-el="capotool"]', p).hidden = !gt;
  $('[data-el="capo"]', p).textContent = st.capo;
  $('[data-act="capo"][data-d="-1"]', p).disabled = st.capo <= 0;
  $('[data-act="capo"][data-d="1"]', p).disabled = st.capo >= 7;
  $$('[data-act="size"]', p).forEach(b => { b.disabled = !cif; });
  const sc = $('[data-act="scroll"]', p);
  sc.disabled = !cif;
  sc.setAttribute('aria-pressed', String(st.scroll));
  $('span', sc).textContent = st.scroll ? 'Pausar' : 'Rolar';
  $('[data-el="speed"]', p).hidden = !st.scroll;
  $('[data-el="speedv"]', p).textContent = st.speed;
  $('[data-act="palco"]', p).setAttribute('aria-pressed', String(st.palco));
  p.classList.toggle('palco', st.palco);
  $$('[data-act="inst"]', p).forEach(b => b.setAttribute('aria-pressed', String(S.letra ? b.dataset.v === 'lt' : b.dataset.v === S.inst)));
  const cb = $('[data-el="chordsbtn"]', p);
  cb.textContent = S.chords ? 'Esconder acordes' : 'Mostrar acordes';
  cb.hidden = !cif || S.letra;
  const simpleOk = !S.letra && hasSimple(so, S.inst);
  $('[data-el="varseg"]', p).hidden = !simpleOk;
  $$('[data-act="var"]', p).forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === '1') === (S.simple && simpleOk))));
  $('[data-el="varbar"]', p).hidden = S.letra || (!simpleOk && cb.hidden);
  $('[data-act="audio"]', p).setAttribute('aria-pressed', String(!!st.audioOpen));
  $('[data-el="video"]', p).classList.toggle('hid', st.hideVideo);
  $('[data-act="toggle-video"]', p).textContent = st.hideVideo ? 'Mostrar vídeo' : 'Esconder vídeo';
  $('[data-el="kinfo"]', p).innerHTML = kinfoHTML(so, st);
  renderCifra(p);
  if (first) {
    const wrap = $('[data-el="keys"]', p), b = $('.kchip[aria-pressed="true"]', p);
    if (wrap && b) wrap.scrollLeft = b.offsetLeft - (wrap.clientWidth - b.offsetWidth) / 2;
  }
}

const SPEEDS = [0, 9, 14, 20, 28, 38];
function startScroll(p) {
  const st = p._st, body = $('.p-body', p);
  let last = performance.now(), acc = 0;
  const step = now => {
    if (!st.scroll || !p.isConnected) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += SPEEDS[st.speed] * dt;
    if (acc >= 1) { const px = Math.floor(acc); body.scrollTop += px; acc -= px; }
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) { st.scroll = false; updateSongPanel(p); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ===== Áudio no tom: um áudio do celular tocado no tom que a pessoa está vendo =====
   (o YouTube não deixa mudar o tom do vídeo; o arquivo fica só neste aparelho) */
let AUDIO = null;
const audioMod = async () => AUDIO || (AUDIO = await import('./audio.js'));
const fmtT = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function tonsTxt(n) {
  if (!n) return 'no tom da gravação';
  const a = Math.abs(n), w = Math.floor(a / 2), h = a % 2;
  return (w ? String(w) : '') + (h ? '½' : '') + (w >= 2 ? ' tons' : ' tom') + (n > 0 ? ' acima' : ' abaixo');
}
const audioTarget = st => st.key || st.base || '';
function audioShift(p) {
  const st = p._st, au = st.au, tg = audioTarget(st);
  if (!au || !au.rec || !tg) return 0;
  return semisOf(keyInfo(au.rec).pc, keyInfo(tg).pc);
}
function semisOf(a, b) { let n = ((b - a) % 12 + 12) % 12; if (n > 6) n -= 12; return n; }
function ytToneLink(so, k) { return ytSearch(`${so.title} ${so.version || ''} tom ${k || ''} playback`.replace(/\s+/g, ' ').trim()); }
async function toggleAudio(p) {
  const st = p._st, box = $('[data-el="abox"]', p);
  st.audioOpen = !st.audioOpen;
  box.hidden = !st.audioOpen;
  updateSongPanel(p);
  if (!st.audioOpen) { if (st.au && st.au.player) st.au.player.pause(); return; }
  if (!st.au) {
    st.au = { name: '', rec: '', s: { status: 'idle' }, player: null };
    renderAudio(p);
    const mod = await audioMod();
    const saved = await mod.getSaved(st.id);
    /* só troca a caixa se havia áudio guardado (e a pessoa ainda não escolheu outro) */
    if (saved && saved.blob && p.isConnected && !st.au.name) startAudio(p, saved.blob, saved.name, saved.rec);
    return;
  }
  renderAudio(p);
}
async function startAudio(p, blob, name, rec) {
  const st = p._st, so = songById(st.id), mod = await audioMod();
  if (st.au.player) st.au.player.close();
  st.au.name = name || 'áudio';
  st.au.rec = rec || origKey(so) || audioTarget(st) || '';
  st.au.player = mod.createPlayer(s => { st.au.s = s; if (p.isConnected) renderAudio(p); });
  st.au.player.setShift(audioShift(p));
  renderAudio(p);
  await st.au.player.load(blob);
}
function audioFile(p, input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const st = p._st;
  if (f.size > 40 * 1024 * 1024) { toast('Esse arquivo é grande demais (máximo 40 MB).'); return; }
  audioMod().then(mod => {
    const rec = (st.au && st.au.rec) || origKey(songById(st.id)) || audioTarget(st) || '';
    mod.saveAudio(st.id, { blob: f, name: f.name, rec }).catch(() => toast('Não deu para guardar o áudio neste aparelho; ele vale só enquanto a tela estiver aberta.'));
    startAudio(p, f, f.name, rec);
  });
}
function audioRetune(p) {
  const st = p._st;
  if (!st.au || !st.au.player) return;
  st.au.player.setShift(audioShift(p));
  renderAudio(p);
}
function audioPlay(p) {
  const au = p._st.au;
  if (!au || !au.player) return;
  if (au.s.playing) au.player.pause();
  else { stopVideo(p); au.player.play(); tickAudio(p); }
}
async function audioRemove(p) {
  const st = p._st, mod = await audioMod();
  if (st.au && st.au.player) st.au.player.close();
  await mod.dropAudio(st.id);
  st.au = { name: '', rec: '', s: { status: 'idle' }, player: null };
  renderAudio(p);
  toast('Áudio removido deste aparelho');
}
function tickAudio(p) {
  const au = p._st.au;
  if (!au || !au.player || !au.s.playing || !p.isConnected) return;
  const t = au.player.time(), r = $('[data-au="seek"]', p), tt = $('[data-el="at"]', p);
  if (r && !r._drag) r.value = String(Math.round(1000 * t / (au.s.dur || 1)));
  if (tt) tt.textContent = fmtT(t);
  requestAnimationFrame(() => tickAudio(p));
}
function renderAudio(p) {
  const st = p._st, so = songById(st.id), box = $('[data-el="abox"]', p), au = st.au;
  if (!box || !so || !au) return;
  const tg = audioTarget(st), n = audioShift(p), s = au.s || {};
  const yt = `<a class="minilink" href="${esc(ytToneLink(so, tg))}" target="_blank" rel="noopener">Procurar no YouTube${tg ? ' em ' + esc(tg) : ''}</a>`;
  const pick = label => `<label class="btn${au.name ? '' : ' pri'} afile">${ICON.music}<span>${label}</span><input type="file" accept="audio/*" data-au="file" hidden></label>`;
  if (!au.name) {
    box.innerHTML = `<p class="ah">Ouvir em outro tom</p>
      <p class="hint">O vídeo do YouTube não deixa mudar o tom. Escolha o áudio desta música que você tem no celular (MP3, M4A…) e o app toca no tom que você está vendo. O arquivo fica só neste aparelho.</p>
      <div class="arow">${pick('Escolher áudio do celular')}${yt}</div>`;
    return;
  }
  if (s.status === 'error') {
    box.innerHTML = `<p class="ah">${esc(au.name)}</p><p class="note bad">${ICON.info}<span>${s.error === 'decode' ? 'Não consegui abrir esse arquivo. Tente um MP3 ou M4A.' : 'Não deu para preparar o áudio neste aparelho.'}</span></p>
      <div class="arow">${pick('Escolher outro áudio')}<button class="linkbtn" data-act="a-del">Remover</button></div>`;
    return;
  }
  const busy = s.status === 'loading' || s.status === 'preparing' || s.status === 'idle';
  const recOpts = ALL_KEYS.map(k => `<option${k === au.rec ? ' selected' : ''}>${k}</option>`).join('');
  box.innerHTML = `<p class="ah">${esc(au.name)}</p>
    <div class="aplayer">
      <button class="aplay" data-act="a-play" ${busy ? 'disabled' : ''} aria-label="${s.playing ? 'Pausar' : 'Tocar'}">${s.playing ? ICON.pause : ICON.play}</button>
      <div class="aprog"><input type="range" min="0" max="1000" step="1" value="${Math.round(1000 * (s.t || 0) / (s.dur || 1))}" data-au="seek" aria-label="Posição da música" ${busy ? 'disabled' : ''}>
        <div class="atime"><span data-el="at">${fmtT(s.t)}</span><span>${busy ? (s.status === 'preparing' ? 'Preparando em ' + esc(tg) + '…' : 'Abrindo…') : fmtT(s.dur)}</span></div></div>
    </div>
    <p class="ainfo">Gravação em <span class="selw sm"><select class="inp asel" data-au="rec" aria-label="Tom da gravação">${au.rec ? '' : '<option value="" selected>?</option>'}${recOpts}</select></span> → ${tg && au.rec ? `tocando em <b>${esc(tg)}</b> · ${tonsTxt(n)}` : 'tocando no tom original. Escolha o tom da gravação e um tom acima para mudar.'}</p>
    ${Math.abs(n) > 4 ? '<p class="hint">Mudança grande: o som pode ficar um pouco artificial.</p>' : ''}
    <p class="hint">Se a gravação estiver em outro tom, ajuste em "Gravação em".</p>
    <div class="arow">${pick('Trocar áudio')}<button class="linkbtn" data-act="a-del">Remover</button>${yt}</div>`;
  if (s.playing) tickAudio(p);
}
function audioInput(p, t) {
  const st = p._st, au = st.au;
  if (t.dataset.au === 'file') { audioFile(p, t); return; }
  if (!au || !au.player) return;
  if (t.dataset.au === 'seek') { t._drag = false; au.player.seek(+t.value / 1000); return; }
  if (t.dataset.au === 'rec') {
    au.rec = t.value;
    audioMod().then(mod => mod.getSaved(st.id).then(sv => { if (sv) mod.saveAudio(st.id, Object.assign(sv, { rec: au.rec })).catch(() => {}); }));
    au.player.setShift(audioShift(p));
    renderAudio(p);
  }
}

/* Modo altar: esconde o vídeo, os tons e os desenhos, aumenta a cifra e mantém a tela acesa */
async function togglePalco(p) {
  const st = p._st;
  st.palco = !st.palco;
  queueSyncBack();
  if (st.palco) stopVideo(p);
  updateSongPanel(p);
  try {
    if (st.palco && navigator.wakeLock && !st.lock) st.lock = await navigator.wakeLock.request('screen');
    else if (!st.palco && st.lock) { await st.lock.release(); st.lock = null; }
  } catch (e) { st.lock = null; }
}

function navSong(p, d) {
  const st = p._st;
  if (!st.ctx) return;
  const l = listById(st.ctx.list);
  const seq = l ? listSeq(l) : [];
  const i = st.ctx.idx + d;
  if (!l || i < 0 || i >= seq.length) return;
  removePanel(p);
  openSong(seq[i].songId, { list: l.id, idx: i }, true);
}

/* acorde tocado (no desenho ou na cifra): desenho grande e outras posições */
function openChordSheet(name, inst) {
  const nm = String(name || '').replace(/^\((.*)\)$/, '$1');
  const tp = topPanel(), st = tp && tp._st;
  const kbView = (inst || S.inst) === 'kb';
  let h = `<h3 class="chordh">${esc(nm)}</h3>`;
  if (kbView) {
    const kb = keyboardNotes(nm);
    h += `<p>Teclado${kb ? ' · ' + esc(kb.names.join(' · ')) : ''}</p><div class="bigdg kbig">${keyboardSVG(nm)}</div>`;
    if (kb && kb.notes.some(x => x.bass)) h += '<p class="hint">Em laranja, a nota do baixo (mão esquerda).</p>';
  } else {
    const shapes = guitarShapes(nm, 3);
    h += `<p>Violão${st && st.capo && S.inst === 'gt' ? ' · forma com capo na ' + st.capo + 'ª casa' : ''}</p><div class="bigdg">${guitarSVG(nm, shapes[0] || null)}</div>`;
    if (shapes.length > 1) h += `<div class="flabel mt">Outras posições</div><div class="altdg">${shapes.slice(1).map(s => guitarSVG(nm, s)).join('')}</div>`;
  }
  h += `<div class="sbtns"><button class="btn" data-act="chord-inst" data-v="${kbView ? 'gt' : 'kb'}" data-c="${esc(nm)}">${kbView ? 'Ver no violão' : 'Ver no teclado'}</button><button class="btn pri" data-act="sheet-done">Fechar</button></div>`;
  openSheet(h);
}

/* ===== Montar / editar o culto ===== */
function nextServiceDate() {
  const t = dObj(today());
  for (let i = 0; i < 8; i++) {
    const d = new Date(t);
    d.setDate(t.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 5) return isoOf(d);
  }
  return today();
}
function listIdFor(date) {
  const base = 'l' + date.replace(/-/g, '');
  let id = base, n = 2;
  while (listById(id)) id = base + 'n' + (n++);
  return id;
}
const songIn = (d, id) => songById(id) || (d.newSongs || []).find(s => s.id === id);
function autoKey(d, so) { return ministerKey(so, d.minister) || so.play || origKey(so) || ''; }
const blankSong = (title, version) => ({ id: uid('s'), title, version: version || '', play: '', key: '', bpm: null, yt: '', cifra: '', cifraKb: '', keyKb: '', cifraS: '', keyS: '', cifraKbS: '', keyKbS: '', letra: '', up: 0, keys: {} });

function itemFromParsed(d, pi) {
  let so = matchSong(pi.title, pi.version, d.newSongs);
  if (!so) {
    so = blankSong(titleCase(pi.title), pi.version ? titleCase(pi.version) : '');
    d.newSongs.push(so);
  }
  const version = pi.version && normKey(pi.version) !== normKey(so.version) ? titleCase(pi.version) : '';
  return { songId: so.id, key: pi.key || autoKey(d, so), version, obs: pi.obs || '', join: !!pi.join, mode: pi.key ? 'manual' : 'auto' };
}

function openListEditor(id, opts) {
  opts = opts || {};
  const src = opts.draft || (id ? listById(id) : null);
  const date0 = nextServiceDate();
  const d = src ? clone(src) : { id: '', date: date0, minister: '', kind: defaultKind(date0), name: '', reh: defaultReh(date0, defaultKind(date0), '', DATA.prefs), aviso: '', items: [], diz: null };
  if (!Array.isArray(d.newSongs)) d.newSongs = [];
  if (!Array.isArray(d.people)) d.people = [];
  if (typeof d.kind !== 'string') d.kind = defaultKind(d.date);
  if (typeof d.name !== 'string') d.name = '';
  if (d.reh === undefined) d.reh = defaultReh(d.date, d.kind, d.name, DATA.prefs);
  if (d._kindTouched === undefined) d._kindTouched = d.kind !== defaultKind(d.date);
  if (d._rehTouched === undefined) d._rehTouched = JSON.stringify(d.reh || null) !== JSON.stringify(defaultReh(d.date, d.kind, d.name, DATA.prefs));
  const isNew = !d.id || !listById(d.id);
  const ministers = allPeople();
  const p = openPanel(`<div class="p-head"><div class="in"><button class="txtbtn" data-act="close">Cancelar</button><b class="p-h">${isNew ? 'Novo culto' : 'Editar culto'}</b><button class="btn pri sm" data-act="save-list">Salvar</button></div></div>
  <div class="p-body"><div class="p-in">
    ${opts.note ? `<p class="note bad">${ICON.info}<span>${esc(opts.note)}</span></p>` : ''}
    <div class="pastebox${isNew ? '' : ' closed'}" data-el="pastebox">
      <label class="flabel" for="le-paste">Mensagem da escala</label>
      <textarea class="inp paste" id="le-paste" placeholder="Cole aqui a mensagem que a líder mandou no grupo. O app acha a data, o ministro, o tipo de culto, os louvores e os tons."></textarea>
      <button class="btn" data-act="parse">Montar o culto</button>
    </div>
    ${isNew ? '' : '<button class="linkbtn" data-act="show-paste">Colar a mensagem da escala de novo</button>'}
    <div class="row2">
      <div class="field"><label for="le-date">Data</label><input class="inp" type="date" id="le-date" data-l="date" value="${esc(d.date)}"></div>
      <div class="field"><label for="le-min">Ministro</label><input class="inp" id="le-min" data-l="minister" value="${esc(d.minister)}" list="le-mins" placeholder="Nome" autocomplete="off"><datalist id="le-mins">${ministers.map(m => `<option value="${esc(m)}"></option>`).join('')}</datalist></div>
    </div>
    <p class="hint dayhint" data-el="dayhint"></p>
    <p class="note" data-el="samedate" hidden></p>
    <div class="field"><span class="flabel">Tipo de culto</span>
      <div class="kinds" role="group" aria-label="Tipo de culto">${KIND_CHIPS.map(([k, t]) => `<button data-act="kind" data-v="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
      <input class="inp" id="le-kname" data-l="name" value="${esc(d.name)}" placeholder="Nome do culto (ex.: Culto de Missões)" autocomplete="off" hidden>
    </div>
    <div class="field"><span class="flabel">Ensaio</span>
      <div class="row2"><input class="inp" type="date" id="le-rdate" data-l="rdate" aria-label="Dia do ensaio"><input class="inp" type="time" id="le-rtime" data-l="rtime" aria-label="Horário do ensaio"></div>
      <p class="hint" data-el="rehhint"></p>
    </div>
    <div class="esec"><h2>Louvores</h2><span data-el="icount"></span></div>
    <div data-el="items"></div>
    <div data-el="addwrap"><button class="addbtn" data-act="show-add" data-target="items">${ICON.plus}Adicionar louvor</button></div>
    <div class="esec"><h2>Dízimos</h2><span>opcional</span></div>
    <div data-el="diz"></div>
    <div class="field"><label for="le-aviso">Aviso <span class="opt">(opcional, aparece no fim da página)</span></label><input class="inp" id="le-aviso" data-l="aviso" value="${esc(d.aviso)}" placeholder="Ex.: Alteração no terceiro louvor" autocomplete="off"></div>
    <button class="btn pri wide" data-act="save-list">Salvar culto</button>
    ${isNew ? '' : '<button class="txtbtn danger" data-act="del-list" data-confirm="Toque de novo para excluir o culto">Excluir culto</button>'}
  </div></div>`, 'editp');
  p._d = d;
  p._kind = 'listedit';
  p._new = isNew;
  syncReh(p);
  refreshHead(p);
  refreshEditor(p);
  if (isNew && !opts.draft) setTimeout(() => { const t = $('#le-paste', p); if (t) t.focus(); }, 80);
}

/* um culto por dia: colar de novo a escala do mesmo dia atualiza o culto e o link continua o mesmo */
const sameDateList = p => p._new ? DATA.lists.find(x => x.date === p._d.date && x.id !== p._d.id) || null : null;
function refreshHead(p) {
  const d = p._d;
  const name = cultoName(d);
  $('[data-el="dayhint"]', p).textContent = isIso(d.date) ? longDate(d.date) + (name ? ' · ' + name : '') : '';
  const same = isIso(d.date) ? sameDateList(p) : null, n = $('[data-el="samedate"]', p);
  n.hidden = !same;
  n.innerHTML = same ? `${ICON.info}<span>Já existe o culto deste dia. Ao salvar, ele é atualizado e o link enviado continua o mesmo.</span>` : '';
  $$('[data-act="kind"]', p).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === (d.kind || ''))));
  $('#le-kname', p).hidden = d.kind !== 'outro';
  refreshRehHint(p);
}
function syncReh(p) {
  const d = p._d;
  $('#le-rdate', p).value = d.reh && d.reh.date ? d.reh.date : (isIso(d.date) ? d.date : '');
  $('#le-rtime', p).value = d.reh && d.reh.time ? d.reh.time : '';
}
function refreshRehHint(p) {
  const d = p._d, el = $('[data-el="rehhint"]', p);
  if (!isIso(d.date)) { el.textContent = ''; return; }
  if (isFixedReh(d.kind, d.date)) el.textContent = `Padrão: ${wd(d.date).toLowerCase()} às ${hm(REH_FIXED[d0(d.date)])}, no mesmo dia.`;
  else if (d.reh && d.reh.time) el.textContent = 'O app guarda este horário para o próximo culto deste tipo.';
  else el.textContent = 'Sem horário padrão. Escolha o horário do ensaio.';
}

function keyHintHTML(d, it, so) {
  if (!it.key) return 'sem tom';
  const mk = ministerKey(so, d.minister);
  if (mk && it.key === mk) return ICON.mic + esc(String(d.minister).split(' ')[0]);
  if (so.play && it.key === so.play) return 'nosso tom';
  if (it.key === origKey(so)) return 'da cifra';
  return 'escolhido';
}
function erowHTML(d, it, num, ref) {
  const so = songIn(d, it.songId);
  if (!so) return '';
  const ver = it.version || so.version;
  const chips = songById(so.id) ? '' : '<span class="chip new">novo no repertório</span>';
  return `<div class="erow${num === '+' ? ' joined' : ''}">
    <button class="emain" data-act="item-sheet" data-i="${ref}">
      <span class="n">${num}</span>
      <span class="et"><b>${esc(so.title)}</b>${ver ? `<small>${esc(ver)}</small>` : ''}${it.obs ? `<span class="obs">${esc(it.obs)}</span>` : ''}${chips ? `<span class="chips">${chips}</span>` : ''}</span>
      <span class="ekey"><span class="kmini${it.key ? '' : ' none'}">${it.key ? esc(it.key) : '—'}</span><small>${keyHintHTML(d, it, so)}</small></span>
    </button>
    ${ref === 'diz' || d.items.length < 2 ? '' : mvHTML('mv-item', +ref, d.items.length, '', so)}
    <button class="erm" data-act="rm-item" data-i="${ref}" aria-label="Remover ${esc(so.title)}">${ICON.x}</button>
  </div>`;
}
function refreshItems(p) {
  const d = p._d, n = d.items.length;
  if (n) d.items[n - 1].join = false;
  $('[data-el="icount"]', p).textContent = n ? n + (n === 1 ? ' louvor' : ' louvores') : '';
  const el = $('[data-el="items"]', p);
  if (!n) { el.innerHTML = `<p class="emptyline">Nenhum louvor ainda. ${p._new ? 'Cole a mensagem acima ou toque em Adicionar louvor.' : 'Toque em Adicionar louvor.'}</p>`; return; }
  let g = 0;
  el.innerHTML = d.items.map((it, i) => erowHTML(d, it, (i === 0 || !d.items[i - 1].join) ? String(++g) : '+', String(i))).join('') +
    '<p class="hint mt">Toque no louvor para trocar o tom ou emendar. As setas mudam a ordem e o × remove.</p>';
}
const acHTML = target => `<div class="ac">${ICON.search}<input class="inp" id="${target === 'diz' ? 'le-diz' : 'le-add'}" data-ac="${target}" placeholder="${target === 'diz' ? 'Buscar o louvor dos dízimos' : 'Buscar louvor para adicionar'}" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="ac-${target}" aria-autocomplete="list"><div class="ac-list" id="ac-${target}" data-el="ac-${target}" role="listbox" hidden></div></div>`;
function refreshDiz(p) {
  const d = p._d, el = $('[data-el="diz"]', p);
  if (d.diz && songIn(d, d.diz.songId)) { el.innerHTML = erowHTML(d, d.diz, '', 'diz'); return; }
  if (!$('#le-diz', el)) el.innerHTML = `<button class="addbtn" data-act="show-add" data-target="diz">${ICON.plus}Escolher o louvor dos dízimos</button>`;
}
function refreshEditor(p) { refreshItems(p); refreshDiz(p); }
function showAdd(p, target) {
  const wrap = $(target === 'diz' ? '[data-el="diz"]' : '[data-el="addwrap"]', p);
  wrap.innerHTML = acHTML(target);
  $('input', wrap).focus();
}
function retune(d) {
  d.items.concat(d.diz ? [d.diz] : []).forEach(it => {
    if (it.mode === 'manual') return;
    const so = songIn(d, it.songId);
    if (so) it.key = autoKey(d, so);
  });
}
function removeItem(d, ref) {
  if (ref === 'diz') { d.diz = null; return; }
  const i = +ref;
  if (i > 0 && d.items[i - 1].join && !d.items[i].join) d.items[i - 1].join = false;
  d.items.splice(i, 1);
}
function removeWithUndo(p, ref) {
  const d = p._d, so = songIn(d, (ref === 'diz' ? d.diz : d.items[+ref]).songId);
  const snap = clone({ items: d.items, diz: d.diz });
  removeItem(d, ref);
  refreshEditor(p);
  toast(`${so ? so.title : 'Louvor'} saiu da lista`, { label: 'Desfazer', fn: () => { d.items = snap.items; d.diz = snap.diz; if (p.isConnected) refreshEditor(p); } });
}

function acRender(p, input) {
  const target = input.dataset.ac;
  const box = $('[data-el="ac-' + target + '"]', p);
  const q = input.value, nq = norm(q).trim();
  if (!nq) { box.hidden = true; box.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); return; }
  const d = p._d;
  const pool = DATA.songs.concat(d.newSongs);
  const items = pool
    .filter(s => norm(s.title + ' ' + (s.version || '')).includes(nq))
    .sort((a, b) => (norm(a.title).startsWith(nq) ? 0 : 1) - (norm(b.title).startsWith(nq) ? 0 : 1) || byTitle(a, b))
    .slice(0, 6);
  let h = items.map(s => {
    const k = autoKey(d, s);
    const meta = [s.version, hasCifra(s) ? '' : 'sem cifra'].filter(Boolean).join(' · ');
    return `<button class="ac-item" data-act="ac-pick" data-target="${target}" data-id="${esc(s.id)}" role="option"><b>${esc(s.title)}</b>${k ? `<span class="kmini">${esc(k)}</span>` : '<span></span>'}${meta ? `<small>${esc(meta)}</small>` : ''}</button>`;
  }).join('');
  if (!items.some(s => normKey(s.title) === normKey(q))) h += `<button class="ac-item new" data-act="ac-new" data-target="${target}" role="option"><b>${ICON.plus}Novo no repertório: “${esc(titleCase(q))}”</b></button>`;
  box.innerHTML = h;
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
function addToList(p, target, so) {
  const d = p._d;
  const entry = { songId: so.id, key: autoKey(d, so), version: '', obs: '', join: false, mode: 'auto' };
  if (target === 'diz') { d.diz = entry; $('[data-el="diz"]', p).innerHTML = ''; refreshDiz(p); return; }
  d.items.push(entry);
  refreshItems(p);
  toast(`${so.title} entrou na lista`);
}

/* folha do louvor dentro do culto: tom do dia, observação, emenda, ordem — tudo vale na hora */
function sheetItem(ctx) {
  const d = ctx.p._d;
  return ctx.ref === 'diz' ? d.diz : d.items[+ctx.ref];
}
function itemSheetHTML(ctx) {
  const d = ctx.p._d, it = sheetItem(ctx), so = songIn(d, it.songId);
  const isDiz = ctx.ref === 'diz', i = isDiz ? -1 : +ctx.ref, n = d.items.length;
  const base = it.key || so.play || origKey(so);
  const list = base ? keyList(base) : ALL_KEYS;
  const hints = [];
  Object.keys(so.keys || {}).forEach(nk => { const e = so.keys[nk]; if (e && e.k) hints.push({ label: (e.n || nk) + ' canta em', k: e.k }); });
  if (so.play) hints.push({ label: 'Tom que cantamos', k: so.play });
  const ok = origKey(so);
  if (ok && ok !== so.play) hints.push({ label: 'Tom da cifra', k: ok });
  return `<h3>${esc(so.title)}</h3>${so.version ? `<p>${esc(so.version)}</p>` : ''}
    <div class="flabel mt">Tom do dia</div>
    <div class="kgrid">${list.map(k => `<button class="kchip" data-act="sheet-key" data-v="${k}" aria-pressed="${k === it.key}">${k}</button>`).join('')}</div>
    <div class="hints">${hints.map(x => `<button class="hintbtn" data-act="sheet-key" data-v="${x.k}"><span>${esc(x.label)}</span><span class="kmini">${x.k}</span></button>`).join('')}<button class="hintbtn" data-act="sheet-key" data-v="" aria-pressed="${!it.key}"><span>Sem tom</span></button></div>
    <div class="field"><label for="is-obs">Observação <span class="opt">(opcional)</span></label><input class="inp" id="is-obs" value="${esc(it.obs || '')}" placeholder="Ex.: entra só voz e teclado" autocomplete="off"></div>
    ${isDiz ? '' : `<button class="toggle" data-act="sheet-join" aria-pressed="${!!it.join}" ${i >= n - 1 ? 'disabled' : ''}>${ICON.link}<span>Emendar com o próximo louvor</span><span class="sw" aria-hidden="true"></span></button>`}
    <div class="sbtns">
      ${isDiz ? '' : `<button class="btn" data-act="sheet-mv" data-d="-1" ${i <= 0 ? 'disabled' : ''}>${ICON.up}Subir</button><button class="btn" data-act="sheet-mv" data-d="1" ${i >= n - 1 ? 'disabled' : ''}>${ICON.down}Descer</button>`}
      <button class="btn danger" data-act="sheet-rm">${ICON.x}${isDiz ? 'Tirar dos dízimos' : 'Remover'}</button>
    </div>
    <button class="btn pri wide" data-act="sheet-done">Pronto</button>`;
}
function openItemSheet(p, ref) { const ctx = { p, ref }; openSheet(itemSheetHTML(ctx), ctx); }
function renderItemSheet() {
  if (sheetEl && sheetEl._ctx && sheetEl._ctx.p) $('.sheet', sheetEl).innerHTML = itemSheetHTML(sheetEl._ctx);
}

function cleanItem(it) {
  return { songId: it.songId, key: it.key || '', version: (it.version || '').trim(), obs: (it.obs || '').trim(), join: !!it.join, mode: it.mode || 'auto' };
}
function saveList(p) {
  const d = p._d;
  if (!isIso(d.date)) { toast('Escolha a data'); return; }
  if (!d.items.length && !d.diz) { toast('Coloque pelo menos um louvor'); return; }
  if (d.kind === 'outro' && !(d.name || '').trim()) { toast('Escreva o nome do culto'); $('#le-kname', p).focus(); return; }
  const seq = d.items.concat(d.diz ? [d.diz] : []);
  const used = new Set(seq.map(it => it.songId));
  /* louvores novos e tons de cada ministro vão junto para o repertório */
  const touched = new Map();
  d.newSongs.filter(s => used.has(s.id) && !songById(s.id)).forEach(s => touched.set(s.id, Object.assign(clone(s), { up: Date.now() })));
  const getS = id => touched.get(id) || (songById(id) ? clone(songById(id)) : null);
  const minister = (d.minister || '').trim();
  seq.forEach(it => {
    const so = getS(it.songId);
    if (!so) return;
    let ch = false;
    if (it.version && !so.version) { so.version = it.version; it.version = ''; ch = true; }
    if (minister && it.key) {
      so.keys = so.keys || {};
      const mk = normKey(minister), e = so.keys[mk];
      if (!e || e.k !== it.key || e.n !== minister) { so.keys[mk] = { n: minister, k: it.key }; ch = true; }
    }
    if (ch) { so.up = Date.now(); touched.set(so.id, so); }
  });
  const same = sameDateList(p);
  const id = (!p._new && d.id) ? d.id : same ? same.id : listIdFor(d.date);
  const reh = d.reh && d.reh.time ? { date: isIso(d.reh.date) ? d.reh.date : d.date, time: d.reh.time } : null;
  const list = { id, date: d.date, minister, kind: d.kind || '', name: d.kind === 'outro' ? d.name.trim() : '', reh, aviso: (d.aviso || '').trim(), items: d.items.map(cleanItem), diz: d.diz ? cleanItem(d.diz) : null, up: Date.now() };
  const isNew = p._new;
  apply({ songs: [...touched.values()], lists: [list], people: mergeNames(d.people, minister ? [minister] : []), reh: rehMemo(list) }, { what: (isNew ? 'Criou o ' : 'Editou o ') + cultoLabel(list) });
  removePanel(p);
  const tp = topPanel();
  if (!(tp && tp._kind === 'list' && tp._id === id)) {
    while (stack.length) closePanel();
    S.tab = 'cultos';
    renderTabs();
    openList(id, true);
  }
  toast(isNew ? 'Culto salvo. Agora é só enviar no WhatsApp.' : 'Culto salvo');
}
function deleteList(p) {
  const id = p._d.id, old = listById(id);
  if (!old) { removePanel(p); return; }
  apply({ delLists: [id] }, { what: 'Excluiu o ' + cultoLabel(old) });
  removePanel(p);
  stack.slice().forEach(x => { if (x._kind === 'list' && x._id === id) removePanel(x); });
  toast('Culto excluído', { label: 'Desfazer', fn: () => { apply({ lists: [old] }, { what: 'Desfez a exclusão do ' + cultoLabel(old) }); openList(old.id); } });
}

/* ===== Cadastro de louvor (cifra de violão e de teclado) ===== */
const CIFRA_PH = 'Cole aqui a cifra, com os acordes na linha de cima:\n\nG                D/F#\nHá uma fonte que não seca';
const CIFRA_S_PH = 'Opcional. Cole aqui a cifra simplificada de violão (menos acordes, mais fácil de tocar).';
const CIFRA_KBS_PH = 'Opcional. Cole aqui a cifra simplificada de teclado.';
const LETRA_PH = 'Opcional. Cole aqui só a letra, para quem canta.\n\n[Refrão]\nGratidão...';
const CIFRA_KB_PH = 'Opcional. Cole aqui a cifra para teclado (no Cifra Club, escolha o instrumento Teclado).\n\nSe ficar vazio, quem escolher Teclado vê a cifra do violão.';
function keyOptions(sel, emptyLabel) {
  return `<option value=""${sel ? '' : ' selected'}>${esc(emptyLabel)}</option><optgroup label="Maiores">${MAJOR_KEYS.map(k => `<option${k === sel ? ' selected' : ''}>${k}</option>`).join('')}</optgroup><optgroup label="Menores">${MINOR_KEYS.map(k => `<option${k === sel ? ' selected' : ''}>${k}</option>`).join('')}</optgroup>`;
}
const cifraSearch = (d, kb) => 'https://www.google.com/search?q=' + encodeURIComponent(((d.title || '') + ' ' + (d.version || '') + ' cifra' + (kb ? ' teclado' : '')).trim());

function openEdit(id, opts) {
  opts = opts || {};
  const src = opts.draft || (id ? songById(id) : null);
  const d = src ? clone(src) : Object.assign(blankSong(opts.title || ''), {});
  if (!d.keys) d.keys = {};
  ['cifraKb', 'keyKb', 'cifraS', 'keyS', 'cifraKbS', 'keyKbS', 'letra'].forEach(f => { if (typeof d[f] !== 'string') d[f] = ''; });
  const isNew = !songById(d.id);
  d._kt = { key: !!d.key, keyS: !!d.keyS, keyKb: !!d.keyKb, keyKbS: !!d.keyKbS };
  d._tab = opts.tab === 'lt' || (!opts.tab && S.letra) ? 'lt' : S.inst === 'kb' ? 'kb' : 'gt';
  d._var = S.simple && d._tab !== 'lt' && hasSimple(d, d._tab) ? 's' : '';
  const versions = [...new Set(DATA.songs.map(s => s.version).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  const p = openPanel(`<div class="p-head"><div class="in"><button class="txtbtn" data-act="close">Cancelar</button><b class="p-h">${isNew ? 'Novo louvor' : 'Editar louvor'}</b><button class="btn pri sm" data-act="save">Salvar</button></div></div>
  <div class="p-body"><div class="p-in">
    <div class="field"><label for="f-title">Nome</label><input class="inp" id="f-title" data-f="title" value="${esc(d.title)}" placeholder="Ex.: Primeira Essência" autocomplete="off"></div>
    <div class="field"><label for="f-version">Versão <span class="opt">(opcional)</span></label><input class="inp" id="f-version" data-f="version" value="${esc(d.version)}" list="f-versions" placeholder="Artista ou gravação" autocomplete="off"><datalist id="f-versions">${versions.map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist></div>
    <div class="row2">
      <div class="field"><label for="f-play">Tom que cantamos</label><div class="selw"><select class="inp" id="f-play" data-f="play">${keyOptions(d.play, 'Igual à cifra')}</select></div></div>
      <div class="field"><label for="f-bpm">BPM <span class="opt">(opcional)</span></label><input class="inp" id="f-bpm" data-f="bpm" type="number" inputmode="numeric" min="30" max="240" value="${d.bpm || ''}" placeholder="Ex.: 72"></div>
    </div>
    <div class="field"><label for="f-yt">Link do YouTube <span class="opt">(opcional)</span></label><input class="inp" id="f-yt" data-f="yt" type="url" inputmode="url" value="${esc(d.yt)}" placeholder="Cole o link do vídeo" autocomplete="off"><a class="minilink" data-el="yt-search" href="${esc(ytSearch(d.title + ' ' + (d.version || '')))}" target="_blank" rel="noopener">Procurar no YouTube</a></div>
    <div class="field"><span class="flabel">Cifra e letra</span>
      <div class="seg ctabs" role="tablist" aria-label="Cifra para">
        <button role="tab" id="ct-gt" data-act="ctab" data-v="gt" aria-controls="cp-gt">Violão</button>
        <button role="tab" id="ct-kb" data-act="ctab" data-v="kb" aria-controls="cp-kb">Teclado</button>
        <button role="tab" id="ct-lt" data-act="ctab" data-v="lt" aria-controls="cp-lt">Letra</button>
      </div>
      <div class="seg sm cvar" data-el="cvar" role="group" aria-label="Versão da cifra"><button data-act="cvar" data-v="">Principal</button><button data-act="cvar" data-v="s">Simplificada</button></div>
      <div class="cpane" id="cp-gt" role="tabpanel"><textarea class="inp" id="f-cifra" data-f="cifra" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Cifra para violão" placeholder="${esc(CIFRA_PH)}">${esc(d.cifra)}</textarea></div>
      <div class="cpane" id="cp-gts" role="tabpanel"><textarea class="inp" id="f-cifras" data-f="cifraS" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Cifra simplificada para violão" placeholder="${esc(CIFRA_S_PH)}">${esc(d.cifraS)}</textarea></div>
      <div class="cpane" id="cp-kb" role="tabpanel"><textarea class="inp" id="f-cifrakb" data-f="cifraKb" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Cifra para teclado" placeholder="${esc(CIFRA_KB_PH)}">${esc(d.cifraKb)}</textarea></div>
      <div class="cpane" id="cp-kbs" role="tabpanel"><textarea class="inp" id="f-cifrakbs" data-f="cifraKbS" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Cifra simplificada para teclado" placeholder="${esc(CIFRA_KBS_PH)}">${esc(d.cifraKbS)}</textarea></div>
      <div class="cpane" id="cp-lt" role="tabpanel"><textarea class="inp ltxt" id="f-letra" data-f="letra" spellcheck="true" aria-label="Letra" placeholder="${esc(LETRA_PH)}">${esc(d.letra)}</textarea><button class="linkbtn" data-act="letra-fill" data-el="letrafill">Copiar a letra da cifra para editar</button></div>
      <div class="hint" data-el="detect" aria-live="polite"></div>
      <a class="minilink" data-el="cifra-search" href="#" target="_blank" rel="noopener">Procurar a cifra na internet</a>
    </div>
    <div class="field" data-el="keyfield"><label for="f-key" data-el="keylabel">Tom em que a cifra está escrita</label>
      ${Object.keys(SLOTS).map(k => `<div class="selw" data-el="key-${k}"><select class="inp" id="${SLOTS[k].sel}" data-f="${SLOTS[k].key}">${keyOptions(d[SLOTS[k].key], 'Descobrir pela cifra')}</select></div>`).join('')}
    </div>
    <button class="btn pri wide" data-act="save">Salvar louvor</button>
    ${isNew ? '' : '<button class="txtbtn danger" data-act="del" data-confirm="Toque de novo para excluir">Excluir louvor</button>'}
  </div></div>`, 'editp');
  p._d = d;
  p._kind = 'form';
  p._ctx = opts.ctx || null;
  setCifraTab(p, d._tab);
  if (!d.title) setTimeout(() => { const t = $('#f-title', p); if (t) t.focus(); }, 60);
}
/* campos de cifra: violão e teclado, cada um com principal e simplificada */
const SLOTS = {
  gt: { text: 'cifra', key: 'key', sel: 'f-key', label: 'Tom em que a cifra está escrita', empty: 'Pode colar do jeito que vem do Cifra Club: acordes em cima, letra embaixo.' },
  gts: { text: 'cifraS', key: 'keyS', sel: 'f-keys', label: 'Tom em que a cifra simplificada está escrita', empty: 'Opcional. Cole aqui a cifra simplificada de violão (com menos acordes). Quem escolher "Simplificada" vê esta.' },
  kb: { text: 'cifraKb', key: 'keyKb', sel: 'f-keykb', label: 'Tom em que a cifra de teclado está escrita', empty: 'Opcional. Se ficar vazio, quem escolher Teclado vê a cifra do violão.' },
  kbs: { text: 'cifraKbS', key: 'keyKbS', sel: 'f-keykbs', label: 'Tom em que a cifra simplificada de teclado está escrita', empty: 'Opcional. Cole aqui a cifra simplificada de teclado. Quem escolher "Simplificada" vê esta.' }
};
const slotOf = d => d._tab === 'lt' ? 'lt' : d._tab + (d._var || '');
function setCifraTab(p, tab, v) {
  const d = p._d;
  d._tab = tab === 'kb' ? 'kb' : tab === 'lt' ? 'lt' : 'gt';
  if (v !== undefined) d._var = v === 's' ? 's' : '';
  const slot = slotOf(d), lt = slot === 'lt', kb = d._tab === 'kb';
  $$('[data-act="ctab"]', p).forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === d._tab)));
  $('[data-el="cvar"]', p).hidden = lt;
  $$('[data-act="cvar"]', p).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === (d._var || ''))));
  ['gt', 'gts', 'kb', 'kbs', 'lt'].forEach(k => { $('#cp-' + k, p).hidden = k !== slot; });
  Object.keys(SLOTS).forEach(k => { $(`[data-el="key-${k}"]`, p).hidden = k !== slot; });
  $('[data-el="keyfield"]', p).hidden = lt;
  if (!lt) {
    $('[data-el="keylabel"]', p).setAttribute('for', SLOTS[slot].sel);
    $('[data-el="keylabel"]', p).textContent = SLOTS[slot].label;
  }
  const cs = $('[data-el="cifra-search"]', p);
  cs.hidden = lt;
  cs.href = cifraSearch(d, kb);
  cs.textContent = kb ? 'Procurar a cifra de teclado na internet' : 'Procurar a cifra na internet';
  refreshDetect(p);
}
function refreshDetect(p) {
  const d = p._d, slot = slotOf(d), el = $('[data-el="detect"]', p);
  if (slot === 'lt') {
    const has = !!(d.letra && d.letra.trim()), auto = lyricsOf(Object.assign({}, d, { letra: '' })).lines.filter(l => l.t === 'ln').length;
    const fill = $('[data-el="letrafill"]', p);
    if (fill) fill.hidden = has || !auto;
    el.innerHTML = has ? 'Quem escolher <b>Letra</b> vê esta letra. Use [Refrão], [Ponte]... numa linha só para separar as partes.'
      : auto ? `Opcional. Sem letra colada, quem escolher <b>Letra</b> vê a letra tirada da cifra (${auto} linhas), sem os acordes.`
        : 'Cole aqui a letra para quem canta. Use [Refrão], [Ponte]... numa linha só para separar as partes.';
    return;
  }
  const S0 = SLOTS[slot], text = d[S0.text], keyF = S0.key;
  if (!text || !text.trim()) { el.innerHTML = S0.empty; return; }
  const n = countChordLines(text);
  const k = detectKey(text);
  if (k && !d._kt[keyF] && d[keyF] !== k) { d[keyF] = k; const sel = $('#' + S0.sel, p); if (sel) sel.value = k; }
  let h = `${n} ${n === 1 ? 'linha de acordes reconhecida' : 'linhas de acordes reconhecidas'}.`;
  if (k) h += k === d[keyF] ? ` Tom da cifra: <b>${k}</b>.` : ` Pela cifra, o tom parece ser <b>${k}</b>. <button class="linkbtn" data-act="use-key" data-v="${k}">Usar ${k}</button>`;
  else if (!n) h = 'Não achei linhas de acordes. Confira se os acordes estão numa linha só deles, em cima da letra.';
  el.innerHTML = h;
}
let detectT = null;
function refreshDetectSoon(p) { clearTimeout(detectT); detectT = setTimeout(() => { if (p.isConnected) refreshDetect(p); }, 250); }

const filled = t => !!(t && String(t).trim());
function cleanSong(d) {
  const tidy = t => (t || '').replace(/\r/g, '').replace(/\s+$/, '');
  const cifra = tidy(d.cifra), cifraKb = tidy(d.cifraKb), cifraS = tidy(d.cifraS), cifraKbS = tidy(d.cifraKbS);
  return {
    id: d.id,
    title: (d.title || '').trim(),
    version: (d.version || '').trim(),
    play: d.play || '',
    key: d.key || (filled(cifra) ? (detectKey(cifra) || '') : ''),
    bpm: d.bpm ? (Math.round(Number(d.bpm)) || null) : null,
    yt: (d.yt || '').trim(),
    cifra,
    cifraKb,
    keyKb: filled(cifraKb) ? (d.keyKb || detectKey(cifraKb) || '') : '',
    cifraS,
    keyS: filled(cifraS) ? (d.keyS || detectKey(cifraS) || '') : '',
    cifraKbS,
    keyKbS: filled(cifraKbS) ? (d.keyKbS || detectKey(cifraKbS) || '') : '',
    letra: tidy(d.letra).replace(/^\s*\n/, ''),
    keys: d.keys || {},
    up: Date.now()
  };
}
function saveSong(p) {
  const d = p._d;
  if (!(d.title || '').trim()) { toast('Escreva o nome do louvor'); $('#f-title', p).focus(); return; }
  const song = cleanSong(d);
  const was = songById(song.id);
  apply({ songs: [song] }, { what: (was ? 'Editou o louvor ' : 'Cadastrou o louvor ') + song.title });
  const ctx = p._ctx;
  removePanel(p);
  const tp = topPanel();
  if (!(tp && tp._kind === 'song' && tp._st.id === song.id)) {
    const l = ctx ? listById(ctx.list) : null;
    const idx = l ? listSeq(l).findIndex(x => x.songId === song.id) : -1;
    if (idx >= 0) openSong(song.id, { list: l.id, idx }, true);
    else { S.tab = 'louvores'; renderTabs(); openSong(song.id, null, true); }
  }
  toast('Louvor salvo');
}
function deleteSong(p) {
  const id = p._d.id, old = songById(id);
  if (!old) { removePanel(p); return; }
  const hit = DATA.lists.filter(l => listSeq(l).some(it => it.songId === id));
  const oldLists = hit.map(clone);
  const lists = hit.map(l => Object.assign(clone(l), { items: l.items.filter(it => it.songId !== id), diz: l.diz && l.diz.songId === id ? null : l.diz, up: Date.now() }));
  apply({ delSongs: [id], lists }, { what: 'Excluiu o louvor ' + old.title });
  removePanel(p);
  stack.slice().forEach(x => { if (x._kind === 'song' && x._st.id === id) removePanel(x); });
  toast('Louvor excluído', { label: 'Desfazer', fn: () => apply({ songs: [old], lists: oldLists }, { what: 'Desfez a exclusão do louvor ' + old.title }) });
}

/* ===== Escala: a líder (administrador) monta; os membros só veem o que foi salvo ===== */
const ES = { sub: 'mes', ym: '', step: 1, dstep: 1, blank: {}, hold: false };
const ymOf = iso => iso.slice(0, 7);
const escId = (date, kind, name) => date + kind + (kind === 'outro' ? '-' + normKey(name).slice(0, 30) : '');
const escById = id => (DATA.escala || []).find(e => e.id === id);
const escGet = (date, kind, name) => escById(escId(date, kind, name || ''));
const escPubGet = (date, kind) => { const e = escGet(date, kind); return e && e.pub ? e : null; };
const escOf = (date, kind, name) => escGet(date, kind, name) || Object.assign(escNew(date, kind, name), { id: escId(date, kind, name || '') });
const escH = () => ({ songById, autoKey, newListId: listIdFor, listExists: id => !!listById(id), appUrl: appUrl(), me: meName() });
const monthPub = ym => daysOf(ym, 0).some(iso => { const e = escGet(iso, 'dom'); return !!(e && e.pub); });
const escLbl = e => (e.kind === 'dom' ? 'domingo' : (escLabel(e) || 'culto').toLowerCase()) + ' ' + dm(e.date);
const escView = e => viewOf(e, DATA.lists, DATA.prefs, ES.blank[e.id] || 0);
function roster() {
  const doc = escById('membros');
  if (doc && doc.up) return doc.people.slice().sort((a, b) => a.n.localeCompare(b.n, 'pt'));
  return allPeople().map(n => ({ n, f: [] }));
}
function escMonthDocs(adm) {
  return (DATA.escala || []).filter(e => e.date && ymOf(e.date) === ES.ym && (adm || e.pub)).sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}
function esInit() {
  if (ES.ym) return;
  let s = today();
  while (dObj(s).getDay() !== 0) s = addDays(s, 1);
  ES.ym = ymOf(s);
  ES.step = ES.dstep = daysOf(ES.ym, 0).indexOf(s) + 1;
}
function esMonth(d) {
  const [y, m] = ES.ym.split('-').map(Number);
  ES.ym = isoOf(new Date(y, m - 1 + d, 1)).slice(0, 7);
  const t = today(), i = daysOf(ES.ym, 0).findIndex(x => x >= t);
  ES.step = ES.dstep = ES.ym === ymOf(t) && i >= 0 ? i + 1 : 1;
}

/* ---- gravar ---- */
const bare = e => { const o = clone(e); delete o.by; o.up = Date.now(); return o; };
function escSave(e, what, extra) {
  const o = bare(e);
  apply(Object.assign({ escala: [o] }, extra || {}), { what: what + ' · ' + escLbl(o), merge: 'esc-' + o.id });
}
function escSetSlot(e, k, val) {
  const o = clone(e);
  o.slots[k] = val;
  if (o.kind === 'dom' && !o.pub && monthPub(ymOf(o.date))) o.pub = true;
  const extra = {};
  if (k === 'min' && o.cpub) {
    const l = listFor(o, DATA.lists);
    if (l && l.minister !== val) extra.lists = [Object.assign(clone(l), { minister: val, up: Date.now() })];
  }
  escSave(o, 'Mudou a escala', extra);
}
/* louvores, dízimos, ensaio e aviso: depois de salvo, vão direto para o culto */
function escPut(e, v, what) {
  const o = bare(e);
  o.items = v.items.slice(); o.diz = v.diz || ''; o.reh = v.reh; o.aviso = (v.aviso || '').trim();
  if (o.cpub) {
    const base = listFor(o, DATA.lists), filled = v.items.filter(Boolean).length;
    ES.blank[o.id] = Math.max(0, v.items.length - Math.max(3, filled));
    if (base || filled || v.diz) {
      const l = listFromView(o, v, base, escH());
      apply({ escala: [o], lists: [l], reh: rehMemo(l) }, { what: what + ' · ' + cultoLabel(l), merge: 'esc-' + o.id });
      return;
    }
  }
  apply({ escala: [o] }, { what: what + ' · ' + escLbl(o), merge: 'esc-' + o.id });
}
function escSaveCulto(e) {
  const v = escView(e), o = bare(e);
  Object.assign(o, { pub: true, cpub: true, items: v.items.slice(), diz: v.diz || '', reh: v.reh, aviso: (v.aviso || '').trim() });
  const ops = { escala: [o] };
  if (v.items.some(Boolean) || v.diz) {
    const l = listFromView(o, v, listFor(o, DATA.lists), escH());
    ops.lists = [l];
    ops.reh = rehMemo(l);
    if (o.slots.min) ops.people = [o.slots.min];
  }
  ES.blank[o.id] = 0;
  apply(ops, { what: 'Salvou a escala · ' + escLbl(o) });
  toast('Escala salva');
}
function escSaveMonth() {
  const docs = daysOf(ES.ym, 0).map(iso => Object.assign(bare(escOf(iso, 'dom')), { pub: true }));
  apply({ escala: docs }, { what: 'Salvou a escala dos domingos de ' + monName(ES.ym) });
  toast('Escala salva');
}
/* trocar o nome: muda na lista de membros, nas escalas e nos próximos cultos */
function escRename(old, n) {
  if (!n) { const i = $('#e-mrn'); if (i) i.focus(); toast('Escreva o nome'); return; }
  if (n === old) { openEscMembers(); return; }
  const ppl = roster();
  if (ppl.some(x => x.n !== old && norm(x.n) === norm(n))) { toast(n + ' já está na lista'); return; }
  const m = ppl.find(x => x.n === old);
  if (m) m.n = n; else ppl.push({ n, f: [] });
  const docs = (DATA.escala || []).filter(e => e.slots && Object.values(e.slots).includes(old)).map(e => {
    const o = bare(e);
    Object.keys(o.slots).forEach(k => { if (o.slots[k] === old) o.slots[k] = n; });
    return o;
  });
  const lists = DATA.lists.filter(l => l.date >= today() && l.minister === old).map(l => Object.assign(clone(l), { minister: n, up: Date.now() }));
  apply({ escala: [{ id: 'membros', people: ppl, up: Date.now() }].concat(docs), lists, people: [n] }, { what: 'Mudou o nome de ' + old + ' para ' + n });
  openEscMembers();
  toast('Nome trocado' + (docs.length ? ' também nas escalas' : ''));
}
function escSaveRoster(people, what) { apply({ escala: [{ id: 'membros', people, up: Date.now() }] }, { what, merge: 'esc-membros' }); }

/* ---- telas ---- */
function escEditorHTML(e, nav, note) {
  let x = `<section class="e-ed" ${eid(e)}>${headHTML(e, nav)}${note ? `<p class="e-count">${note}</p>` : ''}${fieldsHTML(e, roster())}${cultoEditHTML(e, escView(e), DATA.songs)}`;
  x += e.cpub ? '<p class="e-done">Escala salva. O que você mudar aqui aparece na hora para todos.</p>' : '<button class="btn pri wide e-big" data-act="e-cpub">Salvar escala</button><p class="e-hint c">Só você vê até salvar.</p>';
  return x + `<button class="btn wide e-mt" data-act="e-daymsg">${ICON.send}Mensagem do dia no WhatsApp</button></section>`;
}
function escMesAdmin() {
  const sundays = daysOf(ES.ym, 0);
  ES.step = Math.max(1, Math.min(sundays.length, ES.step));
  const iso = sundays[ES.step - 1], e = escOf(iso, 'dom'), pub = monthPub(ES.ym);
  let x = `<section class="e-ed" ${eid(e)} aria-label="Montar a escala do mês">${headHTML(e, escNavHTML('e-step', ES.step, sundays.length, 'Domingo'))}
    <p class="e-count">Domingo ${ES.step} de ${sundays.length} de ${monName(ES.ym)}</p>${fieldsHTML(e, roster())}`;
  if (ES.step < sundays.length) x += `<button class="btn pri wide e-big" data-act="e-step" data-d="1">Próximo domingo · ${dm(sundays[ES.step])}${ICON.chev}</button>`;
  else if (!pub) x += '<button class="btn pri wide e-big" data-act="e-savemonth">Salvar escala</button>';
  x += `</section><div class="e-prev"><h2>Escala do mês</h2>${pub ? '<span class="e-ok">Salva</span>' : '<span class="e-hint">Só você vê até salvar</span>'}</div>`;
  x += gridHTML(sundays, escGet, { admin: true, cur: iso });
  if (pub) x += '<p class="e-done">Escala salva. O que você mudar aqui aparece na hora para todos.</p>';
  else if (ES.step < sundays.length) x += '<button class="btn wide e-mt" data-act="e-savemonth">Salvar escala</button>';
  return x + `<button class="btn pri wide e-mt" data-act="e-share">${ICON.send}Enviar imagem e mensagem</button>`;
}
function escMesMember() {
  if (!monthPub(ES.ym)) return `<div class="empty e-mt"><p>A escala dos domingos de ${monName(ES.ym)} ainda não está pronta.</p></div>`;
  return '<p class="e-top">Toque na data para ver a escala do dia.</p>' + gridHTML(daysOf(ES.ym, 0), escPubGet, { admin: false, me: meName() });
}
function escDom(adm) {
  const sundays = daysOf(ES.ym, 0);
  ES.dstep = Math.max(1, Math.min(sundays.length, ES.dstep));
  const iso = sundays[ES.dstep - 1], nav = escNavHTML('e-dstep', ES.dstep, sundays.length, 'Domingo');
  if (adm) return escEditorHTML(escOf(iso, 'dom'), nav, 'Os membros vêm da escala mensal. Se precisar, troque aqui.');
  const e = escPubGet(iso, 'dom');
  return `<section class="e-ed">${headHTML(e || escNew(iso, 'dom'), nav)}${e ? readCultoHTML(e, listFor(e, DATA.lists), escH()) : '<p class="e-note">A escala deste domingo ainda não está pronta.</p>'}</section>`;
}
function escSem(adm) {
  const list = escMonthDocs(adm).filter(e => e.kind !== 'dom');
  let x = adm ? `<button class="btn pri wide e-mt" data-act="e-add">${ICON.plus}Adicionar culto</button>` : '<p class="e-top">Toque no culto para ver a escala do dia.</p>';
  if (!list.length) x += `<div class="empty e-mt"><p>${adm ? 'Nenhum culto de sexta ou especial neste mês. Toque em Adicionar culto.' : 'Nenhuma escala de sexta ou de culto especial pronta neste mês.'}</p></div>`;
  else x += weekListHTML(list, adm, meName());
  return x;
}
function renderEscala(force) {
  const el = $('#tab-escala');
  if (!el || (ES.hold && !force)) return;
  const a = document.activeElement;
  if (!force && a && el.contains(a) && /^(SELECT|INPUT|TEXTAREA)$/.test(a.tagName)) return;
  esInit();
  const adm = isAdmin();
  let h = `<div class="vh"><div><h1>Escala</h1></div><div class="e-month"><button class="iconbtn" data-act="e-mon" data-d="-1" aria-label="Mês anterior">${ICON.back}</button><b>${monName(ES.ym)} ${ES.ym.slice(0, 4)}</b><button class="iconbtn" data-act="e-mon" data-d="1" aria-label="Próximo mês">${ICON.chev}</button></div></div>`;
  { const mine = escMonthDocs(false); if (!adm || mine.some(e => rolesOf(e, meName()).length)) h += mineHTML(mine, ES.ym, meName()); } /* para o administrador, só quando está escalado */
  h += `<div class="seg e-subs" role="group" aria-label="Escalas">${[['mes', 'Mensal'], ['dom', 'Domingo'], ['sem', 'Sexta e outros']].map(([k, t]) => `<button data-act="e-sub" data-v="${k}" aria-pressed="${ES.sub === k}">${t}</button>`).join('')}</div>`;
  h += ES.sub === 'mes' ? (adm ? escMesAdmin() : escMesMember()) : ES.sub === 'dom' ? escDom(adm) : escSem(adm);
  if (adm) h += `<button class="btn wide e-end" data-act="e-members">${ICON.users}Membros e funções</button>`;
  el.innerHTML = h;
}
/* painel de um culto (sexta e especiais) */
function escDayHTML(id, ro) {
  const e = escById(id), adm = isAdmin() && !ro;
  let h = `<div class="p-head"><div class="in"><button class="backbtn" data-act="close">${ICON.back}<span>Escala</span></button><span class="sp"></span></div></div><div class="p-body"><div class="p-in">`;
  if (!e) return h + '<p class="emptyline">Esta escala foi excluída.</p></div></div>';
  h += adm ? escEditorHTML(e, '') + `<button class="txtbtn danger" data-act="e-del" data-id="${esc(e.id)}" data-confirm="Toque de novo para excluir">Excluir esta escala</button>`
    : `<section class="e-ed">${headHTML(e)}${readCultoHTML(e, listFor(e, DATA.lists), escH())}</section>`;
  return h + '</div></div>';
}
function openEscDay(id, ro, noanim) {
  const p = openPanel(escDayHTML(id, ro), 'escp', noanim);
  p._kind = 'esc';
  p._id = id;
  p._ro = !!ro;
}
function refreshEscPanel(p, force) {
  if (ES.hold && !force) return;
  const a = document.activeElement;
  if (!force && a && p.contains(a) && /^(SELECT|INPUT|TEXTAREA)$/.test(a.tagName)) return;
  const body = $('.p-body', p), top = body ? body.scrollTop : 0;
  p.innerHTML = escDayHTML(p._id, p._ro);
  const nb = $('.p-body', p);
  if (nb) nb.scrollTop = top;
}
/* depois de uma troca: redesenha e devolve o foco para a mesma caixa */
function escRefresh(t, focusSel) {
  const p = t.closest('.panel'), id = focusSel || (t.id ? '#' + CSS.escape(t.id) : '');
  if (p) refreshEscPanel(p, true); else renderEscala(true);
  const again = id && $(id);
  if (again) try { again.focus({ preventScroll: true }); } catch (e) { /* ok */ }
}
const escCtx = el => { const s = el.closest('[data-eid]'); return s ? escOf(s.dataset.edate, s.dataset.ekind, s.dataset.ename) : null; };

/* ---- mensagens e imagem ---- */
function escDayMsg(e) {
  const v = escView(e), H = escH();
  return dayMsg(e, v.live || listFromView(e, v, null, H), H);
}
function escShowMsg(title, text) {
  openSheet(`<h3>${title}</h3><p>Assim vai aparecer no grupo.</p><pre class="e-msg">${esc(text)}</pre>
    <div class="row2"><button class="btn" data-act="e-copy">${ICON.copy}Copiar</button><a class="btn pri" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ICON.send}WhatsApp</a></div>`, { escText: text });
}
function quietCopy(t) { try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(() => {}); } catch (e) { /* ok */ } }
async function escShareMonth() {
  const ym = ES.ym, text = monthMsg(ym, escGet, appUrl());
  openSheet('<h3>Enviar no WhatsApp</h3><p>Preparando a imagem…</p>', { escText: text });
  const ctx = sheetEl._ctx;
  let url = '', blob = null;
  try {
    const c = await monthImage(ym, escGet);
    url = c.toDataURL('image/png');
    blob = await new Promise(r => c.toBlob(r, 'image/png'));
  } catch (e) { console.error(e); }
  if (!sheetEl || sheetEl._ctx !== ctx) return;
  ctx.file = blob ? new File([blob], 'escala-' + ym + '.png', { type: 'image/png' }) : null;
  let can = false;
  try { can = !!(ctx.file && navigator.canShare && navigator.canShare({ files: [ctx.file], text })); } catch (e) { can = false; }
  $('.sheet', sheetEl).innerHTML = `<h3>Enviar no WhatsApp</h3>
    <p>${can ? 'Toque em Enviar e escolha o WhatsApp e o grupo: a imagem vai junto com a mensagem, como legenda da foto.' : 'Salve a imagem e mande no grupo. Depois copie a mensagem e cole junto.'}</p>
    ${url ? `<img class="e-img" src="${url}" alt="Escala dos domingos de ${monName(ym)} em forma de tabela">` : ''}
    <pre class="e-msg">${esc(text)}</pre>
    <div class="row2"><button class="btn" data-act="e-copy">${ICON.copy}Copiar mensagem</button>${can ? `<button class="btn pri" data-act="e-sharego">${ICON.send}Enviar</button>` : url ? `<a class="btn pri" href="${url}" download="escala-${ym}.png">${ICON.image}Salvar imagem</a>` : `<a class="btn pri" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ICON.send}WhatsApp</a>`}</div>`;
}

/* ---- folhas ---- */
function openEscMembers() {
  const ppl = roster(), fns = Object.keys(EFN);
  openSheet(`<h3>Membros e funções</h3><p>Marque o que cada um costuma fazer. Na hora de escalar, essas pessoas aparecem primeiro na caixa, mas qualquer membro pode ser escolhido.</p>
    <div class="row2 e-addm"><input class="inp" id="e-mnew" placeholder="Nome do membro novo" autocomplete="off" maxlength="60" enterkeyhint="done"><button class="btn pri" data-act="e-madd">Adicionar</button></div>
    <div class="e-mlist">${ppl.length ? ppl.map(m => `<div class="e-mrow"><div class="e-mtop"><button class="e-mname" data-act="e-mren" data-n="${esc(m.n)}" aria-label="Editar o nome de ${esc(m.n)}"><b>${esc(m.n)}</b><i>${ICON.edit}</i></button><button class="iconbtn sm" data-act="e-mrm" data-n="${esc(m.n)}" aria-label="Tirar ${esc(m.n)} da lista">${ICON.x}</button></div><div class="e-fchips" role="group" aria-label="Funções de ${esc(m.n)}">${fns.map(f => `<button data-act="e-mf" data-n="${esc(m.n)}" data-r="${f}" aria-pressed="${m.f.includes(f)}">${EFN[f]}</button>`).join('')}</div></div>`).join('') : '<p class="hint">Nenhum membro ainda. Escreva o nome e toque em Adicionar.</p>'}</div>
    <button class="btn wide e-mt" data-act="sheet-done">Pronto</button>`, { members: true });
}
function openEscAdd() {
  openSheet(`<h3>Adicionar culto</h3>
    <div class="e-flabel">Tipo de culto</div><div class="kinds" id="e-sk" role="group" aria-label="Tipo de culto">${[['sex', 'Sexta'], ['jovens', 'Jovens'], ['mulheres', 'Mulheres'], ['outro', 'Outro']].map(([k, t], i) => `<button data-act="e-sk" data-v="${k}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>
    <input class="inp e-mt" id="e-sname" placeholder="Nome do culto (ex.: Vigília)" hidden autocomplete="off" maxlength="60">
    <div class="e-flabel">Dia</div><div class="e-sw" id="e-sdatew">${dateSelectHTML('sex', DATA.escala || [], today(), DATA.lists)}</div>
    <input class="inp e-mt" type="date" id="e-sother" aria-label="Outro dia" hidden>
    <button class="btn pri wide e-big" data-act="e-screate">Montar a escala</button>`);
}

/* ---- toques ---- */
function escClick(b, act, p) {
  const e = b.closest('[data-eid]') ? escCtx(b) : null;
  const top = () => { const s = $('#tab-escala .e-ed'); if (s) s.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  switch (act) {
    case 'e-mon': esMonth(+b.dataset.d); renderEscala(true); window.scrollTo(0, 0); break;
    case 'e-sub': ES.sub = b.dataset.v; renderEscala(true); break;
    case 'e-step': ES.step += +b.dataset.d; renderEscala(true); top(); break;
    case 'e-dstep': ES.dstep += +b.dataset.d; renderEscala(true); top(); break;
    case 'e-gostep': ES.step = +b.dataset.i; renderEscala(true); top(); break;
    case 'e-goday': ES.dstep = +b.dataset.i; ES.sub = 'dom'; renderEscala(true); window.scrollTo(0, 0); break;
    case 'e-day': openEscDay(b.dataset.id); break;
    case 'e-savemonth': escSaveMonth(); break;
    case 'e-cpub': if (e) escSaveCulto(e); break;
    case 'e-sadd': {
      if (!e) break;
      if (e.cpub && escView(e).live) { ES.blank[e.id] = (ES.blank[e.id] || 0) + 1; escRefresh(b); }
      else { const v = escView(e); v.items.push(''); escPut(e, v, 'Mudou os louvores'); }
      const sel = $$(`[data-eid="${CSS.escape(e.id)}"] .e-srow [data-esq]`).pop();
      if (sel) try { sel.focus(); } catch (x) { /* ok */ }
      break;
    }
    case 'e-srm': case 'e-smv': {
      if (!e) break;
      const v = escView(e), i = +b.dataset.i;
      if (act === 'e-srm') v.items.splice(i, 1);
      else { const j = i + (+b.dataset.d); if (j < 0 || j >= v.items.length) break; [v.items[i], v.items[j]] = [v.items[j], v.items[i]]; }
      escPut(e, v, 'Mudou os louvores');
      break;
    }
    case 'e-pick': case 'e-picknew': {
      if (!e) break;
      const k = b.dataset.k, sec = b.closest('[data-eid]'), inPanel = !!b.closest('.panel');
      let so = act === 'e-pick' ? songById(b.dataset.id) : null;
      if (act === 'e-picknew') {
        const title = titleCase(b.dataset.q || '');
        if (!title) break;
        so = matchSong(title);
        if (!so) { so = Object.assign(blankSong(title), { up: Date.now() }); apply({ songs: [so] }, { what: 'Cadastrou o louvor ' + title }); toast(title + ' entrou no repertório. Depois coloque a cifra.'); }
      }
      if (!so) break;
      const cur = escCtx(sec) || e, v = escView(cur);
      if (k === 'diz') v.diz = so.id; else v.items[+k] = so.id;
      escPut(cur, v, 'Mudou os louvores');
      if (inPanel) { const pp = topPanel(); if (pp && pp._kind === 'esc') refreshEscPanel(pp, true); } else renderEscala(true);
      break;
    }
    case 'e-daymsg': if (e) escShowMsg('Mensagem do dia', escDayMsg(e)); break;
    case 'e-share': escShareMonth(); break;
    case 'e-sharego': {
      const c = sheetEl && sheetEl._ctx;
      if (!c || !c.file) break;
      quietCopy(c.escText);
      navigator.share({ files: [c.file], text: c.escText }).then(() => closeSheet(), () => {});
      break;
    }
    case 'e-copy': { const c = sheetEl && sheetEl._ctx; if (c && c.escText) copyText(c.escText, 'Mensagem copiada'); break; }
    case 'e-members': openEscMembers(); break;
    case 'e-mf': {
      const ppl = roster(), m = ppl.find(x => x.n === b.dataset.n), r = b.dataset.r;
      if (!m) break;
      const k = m.f.indexOf(r);
      if (k >= 0) m.f.splice(k, 1); else m.f.push(r);
      b.setAttribute('aria-pressed', String(k < 0));
      escSaveRoster(ppl, 'Mudou as funções dos membros');
      break;
    }
    case 'e-madd': {
      const inp = $('#e-mnew'), n = titleCase((inp.value || '').trim());
      if (!n) { inp.focus(); break; }
      const ppl = roster();
      if (ppl.some(x => norm(x.n) === norm(n))) { toast(n + ' já está na lista'); break; }
      ppl.push({ n, f: [] });
      escSaveRoster(ppl, 'Adicionou ' + n + ' aos membros');
      openEscMembers();
      toast(n + ' adicionado');
      break;
    }
    case 'e-mine': openEscDay(b.dataset.id, true); break;
    case 'e-mren': {
      const n = b.dataset.n, top = b.closest('.e-mtop');
      top.innerHTML = `<div class="e-mrename"><input class="inp" id="e-mrn" value="${esc(n)}" data-old="${esc(n)}" maxlength="60" autocomplete="off" enterkeyhint="done" aria-label="Novo nome"><button class="btn pri" data-act="e-mren-ok">Salvar</button><button class="iconbtn sm" data-act="e-mren-no" aria-label="Cancelar">${ICON.x}</button></div>`;
      const inp = $('#e-mrn');
      inp.focus();
      inp.select();
      break;
    }
    case 'e-mren-no': openEscMembers(); break;
    case 'e-mren-ok': {
      const inp = $('#e-mrn');
      if (inp) escRename(inp.dataset.old, titleCase(inp.value.trim()));
      break;
    }
    case 'e-mrm': {
      const n = b.dataset.n;
      escSaveRoster(roster().filter(x => x.n !== n), 'Tirou ' + n + ' dos membros');
      openEscMembers();
      toast(n + ' saiu da lista');
      break;
    }
    case 'e-add': openEscAdd(); break;
    case 'e-sk': {
      $$('#e-sk button').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
      $('#e-sname').hidden = b.dataset.v !== 'outro';
      $('#e-sdatew').innerHTML = dateSelectHTML(b.dataset.v, DATA.escala || [], today(), DATA.lists);
      $('#e-sother').hidden = true;
      if (b.dataset.v === 'outro') $('#e-sname').focus();
      break;
    }
    case 'e-screate': {
      const k = $('#e-sk [aria-pressed="true"]').dataset.v, name = k === 'outro' ? titleCase($('#e-sname').value.trim()) : '';
      let date = $('#e-sdate').value;
      if (date === '__other') { date = $('#e-sother').value; if (!isIso(date)) { $('#e-sother').focus(); toast('Escolha o dia'); break; } }
      if (k === 'outro' && !name) { $('#e-sname').focus(); toast('Escreva o nome do culto'); break; }
      closeSheet();
      ES.sub = 'sem';
      ES.ym = ymOf(date);
      let ex = escGet(date, k, name);
      if (!ex) { ex = escOf(date, k, name); ex.name = name; escSave(ex, 'Criou a escala'); }
      renderEscala(true);
      openEscDay(ex.id);
      break;
    }
    case 'e-del': {
      const old = escById(b.dataset.id);
      if (!old) break;
      apply({ delEscala: [old.id] }, { what: 'Excluiu a escala · ' + escLbl(old) });
      if (p) removePanel(p);
      toast('Escala excluída', { label: 'Desfazer', fn: () => apply({ escala: [bare(old)] }, { what: 'Desfez a exclusão da escala · ' + escLbl(old) }) });
      break;
    }
    default: break;
  }
}
/* sugestões enquanto digita o louvor */
function escSuggest(input) {
  const box = input.parentNode.querySelector('.ac-list'), q = input.value, nq = norm(q).trim();
  if (!box) return;
  if (!nq) { box.hidden = true; box.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); return; }
  const words = nq.split(/\s+/);
  const items = DATA.songs
    .filter(s => { const t = norm(s.title + ' ' + (s.version || '')); return words.every(w => t.includes(w)); })
    .sort((a, b) => (norm(a.title).startsWith(nq) ? 0 : 1) - (norm(b.title).startsWith(nq) ? 0 : 1) || byTitle(a, b))
    .slice(0, 6);
  const k = input.dataset.esq;
  let h = items.map(s => `<button class="ac-item" data-act="e-pick" data-k="${k}" data-id="${esc(s.id)}" role="option"><b>${esc(s.title)}</b><span></span>${s.version || !hasCifra(s) ? `<small>${esc([s.version, hasCifra(s) ? '' : 'sem cifra'].filter(Boolean).join(' · '))}</small>` : ''}</button>`).join('');
  if (!items.some(s => normKey(s.title) === normKey(q))) h += `<button class="ac-item new" data-act="e-picknew" data-k="${k}" data-q="${esc(q.trim())}" role="option"><b>${ICON.plus}Novo no repertório: “${esc(titleCase(q.trim()))}”</b></button>`;
  box.innerHTML = h;
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
/* caixas de escolha */
function escChange(t) {
  if (t.id === 'e-sdate') { $('#e-sother').hidden = t.value !== '__other'; if (t.value === '__other') $('#e-sother').focus(); return true; }
  if (!t.closest || !t.closest('[data-eid]') || !isAdmin()) return false;
  const e = escCtx(t), d = t.dataset;
  if (d.ek) escSetSlot(e, d.ek, t.value);
  else if (d.esq != null) {
    /* escolher é pela lista de sugestões; aqui só trata apagar ou nome digitado igual a um louvor */
    const q = t.value.trim(), k = d.esq;
    if (!q && d.cur) {
      const v = escView(e);
      if (k === 'diz') v.diz = ''; else v.items[+k] = '';
      d.cur = '';
      ES.hold = true;
      try { escPut(e, v, 'Mudou os louvores'); } finally { ES.hold = false; }
      return true;
    }
    if (q && q !== d.cur) {
      const so = DATA.songs.find(s => norm(songLabel(s)) === norm(q)) || DATA.songs.find(s => normKey(s.title) === normKey(q));
      if (so) {
        const v = escView(e);
        if (k === 'diz') v.diz = so.id; else v.items[+k] = so.id;
        t.value = d.cur = songLabel(so);
        ES.hold = true;
        try { escPut(e, v, 'Mudou os louvores'); } finally { ES.hold = false; }
      } else t.value = d.cur; /* não escolheu da lista: volta como estava */
    }
    return true;
  } else if (d.ereh) {
    const v = escView(e);
    v.reh = Object.assign({ day: 'same', time: '' }, v.reh, { [d.ereh]: t.value });
    escPut(e, v, 'Mudou o ensaio');
  } else if (d.eaviso) {
    const v = escView(e);
    if ((v.aviso || '').trim() === t.value.trim()) return true;
    v.aviso = t.value;
    ES.hold = true; /* não redesenha: o toque seguinte (ex.: Salvar escala) não pode se perder */
    try { escPut(e, v, 'Mudou o aviso'); } finally { ES.hold = false; }
    return true;
  } else return false;
  escRefresh(t);
  return true;
}

/* ===== Dados chegando (de outra pessoa ou do aparelho) ===== */
function onData(v, info) {
  DATA = v;
  if (!S.ready) return;
  buildIndex();
  renderAll();
  stack.slice().forEach(p => refreshPanel(p, info));
  if (pendingHash) openFromHash();
}
function refreshPanel(p, info) {
  const ch = info.changed || new Set();
  if (p._kind === 'list') {
    const l = listById(p._id);
    if (!l) { if (info.remote) { removePanel(p); toast('Este culto foi excluído.'); } return; }
    if (!ch.has(l.id) && !listSeq(l).some(it => ch.has(it.songId))) return;
    const body = $('.p-body', p), top = body ? body.scrollTop : 0;
    p.innerHTML = listPanelHTML(l);
    const nb = $('.p-body', p);
    if (nb) nb.scrollTop = top;
  } else if (p._kind === 'esc') {
    refreshEscPanel(p);
  } else if (p._kind === 'song') {
    const st = p._st, so = songById(st.id);
    if (!so) { if (info.remote) { removePanel(p); toast('Este louvor foi excluído.'); } return; }
    if (!ch.has(so.id) && !(st.ctx && ch.has(st.ctx.list))) return;
    refreshSongPanel(p, info.remote);
  }
}

function openFromHash() {
  let h = '';
  try { h = decodeURIComponent((location.hash || '').replace(/^#/, '')); } catch (e) { h = ''; }
  pendingHash = '';
  if (h === 'setup') { if (!S.ready && STORE && $('#gate')) openGate('setup'); return; }
  if (!h) return;
  if (!S.ready) { pendingHash = h; return; }
  if (/^escala-mes-\d{4}-\d{2}$/.test(h)) { /* link da escala do mês: abre a aba com "Sua escala" em cima */
    while (stack.length) closePanel();
    S.tab = 'escala';
    ES.ym = h.slice(11);
    ES.sub = 'mes';
    const t = today(), i = daysOf(ES.ym, 0).findIndex(x => x >= t);
    ES.step = ES.dstep = i >= 0 ? i + 1 : 1;
    renderTabs();
    renderEscala(true);
    window.scrollTo(0, 0);
    return;
  }
  if (h.startsWith('escala-')) {
    const id = h.slice(7), e = escById(id);
    if (!e) { /* a escala pode chegar um pouco depois dos cultos */
      if (pendingHash !== h) setTimeout(() => { if (pendingHash === h) { pendingHash = ''; toast('Não achei essa escala.'); } }, 9000);
      pendingHash = h;
      return;
    }
    if (!e.pub && !isAdmin()) { toast('A escala deste dia ainda não está pronta.'); return; }
    const tp = topPanel();
    if (tp && tp._kind === 'esc' && tp._id === id) return;
    S.tab = 'escala';
    ES.ym = ymOf(e.date);
    { const i = daysOf(ES.ym, 0).indexOf(e.date); ES.step = ES.dstep = i >= 0 ? i + 1 : 1; }
    renderTabs();
    renderEscala(true);
    openEscDay(id, true, true);
    return;
  }
  const l = listById(h), so = l ? null : songById(h);
  if (!l && !so) {
    if (STORE && !STORE.synced()) { pendingHash = h; return; } /* os dados ainda estão chegando */
    if (/^l\d{8}/.test(h)) toast('Esse culto foi apagado ou ainda não foi salvo.');
    return;
  }
  const tp = topPanel();
  if (l) {
    if (tp && tp._kind === 'list' && tp._id === h) return;
    S.tab = 'cultos';
    renderTabs();
    openList(h, true);
  } else {
    if (tp && tp._kind === 'song' && tp._st.id === h) return;
    openSong(so.id, null, true);
  }
}

/* ===== Eventos ===== */
document.addEventListener('click', e => {
  if (!e.target.closest('.ac')) $$('.ac-list').forEach(x => { x.hidden = true; });
  /* acorde tocado dentro da cifra */
  const cb = e.target.closest('.cifra .ln.ch b');
  if (cb) { openChordSheet(cb.textContent); return; }
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  if (b.dataset.confirm && !b.dataset.armed) { b.dataset.armed = '1'; b.textContent = b.dataset.confirm; return; }
  const act = b.dataset.act, p = b.closest('.panel');
  if (menuEl && act !== 'me-menu') closeMenu();
  switch (act) {
    case 'tab': S.tab = b.dataset.v; renderTabs(); window.scrollTo(0, 0); break;
    case 'me-menu': openMeMenu(); break;
    case 'g-join': doJoin(b); break;
    case 'g-setup': doSetup(b); break;
    case 'g-tojoin': try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ok */ } openGate('join'); break;
    case 'rename': openRename(); break;
    case 'rename-go': doRename(b); break;
    case 'install': openInstall(); break;
    case 'tip-close': storeSet('localStorage', 'lm-tip-install', '0'); renderCultos(); break;
    case 'code': openCode(); break;
    case 'code-go': doChangeCode(b); break;
    case 'share-app': closeMenu(); return; /* o link abre o WhatsApp */
    case 'history': openHistory(); break;
    case 'admin-pass': openAdminPass(); break;
    case 'admin-pass-go': doAdminPass(b); break;
    case 'become-admin': openBecomeAdmin(); break;
    case 'become-admin-go': doBecomeAdmin(b); break;
    case 'import': openImport(); break;
    case 'import-go': doImport(b); break;
    case 'leave': openLeave(); break;
    case 'leave-go': doLeave(b); break;
    case 'toast-act': { const fn = toastFn; toastFn = null; $('#toast').hidden = true; if (fn) fn(); break; }
    case 'new-list': openListEditor(null); break;
    case 'new': openEdit(null); break;
    case 'new-from-q': openEdit(null, { title: titleCase(S.q.trim()) }); break;
    case 'clear': { S.q = ''; const q = $('#q'); q.value = ''; renderSongs(); q.focus(); break; }
    case 'open': openSong(b.dataset.id); break;
    case 'open-list': openList(b.dataset.id); break;
    case 'open-item': {
      const l = listById(b.dataset.list), idx = +b.dataset.idx;
      const it = l && listSeq(l)[idx];
      if (it) openSong(it.songId, { list: l.id, idx });
      break;
    }
    case 'copy-list': { const l = listById(b.dataset.id); if (l) copyText(waText(l, songById, appUrl()), 'Mensagem copiada'); break; }
    case 'edit-list': openListEditor(b.dataset.id); break;
    case 'edit-reh': { const l = p && listById(p._id); if (l) openRehSheet(l); break; }
    case 'reh-save': {
      const ctx = sheetEl && sheetEl._ctx;
      const date = $('#rh-date').value, time = $('#rh-time').value;
      if (!ctx || !ctx.list || !listById(ctx.list)) break;
      if (!time) { toast('Escolha o horário do ensaio'); break; }
      saveListPatch(ctx.list, { reh: { date: isIso(date) ? date : listById(ctx.list).date, time } }, 'Ensaio salvo');
      break;
    }
    case 'reh-clear': { const ctx = sheetEl && sheetEl._ctx; if (ctx && ctx.list) saveListPatch(ctx.list, { reh: null }, 'Ensaio removido'); break; }
    case 'close': if (p) removePanel(p); break;
    case 'discard-stay': closeSheet(); break;
    case 'exit-stay': closeSheet(); break;
    case 'discard-go': { const t = discardTarget; discardTarget = null; closeSheet(); if (t) removePanel(t); break; }

    case 'key': p._st.key = b.dataset.v; updateSongPanel(p); audioRetune(p); break;
    case 'day-key': openDayKeySheet(b.dataset.list, +b.dataset.idx); break;
    case 'day-key-set': { const c = sheetEl && sheetEl._ctx; if (c && c.dayKey) setDayKey(c.list, c.idx, b.dataset.v); break; }
    case 'capo': p._st.capo = Math.max(0, Math.min(7, p._st.capo + (+b.dataset.d))); updateSongPanel(p); break;
    case 'capo-set': p._st.capo = +b.dataset.v; updateSongPanel(p); break;
    case 'size': {
      const st = p._st;
      if (S.letra) { st.lsize = Math.max(14, Math.min(40, st.cur - (st.palco ? 6 : 0) + 2 * (+b.dataset.d))); updateSongPanel(p); break; }
      st.size = Math.max(11, Math.min(30, st.cur - (st.palco ? 4 : 0) + (+b.dataset.d)));
      updateSongPanel(p);
      break;
    }
    case 'scroll': {
      const st = p._st;
      st.scroll = !st.scroll;
      updateSongPanel(p);
      if (st.scroll) startScroll(p);
      break;
    }
    case 'speed': p._st.speed = Math.max(1, Math.min(5, p._st.speed + (+b.dataset.d))); updateSongPanel(p); break;
    case 'palco': togglePalco(p); break;
    case 'toggle-video': {
      p._st.hideVideo = !p._st.hideVideo;
      storeSet('localStorage', 'lm-hidevideo', p._st.hideVideo ? '1' : '0');
      if (p._st.hideVideo) stopVideo(p);
      updateSongPanel(p);
      break;
    }
    case 'play-video': playVideo(p); break;
    case 'inst': {
      if (b.dataset.v === 'lt') S.letra = true;
      else { S.letra = false; S.inst = b.dataset.v === 'kb' ? 'kb' : 'gt'; storeSet('localStorage', 'lm-inst', S.inst); }
      storeSet('localStorage', 'lm-letra', S.letra ? '1' : '0');
      stack.forEach(x => { if (x._kind === 'song') updateSongPanel(x); });
      break;
    }
    case 'var': {
      S.simple = b.dataset.v === '1';
      storeSet('localStorage', 'lm-simple', S.simple ? '1' : '0');
      stack.forEach(x => { if (x._kind === 'song') updateSongPanel(x); });
      break;
    }
    case 'audio': toggleAudio(p); break;
    case 'a-play': audioPlay(p); break;
    case 'a-del': audioRemove(p); break;
    case 'toggle-chords': S.chords = !S.chords; storeSet('localStorage', 'lm-chords', S.chords ? '1' : '0'); updateSongPanel(p); break;
    case 'chord': openChordSheet(b.dataset.v); break;
    case 'chord-inst': openChordSheet(b.dataset.c, b.dataset.v); break;
    case 'nav': navSong(p, +b.dataset.d); break;
    case 'edit': openEdit(b.dataset.id, { ctx: p && p._st ? p._st.ctx : null, tab: b.dataset.tab }); break;

    case 'show-paste': { const box = $('[data-el="pastebox"]', p); box.classList.remove('closed'); b.remove(); $('#le-paste', p).focus(); break; }
    case 'parse': {
      const d = p._d, txt = $('#le-paste', p).value;
      if (!txt.trim()) { toast('Cole a mensagem primeiro'); break; }
      const res = parseMessage(txt);
      if (res.date) d.date = res.date;
      if (res.minister) d.minister = res.minister;
      d.kind = res.kind || defaultKind(d.date);
      d._kindTouched = !!res.kind;
      d.name = '';
      if (res.reh) { d.reh = { date: res.reh.date || d.date, time: res.reh.time }; d._rehTouched = true; }
      else { d.reh = defaultReh(d.date, d.kind, d.name, DATA.prefs); d._rehTouched = false; }
      d.aviso = res.aviso || '';
      d.people = res.people;
      d.newSongs = [];
      d.items = res.items.map(pi => itemFromParsed(d, pi));
      d.diz = res.diz ? itemFromParsed(d, res.diz) : null;
      $('#le-date', p).value = d.date;
      $('#le-min', p).value = d.minister;
      $('#le-aviso', p).value = d.aviso;
      $('#le-kname', p).value = '';
      $('[data-el="diz"]', p).innerHTML = '';
      syncReh(p);
      refreshHead(p);
      refreshEditor(p);
      const n = d.items.length + (d.diz ? 1 : 0), nn = d.newSongs.length;
      toast(n ? `${n} ${n === 1 ? 'louvor encontrado' : 'louvores encontrados'}${nn ? ` · ${nn} ${nn === 1 ? 'novo' : 'novos'} no repertório` : ''}` : 'Não achei louvores na mensagem');
      break;
    }
    case 'kind': {
      const d = p._d;
      d.kind = b.dataset.v;
      d._kindTouched = true;
      if (d.kind !== 'outro') { d.name = ''; $('#le-kname', p).value = ''; }
      if (!d._rehTouched) { d.reh = defaultReh(d.date, d.kind, d.name, DATA.prefs); syncReh(p); }
      refreshHead(p);
      if (d.kind === 'outro') $('#le-kname', p).focus();
      break;
    }
    case 'item-sheet': openItemSheet(p, b.dataset.i); break;
    case 'rm-item': removeWithUndo(p, b.dataset.i); break;
    case 'show-add': showAdd(p, b.dataset.target); break;
    case 'sheet-key': {
      const ctx = sheetEl && sheetEl._ctx;
      if (!ctx || !ctx.p) break;
      const d = ctx.p._d, it = sheetItem(ctx), so = songIn(d, it.songId);
      it.key = b.dataset.v;
      it.mode = (it.key && it.key === autoKey(d, so)) ? 'auto' : 'manual';
      refreshEditor(ctx.p);
      renderItemSheet();
      break;
    }
    case 'sheet-join': {
      const ctx = sheetEl && sheetEl._ctx;
      if (!ctx || !ctx.p) break;
      const it = sheetItem(ctx);
      it.join = !it.join;
      refreshEditor(ctx.p);
      renderItemSheet();
      break;
    }
    case 'mv-group': moveGroup(b.dataset.list, +b.dataset.i, +b.dataset.d); break;
    case 'mv-item': {
      if (!p || !p._d) break;
      const d = p._d, i = +b.dataset.i, j = i + (+b.dataset.d);
      if (j < 0 || j >= d.items.length) break;
      const [x] = d.items.splice(i, 1);
      d.items.splice(j, 0, x);
      refreshEditor(p);
      const nb = $(`[data-act="mv-item"][data-i="${j}"][data-d="${b.dataset.d}"]`, p);
      if (nb && !nb.disabled) nb.focus();
      break;
    }
    case 'sheet-mv': {
      const ctx = sheetEl && sheetEl._ctx;
      if (!ctx || !ctx.p || ctx.ref === 'diz') break;
      const d = ctx.p._d, i = +ctx.ref, j = i + (+b.dataset.d);
      if (j < 0 || j >= d.items.length) break;
      const [x] = d.items.splice(i, 1);
      d.items.splice(j, 0, x);
      ctx.ref = String(j);
      refreshEditor(ctx.p);
      renderItemSheet();
      break;
    }
    case 'sheet-rm': {
      const ctx = sheetEl && sheetEl._ctx;
      if (!ctx || !ctx.p) break;
      closeSheet();
      removeWithUndo(ctx.p, ctx.ref);
      break;
    }
    case 'sheet-done': closeSheet(); break;
    case 'ac-pick': {
      const d = p._d, target = b.dataset.target;
      const so = songIn(d, b.dataset.id);
      if (so) addToList(p, target, so);
      const inp = $(target === 'diz' ? '#le-diz' : '#le-add', p);
      if (inp && inp.isConnected) { inp.value = ''; acRender(p, inp); inp.focus(); }
      break;
    }
    case 'ac-new': {
      const d = p._d, target = b.dataset.target;
      const inp = $(target === 'diz' ? '#le-diz' : '#le-add', p);
      const title = titleCase(inp.value);
      if (!title) break;
      const so = blankSong(title);
      d.newSongs.push(so);
      addToList(p, target, so);
      const again = $(target === 'diz' ? '#le-diz' : '#le-add', p);
      if (again && again.isConnected) { again.value = ''; acRender(p, again); }
      break;
    }
    case 'save-list': saveList(p); break;
    case 'del-list': deleteList(p); break;

    case 'ctab': setCifraTab(p, b.dataset.v); break;
    case 'use-key': {
      const d = p._d, S0 = SLOTS[slotOf(d)];
      if (!S0) break;
      d[S0.key] = b.dataset.v;
      d._kt[S0.key] = true;
      $('#' + S0.sel, p).value = b.dataset.v;
      refreshDetect(p);
      break;
    }
    case 'cvar': setCifraTab(p, p._d._tab, b.dataset.v); break;
    case 'letra-fill': {
      const d = p._d, ta = $('#f-letra', p);
      const lines = lyricsOf(Object.assign({}, d, { letra: '' })).lines;
      d.letra = lines.map(l => l.t === 'sec' ? '[' + l.text + ']' : l.t === 'blank' ? '' : l.text).join('\n');
      ta.value = d.letra;
      refreshDetect(p);
      ta.focus();
      break;
    }
    case 'save': saveSong(p); break;
    case 'del': deleteSong(p); break;
    default: if (act.startsWith('e-')) escClick(b, act, p); break;
  }
});

/* arquivo de áudio escolhido e posição solta no fim do arraste */
document.addEventListener('change', e => {
  const t = e.target, p = t && t.closest && t.closest('.panel');
  if (t && t.dataset && escChange(t)) return;
  if (p && t.dataset && (t.dataset.au === 'file' || t.dataset.au === 'seek')) audioInput(p, t);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { S.q = t.value; renderSongs(); return; }
  if (t.dataset && t.dataset.esq != null) { escSuggest(t); return; }
  if (t.id === 'is-obs' && sheetEl && sheetEl._ctx && sheetEl._ctx.p) { sheetItem(sheetEl._ctx).obs = t.value; refreshEditor(sheetEl._ctx.p); return; }
  if ((t.id === 'g-code' || t.id === 'g-name' || t.id === 'g-file') && $('.gerr')) gateErr('');
  if (t.id === 'g-seed') { const f = $('[data-el="seedf"]'); if (f) f.hidden = !t.checked; gateErr(''); return; }
  const p = t.closest('.panel');
  if (!p) return;
  if (t.dataset.au) { if (t.dataset.au === 'seek') t._drag = true; else if (t.dataset.au === 'rec') audioInput(p, t); return; }
  if (t.dataset.ac) { acRender(p, t); return; }
  if (t.dataset.l) {
    const d = p._d, f = t.dataset.l;
    if (f === 'rdate' || f === 'rtime') {
      const rd = $('#le-rdate', p).value, rt = $('#le-rtime', p).value;
      d.reh = rt ? { date: isIso(rd) ? rd : d.date, time: rt } : null;
      d._rehTouched = true;
      refreshRehHint(p);
      return;
    }
    if (f === 'date') {
      if (!isIso(t.value)) return;
      d.date = t.value;
      if (!d._kindTouched) d.kind = defaultKind(d.date);
      if (!d._rehTouched) { d.reh = defaultReh(d.date, d.kind, d.name, DATA.prefs); syncReh(p); }
      refreshHead(p);
      return;
    }
    d[f] = t.value;
    if (f === 'minister') { retune(d); refreshEditor(p); }
    if (f === 'name') {
      if (!d._rehTouched) { d.reh = defaultReh(d.date, d.kind, d.name, DATA.prefs); syncReh(p); }
      refreshHead(p);
    }
    return;
  }
  if (!t.dataset.f) return;
  const d = p._d, f = t.dataset.f;
  d[f] = t.value;
  if (f === 'key' || f === 'keyS' || f === 'keyKb' || f === 'keyKbS') { d._kt[f] = !!t.value; refreshDetect(p); }
  if (f === 'cifra' || f === 'cifraKb' || f === 'cifraS' || f === 'cifraKbS' || f === 'letra') refreshDetectSoon(p);
  if (f === 'title' || f === 'version') {
    const a = $('[data-el="yt-search"]', p), c = $('[data-el="cifra-search"]', p);
    if (a) a.href = ytSearch(d.title + ' ' + (d.version || ''));
    if (c) c.href = cifraSearch(d, d._tab === 'kb');
  }
});

document.addEventListener('keydown', e => {
  const id = e.target && e.target.id;
  if (e.key === 'Enter' && id === 'q') {
    const first = $('#list .lrow');
    if (first) { e.preventDefault(); first.click(); }
    return;
  }
  if (e.key === 'Enter' && id === 'g-code') { e.preventDefault(); const n = $('#g-name'); if (n) n.focus(); return; }
  if (e.key === 'Enter' && id === 'g-name') { e.preventDefault(); const b = $('[data-act="g-join"], [data-act="g-setup"]'); if (b) b.click(); return; }
  if (e.key === 'Enter' && id === 'rn-name') { e.preventDefault(); const b = $('[data-act="rename-go"]'); if (b) b.click(); return; }
  if (e.key === 'Enter' && id === 'ba-pass') { e.preventDefault(); const b = $('[data-act="become-admin-go"]'); if (b) b.click(); return; }
  if (e.key === 'Enter' && id === 'ap-new') { e.preventDefault(); const b = $('[data-act="admin-pass-go"]'); if (b) b.click(); return; }
  if (e.key === 'Enter' && e.target && e.target.dataset && e.target.dataset.esq != null) { e.preventDefault(); const b = e.target.parentNode.querySelector('.ac-list:not([hidden]) .ac-item'); if (b) b.click(); else e.target.blur(); return; }
  if (e.key === 'Enter' && id === 'e-mrn') { e.preventDefault(); const b = $('[data-act="e-mren-ok"]'); if (b) b.click(); return; }
  if (e.key === 'Enter' && id === 'e-mnew') { e.preventDefault(); const b = $('[data-act="e-madd"]'); if (b) b.click(); return; }
  if (e.key === 'Escape' && !HAS_CW && backLayers() > 0) goBack(); /* no Chrome, o Esc chega pelo vigia */
});

window.addEventListener('resize', () => { closeMenu(); stack.forEach(p => { if (p._kind === 'song') fitCifra(p); }); });
window.addEventListener('hashchange', openFromHash);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });

/* ===== Início ===== */
export async function startApp(cfg) {
  CFG = cfg || {};
  shell();
  measureMono();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measureMono(); stack.forEach(p => { if (p._kind === 'song') fitCifra(p); }); });
  }
  const fb = CFG.firebase && CFG.firebase.apiKey;
  try {
    if (fb) STORE = (await import('./store-firebase.js')).createFirebaseStore(CFG.firebase);
    else STORE = createLocalStore({ seed: CFG.demoSeed || CFG.seed, demoCode: CFG.demoCode });
  } catch (e) {
    console.error(e);
    openGate('join', MSG.load);
    return;
  }
  STORE.onStatus(renderStatus);
  let state;
  try { state = await STORE.init(); } catch (e) {
    console.error(e);
    openGate('join', errMsg(e));
    return;
  }
  const wantsSetup = (location.hash || '') === '#setup';
  if (state === 'ready') {
    enterApp();
    if (wantsSetup) toast('O app já está configurado.');
  } else openGate(wantsSetup ? 'setup' : 'join');
}

/* para os testes: estado interno */
export const _debug = { S, get DATA() { return DATA; }, get STORE() { return STORE; }, get backWatch() { return HAS_CW ? !!watcher : backGuard; } };
