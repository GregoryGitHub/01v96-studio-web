import { loadData } from './format.js';
import * as S from './store.js';
import { h, unbindTree } from './controls.js';
import { mixerView, onMeter } from './views/mixer.js';
import { channelView } from './views/channel.js';
import { effectsView } from './views/effects.js';
import { scenesView } from './views/scenes.js';

const VIEWS = { mixer: mixerView, channel: channelView, effects: effectsView, scenes: scenesView };
const NAV = [['mixer', 'Mixer', '▥'], ['channel', 'Canal', '◎'], ['effects', 'Efeitos', '✺'], ['scenes', 'Cenas', '☰']];

const saved = (() => { try { return JSON.parse(localStorage.getItem('ui') || '{}'); } catch { return {}; } })();
const ui = { view: 'mixer', layer: 'l1', sendsOnFader: null, strip: 'in0', fx: 0, meters: true, followSel: false, ...saved };
// App shortcuts (manifest) open a specific view: /?view=effects
const qsView = new URLSearchParams(location.search).get('view');
if (qsView && VIEWS[qsView]) ui.view = qsView;
ui.go = patch => {
  Object.assign(ui, patch);
  try { localStorage.setItem('ui', JSON.stringify({ ...ui, go: undefined })); } catch {}
  render();
};

const main = h('main');
const statusEl = h('div', { class: 'status' });
const nav = h('nav');
const meterBtn = h('button', { class: 'ghost', title: 'Medidores', onclick: () => { ui.meters = !ui.meters; S.send({ t: 'meters', on: ui.meters }); ui.go({}); } });

function render() {
  unbindTree(main);
  main.replaceChildren(VIEWS[ui.view](ui));
  nav.replaceChildren(...NAV.map(([id, label, icon]) =>
    h('button', { class: ui.view === id ? 'on' : '', onclick: () => ui.go({ view: id }) }, h('i', {}, icon), h('span', {}, label))));
  meterBtn.textContent = ui.meters ? 'Medidores ●' : 'Medidores ○';
}

// Offline overlay (server unreachable) and banner (server up, console missing).
const countdown = h('span');
const offline = h('div', { class: 'offline', role: 'alertdialog', 'aria-live': 'assertive' },
  h('div', { class: 'offbox' },
    h('div', { class: 'officon' }, '⏻'),
    h('h2', {}, 'Servidor offline'),
    h('p', {}, 'Não foi possível falar com o servidor do 01V96 Web Mixer neste computador. Nenhuma alteração está sendo enviada à mesa.'),
    h('p', { class: 'hint' }, 'Abra pelo atalho “01V96 Mixer” na área de trabalho, que inicia o servidor, ou rode “node server.js” na pasta app.'),
    h('div', { class: 'row center' }, h('button', { class: 'tog onbtn on', onclick: () => S.reconnectNow() }, 'Tentar agora'), countdown)));
const banner = h('div', { class: 'banner' }, 'Mesa não encontrada. Confira se a 01V96 está ligada e com o cabo USB conectado. Tentando de novo a cada 3 s…');

function renderStatus() {
  const st = S.status;
  let text, cls;
  if (!st.server) { text = st.connecting ? 'Conectando ao servidor…' : 'Servidor offline'; cls = 'bad'; }
  else if (!st.connected) { text = 'Mesa não encontrada (USB)'; cls = 'bad'; }
  else if (st.sync.running) { text = `Sincronizando ${Math.round((st.sync.done / st.sync.total) * 100)}%`; cls = 'warn'; }
  else { text = st.port; cls = 'ok'; }
  statusEl.className = 'status ' + cls;
  statusEl.replaceChildren(h('i'), text);
  // Give a fresh page a moment to connect before covering it.
  const down = !st.server && (performance.now() > 2500 || !st.connecting);
  document.body.classList.toggle('is-offline', down);
  document.body.classList.toggle('no-console', st.server && !st.connected);
  document.title = down ? '01V96 — offline' : '01V96 Web Mixer';
}
setInterval(() => {
  if (S.status.server) return;
  const s = Math.max(0, Math.ceil((S.status.retryAt - Date.now()) / 1000));
  countdown.textContent = S.status.connecting ? 'conectando…' : `nova tentativa em ${s} s`;
  renderStatus();
}, 500);

S.onMessage(m => {
  if (m.t === 'm') onMeter(m.type, m.levels);
  else if (m.t === 'status' || m.t === 'hello' || m.t === 'link') {
    renderStatus();
    if (m.t === 'hello') { render(); if (ui.meters) S.send({ t: 'meters', on: true }); }
  }
});

// The server keeps meters running for 10 s after each request.
setInterval(() => { if (ui.meters && document.visibilityState === 'visible') S.send({ t: 'meters', on: true }); }, 4000);

document.body.append(
  h('header', {}, h('div', { class: 'brand' }, h('b', {}, '01V96'), ' Web Mixer'), statusEl, h('div', { class: 'grow' }),
    meterBtn, h('button', { class: 'ghost', title: 'Ler tudo da mesa novamente', onclick: () => S.send({ t: 'resync' }) }, 'Sincronizar')),
  banner, main, nav, offline);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

try {
  await loadData();
  render();
} catch {
  // Neither the server nor the offline cache had the data: just show the overlay.
}
renderStatus();
S.connect();
