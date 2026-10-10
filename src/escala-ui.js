/* Aba Escala: o administrador monta (um dia por vez, caixas grandes); o membro vê o que foi salvo.
   - Mensal: só os membros dos domingos do mês.
   - Domingo: membros (vindos da Mensal) + louvores, dízimos, ensaio e aviso; "Salvar escala" cria o culto.
   - Sexta e outros: um culto por vez, do mesmo jeito.
   Este módulo só monta HTML e textos; quem grava é o app (apply). */
import { ESC_KEYS } from './model.js';
import { esc, UP, dObj, dm, isoOf, addDays, norm, hm, WD_UP } from './util.js';
import { defaultKind, defaultReh, groupItems, itemText } from './domain.js';
import { ICON } from './icons.js';

export const EFN = { min: 'Ministro', voc: 'Back', tec: 'Teclado', bat: 'Bateria', gui: 'Guitarra', vio: 'Violão', bai: 'Baixo', mid: 'Mídia', som: 'Som' };
export const EFIELDS = [
  { k: 'min', fn: 'min', label: 'Ministro' },
  { k: 'v0', fn: 'voc', label: 'Back 1' }, { k: 'v1', fn: 'voc', label: 'Back 2' }, { k: 'v2', fn: 'voc', label: 'Back 3' },
  { sec: 'Músicos' },
  { k: 'tec', fn: 'tec', label: 'Teclado' }, { k: 'bat', fn: 'bat', label: 'Bateria' }, { k: 'gui', fn: 'gui', label: 'Guitarra' },
  { k: 'vio', fn: 'vio', label: 'Violão' }, { k: 'bai', fn: 'bai', label: 'Baixo' },
  { line: true },
  { k: 'mid', fn: 'mid', label: 'Mídia' }, { k: 'som', fn: 'som', label: 'Som' }
];
export const ELBL = Object.fromEntries(EFIELDS.filter(f => f.k).map(f => [f.k, f.label]));
export const EKIND = { dom: 'Domingo', sex: 'Culto de sexta', jovens: 'Culto de Jovens', mulheres: 'Culto das Mulheres', outro: '' };
const TIMES = ['08:00', '09:00', '13:00', '14:00', '14:30', '15:00', '15:30', '15:45', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00'];
const WD = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monName = ym => MO[Number(ym.slice(5)) - 1];

export function daysOf(ym, wd) {
  const [y, m] = ym.split('-').map(Number), out = [];
  for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) if (d.getDay() === wd) out.push(isoOf(d));
  return out;
}
export const isCeiaDay = iso => dObj(iso).getDay() === 0 && dObj(iso).getDate() <= 7;
export const backsOf = s => [s.v0, s.v1, s.v2].filter(Boolean);
export const escLabel = e => e.kind === 'outro' ? e.name : EKIND[e.kind];
export const blankSlots = () => Object.fromEntries(ESC_KEYS.map(k => [k, '']));
export const escNew = (date, kind, name) => ({ id: date + kind, date, kind, name: name || '', slots: blankSlots(), pub: false, cpub: false, items: null, diz: '', reh: null, aviso: '' });
/* tipo do culto na aba Cultos */
export const listKindOf = e => e.kind === 'dom' ? defaultKind(e.date) : e.kind === 'sex' ? '' : e.kind;
/* mesmo nome: igual ou mesmo primeiro nome ("Júlia" e "Júlia Souza") */
export function sameName(a, b) {
  const x = norm(a).trim(), y = norm(b).trim();
  if (!x || !y) return false;
  return x === y || x.split(/\s+/)[0] === y.split(/\s+/)[0];
}
export const rolesOf = (e, name) => [...new Set(ESC_KEYS.filter(k => sameName(e.slots[k], name)).map(k => /^v\d$/.test(k) ? 'Back' : ELBL[k]))];

/* o culto (aba Cultos) ligado a esta escala */
export function listFor(e, lists) {
  const same = lists.filter(l => l.date === e.date);
  return same.find(l => (l.kind || '') === listKindOf(e)) || (e.kind === 'dom' || e.kind === 'sex' ? same[0] : null) || null;
}
/* o que a tela mostra de louvores/ensaio/aviso: depois de salvo vem do culto; antes, do rascunho */
export function viewOf(e, lists, prefs, extraBlank) {
  const l0 = listFor(e, lists), l = e.cpub || (l0 && e.items == null) ? l0 : null;
  if (l) {
    const ids = l.items.map(it => it.songId);
    const n = Math.max(3, ids.length) - ids.length + (extraBlank || 0);
    return { items: ids.concat(Array(n).fill('')), diz: l.diz ? l.diz.songId : '', reh: l.reh && l.reh.time ? { day: l.reh.date < l.date ? 'before' : 'same', time: l.reh.time } : { day: 'same', time: '' }, aviso: l.aviso || '', live: e.cpub ? l : null };
  }
  let reh = e.reh;
  if (!reh) {
    const r = defaultReh(e.date, listKindOf(e), e.name, prefs || {});
    reh = r && r.time ? { day: r.date < e.date ? 'before' : 'same', time: r.time } : { day: 'same', time: e.kind === 'sex' ? '19:00' : '' };
  }
  return { items: e.items ? e.items.slice() : ['', '', ''], diz: e.diz || '', reh, aviso: e.aviso || '', live: null };
}
/* monta o culto a partir da escala, aproveitando tom/observação dos louvores que já estavam lá */
export function listFromView(e, v, base, H) {
  const l = base ? JSON.parse(JSON.stringify(base)) : { id: H.newListId(e.date), date: e.date, minister: '', kind: '', name: '', reh: null, aviso: '', items: [], diz: null };
  const minister = e.slots.min || l.minister || '';
  const pool = (base ? base.items.concat(base.diz ? [base.diz] : []) : []).map(x => Object.assign({}, x));
  const mk = id => {
    const i = pool.findIndex(it => it.songId === id);
    if (i >= 0) return pool.splice(i, 1)[0];
    const so = H.songById(id);
    return { songId: id, key: so ? H.autoKey({ minister }, so) : '', version: '', obs: '', join: false, mode: 'auto' };
  };
  l.items = v.items.filter(id => id && H.songById(id)).map(mk);
  if (l.items.length) l.items[l.items.length - 1].join = false;
  l.diz = v.diz && H.songById(v.diz) ? mk(v.diz) : null;
  if (l.diz) l.diz.join = false;
  l.minister = minister;
  if (!base) { l.kind = listKindOf(e); l.name = e.kind === 'outro' ? e.name : ''; }
  l.reh = v.reh && v.reh.time ? { date: v.reh.day === 'before' ? addDays(e.date, -1) : e.date, time: v.reh.time } : null;
  l.aviso = (v.aviso || '').trim();
  l.up = Date.now();
  return l;
}

/* ===== mensagens ===== */
const wdFull = iso => { const i = dObj(iso).getDay(); return i === 0 ? 'DOMINGO' : i === 6 ? 'SÁBADO' : UP(WD[i]) + '-FEIRA'; };
export function dayMsg(e, l, H) {
  const s = e.slots, L = [], i = dObj(e.date).getDay();
  const extra = e.kind === 'dom' ? (isCeiaDay(e.date) ? ' - CULTO DE CEIA' : '') : e.kind === 'sex' ? '' : ' - ' + UP(escLabel(e));
  L.push(`*ESCALA ${i === 0 || i === 6 ? 'DO' : 'DA'} ${wdFull(e.date)} DIA ${dm(e.date)}${extra}*`, '');
  L.push(`*MINISTRO* : ${s.min ? UP(s.min) : '—'}`);
  backsOf(s).forEach(v => L.push('• ' + UP(v)));
  const ins = [['tec', 'TECLADO'], ['bai', 'BAIXO'], ['bat', 'BATERIA'], ['gui', 'GUITARRA'], ['vio', 'VIOLÃO']].filter(([k]) => s[k]);
  if (ins.length) { L.push('', '*INSTRUMENTISTAS*', ''); ins.forEach(([k, t]) => L.push(`*${t}* : ${UP(s[k])}`)); }
  if (s.mid || s.som) { L.push(''); if (s.mid) L.push(`*MÍDIA* : ${UP(s.mid)}`); if (s.som) L.push(`*SOM* : ${UP(s.som)}`); }
  if (l && l.reh && l.reh.time) L.push('', `*ENSAIO* : ${WD_UP[dObj(l.reh.date).getDay()]} ${dm(l.reh.date)} ÀS ${UP(hm(l.reh.time))}`);
  if (l && l.items.length) {
    L.push('', '*LOUVORES* :', '');
    groupItems(l.items).forEach((g, n) => {
      L.push(`${n + 1}) ` + g.map(it => itemText(it, H.songById)).join(' + '));
      g.forEach(it => { if (it.obs) L.push('_Obs.: ' + it.obs + '_'); });
    });
  }
  if (l && l.diz) L.push('', '*DÍZIMOS* : ' + itemText(l.diz, H.songById));
  if (l && l.aviso) L.push('', '⚠️ ' + UP(l.aviso));
  L.push('', l && l.items.length ? '*SUA ESCALA, LOUVORES E CIFRAS NO APP* :' : '*SUA ESCALA NO APP* :', H.appUrl + '#escala-' + e.id);
  return L.join('\n');
}
export function monthMsg(ym, get, appUrl) {
  const L = [`*ESCALA DO LOUVOR · DOMINGOS DE ${UP(monName(ym))}*`];
  daysOf(ym, 0).forEach(iso => {
    const e = get(iso, 'dom'), s = e ? e.slots : blankSlots(), n = k => s[k] ? UP(s[k]) : '—';
    L.push('', '━━━━━━━━━━━━', `*DOMINGO ${dm(iso)}*${isCeiaDay(iso) ? ' · CULTO DE CEIA' : ''}`, '');
    L.push(`*MINISTRO* : ${n('min')}`, `*BACKS* : ${backsOf(s).length ? UP(backsOf(s).join(', ')) : '—'}`, '');
    L.push(`Teclado: ${n('tec')}`, `Bateria: ${n('bat')}`, `Guitarra: ${n('gui')}`, `Violão: ${n('vio')}`, `Baixo: ${n('bai')}`);
    if (s.mid || s.som) L.push(`Mídia: ${n('mid')} · Som: ${n('som')}`);
  });
  L.push('', '━━━━━━━━━━━━', 'Sua escala e os louvores de cada culto no app:', appUrl);
  return L.join('\n');
}

/* ===== pedaços de tela ===== */
const eid = e => `data-eid="${esc(e.id)}" data-edate="${e.date}" data-ekind="${e.kind}" data-ename="${esc(e.name)}"`;
export function headHTML(e, nav) {
  const d = dObj(e.date);
  const kicker = e.kind === 'dom' ? 'Domingo' + (isCeiaDay(e.date) ? '<span class="e-tag">Ceia</span>' : '') : esc(escLabel(e)) + ' · ' + WD[d.getDay()];
  return `<div class="e-head"><div><small>${kicker}</small><div class="e-dt">${d.getDate()} ${UP(MO[d.getMonth()].slice(0, 3))}</div></div>${nav || ''}</div>`;
}
export const navHTML = (act, i, n, what) => `<div class="e-steps"><button class="e-stepbtn" data-act="${act}" data-d="-1" ${i <= 1 ? 'disabled' : ''} aria-label="${what} anterior">${ICON.back}</button><button class="e-stepbtn" data-act="${act}" data-d="1" ${i >= n ? 'disabled' : ''} aria-label="Próximo ${what.toLowerCase()}">${ICON.chev}</button></div>`;
function selectHTML(e, f, people) {
  const val = e.slots[f.k];
  const has = p => p.f.includes(f.fn);
  const main = people.filter(has), rest = people.filter(p => !has(p));
  const opt = p => `<option value="${esc(p.n)}"${p.n === val ? ' selected' : ''}>${esc(UP(p.n))}</option>`;
  const extra = val && !people.some(p => p.n === val) ? `<option value="${esc(val)}" selected>${esc(UP(val))}</option>` : '';
  const other = val ? ESC_KEYS.filter(k => k !== f.k && e.slots[k] === val).map(k => ELBL[k]) : [];
  const grp = f.fn === 'voc' ? 'Cantam' : f.fn === 'min' ? 'Ministram' : 'Tocam ' + EFN[f.fn].toLowerCase();
  return `<div class="e-frow${f.k === 'min' ? ' min' : ''}"><label for="ef-${esc(e.id)}-${f.k}">${f.label}</label>
    <div class="e-sw"><select class="e-sel ${val ? 'on' : 'empty'}" id="ef-${esc(e.id)}-${f.k}" data-ek="${f.k}">
      <option value="">Escolher…</option>${extra}
      ${main.length ? `<optgroup label="${grp}">${main.map(opt).join('')}</optgroup>` : ''}
      ${rest.length ? `<optgroup label="${main.length ? 'Outros membros' : 'Membros'}">${rest.map(opt).join('')}</optgroup>` : ''}
    </select></div>${other.length ? `<p class="e-fwarn">Também está em: ${other.join(', ')}</p>` : ''}</div>`;
}
export const fieldsHTML = (e, people) => '<div class="e-fields">' + EFIELDS.map(f => f.sec ? `<div class="e-fsec">${f.sec}</div>` : f.line ? '<div class="e-fline"></div>' : selectHTML(e, f, people)).join('') + '</div>';

/* caixa de digitar o louvor: as sugestões aparecem embaixo enquanto digita */
export const songLabel = so => so ? so.title + (so.version ? ' · ' + so.version : '') : '';
function songInput(e, val, key, label, ph, songs) {
  const so = val ? songs.find(s => s.id === val) : null, t = songLabel(so), id = 'es-' + e.id.replace(/[^\w-]/g, '') + '-' + key;
  return `<div class="ac e-ac"><input class="inp e-songin${so ? ' on' : ''}" id="${id}" data-esq="${key}" value="${esc(t)}" data-cur="${esc(t)}" placeholder="${ph}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" role="combobox" aria-expanded="false" aria-controls="${id}-l" aria-autocomplete="list" aria-label="${label}"><div class="ac-list" id="${id}-l" role="listbox" hidden></div></div>`;
}
export function cultoEditHTML(e, v, songs) {
  const n = v.items.length;
  let x = `<div class="e-csec"><h3>Louvores</h3><span>${v.items.filter(Boolean).length} escolhidos</span></div><div class="e-srows">`;
  v.items.forEach((id, i) => {
    x += `<div class="e-srow"><span class="n">${i + 1}</span>${songInput(e, id, i, 'Louvor ' + (i + 1), 'Digite o nome do louvor', songs)}
      <div class="e-mv"><button data-act="e-smv" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${ICON.up}</button><button data-act="e-smv" data-i="${i}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Descer">${ICON.down}</button></div>
      <button class="e-x" data-act="e-srm" data-i="${i}" aria-label="Remover louvor ${i + 1}">${ICON.x}</button></div>`;
  });
  x += `</div><button class="e-add" data-act="e-sadd">${ICON.plus}Adicionar louvor</button>
    <div class="e-diz"><div class="e-lbl">Dízimos</div>${songInput(e, v.diz, 'diz', 'Louvor dos dízimos', 'Digite o louvor dos dízimos', songs)}</div>`;
  const before = addDays(e.date, -1);
  x += `<div class="e-csec"><h3>Ensaio</h3></div><div class="e-row2">
    <div class="e-sw"><select class="e-sel on e-small" id="er-day-${esc(e.id)}" data-ereh="day" aria-label="Dia do ensaio"><option value="same"${v.reh.day !== 'before' ? ' selected' : ''}>No dia, ${dm(e.date)}</option><option value="before"${v.reh.day === 'before' ? ' selected' : ''}>${WD[dObj(before).getDay()]}, ${dm(before)}</option></select></div>
    <div class="e-sw"><select class="e-sel ${v.reh.time ? 'on' : 'empty'} e-small" id="er-time-${esc(e.id)}" data-ereh="time" aria-label="Horário do ensaio"><option value="">Sem ensaio</option>${TIMES.concat(v.reh.time && !TIMES.includes(v.reh.time) ? [v.reh.time] : []).map(t => `<option value="${t}"${t === v.reh.time ? ' selected' : ''}>${t.replace(':', 'h')}</option>`).join('')}</select></div></div>
    <div class="e-csec"><h3>Aviso</h3><span>opcional</span></div>
    <textarea class="inp e-aviso" id="ea-${esc(e.id)}" data-eaviso="1" maxlength="300" placeholder="Ex.: alteração no terceiro louvor">${esc(v.aviso)}</textarea>`;
  return x;
}
export function slotsHTML(e, me) {
  let x = '<div class="e-slots">';
  [['min', 'Ministro'], ['voc', 'Backs'], ['tec', 'Teclado'], ['bat', 'Bateria'], ['gui', 'Guitarra'], ['vio', 'Violão'], ['bai', 'Baixo'], ['mid', 'Mídia'], ['som', 'Som']].forEach(([k, lab]) => {
    if (k === 'tec') x += '<div class="e-ssep">Músicos</div>';
    if (k === 'mid') x += '<div class="e-ssep">Apoio</div>';
    const ns = k === 'voc' ? backsOf(e.slots) : (e.slots[k] ? [e.slots[k]] : []);
    x += `<div class="e-slot${k === 'min' ? ' mn' : ''}"><span class="r">${lab}</span><span class="v">${ns.length ? ns.map(n => `<span class="${me && sameName(n, me) ? 'me' : ''}">${esc(n)}</span>`).join(', ') : '<span class="e">—</span>'}</span></div>`;
  });
  return x + '</div>';
}
const listSeqLen = l => l.items.length + (l.diz ? 1 : 0);
export function youHTML(e, me) {
  const rs = me ? rolesOf(e, me) : [];
  return rs.length ? `<div class="e-you"><span>Você</span><b>${rs.join(' e ')}</b></div>` : '';
}
export function readCultoHTML(e, l, H) {
  let x = youHTML(e, H.me) + slotsHTML(e, H.me);
  if (!l || !listSeqLen(l)) return x + '<p class="e-note">Os louvores deste culto ainda não estão prontos.</p>';
  x += `<div class="e-csec"><h3>Louvores</h3></div><ol class="e-ro">${l.items.map((it, i) => {
    const so = H.songById(it.songId);
    return so ? `<li><button data-act="open-item" data-list="${esc(l.id)}" data-idx="${i}"><b>${i + 1}</b><span>${esc(so.title)}</span>${it.key ? `<span class="kmini">${esc(it.key)}</span>` : ''}</button></li>` : '';
  }).join('')}</ol>`;
  if (l.diz && H.songById(l.diz.songId)) x += `<div class="e-meta"><span><b>Dízimos:</b> ${esc(H.songById(l.diz.songId).title)}${l.diz.key ? ' · ' + esc(l.diz.key) : ''}</span></div>`;
  x += '<div class="e-meta">' + (l.reh && l.reh.time ? `<span><b>Ensaio:</b> ${WD[dObj(l.reh.date).getDay()].toLowerCase()} ${dm(l.reh.date)} às ${l.reh.time.replace(':', 'h')}</span>` : '') + (l.aviso ? `<span class="e-av">⚠️ ${esc(l.aviso)}</span>` : '') + '</div>';
  return x;
}
export function gridHTML(sundays, get, opts) {
  const rows = [{ k: 'min', label: 'Ministro' }, { k: 'voc', label: 'Backs' }, { sec: 'Músicos' }, { k: 'tec', label: 'Teclado' }, { k: 'bat', label: 'Bateria' }, { k: 'gui', label: 'Guitarra' }, { k: 'vio', label: 'Violão' }, { k: 'bai', label: 'Baixo' }, { sec: 'Apoio' }, { k: 'mid', label: 'Mídia' }, { k: 'som', label: 'Som' }];
  const act = opts.admin ? 'e-gostep' : 'e-goday';
  let x = '<div class="e-gridwrap"><table class="e-grid"><thead><tr><th class="rl" scope="col"><span class="sr">Função</span></th>';
  sundays.forEach((iso, i) => { x += `<th scope="col" class="${iso === opts.cur ? 'cur' : ''}"><button class="dh" data-act="${act}" data-i="${i + 1}"><small>DOM</small><b>${dm(iso)}</b>${isCeiaDay(iso) ? '<span class="e-tag">Ceia</span>' : ''}</button></th>`; });
  x += '</tr></thead><tbody>';
  rows.forEach(r => {
    if (r.sec) { x += `<tr class="sep"><th class="rl" colspan="${sundays.length + 1}">${r.sec}</th></tr>`; return; }
    x += `<tr class="${r.k === 'min' ? 'mn' : ''}"><th class="rl" scope="row">${r.label}</th>`;
    sundays.forEach((iso, i) => {
      const e = get(iso, 'dom'), s = e ? e.slots : blankSlots(), names = r.k === 'voc' ? backsOf(s) : (s[r.k] ? [s[r.k]] : []);
      const inner = names.length ? names.map(n => `<span class="${opts.me && sameName(n, opts.me) ? 'me' : ''}">${esc(n)}</span>`).join('') : '<span class="e" aria-hidden="true">·</span>';
      x += `<td class="${iso === opts.cur ? 'cur' : ''}"><button class="cell" data-act="${act}" data-i="${i + 1}" aria-label="${r.label} em ${dm(iso)}: ${names.length ? esc(names.join(', ')) : 'vazio'}">${inner}</button></td>`;
    });
    x += '</tr>';
  });
  return x + '</tbody></table></div>';
}
export function mineHTML(list, ym, me) {
  const rows = [];
  list.forEach(e => {
    const rs = rolesOf(e, me);
    if (rs.length) rows.push(`<li><button data-act="e-mine" data-id="${esc(e.id)}"><span class="d">${WS[dObj(e.date).getDay()]} ${dm(e.date)}</span><span class="t">${rs.join(' e ')}${e.kind !== 'dom' && e.kind !== 'sex' ? ' · ' + esc(escLabel(e)) : ''}</span>${ICON.chev}</button></li>`);
  });
  return `<section class="e-mine" aria-label="Sua escala"><div class="lbl">Sua escala em ${monName(ym)}</div>${rows.length ? `<ul>${rows.join('')}</ul>` : '<p class="none">Você não está escalado neste mês.</p>'}</section>`;
}
export function weekListHTML(list, admin, me) {
  return '<ul class="e-wk">' + list.map(e => {
    const d = dObj(e.date), filled = ESC_KEYS.filter(k => e.slots[k]).length, meIn = !admin && me && rolesOf(e, me).length;
    const status = e.pub ? 'Salva' : filled ? 'Rascunho' : 'Vazia';
    const sum = e.slots.min ? `Ministro ${UP(e.slots.min)}` : (filled ? `${filled} de ${ESC_KEYS.length} preenchidos` : 'Toque para montar');
    return `<li><button class="e-wcard${meIn ? ' me' : ''}" data-act="e-day" data-id="${esc(e.id)}"><span class="wday"><small>${WS[d.getDay()]}</small><b>${String(d.getDate()).padStart(2, '0')}</b></span>
      <span class="wt"><span class="k">${esc(escLabel(e))}</span><b>${WD[d.getDay()]}, ${dm(e.date)}</b><small>${admin ? status + ' · ' : ''}${meIn ? 'Você: ' + rolesOf(e, me).join(' e ') : esc(sum)}</small></span><span class="chev">${ICON.chev}</span></button></li>`;
  }).join('') + '</ul>';
}
export { eid };

/* dias para um culto novo: só os próximos (depois do último desse tipo); sexta só sextas; outros: sexta, sábado e domingo */
export function dateOptions(kind, all, todayIso, lists) {
  const lk = kind === 'sex' ? '' : kind;
  const same = all.filter(e => e.kind === kind).map(e => e.date)
    .concat((lists || []).filter(l => kind !== 'outro' && (l.kind || '') === lk && (kind !== 'sex' || dObj(l.date).getDay() === 5)).map(l => l.date)).sort();
  let start = todayIso;
  if (same.length && addDays(same[same.length - 1], 1) > start) start = addDays(same[same.length - 1], 1);
  const ok = kind === 'sex' ? [5] : [5, 6, 0], out = [];
  for (let iso = start; out.length < 10 && iso < addDays(start, 150); iso = addDays(iso, 1)) {
    if (ok.includes(dObj(iso).getDay()) && !all.some(e => e.id === iso + kind)) out.push(iso);
  }
  return out;
}
export const dateSelectHTML = (kind, all, todayIso, lists) => `<select class="e-sel on e-small" id="e-sdate" aria-label="Dia">${dateOptions(kind, all, todayIso, lists).map((iso, i) => `<option value="${iso}"${i === 0 ? ' selected' : ''}>${WD[dObj(iso).getDay()]}, ${dm(iso)}</option>`).join('')}<option value="__other">Outro dia…</option></select>`;

/* imagem da escala do mês, parecida com a planilha */
export async function monthImage(ym, get) {
  try { await document.fonts.ready; } catch (e) { /* segue */ }
  const sundays = daysOf(ym, 0), W = 1080, lab = 200, colW = (W - 60 - lab) / Math.max(1, sundays.length), x0 = 30;
  const rows = [{ k: 'min', label: 'Ministro', hgt: 58 }, { k: 'voc', label: 'Backs', hgt: 120 }, { sep: 'MÚSICOS' }, { k: 'tec', label: 'Teclado' }, { k: 'bat', label: 'Bateria' }, { k: 'gui', label: 'Guitarra' }, { k: 'vio', label: 'Violão' }, { k: 'bai', label: 'Baixo' }, { sep: 'APOIO' }, { k: 'mid', label: 'Mídia' }, { k: 'som', label: 'Som' }].map(r => Object.assign({ hgt: 56 }, r));
  const H = 250 + rows.reduce((a, x) => a + (x.sep ? 46 : x.hgt), 0) + 80;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const Y = '#FFD21A', K = '#0B0B09', F = '#F5F2E6', M = '#A6A08A', L = '#2F2C22', S2 = '#151510';
  const disp = (w, s) => `${w} ${s}px "Big Shoulders Display", "Arial Narrow", Impact, sans-serif`;
  const body = (w, s) => `${w} ${s}px "Instrument Sans", Arial, sans-serif`;
  g.fillStyle = K; g.fillRect(0, 0, W, H);
  g.fillStyle = Y; g.fillRect(0, 0, W, 112);
  g.fillStyle = K; g.font = disp(800, 62); g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText('ESCALA DO LOUVOR', x0, 50);
  g.font = body(700, 22); g.fillText(`DOMINGOS DE ${UP(monName(ym))} · ADORAÇÃO & ARTES MANANCIAL SELECTA`, x0, 92);
  let y = 132;
  g.textAlign = 'center';
  sundays.forEach((iso, i) => {
    const cx = x0 + lab + colW * i + colW / 2;
    g.fillStyle = S2; g.fillRect(x0 + lab + colW * i + 4, y, colW - 8, 92);
    g.fillStyle = M; g.font = body(700, 18); g.fillText('DOMINGO', cx, y + 22);
    g.fillStyle = F; g.font = disp(800, 44); g.fillText(dm(iso), cx, y + 50);
    if (isCeiaDay(iso)) { g.fillStyle = Y; g.font = body(700, 15); g.fillText('CEIA', cx, y + 81); }
  });
  y += 108;
  rows.forEach(row => {
    if (row.sep) { g.fillStyle = M; g.font = body(700, 18); g.textAlign = 'left'; g.fillText(row.sep, x0, y + 28); y += 46; return; }
    g.strokeStyle = L; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y + row.hgt); g.lineTo(W - x0, y + row.hgt); g.stroke();
    g.textAlign = 'left'; g.fillStyle = row.k === 'min' ? Y : M; g.font = body(700, 21); g.fillText(UP(row.label), x0, y + row.hgt / 2);
    g.textAlign = 'center';
    sundays.forEach((iso, i) => {
      const e = get(iso, 'dom'), s = e ? e.slots : blankSlots(), ns = row.k === 'voc' ? backsOf(s) : (s[row.k] ? [s[row.k]] : []), cx = x0 + lab + colW * i + colW / 2;
      g.fillStyle = row.k === 'min' ? Y : F; g.font = body(row.k === 'min' ? 700 : 600, 22);
      if (!ns.length) { g.fillStyle = L; g.fillText('—', cx, y + row.hgt / 2); return; }
      const lh = 30, top = y + row.hgt / 2 - (ns.length - 1) * lh / 2;
      ns.forEach((n, k) => g.fillText(UP(n), cx, top + k * lh, colW - 14));
    });
    y += row.hgt;
  });
  g.textAlign = 'left'; g.fillStyle = M; g.font = body(600, 19);
  g.fillText('Sua escala e os louvores de cada culto: manancial-selecta.github.io', x0, H - 40);
  return c;
}
