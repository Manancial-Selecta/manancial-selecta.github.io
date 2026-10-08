/* Áudio no tom: toca um arquivo de áudio do celular no tom escolhido.
   O vídeo do YouTube não deixa mudar o tom; aqui a pessoa usa um áudio que ela tem.
   O arquivo fica só neste aparelho (IndexedDB), não vai para o Firebase. */

const DB_NAME = 'lm-audio', OS = 'files';
const SR = 32000; /* qualidade suficiente para ensaiar e usa menos memória */
export const MAX_BYTES = 40 * 1024 * 1024;

function openDb() {
  return new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open(DB_NAME, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(OS, mode), st = t.objectStore(OS);
    const r = fn(st);
    t.oncomplete = () => { db.close(); res(r && 'result' in r ? r.result : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}
/* { blob, name, rec } por louvor */
export const getSaved = id => tx('readonly', st => st.get(id)).catch(() => null);
export const saveAudio = (id, rec) => tx('readwrite', st => st.put(rec, id));
export const dropAudio = id => tx('readwrite', st => st.delete(id)).catch(() => {});

/* tocador: carrega o áudio, prepara no tom (em segundo plano) e toca */
export function createPlayer(onState) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const worker = new Worker(new URL('./stretch-worker.js', import.meta.url), { type: 'module' });
  const state = { status: 'idle', playing: false, t: 0, dur: 0, n: 0, error: '' };
  let buf = null, bufN = null, src = null, startedAt = 0, startT = 0, reqId = 0, wantN = 0, closed = false;
  const pend = new Map();
  worker.onmessage = e => { const m = e.data; const f = pend.get(m.id); if (f) { pend.delete(m.id); f(m); } };
  worker.onerror = () => { state.status = 'error'; state.error = 'prep'; emit(); };
  const ask = (msg, transfer) => new Promise(res => { const id = ++reqId; pend.set(id, res); worker.postMessage(Object.assign({ id }, msg), transfer || []); });
  const emit = () => { if (!closed) onState(Object.assign({}, state)); };
  const rate = n => Math.pow(2, n / 12);

  function now() {
    if (!state.playing) return state.t;
    return Math.min(state.dur, startT + (ctx.currentTime - startedAt));
  }
  function stopSrc() {
    if (src) { src.onended = null; try { src.stop(); } catch (e) { /* ok */ } src.disconnect(); src = null; }
  }
  function startAt(t) {
    stopSrc();
    if (!buf) return;
    const r = rate(bufN);
    src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = r;
    src.connect(ctx.destination);
    src.onended = () => { if (!state.playing) return; state.playing = false; state.t = 0; src = null; emit(); };
    startT = Math.max(0, Math.min(t, state.dur - 0.05));
    startedAt = ctx.currentTime;
    src.start(0, startT * r);
    state.playing = true;
  }

  async function load(blob) {
    state.status = 'loading'; state.playing = false; state.t = 0; buf = null; bufN = null; stopSrc(); emit();
    let dec;
    try {
      const ab = await blob.arrayBuffer();
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const off = new OAC(1, 1, SR);
      dec = await new Promise((res, rej) => { const p = off.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
    } catch (e) { state.status = 'error'; state.error = 'decode'; emit(); return false; }
    /* junta os canais num só */
    const len = dec.length, mono = new Float32Array(len);
    for (let c = 0; c < dec.numberOfChannels; c++) { const d = dec.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / dec.numberOfChannels; }
    state.dur = len / SR;
    await ask({ type: 'load', data: mono, sr: SR }, [mono.buffer]);
    await prepare(wantN);
    return true;
  }
  async function prepare(n) {
    wantN = n;
    if (state.status === 'idle' || (bufN === n && buf)) { state.n = n; emit(); return; }
    const t = now(), was = state.playing;
    if (was) { stopSrc(); state.playing = false; }
    state.t = t; state.status = 'preparing'; state.n = n; emit();
    const m = await ask({ type: 'shift', n });
    if (closed) return;
    if (m.type !== 'shifted') { state.status = 'error'; state.error = 'prep'; emit(); return; }
    if (wantN !== m.n) return; /* trocaram de tom no meio do caminho */
    const b = ctx.createBuffer(1, m.data.length, SR);
    b.copyToChannel ? b.copyToChannel(m.data, 0) : b.getChannelData(0).set(m.data);
    buf = b; bufN = m.n;
    state.status = 'ready';
    if (was) startAt(t);
    emit();
  }
  return {
    load,
    setShift: n => prepare(n),
    async play() {
      if (!buf) return;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* ok */ } }
      startAt(state.t >= state.dur - 0.1 ? 0 : state.t);
      emit();
    },
    pause() { if (!state.playing) return; state.t = now(); state.playing = false; stopSrc(); emit(); },
    seek(frac) {
      const t = Math.max(0, Math.min(1, frac)) * state.dur;
      if (state.playing) startAt(t); else state.t = t;
      emit();
    },
    time: now,
    get state() { return Object.assign({}, state, { t: now() }); },
    close() { closed = true; stopSrc(); try { worker.terminate(); } catch (e) { /* ok */ } try { ctx.close(); } catch (e) { /* ok */ } }
  };
}
