/* Gera o MP3 do "Áudio no tom" fora da tela, para o celular não travar.
   Usa o lamejs 1.2.1 (LGPL, vendor/LICENSE-lamejs.txt). */
importScripts('../vendor/lame.min.js');
self.onmessage = e => {
  const { data, sr, kbps } = e.data;
  try {
    const enc = new lamejs.Mp3Encoder(1, sr, kbps || 96);
    const n = data.length, BL = 1152 * 32, i16 = new Int16Array(BL), out = [];
    let lastP = -1;
    for (let i = 0; i < n; i += BL) {
      const m = Math.min(BL, n - i);
      for (let j = 0; j < m; j++) { let v = data[i + j]; v = v < -1 ? -1 : v > 1 ? 1 : v; i16[j] = v < 0 ? v * 32768 : v * 32767; }
      const b = enc.encodeBuffer(m === BL ? i16 : i16.subarray(0, m));
      if (b.length) out.push(b);
      const p = Math.floor(100 * i / n);
      if (p !== lastP && p % 5 === 0) { lastP = p; self.postMessage({ type: 'progress', p }); }
    }
    const f = enc.flush();
    if (f.length) out.push(f);
    self.postMessage({ type: 'done', parts: out });
  } catch (err) { self.postMessage({ type: 'error', error: String(err && err.message || err) }); }
};
