/* Teste do modo offline (service worker): abre sem internet e avisa quando há versão nova.
   Rodar na pasta do app: node tests/offline.cjs */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8990 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}/`;
let fails = 0, count = 0;
const check = (cond, name, extra) => { count++; if (!cond) { fails++; console.log('FALHOU ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* cópia do app numa pasta temporária, para poder trocar a versão do sw.js no meio do teste */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'louvores-'));
  fs.cpSync(ROOT, tmp, { recursive: true, filter: src => !src.includes(path.join('tests', 'shots')) });
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'prototipo.json'), path.join(tmp, 'data', 'prototipo.json'));
  fs.writeFileSync(path.join(tmp, 'src', 'config.js'), "export const FIREBASE = { apiKey: '' };\n"); /* modo demonstração no teste */
  const V = fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)';/)[1];
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: tmp, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const errs = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com|gstatic\.com\/firebasejs/, r => r.abort());
    await ctx.clock.setFixedTime(new Date('2026-10-07T12:00:00-03:00'));
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await page.goto(BASE);
    await page.waitForSelector('#gate');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    check(true, 'modo offline instalado');
    const keys = await page.evaluate(() => caches.keys());
    check(keys.includes('lm-core-' + V), 'arquivos do app guardados', keys);
    await page.fill('#g-code', 'manancial');
    await page.fill('#g-name', 'Teste Offline');
    await page.click('[data-act="g-join"]');
    await page.waitForSelector('#app:not([hidden])');

    /* sem internet: abre do mesmo jeito */
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
    check((await page.locator('.lcard').count()) === 3, 'abre sem internet com os cultos', await page.locator('.lcard').count());
    await page.click('.lcard.next');
    check(await page.locator('.panel .hero').count() === 1, 'culto abre sem internet');
    await ctx.setOffline(false);

    /* versão nova publicada: aparece o aviso e o botão Atualizar troca a versão */
    const swPath = path.join(tmp, 'sw.js');
    fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace(`const VERSION = '${V}';`, "const VERSION = '9.9.9-teste';"));
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await page.waitForSelector('#updbar', { timeout: 15000 });
    check(/versão nova/.test(await page.locator('#updbar').textContent()), 'aviso de versão nova');
    await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('#updbar button')]);
    await sleep(500);
    const keys2 = await page.evaluate(() => caches.keys());
    check(keys2.includes('lm-core-9.9.9-teste') && !keys2.includes('lm-core-' + V), 'versão nova no lugar da antiga', keys2);
    await page.waitForSelector('#app:not([hidden])');
    check(true, 'app continua aberto depois de atualizar');
    await ctx.close();
  } catch (e) {
    fails++;
    console.log('ERRO NO TESTE:', e.message.split('\n')[0], (e.stack || '').split('\n').find(l => l.includes('offline.cjs')));
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  errs.forEach(e => console.log('ERRO NA PÁGINA: ' + e));
  if (errs.length) fails += errs.length;
  console.log(fails ? `\n${fails} problema(s) em ${count} verificações` : `TUDO OK (${count} verificações)`);
  process.exit(fails ? 1 : 0);
})();
