// Scene memory: titles, recall and store.
import { h } from '../controls.js';
import * as S from '../store.js';

export function scenesView(ui) {
  const current = () => S.get('4:10:0:0', 0);
  const list = h('div', { class: 'scenes' });
  const render = () => {
    list.replaceChildren(...Array.from({ length: 99 }, (_, i) => {
      const n = i + 1;
      const title = S.get('scene:' + n, '');
      return h('div', { class: 'scene' + (current() === n ? ' cur' : '') },
        h('span', { class: 'snum' }, String(n).padStart(2, '0')),
        h('span', { class: 'stitle' }, title || '—'),
        h('button', { class: 'tog', onclick: () => { S.send({ t: 'recall', n }); } }, 'RECALL'),
        h('button', { class: 'tog warn', onclick: () => {
          const t = prompt(`Gravar a mixagem atual na cena ${n}? Isso substitui o conteúdo dessa memória na mesa.\nTítulo:`, title || 'New Scene');
          if (t != null) S.send({ t: 'store', n, title: t });
        } }, 'STORE'));
    }));
  };
  render();
  const off = S.onMessage(m => {
    if (!list.isConnected) { off(); return; }
    if (m.t === 'scene') { S.set('scene:' + m.n, m.title); clearTimeout(list._t); list._t = setTimeout(render, 100); }
    if (m.t === 'p' && m.a.some(([k]) => k === '4:10:0:0')) render();
  });
  S.send({ t: 'scenes' });
  return h('section', { class: 'view scenesv' }, h('div', { class: 'toolbar' }, h('h2', {}, 'Cenas'), h('span', { class: 'hint' }, 'Cena atual: ', String(current()))), list);
}
