// Scene memory: big touch cards. Tap = recall (with confirmation), long menu
// for store/rename. Empty memories are shown dimmed and can be stored into.
import { h, sheet } from '../controls.js';
import * as S from '../store.js';

export const SCENE_KEY = '4:10:0:0';
export const sceneTitle = n => S.get('scene:' + n, undefined);
export const sceneLabel = n => {
  const t = sceneTitle(n);
  return t === null ? 'vazia' : t || (t === undefined ? '…' : 'sem nome');
};

export async function recallScene(n) {
  const ok = await sheet({
    title: `Carregar cena ${String(n).padStart(2, '0')}?`,
    text: `“${sceneLabel(n)}” vai substituir a mixagem atual da mesa.`,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Carregar', value: true, className: 'primary' }],
  });
  if (ok) S.send({ t: 'recall', n });
}

export async function storeScene(n, defaultTitle) {
  const r = await sheet({
    title: `Salvar na cena ${String(n).padStart(2, '0')}`,
    text: sceneTitle(n) ? `Isso substitui “${sceneTitle(n)}” pela mixagem atual.` : 'Grava a mixagem atual nesta memória.',
    input: { value: defaultTitle ?? (sceneTitle(n) || ''), max: 16, placeholder: 'Nome da cena' },
    actions: [{ label: 'Cancelar', value: false }, { label: 'Salvar', value: true, className: 'warn' }],
  });
  if (r && r.value) S.send({ t: 'store', n, title: r.text.trim() || 'Cena ' + n });
}

async function renameScene(n) {
  const r = await sheet({
    title: `Renomear cena ${String(n).padStart(2, '0')}`,
    input: { value: sceneTitle(n) || '', max: 16, placeholder: 'Nome da cena' },
    actions: [{ label: 'Cancelar', value: false }, { label: 'Renomear', value: true, className: 'primary' }],
  });
  if (r && r.value) S.send({ t: 'sceneTitle', n, title: r.text.trim() });
}

async function sceneMenu(n) {
  const empty = sceneTitle(n) === null;
  const choice = await sheet({
    title: `Cena ${String(n).padStart(2, '0')} — ${sceneLabel(n)}`,
    actions: [
      { label: 'Fechar', value: null },
      ...(empty ? [] : [{ label: 'Renomear', value: 'rename' }]),
      { label: 'Salvar mixagem atual aqui', value: 'store', className: 'warn' },
      ...(empty ? [] : [{ label: 'Carregar', value: 'recall', className: 'primary' }]),
    ],
  });
  if (choice === 'rename') renameScene(n);
  if (choice === 'store') storeScene(n);
  if (choice === 'recall') S.send({ t: 'recall', n });
}

export function scenesView(ui) {
  const grid = h('div', { class: 'scenes' });
  const showEmpty = ui.showEmptyScenes ?? false;
  const render = () => {
    const cur = S.get(SCENE_KEY, 0);
    const cards = [];
    for (let n = 1; n <= 99; n++) {
      const t = sceneTitle(n);
      if (t === null && !showEmpty) continue;
      cards.push(h('div', { class: 'scene' + (cur === n ? ' cur' : '') + (t === null ? ' empty' : '') },
        h('button', { class: 'scene-main', onclick: () => (t === null ? storeScene(n) : recallScene(n)) },
          h('span', { class: 'snum' }, String(n).padStart(2, '0')),
          h('span', { class: 'stitle' }, sceneLabel(n)),
          cur === n ? h('span', { class: 'scur' }, 'ATUAL') : null),
        h('button', { class: 'scene-more', 'aria-label': 'Mais opções', onclick: () => sceneMenu(n) }, '⋯')));
    }
    const firstFree = Array.from({ length: 99 }, (_, i) => i + 1).find(n => sceneTitle(n) === null);
    grid.replaceChildren(...cards, h('button', { class: 'scene newscene', onclick: () => storeScene(firstFree ?? 99, '') }, '＋ Salvar mixagem atual como nova cena'));
  };
  render();
  const off = S.onMessage(m => {
    if (!grid.isConnected) { off(); return; }
    if (m.t === 'scene' || (m.t === 'p' && m.a.some(([k]) => k === SCENE_KEY))) { clearTimeout(grid._t); grid._t = setTimeout(render, 80); }
  });
  S.send({ t: 'scenes' });
  return h('section', { class: 'view scenesv' },
    h('div', { class: 'toolbar' }, h('h2', {}, 'Cenas'), h('div', { class: 'grow' }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showEmpty, onchange: e => ui.go({ showEmptyScenes: e.target.checked }) }), 'Mostrar vazias')),
    grid,
    h('div', { class: 'hint pad' }, 'Toque numa cena para carregar. Use ⋯ para renomear ou gravar a mixagem atual por cima.'));
}
