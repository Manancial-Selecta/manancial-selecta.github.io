/* Testes de tela no modo demonstração (sem Firebase), com o Chromium do Playwright.
   Rodar na pasta do app: node tests/ui.cjs  (precisa do playwright instalado) */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS || path.join(ROOT, 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let fails = 0, count = 0;
const check = (cond, name, extra) => { count++; if (!cond) { fails++; console.log('FALHOU ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIXTURE = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'prototipo.json'));
const TODAY = new Date('2026-10-07T12:00:00-03:00'); /* os dados de teste são de outubro de 2026 */
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const GT = `[Intro] G  D/F#  Em7  C9

[Primeira Parte]
G                D/F#
Há uma fonte que não seca
Em7              C9
Corre mansa no deserto
G                   D/F#
Quem tem sede vem e bebe
Em7           C9        D4  D
Teu amor está sempre perto`;
const KB = `[Teclado]
G/B          D/F#
Há uma fonte que não seca
Em7(9)        C7M
Corre mansa no deserto`;

async function newPage(ctx, errs) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  return page;
}
const vis = async (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const lastPanel = page => page.locator('.panel').last();

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const errs = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', colorScheme: 'dark' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.route(/i\.ytimg\.com/, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1 }));
    await ctx.route(/youtube-nocookie\.com/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="background:#000;color:#fff">player</body></html>' }));
    await ctx.route(BASE + 'data/prototipo.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE }));
    await ctx.clock.setFixedTime(TODAY);
    await ctx.route(BASE + 'src/config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "export const FIREBASE = { apiKey: '' };" }));
    await ctx.addInitScript(() => { try { navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; } catch (e) { /* ok */ } });
    const page = await newPage(ctx, errs);
    await page.goto(BASE);

    /* ----- entrar ----- */
    await page.waitForSelector('#gate');
    check(await page.locator('#gate h1').textContent() === 'Entrar', 'tela de entrada');
    await page.screenshot({ path: path.join(SHOTS, '01-entrar.png') });
    await page.fill('#g-code', 'errado');
    await page.fill('#g-name', 'maria');
    await page.click('[data-act="g-join"]');
    await sleep(200);
    check(/Código errado/.test(await page.locator('.gerr').textContent()), 'código errado avisa');
    await page.fill('#g-code', '  Manancial ');
    await page.fill('#g-name', 'ana paula de souza');
    await page.press('#g-name', 'Enter');
    await page.waitForSelector('#app:not([hidden])');
    check((await page.locator('#me-btn').textContent()).trim() === 'AS', 'iniciais no botão', await page.locator('#me-btn').textContent());
    check(await page.locator('.lcard').count() === 3, 'três cultos do protótipo');
    check(await page.locator('.lcard.next').count() === 1, 'próximo culto destacado');

    /* ----- página do culto ----- */
    await page.click('.lcard.next');
    const lp = lastPanel(page);
    await lp.waitFor();
    check(/Sexta/.test(await lp.locator('.hero .wd').textContent()), 'culto de sexta');
    check(/Ensaio às 19h00/.test(await lp.locator('.rehbtn').textContent()), 'ensaio de sexta 19h00');
    const wa = decodeURIComponent((await lp.locator('a.btn.pri').getAttribute('href')).replace('https://wa.me/?text=', ''));
    check(wa.startsWith('*LOUVORES DA SEXTA-FEIRA DIA 09/10*'), 'título da mensagem', wa.split('\n')[0]);
    check(wa.includes('*ENSAIO* : SEXTA 09/10 ÀS 19H00'), 'linha do ensaio');
    check(wa.trim().endsWith(BASE + '#l20261009'), 'link do culto no fim', wa.trim().split('\n').pop());
    check(/ALTERAÇÃO NO SEGUNDO LOUVOR/i.test(await lp.locator('.avisobox').textContent()), 'aviso no fim da página');
    await lp.locator('[data-act="copy-list"]').click();
    await sleep(100);
    check((await page.evaluate(() => window.__copied || '')).includes('MINISTRO'), 'copiar mensagem');
    /* ensaio */
    await lp.locator('.rehbtn').click();
    await page.fill('#rh-time', '19:30');
    await page.click('[data-act="reh-save"]');
    await sleep(150);
    check(/19h30/.test(await lastPanel(page).locator('.rehbtn').textContent()), 'ensaio alterado na página');
    await page.screenshot({ path: path.join(SHOTS, '02-culto.png') });
    await lastPanel(page).locator('[data-act="close"]').click();
    check(/19h30/.test(await page.locator('.lcard.next').textContent()), 'ensaio alterado no cartão');

    /* ----- novo louvor com cifra de violão e de teclado ----- */
    await page.click('[data-act="tab"][data-v="louvores"]');
    await page.click('#vh-louvores [data-act="new"]');
    let ed = lastPanel(page);
    await ed.locator('#f-title').fill('Teste Violão e Teclado');
    await ed.locator('#f-yt').fill('https://youtu.be/dQw4w9WgXcQ');
    await ed.locator('#f-cifra').fill(GT);
    await sleep(350);
    check(/Tom da cifra: G/.test(await ed.locator('[data-el="detect"]').textContent()), 'tom detectado no violão');
    await ed.locator('[data-act="ctab"][data-v="kb"]').click();
    check(await ed.locator('#f-cifrakb').isVisible() && !(await ed.locator('#f-cifra').isVisible()), 'aba teclado');
    check(/Opcional/.test(await ed.locator('[data-el="detect"]').textContent()), 'teclado opcional');
    await ed.locator('#f-cifrakb').fill(KB);
    await sleep(350);
    check(/linhas de acordes/.test(await ed.locator('[data-el="detect"]').textContent()), 'cifra de teclado reconhecida');
    await page.screenshot({ path: path.join(SHOTS, '03-editor-teclado.png') });
    await ed.locator('[data-act="save"]').first().click();
    const sp = lastPanel(page);
    await sp.locator('[data-el="cifra"]').waitFor();
    check((await sp.locator('.p-title b').textContent()) === 'Teste Violão e Teclado', 'louvor salvo e aberto', await sp.locator('.p-title b').textContent());

    /* violão: desenhos de violão */
    await sp.locator('[data-act="inst"][data-v="gt"]').click();
    const gtCount = await sp.locator('.dstrip .dg.gt').count();
    check(gtCount === 6, 'desenhos de violão (G D/F# Em7 C9 D4 D)', gtCount);
    check(await sp.locator('[data-el="capotool"]').isVisible(), 'capo aparece no violão');
    await page.screenshot({ path: path.join(SHOTS, '04-louvor-violao.png') });
    /* vídeo */
    check(await sp.locator('button.vbox img.vthumb').count() === 1, 'capa do vídeo');
    await sp.locator('[data-act="play-video"]').click();
    check(/youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test(await sp.locator('.vframe iframe').getAttribute('src')), 'vídeo toca dentro do app');
    /* teclado */
    await sp.locator('[data-act="inst"][data-v="kb"]').click();
    check(await sp.locator('.dstrip .dg.kb').count() === 4, 'desenhos de teclado', await sp.locator('.dstrip .dg.kb').count());
    check(!(await sp.locator('[data-el="capotool"]').isVisible()), 'capo some no teclado');
    check(/Em7\(9\)/.test(await sp.locator('[data-el="cifra"]').textContent()), 'cifra de teclado aparece');
    check(await sp.locator('.vframe iframe').count() === 1, 'trocar instrumento não para o vídeo');
    await page.screenshot({ path: path.join(SHOTS, '05-louvor-teclado.png') });
    /* tom muda os desenhos */
    await sp.locator('.kchip[data-v="A"]').click();
    const kbNames = await sp.locator('.dstrip .dchip').evaluateAll(els => els.map(e => e.dataset.v));
    check(JSON.stringify(kbNames) === JSON.stringify(['A/C#', 'E/G#', 'F#m7(9)', 'D7M']), 'acordes no tom A', kbNames);
    /* acorde tocado */
    await sp.locator('.dstrip .dchip').first().click();
    check(await page.locator('.sheet .bigdg .dg.kb').count() === 1, 'desenho grande do teclado');
    check(/laranja/.test(await page.locator('.sheet').textContent()), 'explica a nota do baixo');
    await page.screenshot({ path: path.join(SHOTS, '06-acorde-teclado.png') });
    await page.click('[data-act="chord-inst"]');
    check(await page.locator('.sheet .bigdg .dg.gt').count() === 1, 'ver o mesmo acorde no violão');
    check(await page.locator('.sheet .altdg .dg.gt').count() >= 1, 'outras posições no violão');
    await page.screenshot({ path: path.join(SHOTS, '07-acorde-violao.png') });
    await page.click('.sheet [data-act="sheet-done"]');
    await sp.locator('[data-act="inst"][data-v="gt"]').click();
    await sp.locator('.cifra .ln.ch b').first().click();
    check(/^[A-G]/.test(await page.locator('.sheet h3.chordh').textContent()), 'acorde tocado na cifra');
    await page.click('.sheet [data-act="sheet-done"]');
    /* capo */
    await sp.locator('[data-act="capo"][data-d="1"]').click();
    await sp.locator('[data-act="capo"][data-d="1"]').click();
    const capoNames = await sp.locator('.dstrip .dchip').evaluateAll(els => els.map(e => e.dataset.v));
    check(capoNames[0] === 'G', 'capo 2 em A mostra formas de G', capoNames);
    /* esconder acordes e modo altar */
    await sp.locator('[data-act="toggle-chords"]').click();
    check(!(await sp.locator('[data-el="dstrip"]').isVisible()), 'esconder acordes');
    await sp.locator('[data-act="toggle-chords"]').click();
    await sp.locator('[data-act="palco"]').click();
    check(!(await sp.locator('[data-el="dstrip"]').isVisible()) && !(await sp.locator('[data-el="video"]').isVisible()), 'modo altar limpa a tela');
    check(await sp.locator('.vframe').count() === 0, 'modo altar para o vídeo');
    await sp.locator('[data-act="palco"]').click();
    await sp.locator('[data-act="close"]').first().click();

    /* teclado sem cifra própria usa a do violão */
    await page.fill('#q', 'oceanos');
    await page.click('#list .lrow');
    const so2 = lastPanel(page);
    check(/ainda não tem cifra/.test(await so2.locator('[data-el="cifra"]').textContent()), 'louvor sem cifra');
    await so2.locator('[data-act="close"]').first().click();
    await page.click('[data-act="clear"]');
    await page.fill('#q', 'teste violão');
    await page.click('#list .lrow');
    const so3 = lastPanel(page);
    await so3.locator('[data-act="edit"]').first().click();
    ed = lastPanel(page);
    check(await ed.locator('[data-act="ctab"][data-v="gt"]').getAttribute('aria-selected') === 'true', 'editor abre na aba do instrumento escolhido');
    await ed.locator('[data-act="ctab"][data-v="kb"]').click();
    await ed.locator('#f-cifrakb').fill('');
    await ed.locator('[data-act="save"]').first().click();
    const so4 = lastPanel(page);
    await so4.locator('[data-act="inst"][data-v="kb"]').click();
    check(await so4.locator('[data-el="instnote"]').isVisible(), 'aviso de cifra do violão no teclado');
    check(await so4.locator('.dstrip .dg.kb').count() === 6, 'teclado desenha os acordes da cifra do violão', await so4.locator('.dstrip .dg.kb').count());
    await so4.locator('[data-act="inst"][data-v="gt"]').click();
    await so4.locator('[data-act="close"]').first().click();
    await page.click('[data-act="clear"]');

    /* ----- novo culto colando a escala ----- */
    await page.click('[data-act="tab"][data-v="cultos"]');
    await page.click('[data-act="new-list"]');
    const le = lastPanel(page);
    await le.locator('#le-paste').fill(`*ESCALA DO DOMINGO DIA 18/10*\n\n*MINISTRO* : CARLA\n\n*LOUVORES* :\n\n1) TESTE VIOLÃO E TECLADO (*TOM A*)\n2) OCEANOS + RENDIDO ESTOU\n3) LOUVOR NOVO DE TESTE\n\n*DÍZIMOS* : TEU AMOR NÃO FALHA`);
    await le.locator('[data-act="parse"]').click();
    check(await le.locator('.erow').count() === 5, 'cinco louvores montados', await le.locator('.erow').count());
    check((await le.locator('.chip.new').count()) === 1, 'um louvor novo no repertório');
    check(await le.locator('#le-rtime').inputValue() === '15:45', 'ensaio de domingo 15h45');
    await page.screenshot({ path: path.join(SHOTS, '08-novo-culto.png') });
    await le.locator('[data-act="save-list"]').first().click();
    const lp2 = lastPanel(page);
    await lp2.locator('.hero').waitFor();
    check(/18 out/i.test(await lp2.locator('.hero .dt').textContent()), 'culto novo aberto');
    const wa2 = decodeURIComponent((await lp2.locator('a.btn.pri').getAttribute('href')).replace('https://wa.me/?text=', ''));
    check(wa2.includes('1) TESTE VIOLÃO E TECLADO (*TOM A* )'), 'tom do dia na mensagem', wa2);
    check(wa2.includes('#l20261018'), 'link do culto novo');
    /* abrir o louvor pela lista: tom do dia */
    await lp2.locator('.srow').first().click();
    const sp5 = lastPanel(page);
    check((await sp5.locator('.kchip[aria-pressed="true"]').textContent()) === 'A', 'abre no tom do dia');
    check(/louvor 1 de 3/.test(await sp5.locator('[data-el="where"]').textContent()), 'posição no culto', await sp5.locator('[data-el="where"]').textContent());
    await sp5.locator('[data-act="nav"][data-d="1"]').click();
    check(/Oceanos/.test(await lastPanel(page).locator('.p-title b').textContent()), 'próximo louvor');
    await lastPanel(page).locator('[data-act="close"]').first().click();
    await lastPanel(page).locator('[data-act="close"]').first().click();

    /* ----- link direto do WhatsApp ----- */
    const page2 = await newPage(ctx, errs);
    await page2.goto(BASE + '#l20261018');
    await page2.waitForSelector('.panel .hero');
    check(/18 out/i.test(await page2.locator('.panel .hero .dt').textContent()), 'link abre o culto direto');
    /* outra aba vê a alteração na hora */
    await page.click('[data-act="tab"][data-v="louvores"]');
    await page.fill('#q', 'louvor novo');
    await page.click('#list .lrow');
    await lastPanel(page).locator('[data-act="edit"]').first().click();
    await lastPanel(page).locator('#f-title').fill('Louvor Novo Renomeado');
    await lastPanel(page).locator('[data-act="save"]').first().click();
    await sleep(300);
    check(/Louvor Novo Renomeado/.test(await page2.locator('.panel').last().textContent()), 'outra aba atualizou na hora');
    await page2.close();
    await lastPanel(page).locator('[data-act="close"]').first().click();
    await page.click('[data-act="clear"]');

    /* ----- excluir e desfazer ----- */
    await page.fill('#q', 'renomeado');
    await page.click('#list .lrow');
    await lastPanel(page).locator('[data-act="edit"]').first().click();
    await lastPanel(page).locator('[data-act="del"]').click();
    await lastPanel(page).locator('[data-act="del"]').click();
    await sleep(100);
    check(await page.locator('.panel').count() === 0, 'louvor excluído fecha as telas');
    check(await page.locator('#list .lrow').count() === 0, 'louvor sumiu');
    await page.click('[data-act="toast-act"]');
    await sleep(100);
    check(await page.locator('#list .lrow').count() === 1, 'desfazer exclusão');
    await page.click('[data-act="clear"]');

    /* ----- conta ----- */
    await page.click('#me-btn');
    check(await page.locator('.menu [data-act="install"]').count() === 1, 'menu tem instalar');
    await page.click('.menu [data-act="rename"]');
    await page.fill('#rn-name', 'joana d arc');
    await page.click('[data-act="rename-go"]');
    await sleep(100);
    check((await page.locator('#me-btn').textContent()).trim() === 'JA', 'nome trocado', await page.locator('#me-btn').textContent());
    await page.click('#me-btn');
    await page.click('.menu [data-act="install"]');
    check(/Chrome/.test(await page.locator('.sheet').textContent()), 'instruções de instalar');
    await page.click('.sheet [data-act="sheet-done"]');
    await page.click('#me-btn');
    await page.click('.menu [data-act="leave"]');
    await page.click('[data-act="leave-go"]');
    await page.waitForSelector('#gate');
    check(true, 'saiu do aparelho');

    /* ----- configurar (#setup) ----- */
    await page.goto(BASE + '#setup');
    await page.waitForSelector('#gate[data-kind="setup"]');
    await page.screenshot({ path: path.join(SHOTS, '09-configurar.png') });
    await page.fill('#g-code', 'curto');
    await page.fill('#g-name', 'admin teste');
    await page.click('[data-act="g-setup"]');
    check(/pelo menos 6/.test(await page.locator('.gerr').textContent()), 'código curto avisa');
    await page.fill('#g-code', 'Selecta2026');
    await page.click('[data-act="g-setup"]');
    await page.waitForSelector('#app:not([hidden])');
    await page.click('#me-btn');
    check(await page.locator('.menu [data-act="code"]').count() === 1, 'administrador vê o código');
    await page.click('.menu [data-act="code"]');
    await sleep(100);
    check((await page.locator('.codebox').textContent()) === 'selecta2026', 'código salvo', await page.locator('.codebox').textContent());
    await page.click('.scrim', { position: { x: 10, y: 10 } });

    /* ----- tema claro e tela pequena ----- */
    const light = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, serviceWorkers: 'block', colorScheme: 'light' });
    await light.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await light.route(/i\.ytimg\.com/, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1 }));
    await light.route(BASE + 'data/prototipo.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE }));
    await light.clock.setFixedTime(TODAY);
    await light.route(BASE + 'src/config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "export const FIREBASE = { apiKey: '' };" }));
    const lpg = await newPage(light, errs);
    await lpg.goto(BASE);
    await lpg.fill('#g-code', 'manancial');
    await lpg.fill('#g-name', 'Teste');
    await lpg.click('[data-act="g-join"]');
    await lpg.waitForSelector('#app:not([hidden])');
    await lpg.screenshot({ path: path.join(SHOTS, '10-claro-inicio.png') });
    const overflow = await lpg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, 'sem rolagem para o lado no celular pequeno');

    /* ----- botão voltar do celular ----- */
    const back = async () => { await lpg.goBack(); await lpg.waitForTimeout(200); };
    const panels = () => lpg.locator('.panel').count();
    await lpg.click('.lcard.next');
    await lpg.locator('.panel [data-act="open-item"]').first().click();
    await lpg.waitForSelector('.panel .cifra, .panel [data-el="cifra"]');
    check(await panels() === 2, 'culto e louvor abertos');
    await back();
    check(await panels() === 1 && lpg.url() === BASE, 'voltar fecha só o louvor', [await panels(), lpg.url()]);
    await back();
    check(await panels() === 0 && lpg.url() === BASE && await lpg.locator('#app').isVisible(), 'voltar fecha o culto e continua no app', [await panels(), lpg.url()]);
    /* modo altar: o voltar primeiro sai do modo altar */
    await lpg.click('.lcard.next');
    await lpg.locator('.panel [data-act="open-item"]').first().click();
    await lpg.locator('.panel [data-act="palco"]').last().click();
    await back();
    check(await panels() === 2 && await lpg.locator('.panel [data-act="palco"]').last().getAttribute('aria-pressed') === 'false', 'voltar sai do modo altar');
    await back(); await back();
    check(await panels() === 0, 'voltar duas vezes fecha tudo');
    /* editor sem alteração fecha direto; com alteração pergunta */
    await lpg.click('[data-act="tab"][data-v="louvores"]');
    await lpg.click('[data-act="new"]');
    await back();
    check(await panels() === 0, 'editor sem alteração fecha com voltar');
    await lpg.click('[data-act="new"]');
    await lpg.fill('#f-title', 'Rascunho');
    await back();
    check(await panels() === 1 && /Sair sem salvar/.test(await lpg.locator('.sheet').textContent()), 'editor com alteração pergunta antes de sair');
    await lpg.click('[data-act="discard-stay"]');
    check(await panels() === 1 && await lpg.locator('.sheet').count() === 0 && await lpg.inputValue('#f-title') === 'Rascunho', 'continuar editando mantém o que foi escrito');
    await back();
    await back();
    check(await panels() === 1 && await lpg.locator('.sheet').count() === 0, 'voltar com a pergunta aberta só fecha a pergunta');
    await back();
    await lpg.click('[data-act="discard-go"]');
    await lpg.waitForTimeout(200);
    check(await panels() === 0 && lpg.url() === BASE, 'sair sem salvar fecha o editor');
    /* culto novo: colar a escala sem montar também conta como alteração */
    await lpg.click('[data-act="tab"][data-v="cultos"]');
    await lpg.click('[data-act="new-list"]');
    await lpg.fill('#le-paste', '*ESCALA DO DOMINGO DIA 25/10*');
    await back();
    check(/Sair sem salvar/.test(await lpg.locator('.sheet').textContent()), 'escala colada pergunta antes de sair');
    await lpg.click('[data-act="discard-go"]');
    /* fechar pela seta do app não deixa um voltar "morto" */
    await lpg.click('.lcard.next');
    await lpg.locator('.panel [data-act="close"]').click();
    await lpg.waitForTimeout(200);
    check(await panels() === 0 && await lpg.locator('.sheet').count() === 0, 'seta do app fecha o culto');
    /* tela inicial: o voltar pergunta antes de sair */
    await back();
    check(/Sair do app\?/.test(await lpg.locator('.sheet').textContent()) && lpg.url() === BASE, 'tela inicial: voltar pergunta se quer sair');
    await lpg.click('[data-act="exit-stay"]');
    await lpg.waitForTimeout(200);
    check(await lpg.locator('.sheet').count() === 0 && await lpg.evaluate(() => history.state && history.state.lmBack === 1), 'continuar no app');
    await back();
    check(/Sair do app\?/.test(await lpg.locator('.sheet').textContent()), 'pergunta de novo no próximo voltar');
    await lpg.goBack().catch(() => null); await lpg.waitForTimeout(300);
    check(lpg.url() !== BASE, 'voltar de novo sai do app', lpg.url());
    await lpg.goto(BASE);
    await lpg.waitForSelector('#app:not([hidden])');
    /* link do WhatsApp abre o culto; o voltar fecha e continua no app */
    const lp9 = await newPage(light, errs);
    await lp9.goto(BASE + '#l20261009');
    await lp9.waitForSelector('.panel .hero');
    await lp9.click('.panel .hero');
    await lp9.goBack(); await lp9.waitForTimeout(200);
    check(await lp9.locator('.panel').count() === 0 && await lp9.locator('#app').isVisible() && await lp9.locator('.sheet').count() === 0, 'link do culto: voltar fica no app', lp9.url());
    await lp9.goBack(); await lp9.waitForTimeout(200);
    check(/Sair do app\?/.test(await lp9.locator('.sheet').textContent()), 'link do culto: depois pergunta se quer sair');
    await lp9.close();
    await lpg.click('[data-act="tab"][data-v="louvores"]');
    await lpg.click('[data-act="new"]');
    await lpg.fill('#f-title', 'Teste Claro');
    await lpg.fill('#f-cifra', GT);
    await lpg.locator('.panel [data-act="save"]').first().click();
    await lpg.waitForSelector('.panel .dstrip .dg');
    await lpg.screenshot({ path: path.join(SHOTS, '11-claro-louvor.png') });
    const ov2 = await lpg.evaluate(() => { const p = document.querySelector('.panel .p-in'); return p.scrollWidth > p.clientWidth + 1; });
    check(!ov2, 'tela do louvor cabe no celular pequeno');
    await light.close();
    await ctx.close();
  } catch (e) {
    fails++;
    console.log('ERRO NO TESTE:', e.message.split('\n')[0], (e.stack || '').split('\n').find(l => l.includes('ui.cjs')));
  } finally {
    await browser.close();
    srv.kill();
  }
  errs.forEach(e => console.log('ERRO NA PÁGINA: ' + e));
  if (errs.length) fails += errs.length;
  console.log(fails ? `\n${fails} problema(s) em ${count} verificações` : `TUDO OK (${count} verificações)`);
  process.exit(fails ? 1 : 0);
})();
