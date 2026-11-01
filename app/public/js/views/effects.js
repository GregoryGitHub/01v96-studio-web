// Internal effects 1-4: type, mix, bypass and every parameter of the type.
import { h, knob, toggle, bind, unbindTree } from '../controls.js';
import { FX, fxLayout, fxDisplay } from '../format.js';
import * as S from '../store.js';
import { fxKey, FX_PARAM0, FX_MIX, FX_TYPE, FX_BYPASS } from '../model.js';

export function effectsView(ui) {
  const unit = ui.fx ?? 0;
  const tabs = h('div', { class: 'seg' }, [0, 1, 2, 3].map(u =>
    h('button', { class: u === unit ? 'on' : '', onclick: () => ui.go({ fx: u }) }, `FX ${u + 1}`, h('small', {}, ' ' + typeName(u)))));

  const typeSel = h('select', { class: 'fxtype' }, FX.map(t => h('option', { value: t.type }, `${String(t.type + 1).padStart(2, '0')}  ${t.name}`)));
  const params = h('div', { class: 'fxparams' });
  const title = h('div', { class: 'fxtitle' });

  const renderParams = type => {
    unbindTree(params);
    params.replaceChildren(...fxLayout(type).map(p => paramControl(unit, p)));
    if (!params.childElementCount) params.append(h('div', { class: 'hint' }, 'Sem parâmetros editáveis para este tipo.'));
  };
  bind(typeSel, fxKey(unit, FX_TYPE), v => { typeSel.value = v; renderParams(v); });
  typeSel.addEventListener('change', () => {
    S.set(fxKey(unit, FX_TYPE), +typeSel.value);
    // The console loads the type's defaults; fetch them back.
    setTimeout(() => S.send({ t: 'get', a: Array.from({ length: 53 }, (_, p) => [1, fxKey(unit, 0).split(':').map(Number)[1], p, 0x7f]) }), 250);
  });
  const titleKeys = Array.from({ length: 16 }, (_, i) => fxKey(unit, i));
  const renderTitle = () => { title.textContent = titleKeys.map(x => String.fromCharCode(S.get(x, 32) || 32)).join('').trim(); };
  titleKeys.forEach(x => bind(title, x, renderTitle));

  return h('section', { class: 'view effects' },
    h('div', { class: 'toolbar' }, tabs),
    h('div', { class: 'card wide fxhead' },
      h('div', { class: 'row' },
        h('label', { class: 'sel' }, h('span', {}, 'TIPO'), typeSel),
        title,
        h('div', { class: 'grow' }),
        knob(fxKey(unit, FX_MIX), { min: 0, max: 100, home: 100, label: 'MIX', format: v => v + '%' }),
        toggle(fxKey(unit, FX_BYPASS), 'BYPASS', { className: 'warn' }))),
    h('div', { class: 'card wide' }, h('h3', {}, 'PARÂMETROS'), params),
    h('div', { class: 'hint' }, 'Os retornos de efeito chegam nas entradas ST IN ou nos canais configurados no patch da mesa. Os envios saem pelos AUX atribuídos ao efeito.'));
}

function typeName(u) {
  const t = FX[S.get(fxKey(u, FX_TYPE), -1)];
  return t ? t.name : '';
}

function paramControl(unit, p) {
  const k1 = fxKey(unit, FX_PARAM0 + p.slot);
  if (p.wide) {
    // 28-bit value split over two 14-bit slots (high, low).
    const k2 = fxKey(unit, FX_PARAM0 + p.slot + 1);
    const vkey = `fxwide:${unit}:${p.slot}`;
    const sync = () => S.set(vkey, S.get(k1) * 16384 + S.get(k2));
    const el = knob(vkey, { min: 0, max: p.max, home: 0, label: p.name, format: v => fxDisplay(p, v) });
    bind(el, k1, sync); bind(el, k2, sync);
    bind(el, vkey, v => { if (S.get(k1) * 16384 + S.get(k2) !== v) { S.set(k1, Math.floor(v / 16384)); S.set(k2, v % 16384); } });
    return el;
  }
  if (p.options && p.options.length <= 6 && p.options.length > 1) {
    const seg = h('div', { class: 'optseg' }, h('div', { class: 'klabel' }, p.name),
      h('div', { class: 'seg mini' }, p.options.map((o, i) => {
        const b = h('button', { onclick: () => S.set(k1, i) }, o);
        bind(b, k1, v => b.classList.toggle('on', v === i));
        return b;
      })));
    return seg;
  }
  return knob(k1, { min: 0, max: p.max, home: 0, label: p.name, format: v => fxDisplay(p, v) });
}
