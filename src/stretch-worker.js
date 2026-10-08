/* Trabalho pesado fora da tela: guarda o áudio original e devolve a versão no tom pedido */
import { stretch } from './stretch.js';

let orig = null, sr = 32000;
self.onmessage = e => {
  const m = e.data || {};
  if (m.type === 'load') { orig = m.data; sr = m.sr; self.postMessage({ type: 'loaded', id: m.id }); return; }
  if (m.type === 'shift') {
    if (!orig) { self.postMessage({ type: 'error', id: m.id }); return; }
    const out = stretch(orig, Math.pow(2, m.n / 12), sr);
    self.postMessage({ type: 'shifted', id: m.id, n: m.n, data: out }, [out.buffer]);
  }
};
