/* Testes da aba Escala no modo demonstração (sem Firebase).
   Rodar na pasta do app: node tests/escala.cjs */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS || path.join(ROOT, 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const FIXTURE = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'prototipo.json'));
const TODAY = new Date('2026-10-07T12:00:00-03:00');

let fails = 0, count = 0;
const check = (cond, name, extra) => { count++; if (!cond) { fails++; console.log('FALHOU ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) { try { if (await fn()) return true; } catch (e) { /* de novo */ } await sleep(80); }
  return false;
}

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const errs = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', colorScheme: 'dark' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.route(BASE + 'data/prototipo.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE }));
    await ctx.route(BASE + 'src/config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "export const FIREBASE = { apiKey: '' };" }));
    await ctx.addInitScript(() => { try { navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; } catch (e) { /* ok */ } });
    await ctx.clock.setFixedTime(TODAY);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
    const D = () => page.evaluate(() => import('/src/app.js').then(m => JSON.parse(JSON.stringify(m._debug.DATA))));

    /* administrador (quem configura o app) */
    await page.goto(BASE + '#setup');
    await page.waitForSelector('#gate[data-kind="setup"]');
    await page.fill('#g-code', 'Selecta2026');
    await page.fill('#g-name', 'Líder Teste');
    await page.click('[data-act="g-setup"]');
    await page.waitForSelector('#app:not([hidden])');
    check(await page.locator('.tabbar button').count() === 3, 'três abas embaixo');
    await page.click('[data-act="tab"][data-v="escala"]');
    await page.waitForSelector('#tab-escala .e-ed');
    check(/Domingo 2 de 4 de outubro/.test(await page.locator('.e-count').first().textContent()), 'começa no próximo domingo (11/10)');
    check(await page.locator('[data-act="e-members"]').count() === 1, 'administrador vê Membros e funções');

    /* membros e funções */
    await page.click('[data-act="e-members"]');
    check(await page.locator('.e-mrow').count() >= 10, 'lista começa com as pessoas do app', await page.locator('.e-mrow').count());
    await page.fill('#e-mnew', 'ana teste');
    await page.click('[data-act="e-madd"]');
    check(await page.locator('.e-mrow b', { hasText: 'Ana Teste' }).count() === 1, 'membro novo entra na lista');
    await page.click('.e-mrow:has(b:text-is("Marcos")) [data-r="min"]');
    await page.click('.e-mrow:has(b:text-is("Carla")) [data-r="voc"]');
    /* trocar o nome pelo lápis */
    await page.click('.e-mrow [data-act="e-mren"][data-n="Ana Teste"]');
    await page.fill('#e-mrn', 'ana souza');
    await page.press('#e-mrn', 'Enter');
    check(await page.locator('.e-mrow b', { hasText: 'Ana Souza' }).count() === 1 && await page.locator('.e-mrow b', { hasText: 'Ana Teste' }).count() === 0, 'nome trocado pelo lápis');
    await page.click('[data-act="sheet-done"]');
    let d = await D();
    const mem = d.escala.find(e => e.id === 'membros');
    check(mem && mem.people.find(p => p.n === 'Marcos').f.includes('min'), 'função salva', mem);

    /* mensal: escolher pelas caixas */
    const min = '#tab-escala [data-ek="min"]';
    const grp = await page.locator(min + ' optgroup').first().getAttribute('label');
    check(grp === 'Ministram', 'quem ministra aparece primeiro', grp);
    await page.selectOption(min, 'Marcos');
    await page.selectOption('#tab-escala [data-ek="v0"]', 'Carla');
    await page.selectOption('#tab-escala [data-ek="tec"]', 'Carla');
    check(/Também está em: Back 1/.test(await page.locator('#tab-escala .e-fwarn').last().textContent()) && /Também está em: Teclado/.test(await page.locator('#tab-escala .e-fwarn').first().textContent()), 'avisa quando a pessoa já está em outra função');
    check(/MARCOS|Marcos/i.test(await page.locator('.e-grid td.cur').first().textContent()), 'grade mostra o domingo atual');
    d = await D();
    const e11 = d.escala.find(e => e.id === '2026-10-11dom');
    check(e11 && e11.slots.min === 'Marcos' && !e11.pub, 'rascunho salvo, ainda não publicado', e11);
    await page.screenshot({ path: path.join(SHOTS, 'e1-mensal.png'), fullPage: true });
    await page.click('[data-act="e-step"][data-d="1"].e-big');
    check(/Domingo 3 de 4/.test(await page.locator('.e-count').first().textContent()), 'próximo domingo');
    await page.selectOption(min, 'Tiago');
    await page.click('.e-grid .dh >> text=11/10');
    check(/Domingo 2 de 4/.test(await page.locator('.e-count').first().textContent()), 'tocar na data da grade volta ao domingo');
    await page.click('[data-act="e-savemonth"]');
    check(await page.locator('#tab-escala .e-done').count() === 1, 'escala do mês salva');
    d = await D();
    check(d.escala.filter(e => e.kind === 'dom' && e.date.startsWith('2026-10') && e.pub).length === 4, 'os 4 domingos ficam salvos');

    /* imagem e mensagem */
    await page.click('[data-act="e-share"]');
    await page.waitForSelector('.sheet .e-img');
    const msg = await page.locator('.sheet .e-msg').textContent();
    check(/\*ESCALA DO LOUVOR · DOMINGOS DE OUTUBRO\*/.test(msg) && /\*MINISTRO\* : MARCOS/.test(msg) && /\*MINISTRO\* : TIAGO/.test(msg), 'mensagem do mês', msg.slice(0, 200));
    const iw = await page.locator('.sheet .e-img').evaluate(i => i.naturalWidth);
    check(iw === 1080, 'imagem da escala gerada', iw);
    await page.screenshot({ path: path.join(SHOTS, 'e2-enviar.png') });
    await page.click('[data-act="e-copy"]');
    check(/DOMINGOS DE OUTUBRO/.test(await page.evaluate(() => window.__copied || '')), 'copia a mensagem');
    await page.click('.scrim', { position: { x: 10, y: 10 } });

    /* domingo: já vem com os membros e com os louvores do culto que existe */
    await page.click('[data-act="e-sub"][data-v="dom"]');
    check(await page.locator('#tab-escala [data-ek="min"]').inputValue() === 'Marcos', 'domingo vem preenchido da mensal');
    check(await page.locator('#tab-escala .e-srow [data-esq]').count() === 4 && /^Vim Para Adorar/.test(await page.locator('#tab-escala [data-esq="0"]').inputValue()), 'louvores do culto que já existia', await page.locator('#tab-escala .e-srow [data-esq]').count());
    await page.click('#tab-escala [data-act="e-cpub"]');
    check(await page.locator('#tab-escala .e-done').count() === 1, 'Salvar escala do domingo');
    d = await D();
    let l11 = d.lists.find(l => l.id === 'l20261011');
    check(l11.items.length === 4 && l11.diz && l11.minister === 'Marcos', 'culto continua com os louvores', l11);
    /* depois de salvo, muda direto no culto */
    const sub = d.songs.find(s => s.title === 'Sublime').id;
    await page.fill('#tab-escala [data-esq="0"]', 'subl');
    check(await page.locator('#tab-escala [data-esq="0"] ~ .ac-list .ac-item').first().textContent() === 'SublimeFhop · sem cifra', 'sugestões enquanto digita', await page.locator('#tab-escala [data-esq="0"] ~ .ac-list').textContent());
    await page.screenshot({ path: path.join(SHOTS, 'e7-sugestoes.png') });
    await page.locator('#tab-escala [data-esq="0"] ~ .ac-list [data-act="e-pick"]').first().click();
    d = await D();
    l11 = d.lists.find(l => l.id === 'l20261011');
    check(l11.items[0].songId === sub && l11.items[0].key === 'D', 'troca de louvor vai para o culto', l11.items[0]);
    await page.click('#tab-escala [data-act="e-smv"][data-i="0"][data-d="1"]');
    d = await D();
    check(d.lists.find(l => l.id === 'l20261011').items[1].songId === sub, 'setas mudam a ordem no culto');
    await page.click('#tab-escala [data-act="e-sadd"]');
    check(await page.locator('#tab-escala .e-srow [data-esq]').count() === 5, 'adicionar louvor abre mais uma caixa');
    check(await page.evaluate(() => document.activeElement && document.activeElement.dataset.esq === '4'), 'cursor já na caixa nova');
    await page.fill('#tab-escala [data-esq="4"]', 'louvor novo teste');
    check(/Novo no repertório: “Louvor Novo Teste”/.test(await page.locator('#tab-escala [data-esq="4"] ~ .ac-list').textContent()), 'oferece cadastrar o louvor que não existe');
    await page.press('#tab-escala [data-esq="4"]', 'Enter');
    d = await D();
    const nsong = d.songs.find(s => s.title === 'Louvor Novo Teste');
    check(nsong && d.lists.find(l => l.id === 'l20261011').items.some(it => it.songId === nsong.id), 'louvor que não estava na lista entra no repertório e no culto');
    await page.selectOption('#tab-escala [data-ereh="time"]', '16:00');
    d = await D();
    check(d.lists.find(l => l.id === 'l20261011').reh.time === '16:00', 'ensaio vai para o culto');
    await page.fill('#tab-escala [data-eaviso]', 'Chegar cedo');
    await page.click('#tab-escala [data-act="e-daymsg"]');
    const dmsg = await page.locator('.sheet .e-msg').textContent();
    check(/^\*ESCALA DO DOMINGO DIA 11\/10\*/.test(dmsg) && /\*MINISTRO\* : MARCOS\n• CARLA/.test(dmsg) && /\*TECLADO\* : CARLA/.test(dmsg) && /\*ENSAIO\* : DOMINGO 11\/10 ÀS 16H00/.test(dmsg) && /\*LOUVORES\* :/.test(dmsg) && /⚠️ CHEGAR CEDO/.test(dmsg) && /#escala-2026-10-11dom$/.test(dmsg), 'mensagem do dia no formato da líder', dmsg);
    await page.click('.scrim', { position: { x: 10, y: 10 } });
    await page.screenshot({ path: path.join(SHOTS, 'e3-domingo.png'), fullPage: true });

    /* sexta e outros */
    await page.click('[data-act="e-sub"][data-v="sem"]');
    await page.click('[data-act="e-add"]');
    const first = await page.locator('#e-sdate option').first().getAttribute('value');
    check(first === '2026-10-16', 'só os próximos dias depois da última sexta', first);
    await page.click('#e-sk [data-v="jovens"]');
    const opts = await page.locator('#e-sdate option').evaluateAll(o => o.map(x => x.value));
    check(opts.slice(0, 3).join() === '2026-10-09,2026-10-10,2026-10-11' && opts[opts.length - 1] === '__other', 'outros: sexta, sábado e domingo, e Outro dia', opts.slice(0, 4));
    await page.click('#e-sk [data-v="sex"]');
    await page.click('[data-act="e-screate"]');
    await page.waitForSelector('.panel .e-ed');
    check(/Culto de sexta/.test(await page.locator('.panel .e-head').textContent()), 'abre a escala da sexta');
    check(await page.locator('.panel [data-ereh="time"]').inputValue() === '19:00', 'ensaio de sexta às 19h');
    await page.selectOption('.panel [data-ek="min"]', 'Tiago');
    const oce = d.songs.find(s => s.title === 'Oceanos').id;
    await page.fill('.panel [data-esq="0"]', 'ocea');
    await page.locator('.panel [data-esq="0"] ~ .ac-list [data-id="' + oce + '"]').click();
    await page.click('.panel [data-act="e-cpub"]');
    d = await D();
    const l16 = d.lists.find(l => l.date === '2026-10-16');
    check(l16 && l16.items.length === 1 && l16.minister === 'Tiago' && l16.kind === '' && l16.reh.time === '19:00', 'salvar cria o culto da sexta', l16);
    await page.screenshot({ path: path.join(SHOTS, 'e4-sexta.png'), fullPage: true });
    await page.click('.panel [data-act="close"]');
    check(await page.locator('#tab-escala .e-wcard').count() === 1, 'card da sexta na lista');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!ov, 'aba cabe na largura do celular');

    /* administrador também vê a própria escala */
    await page.click('#me-btn');
    await page.click('.menu [data-act="rename"]');
    await page.fill('#rn-name', 'Carla');
    await page.click('[data-act="rename-go"]');
    await sleep(200);
    check(/Back e Teclado/.test(await page.locator('#tab-escala .e-mine').textContent()), 'administrador vê o quadro Sua escala');
    await page.click('#tab-escala .e-mine [data-act="e-mine"]');
    check(await page.locator('.panel .e-you').count() === 1 && await page.locator('.panel select').count() === 0, 'tocar no dia abre a escala como membro');
    await page.click('.panel [data-act="close"]');
    check(/escala-2026-10-11dom/.test(dmsg), 'link da escala do dia');

    /* membro: só vê */
    await page.evaluate(() => { const m = JSON.parse(localStorage.getItem('lm-demo-me')); m.admin = false; m.name = 'Carla'; localStorage.setItem('lm-demo-me', JSON.stringify(m)); });
    await page.reload();
    await page.waitForSelector('#app:not([hidden])');
    await page.click('[data-act="tab"][data-v="escala"]');
    await page.waitForSelector('#tab-escala .e-mine');
    const mine = await page.locator('.e-mine').textContent();
    check(/Sua escala em outubro/.test(mine) && /DOM 11\/10/.test(mine) && /Back e Teclado/.test(mine), 'membro vê a sua escala', mine);
    check(await page.locator('[data-act="e-members"]').count() === 0 && await page.locator('#tab-escala select').count() === 0, 'membro não monta escala');
    check(await page.locator('.e-top').first().textContent() === 'Toque na data para ver a escala do dia.', 'aviso de tocar na data em cima');
    check(await page.locator('.e-grid span.me').count() >= 1, 'nome do membro destacado na grade');
    await page.click('.e-grid .dh >> text=11/10');
    check(await page.locator('#tab-escala .e-ro button').count() === 5 && await page.locator('#tab-escala [data-act="e-daymsg"]').count() === 0, 'membro vê os louvores do domingo, sem botão de WhatsApp');
    check(/Back e Teclado/.test(await page.locator('#tab-escala .e-you').textContent()), 'membro vê a função dele em destaque');
    await page.screenshot({ path: path.join(SHOTS, 'e5-membro.png'), fullPage: true });
    await page.locator('#tab-escala .e-ro button').first().click();
    await page.waitForSelector('.panel .cifra, .panel [data-el="cifra"], .panel .p-head');
    check(await page.locator('.panel').count() === 1, 'tocar no louvor abre o louvor');
    await page.keyboard.press('Escape');
    await page.click('[data-act="e-sub"][data-v="sem"]');
    check(await page.locator('#tab-escala .e-wcard.me').count() === 0 && await page.locator('#tab-escala .e-wcard').count() === 1, 'membro vê a sexta salva');
    /* link da mensagem do dia abre a escala do dia */
    await page.goto(BASE + '#escala-2026-10-11dom');
    await page.waitForSelector('.panel .e-you');
    check(/Back e Teclado/.test(await page.locator('.panel .e-you').textContent()) && await page.locator('.panel .e-ro button').count() === 5, 'link abre a escala do dia com a função da pessoa');
    await page.screenshot({ path: path.join(SHOTS, 'e6-link.png') });
    await ctx.close();
  } catch (e) {
    fails++;
    console.log('ERRO NO TESTE:', e.message.split('\n')[0], (e.stack || '').split('\n').find(l => l.includes('escala.cjs')));
  } finally {
    await browser.close();
    srv.kill();
  }
  errs.forEach(e => console.log('ERRO NA PÁGINA: ' + e));
  if (errs.length) fails += errs.length;
  console.log(fails ? `\n${fails} problema(s) em ${count} verificações` : `TUDO OK (${count} verificações)`);
  process.exit(fails ? 1 : 0);
})();
