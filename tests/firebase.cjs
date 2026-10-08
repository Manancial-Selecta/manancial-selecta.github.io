/* Testes do modo compartilhado (Firebase imitado): configurar, entrar com código, tempo real entre duas
   pessoas, sem internet e volta, troca de código e acesso removido.
   Rodar na pasta do app: node tests/firebase.cjs */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8890 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS || path.join(ROOT, 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const FB = 'https://www.gstatic.com/firebasejs/12.19.0/';

let fails = 0, count = 0;
const check = (cond, name, extra) => { count++; if (!cond) { fails++; console.log('FALHOU ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) { try { if (await fn()) return true; } catch (e) { /* tenta de novo */ } await sleep(80); }
  return false;
}
const lastPanel = page => page.locator('.panel').last();

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const errs = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', colorScheme: 'dark' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.route(FB + '*', r => {
      const f = r.request().url().split('/').pop();
      r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(ROOT, 'tests', 'mock', f), 'utf8') });
    });
    await ctx.route(BASE + 'src/config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "export const FIREBASE = { apiKey: 'teste', authDomain: 'x', projectId: 'louvores-teste', storageBucket: '', messagingSenderId: '', appId: 'x' };" }));
    await ctx.clock.setFixedTime(new Date('2026-10-07T12:00:00-03:00')); /* os dados de teste são de outubro de 2026 */
    const open = async () => {
      const p = await ctx.newPage();
      p.on('pageerror', e => errs.push('pageerror: ' + e.message));
      p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|insufficient permissions/.test(m.text())) errs.push('console: ' + m.text()); });
      return p;
    };

    /* ----- antes de configurar ----- */
    const A = await open();
    await A.goto(BASE);
    await A.waitForSelector('#gate');
    await A.fill('#g-code', 'qualquer1');
    await A.fill('#g-name', 'Pessoa');
    await A.click('[data-act="g-join"]');
    check(await until(async () => /ainda não foi configurado/.test(await A.locator('.gerr').textContent())), 'avisa que não está configurado');

    /* ----- configurar (administrador) ----- */
    await A.goto(BASE + '#setup');
    await A.reload();
    await A.waitForSelector('#gate[data-kind="setup"]');
    await A.fill('#g-code', 'Manancial2026');
    await A.fill('#g-name', 'ana lima');
    await A.click('[data-act="g-setup"]');
    check(await until(async () => /Escolha o arquivo do protótipo/.test(await A.locator('.gerr').textContent())), 'pede o arquivo do protótipo');
    await A.setInputFiles('#g-file', path.join(ROOT, 'package.json'));
    await A.click('[data-act="g-setup"]');
    check(await until(async () => /não é o do protótipo/.test(await A.locator('.gerr').textContent())), 'recusa arquivo errado');
    await A.setInputFiles('#g-file', path.join(ROOT, 'tests', 'fixtures', 'prototipo.json'));
    await A.screenshot({ path: path.join(SHOTS, '19-configurar-arquivo.png') });
    await A.click('[data-act="g-setup"]');
    await A.waitForSelector('#app:not([hidden])');
    check(await until(async () => (await A.locator('.lcard').count()) === 3), 'dados do protótipo importados', await A.locator('.lcard').count());
    const db = await A.evaluate(() => JSON.parse(localStorage.getItem('mock-fs-db')));
    check(db['config/access'] && db['config/access'].code === 'manancial2026', 'código guardado');
    check(Object.keys(db).filter(k => k.startsWith('songs/')).length === 14, 'louvores no banco');
    check(Object.keys(db).filter(k => k.startsWith('lists/')).length === 3, 'cultos no banco');
    check(Object.values(db).filter(d => d && d.admin === true).length === 1, 'um administrador');
    check(A.url().indexOf('#setup') < 0, 'tira o #setup do endereço');
    /* o resto do teste acontece 10 minutos depois da importação (o app relê só os últimos 5 minutos ao abrir) */
    await ctx.clock.setFixedTime(new Date('2026-10-07T12:10:00-03:00'));
    /* configurar de novo não é possível */
    const db0 = JSON.stringify(db);

    /* ----- segunda pessoa entra ----- */
    const B = await open();
    await B.goto(BASE + '#l20261011');
    await B.waitForSelector('#gate');
    await B.fill('#g-code', 'errado123');
    await B.fill('#g-name', 'carla');
    await B.click('[data-act="g-join"]');
    check(await until(async () => /Código errado/.test(await B.locator('.gerr').textContent())), 'código errado não entra');
    await B.fill('#g-code', 'MANANCIAL2026');
    await B.click('[data-act="g-join"]');
    await B.waitForSelector('#app:not([hidden])');
    check(await until(async () => (await B.locator('.panel .hero').count()) === 1), 'link do WhatsApp abre o culto depois de entrar');
    check(/11 out/i.test(await B.locator('.panel .hero .dt').textContent()), 'culto certo');
    const db1 = await B.evaluate(() => JSON.parse(localStorage.getItem('mock-fs-db')));
    check(Object.values(db1).filter(d => d && d.name === 'Carla' && d.admin === false).length === 1, 'membro novo no banco');

    /* ----- tempo real: A muda o ensaio, B vê ----- */
    await A.click('.lcard >> text=11 de outubro');
    await lastPanel(A).locator('.rehbtn').click();
    await A.fill('#rh-time', '16:15');
    await A.click('[data-act="reh-save"]');
    check(await until(async () => /16h15/.test(await B.locator('.panel .rehbtn').textContent())), 'B vê o ensaio novo na hora');
    /* B cria um louvor, A vê */
    await B.locator('.panel [data-act="close"]').first().click();
    await B.click('[data-act="tab"][data-v="louvores"]');
    await B.click('#vh-louvores [data-act="new"]');
    await lastPanel(B).locator('#f-title').fill('Louvor da Carla');
    await lastPanel(B).locator('#f-cifra').fill('D        A/C#\nTexto de teste do louvor\nBm7      G7M\nOutra linha de teste');
    await lastPanel(B).locator('[data-act="save"]').first().click();
    await lastPanel(A).locator('[data-act="close"]').first().click();
    await A.click('[data-act="tab"][data-v="louvores"]');
    check(await until(async () => (await A.locator('#list .lrow', { hasText: 'Louvor da Carla' }).count()) === 1), 'A vê o louvor novo na hora');
    /* A abre o louvor; B muda a cifra; a tela de A atualiza sem fechar */
    await A.locator('#list .lrow', { hasText: 'Louvor da Carla' }).click();
    check((await lastPanel(A).locator('.kchip[aria-pressed="true"]').textContent()) === 'D', 'tom D');
    await lastPanel(B).locator('[data-act="edit"]').first().click();
    await lastPanel(B).locator('#f-cifra').fill('E        B/D#\nTexto de teste do louvor\nC#m7     A7M\nOutra linha de teste');
    await lastPanel(B).locator('[data-act="save"]').first().click();
    check(await until(async () => /C#m7/.test(await lastPanel(A).locator('[data-el="cifra"]').textContent()) || /Bm7/.test(await lastPanel(A).locator('[data-el="cifra"]').textContent()) === false), 'cifra atualizada na tela aberta');
    check(await until(async () => (await lastPanel(A).locator('.dstrip .dchip').count()) === 4), 'desenhos atualizados');
    await A.screenshot({ path: path.join(SHOTS, '20-tempo-real.png') });
    await lastPanel(A).locator('[data-act="close"]').first().click();
    await lastPanel(B).locator('[data-act="close"]').first().click();

    /* ----- sem internet ----- */
    await A.evaluate(() => { window.__mockOffline = true; window.dispatchEvent(new Event('offline')); });
    check(await until(async () => A.locator('#netbar').isVisible()), 'aviso de sem internet');
    await A.click('[data-act="tab"][data-v="cultos"]');
    await A.click('.lcard >> text=11 de outubro');
    await lastPanel(A).locator('.rehbtn').click();
    await A.fill('#rh-time', '17:00');
    await A.click('[data-act="reh-save"]');
    check(/17h00/.test(await lastPanel(A).locator('.rehbtn').textContent()), 'alteração aparece na hora mesmo sem internet');
    check(/enviadas quando a internet voltar/.test(await A.locator('#netbar').textContent()), 'avisa que vai enviar depois');
    await sleep(400);
    await B.click('[data-act="tab"][data-v="cultos"]');
    check(!/17h00/.test(await B.locator('.lcard', { hasText: '11 de outubro' }).textContent()), 'B ainda não recebeu');
    await A.evaluate(() => { window.dispatchEvent(new Event('online')); window.__mockSetOnline(); });
    check(await until(async () => /17h00/.test(await B.locator('.lcard', { hasText: '11 de outubro' }).textContent())), 'internet voltou: B recebe');
    check(await until(async () => !(await A.locator('#netbar').isVisible())), 'aviso some');
    await lastPanel(A).locator('[data-act="close"]').first().click();

    /* ----- reabrir: entra direto e baixa só o que mudou ----- */
    await A.evaluate(() => { window.__mockReads = 0; });
    await A.reload();
    await A.waitForSelector('#app:not([hidden])');
    check(await until(async () => (await A.locator('.lcard').count()) === 3), 'reabriu com os cultos');
    await sleep(500);
    const reads = await A.evaluate(() => window.__mockReads);
    check(reads <= 6, 'ao reabrir, quase nada é baixado de novo', reads);
    check((await A.locator('#me-btn').textContent()).trim() === 'AL', 'continua como Ana', await A.locator('#me-btn').textContent());

    /* ----- excluir culto: quem está com ele aberto é avisado ----- */
    await B.click('.lcard >> text=9 de outubro');
    await A.click('.lcard >> text=9 de outubro');
    await lastPanel(A).locator('[data-act="edit-list"]').first().click();
    await lastPanel(A).locator('[data-act="del-list"]').click();
    await lastPanel(A).locator('[data-act="del-list"]').click();
    check(await until(async () => (await B.locator('.panel').count()) === 0), 'tela do culto excluído fecha para B');
    check(/excluído/.test(await B.locator('#toast').textContent()), 'B é avisado');
    await A.click('[data-act="toast-act"]');
    check(await until(async () => (await B.locator('.lcard', { hasText: '9 de outubro' }).count()) === 1), 'desfazer volta para todos');
    check(await A.locator('.panel .hero').count() === 1, 'desfazer reabre o culto');
    await lastPanel(A).locator('[data-act="close"]').first().click();

    /* ----- tom e ordem em tempo real: A muda, B vê na hora (na página do culto e na tela do louvor) ----- */
    await A.click('[data-act="tab"][data-v="cultos"]');
    await B.click('[data-act="tab"][data-v="cultos"]');
    await A.click('.lcard >> text=11 de outubro');
    await B.click('.lcard >> text=11 de outubro');
    await lastPanel(B).locator('[data-act="open-item"]').first().click();
    await lastPanel(B).locator('.kchip').first().waitFor();
    const dayKey = async P => ((await P.locator('.panel .kbtn .kmini').first().textContent()) || '').trim();
    const k0 = await dayKey(A), k1 = k0 === 'A' ? 'B' : 'A';
    await lastPanel(A).locator('.kbtn').first().click();
    await A.locator('.sheet [data-act="day-key-set"]', { hasText: new RegExp('^' + k1 + '$') }).first().click();
    check(/para todos/.test(await A.locator('#toast').textContent()), 'avisa que o tom do dia mudou para todos');
    check(await until(async () => ((await lastPanel(B).locator('.kchip[aria-pressed="true"]').textContent()) || '').trim() === k1), 'B, na tela da cifra, passa a ver o tom do dia novo', [k0, k1]);
    check(await until(async () => /tom do dia mudou/.test(await B.locator('#toast').textContent())), 'B é avisado que o tom do dia mudou');
    /* B escolhe outro tom só para estudar; A muda o tom do dia de novo: o de B continua */
    await lastPanel(B).locator('.kchip', { hasText: /^E$/ }).first().click();
    await lastPanel(A).locator('.kbtn').first().click();
    await A.locator('.sheet [data-act="day-key-set"]', { hasText: /^G$/ }).first().click();
    check(await until(async () => /você está vendo em E/.test(await B.locator('#toast').textContent())), 'B é avisado, mas continua no tom que escolheu');
    check(((await lastPanel(B).locator('.kchip[aria-pressed="true"]').textContent()) || '').trim() === 'E', 'tom de estudo de B não muda');
    /* tom pela tela da cifra não muda para os outros */
    check((await dayKey(A)) === 'G', 'tom do dia ficou G');
    await lastPanel(B).locator('[data-act="close"]').first().click();
    check(await until(async () => (await dayKey(B)) === 'G'), 'B vê o tom do dia na página do culto');
    const titles = async P => P.locator('.panel .items .srow b').allTextContents();
    const t0 = await titles(B);
    await lastPanel(A).locator('[data-act="mv-group"][data-d="1"]').first().click();
    check(await until(async () => { const t = await titles(B); return t[0] === t0[1] && t[1] === t0[0]; }), 'B vê a ordem nova na hora', t0);
    check(await until(async () => { const t = await titles(A); return t[0] === t0[1]; }), 'A vê a ordem nova');
    await lastPanel(A).locator('[data-act="close"]').first().click();
    await lastPanel(B).locator('[data-act="close"]').first().click();

    /* ----- outra pessoa vira administradora pelo console do Firebase: o celular dela fica sabendo na hora ----- */
    await B.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('mock-fs-db'));
      const me = JSON.parse(sessionStorage.getItem('mock-auth-user')).uid;
      db['members/' + me].admin = true;
      db.__v = (db.__v || 0) + 1;
      localStorage.setItem('mock-fs-db', JSON.stringify(db));
      new BroadcastChannel('mock-fs').postMessage({ db });
    });
    let isAdm = false;
    for (let i = 0; i < 30 && !isAdm; i++) {
      await B.click('#me-btn');
      isAdm = (await B.locator('.menu [data-act="code"]').count()) === 1;
      await B.keyboard.press('Escape');
      if (!isAdm) await sleep(150);
    }
    check(isAdm, 'nova administradora vê as opções sem sair do app');

    /* ----- administrador muda o código ----- */
    await A.click('#me-btn');
    await A.click('.menu [data-act="code"]');
    check(await until(async () => (await A.locator('.codebox').textContent()) === 'manancial2026'), 'administrador vê o código');
    await A.fill('#cd-new', 'novocodigo');
    await A.click('[data-act="code-go"]');
    check(await until(async () => /Código alterado/.test(await A.locator('#toast').textContent())), 'código alterado');
    const C = await open();
    await C.goto(BASE);
    await C.waitForSelector('#gate');
    await C.fill('#g-code', 'manancial2026');
    await C.fill('#g-name', 'Nova Pessoa');
    await C.click('[data-act="g-join"]');
    check(await until(async () => /Código errado/.test(await C.locator('.gerr').textContent())), 'código antigo não entra mais');
    await C.fill('#g-code', 'novocodigo');
    await C.click('[data-act="g-join"]');
    check(await until(async () => C.locator('#app:not([hidden])').isVisible()), 'código novo entra');
    check(await until(async () => (await C.locator('.lcard').count()) === 3), 'pessoa nova recebe tudo');

    /* ----- senha de administrador ----- */
    const fsCall = (P, fn) => P.evaluate(fn);
    /* regras: membro comum não lê o histórico nem vira administrador sem a senha */
    check(await fsCall(C, async () => { const m = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'); try { await m.getDocs(m.query(m.collection(null, 'log'))); return 'leu'; } catch (e) { return e.code; } }) === 'permission-denied', 'membro comum não lê o histórico');
    check(await fsCall(C, async () => { const m = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'); const uid = JSON.parse(sessionStorage.getItem('mock-auth-user')).uid; try { await m.setDoc(m.doc(null, 'members', uid), { admin: true }, { merge: true }); return 'virou'; } catch (e) { return e.code; } }) === 'permission-denied', 'não vira administrador sem senha');
    await C.click('#me-btn');
    check(await C.locator('.menu [data-act="become-admin"]').count() === 1 && await C.locator('.menu [data-act="history"]').count() === 0, 'membro vê "Entrar como administrador"');
    await C.click('.menu [data-act="become-admin"]');
    await C.fill('#ba-pass', 'qualquer');
    await C.click('[data-act="become-admin-go"]');
    check(await until(async () => /Senha errada/.test(await C.locator('.sheet .gerr').textContent())), 'sem senha criada: não entra');
    await C.keyboard.press('Escape');
    await A.click('#me-btn');
    await A.click('.menu [data-act="admin-pass"]');
    check(await until(async () => /Ainda sem senha/.test(await A.locator('.sheet .codebox').textContent())), 'administrador vê que ainda não tem senha');
    await A.fill('#ap-new', '  Ensaio2026 ');
    await A.click('[data-act="admin-pass-go"]');
    check(await until(async () => /Senha de administrador salva/.test(await A.locator('#toast').textContent())), 'senha salva');
    await A.click('#me-btn');
    await A.click('.menu [data-act="admin-pass"]');
    check(await until(async () => (await A.locator('.sheet .codebox').textContent()) === 'ensaio2026'), 'administrador vê a senha');
    await A.keyboard.press('Escape');
    await C.click('#me-btn');
    await C.click('.menu [data-act="become-admin"]');
    await C.fill('#ba-pass', 'errada1');
    await C.click('[data-act="become-admin-go"]');
    check(await until(async () => /Senha errada/.test(await C.locator('.sheet .gerr').textContent())), 'senha errada não entra');
    await C.fill('#ba-pass', 'ENSAIO2026');
    await C.click('[data-act="become-admin-go"]');
    check(await until(async () => /agora você é administrador/i.test(await C.locator('#toast').textContent())), 'senha certa: vira administrador');
    await C.click('#me-btn');
    check(await C.locator('.menu [data-act="history"]').count() === 1, 'menu de administrador aparece');
    await C.keyboard.press('Escape');
    const dbA = await A.evaluate(() => JSON.parse(localStorage.getItem('mock-fs-db')));
    check(Object.values(dbA).filter(d => d && d.name === 'Nova Pessoa' && d.admin === true).length === 1, 'administrador no banco');

    /* ----- histórico (só administrador) ----- */
    await A.click('#me-btn');
    await A.click('.menu [data-act="history"]');
    check(await until(async () => (await A.locator('.panel .hrow').count()) > 3), 'histórico carrega');
    const hist = await A.locator('.panel [data-el="hist"]').textContent();
    check(/Carla/.test(hist) && /Nova Pessoa/.test(hist) && /Ana Lima/.test(hist), 'quem abriu o app', hist.slice(0, 200));
    check(/Entrou como administrador/.test(hist), 'histórico: virou administrador');
    check(/Mudou o tom do dia de .+ para G/.test(hist), 'histórico: tom');
    check(/Mudou a ordem dos louvores/.test(hist), 'histórico: ordem');
    check(/Mudou o código do ministério/.test(hist), 'histórico: código');
    check(/Cadastrou o louvor Louvor da Carla/.test(hist) && /Excluiu o culto de sexta 09\/10/.test(hist), 'histórico: louvor e culto', hist.slice(0, 900));
    await A.screenshot({ path: path.join(SHOTS, '22-historico.png') });
    await lastPanel(A).locator('[data-act="close"]').first().click();

    /* ----- acesso removido ----- */
    await C.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('mock-fs-db'));
      const me = JSON.parse(sessionStorage.getItem('mock-auth-user')).uid;
      delete db['members/' + me];
      db.__v = (db.__v || 0) + 1;
      localStorage.setItem('mock-fs-db', JSON.stringify(db));
      new BroadcastChannel('mock-fs').postMessage({ db });
    });
    await B.click('[data-act="tab"][data-v="louvores"]');
    await B.locator('#list .lrow', { hasText: 'Louvor da Carla' }).click();
    await lastPanel(B).locator('[data-act="edit"]').first().click();
    await lastPanel(B).locator('#f-title').fill('Louvor da Carla 2');
    await lastPanel(B).locator('[data-act="save"]').first().click();
    check(await until(async () => C.locator('#gate').isVisible(), 6000), 'quem perdeu o acesso volta para a entrada');
    check(/acesso foi removido/.test(await C.locator('#gate').textContent()), 'explica o motivo');
    await C.screenshot({ path: path.join(SHOTS, '21-acesso-removido.png') });

    /* ----- configurar de novo não é possível ----- */
    const D = await open();
    await D.goto(BASE + '#setup');
    await D.waitForSelector('#gate[data-kind="setup"]');
    await D.fill('#g-code', 'invasor123');
    await D.fill('#g-name', 'Invasor');
    await D.click('[data-act="g-setup"]');
    check(await until(async () => /já foi configurado/.test(await D.locator('.gerr').textContent())), 'não deixa configurar duas vezes');
    const db2 = await D.evaluate(() => JSON.parse(localStorage.getItem('mock-fs-db')));
    check(db2['config/access'].code === 'novocodigo', 'código não mudou');
    check(!!db0, 'ok');
    await ctx.close();
  } catch (e) {
    fails++;
    console.log('ERRO NO TESTE:', e.message.split('\n')[0], (e.stack || '').split('\n').find(l => l.includes('firebase.cjs')));
  } finally {
    await browser.close();
    srv.kill();
  }
  errs.forEach(e => console.log('ERRO NA PÁGINA: ' + e));
  if (errs.length) fails += errs.length;
  console.log(fails ? `\n${fails} problema(s) em ${count} verificações` : `TUDO OK (${count} verificações)`);
  process.exit(fails ? 1 : 0);
})();
