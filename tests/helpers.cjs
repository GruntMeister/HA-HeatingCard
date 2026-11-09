'use strict';

// Minimal DOM stub so the card (a browser custom element) can run under Node.
function installDom() {
  global.window = global;
  global.CustomEvent = class CustomEvent {
    constructor(type, opts) {
      this.type = type;
      this.detail = opts && opts.detail;
      this.bubbles = !!(opts && opts.bubbles);
    }
  };
  class StubElement {
    constructor() {
      this.id = '';
      this.textContent = '';
      this.innerHTML = '';
      this.value = '';
      this.dataset = {};
      this.style = { cssText: '' };
      this.listeners = {};
      this.children = [];
    }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    dispatchEvent(ev) { this.lastEvent = ev; return true; }
    querySelector() { return null; }
    appendChild() {}
  }
  const style = new StubElement();
  global.document = {
    getElementById(id) { return style.id === id ? style : null; },
    createElement(tag) { const el = new StubElement(); el.tagName = tag; return el; },
    head: { appendChild(el) { style.id = el.id; style.textContent = el.textContent; } }
  };
  global.HTMLElement = StubElement;
  global.customElements = {
    _defs: {},
    get(n) { return this._defs[n]; },
    define(n, c) { this._defs[n] = c; }
  };
}

function loadCard() {
  const path = require.resolve('../heating-flow-card.js');
  delete require.cache[path];
  require(path);
  return {
    Card: global.customElements.get('heating-flow-card'),
    Editor: global.customElements.get('heating-flow-card-editor')
  };
}

function makeHass(states) {
  const s = {};
  for (const [k, v] of Object.entries(states)) s[k] = { state: String(v) };
  return { states: s };
}

function renderCard(Card, config, states) {
  const el = new Card();
  el.setConfig(config);
  el.hass = makeHass(states);
  return el;
}

const EXAMPLE_CONFIG = {
  type: 'custom:heating-flow-card',
  title: 'Heating system',
  min_temp: 30,
  max_temp: 60,
  participants: [
    { id: 'heatpump', type: 'generator', name: 'Heat pump',
      sensors: { flow_temp: 'sensor.wp_supply', return_temp: 'sensor.wp_return', power: 'sensor.wp_power' },
      pump: 'binary_sensor.wp_compressor', pump_direction: 'from' },
    { id: 'solar', type: 'solar', name: 'Solar thermal',
      sensors: { flow_temp: 'sensor.solar_supply', return_temp: 'sensor.solar_return', power: 'sensor.solar_power' },
      pump: 'binary_sensor.solar_pump', pump_direction: 'from' },
    { id: 'tank', type: 'storage', name: 'Tank',
      layers: [
        { name: 'Top', temp: 'sensor.tank_top' },
        { name: 'Middle', temp: 'sensor.tank_middle' },
        { name: 'Bottom', temp: 'sensor.tank_bottom' }
      ] },
    { id: 'hc1', type: 'emitter', name: 'Heating circuit 1',
      sensors: { flow_temp: 'sensor.hc1_supply', return_temp: 'sensor.hc1_return', power: 'sensor.hc1_power' },
      pump: 'binary_sensor.hc1_pump', pump_direction: 'to' },
    { id: 'dhw', type: 'emitter', name: 'DHW',
      sensors: { flow_temp: 'sensor.dhw_supply', return_temp: 'sensor.dhw_return' } }
  ]
};

const EXAMPLE_STATES = {
  'sensor.wp_supply': 42.5, 'sensor.wp_return': 36.1, 'sensor.wp_power': 3.2,
  'binary_sensor.wp_compressor': 'on',
  'sensor.solar_supply': 55.0, 'sensor.solar_return': 48.2, 'sensor.solar_power': 1.8,
  'binary_sensor.solar_pump': 'on',
  'sensor.tank_top': 58.0, 'sensor.tank_middle': 45.0, 'sensor.tank_bottom': 38.0,
  'sensor.hc1_supply': 40.2, 'sensor.hc1_return': 33.5, 'sensor.hc1_power': 2.9,
  'binary_sensor.hc1_pump': 'on',
  'sensor.dhw_supply': 39.0, 'sensor.dhw_return': 35.0
};

// Inline the card's CSS classes as style attributes so the SVG can be
// rasterized outside a browser (svglib ignores CSS classes).
function inlineStyles(svg) {
  const styles = {
    'hfc-box': 'fill:#1e1e1e;stroke:#3a3a3a;stroke-width:1',
    'hfc-title': 'fill:#212121;font-size:14px;font-weight:600;font-family:sans-serif',
    'hfc-name': 'fill:#ffffff;font-size:12px;font-weight:600;font-family:sans-serif',
    'hfc-sub': 'fill:#9e9e9e;font-size:11px;font-family:sans-serif',
    'hfc-temp': 'fill:#ffffff;font-weight:700',
    'hfc-bus': 'stroke:#3a3a3a;stroke-width:3;stroke-linecap:round',
    'hfc-line': 'fill:none;stroke-linecap:round',
    'hfc-line-off': 'stroke:#3a3a3a;stroke-width:2;opacity:0.5',
    'hfc-flow': 'stroke-dasharray:7 7'
  };
  return svg.replace(/class="([^"]+)"/g, (m, cls) =>
    'style="' + cls.trim().split(/\s+/).map((c) => styles[c] || '').filter(Boolean).join(';') + '"');
}

// Detect intersections between <line> segments and approximate <text> boxes.
function findLineTextOverlaps(svg) {
  const lines = [...svg.matchAll(/<line[^>]*?x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)]
    .map((m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }));
  const texts = [...svg.matchAll(/<text[^>]*?x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => ({ x: +m[1], y: +m[2], t: m[3], w: m[3].length * (m[0].includes('hfc-name') ? 6.8 : 6.0) }));
  const hits = [];
  for (const L of lines) {
    for (const T of texts) {
      const bx0 = T.x, bx1 = T.x + T.w, by0 = T.y - 11, by1 = T.y + 3;
      for (let i = 0; i <= 50; i++) {
        const px = L.x1 + ((L.x2 - L.x1) * i) / 50;
        const py = L.y1 + ((L.y2 - L.y1) * i) / 50;
        if (px >= bx0 && px <= bx1 && py >= by0 && py <= by1) { hits.push({ line: [L.x1, L.y1, L.x2, L.y2], text: T.t }); break; }
      }
    }
  }
  return hits;
}

module.exports = { installDom, loadCard, makeHass, renderCard, EXAMPLE_CONFIG, EXAMPLE_STATES, inlineStyles, findLineTextOverlaps };
