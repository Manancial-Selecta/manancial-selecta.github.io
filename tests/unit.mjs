/* Testes das partes sem tela: leitura da escala, mensagem do WhatsApp, acordes, dados do protótipo.
   Rodar: node tests/unit.mjs */
import { readFileSync } from 'node:fs';
import { parseMessage, splitMedley, parseReh } from '../src/parse.js';
import { waText, cifraFor, hasCifra, origKey, defaultKind, defaultReh, rehText, cultoName, groupItems } from '../src/domain.js';
import { guitarShape, guitarShapes, keyboardNotes, chordFormula, chordsOfLines, KNOWN_SHAPES } from '../src/chords.js';
import { processCifra, detectKey, shiftKey, capoHint } from '../src/music.js';
import { fromPrototype, normSong, normList } from '../src/model.js';
import { ytId } from '../src/youtube.js';

let fails = 0, count = 0;
const eq = (got, want, name) => {
  count++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log('FALHOU ' + name + '\n   veio:     ' + g + '\n   esperado: ' + w); }
};
const ok = (cond, name) => eq(!!cond, true, name);
const show = f => f.map(x => x < 0 ? 'x' : x > 9 ? '(' + x + ')' : String(x)).join('');

/* ----- escala do WhatsApp ----- */
const msg = `*ESCALA DO DOMINGO DIA 11/10*

*MINISTRO* : MARCOS
• CARLA
• RAFAEL
• LÍVIA

*TECLADO* : BIA
*BAIXO* : HENRIQUE

*LOUVORES* :

1) VIM PARA ADORAR TE
2) PRIMEIRA ESSÊNCIA (FELIPE RODRIGUES - *TOM C* )
3) OCEANOS + RENDIDO ESTOU

*DÍZIMOS* : TEU AMOR NÃO FALHA`;
const r = parseMessage(msg);
eq(r.date.slice(5), '10-11', 'data da escala');
eq(r.minister, 'Marcos', 'ministro');
eq(r.items.map(i => i.title), ['VIM PARA ADORAR TE', 'PRIMEIRA ESSÊNCIA', 'OCEANOS', 'RENDIDO ESTOU'], 'louvores');
eq(r.items.map(i => i.join), [false, false, true, false], 'emenda');
eq(r.items[1].key, 'C', 'tom do segundo');
eq(r.items[1].version, 'FELIPE RODRIGUES', 'versão');
eq(r.diz && r.diz.title, 'TEU AMOR NÃO FALHA', 'dízimos');
ok(r.people.includes('Carla') && r.people.includes('Bia'), 'pessoas da escala');
eq(splitMedley('OH QUÃO LINDO/FOGO NUNCA DORME'), ['OH QUÃO LINDO', 'FOGO NUNCA DORME'], 'barra separa emenda');
eq(parseReh('HOJE AS 18HS').time, '18:00', 'ensaio no aviso');
const ceia = parseMessage('*LOUVORES DO DOMINGO DIA 04/10 - CULTO DE CEIA*\n1) A\n2) B');
eq(ceia.kind, 'ceia', 'culto de ceia pelo título');

/* ----- regras do ministério ----- */
eq(defaultKind('2026-11-01'), 'ceia', 'primeiro domingo é ceia');
eq(defaultKind('2026-11-08'), '', 'segundo domingo é comum');
eq(defaultReh('2026-11-01', 'ceia', '', {}), { date: '2026-11-01', time: '15:45' }, 'ensaio da ceia no domingo');
eq(defaultReh('2026-10-09', '', '', {}), { date: '2026-10-09', time: '19:00' }, 'ensaio de sexta');
eq(defaultReh('2026-10-10', 'jovens', '', { reh: { jovens: { d: 0, t: '17:00' } } }), { date: '2026-10-10', time: '17:00' }, 'jovens lembra o horário');
eq(cultoName({ kind: 'mulheres' }), 'Culto das Mulheres', 'nome do culto');

/* ----- mensagem do WhatsApp ----- */
const songs = { a: { id: 'a', title: 'Oceanos', version: '' }, b: { id: 'b', title: 'Rendido Estou', version: 'Aline Barros' }, c: { id: 'c', title: 'Teu Amor Não Falha', version: '' } };
const L = { id: 'l20261011', date: '2026-10-11', minister: 'Marcos', kind: '', name: '', reh: { date: '2026-10-11', time: '15:45' }, aviso: 'trazer a pasta', items: [{ songId: 'a', key: 'G', join: true, obs: '' }, { songId: 'b', key: '', join: false, obs: 'só voz' }], diz: { songId: 'c', key: 'D', obs: '' } };
eq(waText(L, id => songs[id], 'https://x.github.io/louvores/').split('\n'), [
  '*LOUVORES DO DOMINGO DIA 11/10*', '', '*MINISTRO* : MARCOS', '*ENSAIO* : DOMINGO 11/10 ÀS 15H45', '',
  '1) OCEANOS (*TOM G* ) + RENDIDO ESTOU (ALINE BARROS)', '_Obs.: só voz_', '', '*DÍZIMOS* : TEU AMOR NÃO FALHA (*TOM D* )',
  '', '⚠️ TRAZER A PASTA', '', '*CIFRAS E VÍDEOS NO APP* :', 'https://x.github.io/louvores/#l20261011'
], 'mensagem do WhatsApp');
eq(groupItems(L.items).length, 1, 'emenda vira um item');

/* ----- violão e teclado ----- */
const gt = 'G       D/F#\nHá uma fonte que não seca\nEm7     C9\nCorre mansa no deserto';
const kb = 'G/B     D\nHá uma fonte que não seca';
eq(cifraFor({ cifra: gt, cifraKb: '' }, 'kb').fallback, true, 'teclado sem cifra usa a do violão');
eq(cifraFor({ cifra: gt, cifraKb: kb }, 'kb').text, kb, 'teclado com cifra própria');
eq(cifraFor({ cifra: '', cifraKb: kb }, 'gt').fallback, true, 'violão sem cifra usa a do teclado');
ok(hasCifra({ cifra: '', cifraKb: kb }), 'só cifra de teclado conta como cifra');
eq(origKey({ cifra: gt }), 'G', 'tom da cifra');
eq(chordsOfLines(processCifra(gt, 'G', 'A')), ['A', 'E/G#', 'F#m7', 'D9'], 'acordes da cifra transposta');
eq(detectKey(gt), 'G', 'descobrir o tom');
eq(shiftKey('A', -2), 'G', 'capo');
eq(capoHint('Bb'), { capo: 1, shape: 'A' }, 'sugestão de capo');

/* formas conhecidas passam na conferência das notas */
Object.entries(KNOWN_SHAPES).forEach(([n, f]) => eq(show(guitarShape(n).frets), f, 'forma conhecida ' + n));
const want = { Bm: 'x24432', F: '133211', 'F#m': '244222', 'C#m': 'x46654', Gm: '355333', Bb: 'x13331', Ab: '466544', Eb: 'xx1343', 'G#m': '466444', 'C#m7': 'x46454', 'Bm7(b5)': 'x2323x', 'B°': 'x2313x', 'F#m7(b5)': '2x221x', Bsus4: 'x24452', 'Bm/F#': '224432', 'C#m/G#': '446654', 'G#m/D#': 'x66444', 'C7(9)': 'x32333' };
Object.entries(want).forEach(([n, f]) => eq(show(guitarShape(n).frets), f, 'violão ' + n));
eq(guitarShape('F').barre, { fret: 1, from: 0, to: 5 }, 'pestana do F');
eq(guitarShape('C7(9)').barre, { fret: 3, from: 3, to: 5 }, 'pestana de cima do C7(9)');
ok(guitarShapes('G', 3).length >= 2, 'outras posições');
/* todo acorde comum tem desenho */
const roots = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
const sufs = ['', 'm', '7', 'm7', '7M', '4', '2', '9', 'm9', '6', 'm6', '7(4)', '7(9)', 'm7(9)', '7M(9)', '°', 'm7(b5)', '5', '+', '6(9)', 'm7(11)', '7(13)', '7(b9)', '7(#9)', 'sus4', 'add9', 'maj7', 'dim', 'm(7M)'];
const missing = [];
roots.forEach(rt => sufs.forEach(s => { if (!guitarShape(rt + s)) missing.push(rt + s); }));
roots.forEach(rt => ['C', 'E', 'F#', 'G', 'A', 'B', 'D#'].forEach(bs => { if (!guitarShape(rt + '/' + bs)) missing.push(rt + '/' + bs); }));
eq(missing, [], 'todos os acordes têm forma no violão');
eq(chordFormula('7(9)').tones.map(t => t[0]), [0, 4, 7, 10, 14], 'fórmula 7(9)');
eq(chordFormula('9').tones.map(t => t[0]), [0, 4, 7, 14], 'C9 é com nona, sem sétima');
eq(chordFormula('°').tones.map(t => t[0]), [0, 3, 6, 9], 'diminuto de 4 notas');
eq(keyboardNotes('D/F#').names, ['F#', 'D', 'A'], 'teclado D/F#');
eq(keyboardNotes('E°').names, ['E', 'G', 'Bb', 'Db'], 'teclado E°');
eq(keyboardNotes('Bm7(b5)').names, ['B', 'D', 'F', 'A'], 'teclado Bm7(b5)');
eq(keyboardNotes('Ab7M(9)').names, ['Ab', 'C', 'Eb', 'G', 'Bb'], 'teclado Ab7M(9)');

/* ----- dados do protótipo ----- */
const proto = JSON.parse(readFileSync(new URL('./fixtures/prototipo.json', import.meta.url)));
const d = fromPrototype(proto);
eq(d.songs.length, proto.songs.length, 'todos os louvores do protótipo');
eq(d.lists.length, proto.lists.length, 'todos os cultos do protótipo');
ok(d.songs.every(s => s.cifraKb === '' && s.keyKb === ''), 'louvores ganham cifra de teclado vazia');
ok(d.lists.every(l => l.items.length > 0), 'cultos com louvores');
eq(normList({ id: 'x', date: '2026-10-11', items: [] }, {}).reh, { date: '2026-10-11', time: '15:45' }, 'culto sem ensaio ganha o padrão');
eq(normSong({ id: 'a', title: ' X ', bpm: '72.4' }).bpm, 72, 'bpm');

/* ----- YouTube ----- */
eq(ytId('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ', 'link curto');
eq(ytId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ', 'link normal');
eq(ytId('https://m.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'shorts');
eq(ytId('https://music.youtube.com/watch?list=x&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'youtube music');
eq(ytId('não é link'), '', 'texto qualquer');

console.log(fails ? `\n${fails} de ${count} testes falharam` : `TUDO OK (${count} testes)`);
process.exit(fails ? 1 : 0);
