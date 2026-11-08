'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installDom, loadCard, renderCard, EXAMPLE_CONFIG, EXAMPLE_STATES, findLineTextOverlaps } = require('./helpers.cjs');

installDom();
const { Card, Editor } = loadCard();

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// count actual <line> elements carrying a given class (not CSS rules)
function countLines(html, cls) {
  return (html.match(new RegExp('<line class="hfc-line ' + cls, 'g')) || []).length;
}

test('setConfig rejects missing participants', () => {
  const el = new Card();
  assert.throws(() => el.setConfig({}), /participants/);
  assert.throws(() => el.setConfig({ participants: [] }), /participants/);
});

test('setConfig rejects unknown participant type', () => {
  const el = new Card();
  assert.throws(
    () => el.setConfig({ participants: [{ id: 'x', type: 'oven' }] }),
    /unknown participant type/
  );
});

test('setConfig rejects storage without layers', () => {
  const el = new Card();
  assert.throws(
    () => el.setConfig({ participants: [{ id: 't', type: 'storage' }] }),
    /requires "layers"/
  );
});

test('getStubConfig produces a valid config', () => {
  const el = new Card();
  const stub = el.getStubConfig();
  assert.doesNotThrow(() => el.setConfig(stub));
  assert.equal(stub.participants.length, 3);
});

test('UI configurator: config element is registered and builds config', () => {
  assert.ok(Editor, 'editor custom element registered');
  const ed = new Editor();
  ed.setConfig(EXAMPLE_CONFIG);
  assert.match(ed.innerHTML, /hfc-ed-parts/);
  assert.match(ed.innerHTML, /Heat pump/);
  const built = ed._buildConfig('My title', 10, 90, JSON.stringify(EXAMPLE_CONFIG.participants));
  assert.equal(built.type, 'heating-flow-card');
  assert.equal(built.title, 'My title');
  assert.equal(built.min_temp, 10);
  assert.equal(built.max_temp, 90);
  assert.equal(built.participants.length, 5);
  assert.throws(() => ed._buildConfig('', 5, 80, '{invalid json'), /JSON/);
});

test('render: svg with one box per participant plus title', () => {
  const el = renderCard(Card, EXAMPLE_CONFIG, EXAMPLE_STATES);
  assert.match(el.innerHTML, /<svg/);
  assert.equal(count(el.innerHTML, 'class="hfc-box"'), 5); // 4 participants + 1 tank
  assert.match(el.innerHTML, /Heating system/);
  assert.match(el.innerHTML, /Heat pump/);
  assert.match(el.innerHTML, /Tank/);
  assert.ok(el.getCardSize() >= 3);
});

test('render: active flows are animated, pump-off flows are off', () => {
  const states = { ...EXAMPLE_STATES, 'binary_sensor.hc1_pump': 'off' };
  const el = renderCard(Card, EXAMPLE_CONFIG, states);
  // 2 sources + 1 emitter + 1 tank overlay are active; hc1 is off
  assert.equal(countLines(el.innerHTML, 'hfc-flow'), 4);
  assert.equal(countLines(el.innerHTML, 'hfc-line-off'), 1);
});

test('render: direction classes follow pump_direction (source=from -> fwd, emitter=to -> fwd)', () => {
  const el = renderCard(Card, EXAMPLE_CONFIG, EXAMPLE_STATES);
  const flowLines = el.innerHTML.match(/<line class="hfc-line hfc-flow[^"]*"[^>]*>/g) || [];
  assert.equal(flowLines.length, 5);
  // every active flow in the example is "forward" along its drawn path
  assert.ok(flowLines.every((l) => l.includes('hfc-fwd')));
});

test('flow logic: no pump -> temperature difference decides (threshold 0.5 K)', () => {
  const cfg = {
    participants: [
      { id: 'g', type: 'generator', name: 'G', sensors: { flow_temp: 's.a', return_temp: 's.b' } },
      { id: 'e', type: 'emitter', name: 'E', sensors: { flow_temp: 's.c', return_temp: 's.d' } }
    ]
  };
  const active = renderCard(Card, cfg, { 's.a': 40, 's.b': 35, 's.c': 39, 's.d': 33 });
  assert.equal(countLines(active.innerHTML, 'hfc-flow'), 2);
  const idle = renderCard(Card, cfg, { 's.a': 40, 's.b': 39.8, 's.c': 39, 's.d': 38.9 });
  assert.equal(countLines(idle.innerHTML, 'hfc-flow'), 0);
  assert.equal(countLines(idle.innerHTML, 'hfc-line-off'), 2);
});

test('flow logic: storage charges when bus is warmer, discharges when cooler', () => {
  const cfg = {
    participants: [
      { id: 'g', type: 'generator', name: 'G', sensors: { flow_temp: 's.a', return_temp: 's.b' }, pump: 'p', pump_direction: 'from' },
      { id: 't', type: 'storage', name: 'T', layers: [{ name: 'Top', temp: 's.t1' }, { name: 'Bot', temp: 's.t2' }] }
    ]
  };
  // bus temp 50, tank avg 40 -> charging ('to', forward along downward path)
  const charging = renderCard(Card, cfg, { 's.a': 50, 's.b': 45, p: 'on', 's.t1': 45, 's.t2': 35 });
  assert.equal(countLines(charging.innerHTML, 'hfc-flow'), 2); // source + tank overlay
  assert.ok(charging.innerHTML.match(/hfc-flow hfc-fwd/));
  // bus temp 30, tank avg 50 -> discharging ('from' -> reverse)
  const discharging = renderCard(Card, cfg, { 's.a': 30, 's.b': 28, p: 'on', 's.t1': 55, 's.t2': 45 });
  assert.ok(discharging.innerHTML.match(/hfc-flow hfc-rev/));
});

test('render: no line intersects any text (lines stop at box edges)', () => {
  const el = renderCard(Card, EXAMPLE_CONFIG, EXAMPLE_STATES);
  assert.deepEqual(findLineTextOverlaps(el.innerHTML), []);
});

test('render: CSS is embedded inside the SVG (shadow-DOM safe)', () => {
  const el = renderCard(Card, EXAMPLE_CONFIG, EXAMPLE_STATES);
  const svgStart = el.innerHTML.indexOf('<svg');
  const svgEnd = el.innerHTML.indexOf('</svg>');
  const svg = el.innerHTML.slice(svgStart, svgEnd);
  assert.match(svg, /<style>/);
  assert.match(svg, /\.hfc-box/);
  assert.match(svg, /\.hfc-name/);
});

test('render: unchanged states do not re-render', () => {
  const el = renderCard(Card, EXAMPLE_CONFIG, EXAMPLE_STATES);
  const first = el.innerHTML;
  el.hass = { states: Object.fromEntries(Object.entries(EXAMPLE_STATES).map(([k, v]) => [k, { state: String(v) }])) };
  assert.equal(el.innerHTML, first);
});
