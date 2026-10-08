/* Muda a duração do áudio sem mudar a altura (WSOLA, a mesma ideia do SoundTouch).
   O app estica o áudio por r = 2^(semitons/12) e depois toca com velocidade r:
   a duração volta a ser a original e o som sobe (ou desce) os semitons pedidos.
   Funciona com um canal (mono) em Float32Array. */

export function stretch(x, ratio, sr) {
  if (!x || !x.length) return new Float32Array(0);
  if (!(ratio > 0) || Math.abs(ratio - 1) < 1e-6) return x.slice();
  const seq = Math.max(64, Math.round(sr * 0.082)); /* tamanho de cada pedaço */
  const seek = Math.max(16, Math.round(sr * 0.028)); /* onde procurar o melhor encaixe */
  const ovl = Math.max(16, Math.round(sr * 0.012)); /* trecho que se mistura entre pedaços */
  const mid = seq - 2 * ovl;
  const outStep = seq - ovl;
  const skip = outStep / ratio;
  const outLen = Math.round(x.length * ratio);
  const y = new Float32Array(outLen);

  /* janela para comparar (dá mais peso ao meio do trecho) e rampas para misturar */
  const win = new Float32Array(ovl);
  for (let j = 0; j < ovl; j++) win[j] = j * (ovl - j);
  const fadeIn = new Float32Array(ovl), fadeOut = new Float32Array(ovl);
  for (let j = 0; j < ovl; j++) { fadeIn[j] = j / ovl; fadeOut[j] = 1 - j / ovl; }

  let tail = x.slice(0, ovl); /* fim do pedaço anterior, para misturar com o próximo */
  const ref = new Float32Array(ovl);
  let inPos = 0, frac = 0, outPos = 0, first = true;

  function corrAt(p, step) {
    let num = 0, en = 1e-9;
    for (let j = 0; j < ovl; j += step) { const v = x[p + j]; num += ref[j] * v; en += v * v; }
    return num / Math.sqrt(en);
  }
  function best(pos) {
    for (let j = 0; j < ovl; j++) ref[j] = tail[j] * win[j];
    let bi = 0, bc = -Infinity;
    for (let i = 0; i < seek; i += 4) { const c = corrAt(pos + i, 4); if (c > bc) { bc = c; bi = i; } }
    const lo = Math.max(0, bi - 3), hi = Math.min(seek - 1, bi + 3);
    let bi2 = bi; bc = -Infinity;
    for (let i = lo; i <= hi; i++) { const c = corrAt(pos + i, 1); if (c > bc) { bc = c; bi2 = i; } }
    return bi2;
  }

  while (outPos < outLen && inPos + seek + seq < x.length) {
    const off = first ? 0 : best(inPos);
    first = false;
    const p = inPos + off;
    /* mistura o fim do pedaço anterior com o começo deste */
    for (let j = 0; j < ovl && outPos < outLen; j++) y[outPos++] = x[p + j] * fadeIn[j] + tail[j] * fadeOut[j];
    /* o meio do pedaço vai direto */
    for (let j = 0; j < mid && outPos < outLen; j++) y[outPos++] = x[p + ovl + j];
    tail = x.slice(p + ovl + mid, p + ovl + mid + ovl);
    frac += skip;
    const adv = Math.floor(frac);
    frac -= adv;
    inPos += adv;
  }
  /* final: o que sobrou, sem procurar encaixe */
  for (let j = 0; j < tail.length && outPos < outLen; j++) y[outPos++] = tail[j];
  let q = inPos + seq;
  while (outPos < outLen && q < x.length) y[outPos++] = x[q++];
  return y;
}

/* semitons entre o tom da gravação e o tom pedido, pelo caminho mais curto (−5 a +6) */
export function semis(fromPc, toPc) {
  let n = ((toPc - fromPc) % 12 + 12) % 12;
  if (n > 6) n -= 12;
  return n;
}
