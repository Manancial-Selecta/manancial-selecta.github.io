/* Começo do app: instala o modo offline (service worker), avisa quando tem versão nova e abre o app */
import { FIREBASE } from './config.js';
import { startApp } from './app.js';

/* Android/Chrome: guarda o pedido de instalação para o botão "Instalar o app" */
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__lmInstall = e; });

function updateBar(reg) {
  if (document.getElementById('updbar')) return;
  const el = document.createElement('div');
  el.id = 'updbar';
  el.className = 'updbar';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span>Tem uma versão nova do app.</span><button type="button">Atualizar</button>';
  el.querySelector('button').addEventListener('click', () => {
    if (reg.waiting) reg.waiting.postMessage('skip-waiting');
    else location.reload();
  });
  document.body.appendChild(el);
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) updateBar(reg);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) updateBar(reg); });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => { /* sem modo offline neste navegador */ });
}

(async () => {
  const cfg = { firebase: FIREBASE, seedUrl: 'data/prototipo.json' };
  /* sem Firebase configurado: demonstração com os dados do protótipo */
  if (!FIREBASE.apiKey) {
    try { const r = await fetch('data/prototipo.json'); if (r.ok) cfg.demoSeed = await r.json(); } catch (e) { /* sem dados */ }
  }
  startApp(cfg);
})();
