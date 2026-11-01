// Mixer view: channel strips with layers and sends-on-fader.
import { h, fader, knob, toggle, meter, bind } from '../controls.js';
import { faderDb, pan, ZERO_DB } from '../format.js';
import { strips, k, name, setName, nameKeys } from '../model.js';

export const LAYERS = [
  { id: 'l1', label: '1–16', strips: () => strips.in.slice(0, 16) },
  { id: 'l2', label: '17–32', strips: () => strips.in.slice(16) },
  { id: 'l3', label: 'ST IN', strips: () => strips.stin },
  { id: 'l4', label: 'AUX', strips: () => strips.aux },
  { id: 'l5', label: 'BUS', strips: () => strips.bus },
];

export const meters = new Map(); // "type:index" -> meter element

export function mixerView(ui) {
  meters.clear();
  const layer = LAYERS.find(l => l.id === ui.layer) || LAYERS[0];
  const sof = ui.sendsOnFader; // null or aux index 0..7

  const layerBar = h('div', { class: 'seg' }, LAYERS.map(l =>
    h('button', { class: l.id === layer.id ? 'on' : '', onclick: () => ui.go({ layer: l.id }) }, l.label)));
  const sofBar = h('div', { class: 'seg sof' },
    h('button', { class: sof == null ? 'on' : '', onclick: () => ui.go({ sendsOnFader: null }) }, 'MIX'),
    strips.aux.map((a, i) => h('button', { class: sof === i ? 'on aux' : 'aux', onclick: () => ui.go({ sendsOnFader: i }) }, name(a) === a.label ? `AUX${i + 1}` : name(a))));

  const list = layer.strips();
  const bank = h('div', { class: 'bank' }, list.map(s => strip(s, ui, sof)));
  const master = h('div', { class: 'bank master' }, strip(sof != null ? strips.aux[sof] : strips.st[0], ui, null, true));

  return h('section', { class: 'view mixer' + (sof != null ? ' sof-on' : '') },
    h('div', { class: 'toolbar' }, layerBar, sofBar),
    h('div', { class: 'console' }, bank, master));
}

function strip(s, ui, sof, isMaster = false) {
  const sends = sof != null && s.kind === 'in';
  const fk = sends ? k.send(s, sof) : k.fader(s);
  const ok = sends ? k.sendOn(s, sof) : k.on(s);
  const label = h('button', { class: 'sname', title: 'Duplo clique para renomear', onclick: () => ui.go({ view: 'channel', strip: s.id }) });
  const renderName = () => { label.textContent = name(s); };
  nameKeys(s).forEach(x => bind(label, x, renderName));
  label.addEventListener('dblclick', e => {
    e.stopPropagation();
    const t = prompt(`Nome de ${s.label} (até 4 caracteres)`, name(s));
    if (t != null) { setName(s, t); renderName(); }
  });

  const m = meter();
  meters.set(s.meter.join(':'), m);

  const kids = [
    h('div', { class: 'stag ' + s.kind }, s.label),
    label,
    knob(k.pan(s), { min: -63, max: 63, home: 0, label: s.kind === 'in' ? 'PAN' : 'BAL', format: pan, size: 'sm' }),
    h('div', { class: 'fwrap' }, m, fader(fk, { home: ZERO_DB, format: faderDb, className: sends ? 'send' : s.kind })),
    toggle(ok, 'ON', { className: 'onbtn' }),
    s.kind === 'in' ? toggle(k.cue(s), 'CUE', { className: 'cue' }) : null,
    h('button', { class: 'selbtn' + (ui.strip === s.id ? ' on' : ''), onclick: () => ui.go({ view: 'channel', strip: s.id }) }, 'SEL'),
  ];
  if (sends) kids.splice(3, 0, toggle(k.sendPre(s, sof), 'PRE', { className: 'pre' }));
  return h('div', { class: `strip ${s.kind}${isMaster ? ' is-master' : ''}${sends ? ' sends' : ''}` }, kids);
}

// Route meter frames to strips: levels[i] = [pre, post, gr]
export function onMeter(type, levels) {
  for (let i = 0; i < levels.length; i++) {
    const m = meters.get(type + ':' + i);
    if (m) m.setLevel(type === 0 ? levels[i][1] : levels[i][0]);
  }
}
