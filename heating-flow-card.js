/*
 * Heating Flow Card for Home Assistant
 * Visualizes heating systems (generators, solar thermal, emitters, layered
 * storage) with animated flows derived from temperature differences and
 * optional pump enable signals. Inspired by power-flow-card-plus.
 */
(function () {
  'use strict';

  const CARD_TYPE = 'heating-flow-card';

  const TYPE_INFO = {
    generator: { dir: 'from', color: '#ff7043', label: 'Generator' },
    solar: { dir: 'from', color: '#ffd54f', label: 'Solar' },
    emitter: { dir: 'to', color: '#4dd0e1', label: 'Emitter' },
    storage: { dir: 'to', color: '#a1887f', label: 'Storage' }
  };

  const CSS = [
    '.hfc-svg { width: 100%; height: auto; display: block; font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }',
    '.hfc-box { fill: #1e1e1e; stroke: #424242; stroke-width: 1; }',
    '.hfc-title { fill: #ffffff; font-size: 14px; font-weight: 600; }',
    '.hfc-name { fill: #ffffff; font-size: 12px; font-weight: 600; }',
    '.hfc-sub { fill: #9e9e9e; font-size: 11px; }',
    '.hfc-temp { fill: #ffffff; font-size: 11px; font-weight: 700; }',
    '.hfc-bus { stroke: #757575; stroke-width: 3; stroke-linecap: round; }',
    '.hfc-line { fill: none; stroke-linecap: round; }',
    '.hfc-line-off { stroke: #757575; stroke-width: 2; opacity: 0.5; }',
    '.hfc-flow { stroke-dasharray: 7 7; animation: hfc-dash 0.9s linear infinite; }',
    '.hfc-fwd { animation-direction: normal; }',
    '.hfc-rev { animation-direction: reverse; }',
    '@keyframes hfc-dash { to { stroke-dashoffset: -14; } }',
    '@media (prefers-reduced-motion: reduce) { .hfc-flow { animation: none; } }'
  ].join('\n');

  function num(hass, id) {
    if (!id || !hass || !hass.states || !hass.states[id]) return null;
    const v = parseFloat(hass.states[id].state);
    return Number.isFinite(v) ? v : null;
  }

  function isOn(hass, id) {
    const s = hass.states && hass.states[id];
    if (!s) return null;
    return ['on', 'true', 'open', 'home', 'heat', 'active'].indexOf(s.state) !== -1;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function tempColor(t, min, max) {
    if (t == null) return '#607d8b';
    const x = Math.max(0, Math.min(1, (t - min) / ((max - min) || 1)));
    const hue = 210 - 210 * x;
    return 'hsl(' + hue.toFixed(0) + ', 80%, 50%)';
  }

  function readParts(cfg, hass) {
    return cfg.participants.map((p) => {
      const s = p.sensors || {};
      const layers = Array.isArray(p.layers)
        ? p.layers.map((l) => ({ name: l.name || '', temp: num(hass, l.temp) }))
        : null;
      return {
        p,
        tf: num(hass, s.flow_temp),
        tr: num(hass, s.return_temp),
        power: num(hass, s.power),
        pump: p.pump ? isOn(hass, p.pump) : null,
        layers
      };
    });
  }

  function busTempOf(parts) {
    const src = parts
      .filter((x) => x.p.type === 'generator' || x.p.type === 'solar')
      .map((x) => x.tf)
      .filter((v) => v != null);
    const pool = src.length ? src : parts.map((x) => x.tf).filter((v) => v != null);
    return pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : null;
  }

  function layerAvg(x) {
    const temps = (x.layers || []).map((l) => l.temp).filter((v) => v != null);
    return temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  }

  function flowFor(x, busTemp) {
    const p = x.p;
    const th = p.threshold != null ? p.threshold : 0.5;
    const dT = x.tf != null && x.tr != null ? x.tf - x.tr : null;
    let active = false, dir = null, mag = 0;

    if (x.pump != null) {
      active = x.pump === true;
      dir = active ? (p.pump_direction || p.direction || TYPE_INFO[p.type].dir) : null;
    } else if (p.type === 'storage') {
      const avg = layerAvg(x);
      if (avg != null && busTemp != null && Math.abs(busTemp - avg) > th) {
        active = true;
        dir = busTemp > avg ? 'to' : 'from';
      }
    } else if (dT != null && Math.abs(dT) > th) {
      active = true;
      dir = p.direction || (p.type === 'emitter' ? 'to' : 'from');
    }

    if (active && x.power != null) mag = Math.abs(x.power);
    else if (dT != null) mag = Math.abs(dT);
    else if (p.type === 'storage' && busTemp != null) {
      const a = layerAvg(x);
      if (a != null) mag = Math.abs(busTemp - a);
    }
    return { active, dir, mag, dT };
  }

  function iconSVG(type, cx, cy, color) {
    let i, a, rays = '';
    if (type === 'generator') {
      return '<path d="M ' + cx + ' ' + (cy - 9) +
        ' C ' + (cx + 6) + ' ' + (cy - 2) + ' ' + (cx + 5) + ' ' + (cy + 5) + ' ' + cx + ' ' + (cy + 8) +
        ' C ' + (cx - 5) + ' ' + (cy + 5) + ' ' + (cx - 6) + ' ' + (cy - 2) + ' ' + cx + ' ' + (cy - 9) +
        ' Z" fill="' + color + '"/>';
    }
    if (type === 'solar') {
      for (i = 0; i < 8; i++) {
        a = (Math.PI / 4) * i;
        rays += '<line x1="' + (cx + 7 * Math.cos(a)).toFixed(1) + '" y1="' + (cy + 7 * Math.sin(a)).toFixed(1) +
          '" x2="' + (cx + 10 * Math.cos(a)).toFixed(1) + '" y2="' + (cy + 10 * Math.sin(a)).toFixed(1) +
          '" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round"/>';
      }
      return '<circle cx="' + cx + '" cy="' + cy + '" r="4.5" fill="' + color + '"/>' + rays;
    }
    if (type === 'emitter') {
      return '<rect x="' + (cx - 9) + '" y="' + (cy - 7) + '" width="18" height="14" rx="3" fill="none" stroke="' + color + '" stroke-width="1.8"/>' +
        [-4, 0, 4].map((dx) =>
          '<line x1="' + (cx + dx) + '" y1="' + (cy - 4) + '" x2="' + (cx + dx) + '" y2="' + (cy + 4) + '" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round"/>'
        ).join('');
    }
    return '<rect x="' + (cx - 7) + '" y="' + (cy - 9) + '" width="14" height="18" rx="3" fill="none" stroke="' + color + '" stroke-width="1.8"/>' +
      '<line x1="' + (cx - 7) + '" y1="' + (cy - 3) + '" x2="' + (cx + 7) + '" y2="' + (cy - 3) + '" stroke="' + color + '" stroke-width="1.4"/>' +
      '<line x1="' + (cx - 7) + '" y1="' + (cy + 3) + '" x2="' + (cx + 7) + '" y2="' + (cy + 3) + '" stroke="' + color + '" stroke-width="1.4"/>';
  }

  function participantBox(x, bx, by, W, BOX_H) {
    const p = x.p, f = x.flow;
    const color = TYPE_INFO[p.type].color;
    let lines = '';
    if (x.tf != null || x.tr != null) {
      lines += '<text class="hfc-temp" x="' + (bx + 46) + '" y="' + (by + 42) + '">' +
        (x.tf != null ? 'VL ' + x.tf.toFixed(1) + '°' : 'VL –') + '  ' +
        (x.tr != null ? 'RL ' + x.tr.toFixed(1) + '°' : 'RL –') + '</text>';
      lines += '<text class="hfc-sub" x="' + (bx + 46) + '" y="' + (by + 58) + '">' +
        (x.power != null ? x.power.toFixed(1) + ' kW' : (f.dT != null ? 'ΔT ' + f.dT.toFixed(1) + ' K' : '')) + '</text>';
    } else if (x.power != null) {
      lines += '<text class="hfc-sub" x="' + (bx + 46) + '" y="' + (by + 46) + '">' + x.power.toFixed(1) + ' kW</text>';
    }
    return '<g>' +
      '<rect class="hfc-box" x="' + bx + '" y="' + by + '" width="' + W + '" height="' + BOX_H + '" rx="10"/>' +
      iconSVG(p.type, bx + 24, by + BOX_H / 2, color) +
      '<text class="hfc-name" x="' + (bx + 46) + '" y="' + (by + 24) + '">' + esc(String(p.name || p.id || p.type).slice(0, 20)) + '</text>' +
      lines + '</g>';
  }

  function storageBox(x, bx, by, W, BOX_H, minT, maxT) {
    const p = x.p;
    const layers = x.layers || [];
    const tankX = bx + 14, tankY = by + 10, tankW = 40, tankH = BOX_H - 20;
    let segs = '', i, ly;
    if (layers.length) {
      const lh = tankH / layers.length;
      for (i = 0; i < layers.length; i++) {
        ly = tankY + i * lh;
        segs += '<rect x="' + tankX + '" y="' + ly.toFixed(1) + '" width="' + tankW + '" height="' + Math.max(1, lh - 1).toFixed(1) + '" fill="' + tempColor(layers[i].temp, minT, maxT) + '"/>';
      }
    }
    segs += '<rect x="' + tankX + '" y="' + tankY + '" width="' + tankW + '" height="' + tankH + '" rx="5" fill="none" stroke="#ffffff" stroke-width="1.2" opacity="0.7"/>';
    let labels = '<text class="hfc-name" x="' + (bx + 64) + '" y="' + (by + 22) + '">' + esc(String(p.name || 'Storage').slice(0, 16)) + '</text>';
    const lh2 = Math.min(14, (BOX_H - 30) / Math.max(1, layers.length));
    for (i = 0; i < layers.length; i++) {
      ly = by + 36 + i * lh2;
      labels += '<text class="hfc-sub" x="' + (bx + 64) + '" y="' + ly.toFixed(1) + '">' +
        esc(String(layers[i].name || 'Layer ' + (i + 1)).slice(0, 8)) + ': ' +
        (layers[i].temp != null ? layers[i].temp.toFixed(1) + '°' : '–') + '</text>';
    }
    return '<g><rect class="hfc-box" x="' + bx + '" y="' + by + '" width="' + W + '" height="' + BOX_H + '" rx="10"/>' + segs + labels + '</g>';
  }

  class HeatingFlowCard extends HTMLElement {
    constructor() {
      super();
      this._config = null;
      this._hass = null;
      this._lastSig = '';
      this._height = 200;
    }

    setConfig(config) {
      if (!config || !Array.isArray(config.participants) || config.participants.length === 0) {
        throw new Error('heating-flow-card: "participants" (list) is missing or empty.');
      }
      config.participants.forEach((p) => {
        if (!p.type || !TYPE_INFO[p.type]) {
          throw new Error('heating-flow-card: unknown participant type "' + p.type + '" (allowed: generator, solar, emitter, storage).');
        }
        if (p.type === 'storage' && (!Array.isArray(p.layers) || p.layers.length === 0)) {
          throw new Error('heating-flow-card: storage "' + (p.name || p.id || '?') + '" requires "layers".');
        }
      });
      this._config = config;
      this._lastSig = '';
    }

    set hass(hass) {
      this._hass = hass;
      this._render();
    }

    static getConfigElement() {
      return document.createElement('heating-flow-card-editor');
    }

    getCardSize() {
      return Math.max(3, Math.ceil(this._height / 50));
    }

    getStubConfig() {
      return {
        title: 'Heating',
        participants: [
          { id: 'generator', type: 'generator', name: 'Heat generator', sensors: { flow_temp: 'sensor.supply', return_temp: 'sensor.return' } },
          { id: 'tank', type: 'storage', name: 'Tank', layers: [{ name: 'Top', temp: 'sensor.tank_top' }, { name: 'Bottom', temp: 'sensor.tank_bottom' }] },
          { id: 'heating', type: 'emitter', name: 'Heating circuit', sensors: { flow_temp: 'sensor.hc_supply', return_temp: 'sensor.hc_return' } }
        ]
      };
    }

    _render() {
      const hass = this._hass, cfg = this._config;
      if (!hass || !cfg) return;

      const parts = readParts(cfg, hass);
      const busTemp = busTempOf(parts);
      parts.forEach((x) => { x.flow = flowFor(x, busTemp); });

      const sig = parts.map((x) =>
        [x.tf, x.tr, x.power, x.pump].concat((x.layers || []).map((l) => l.temp)).join(',')
      ).join('|');
      if (sig === this._lastSig) return;
      this._lastSig = sig;

      const minT = cfg.min_temp != null ? cfg.min_temp : 5;
      const maxT = cfg.max_temp != null ? cfg.max_temp : 80;
      const W = 420, MARGIN = 12, BOX_W = 170, BOX_H = 68, ROW_H = 84, BUS_X = W / 2;
      const titleH = cfg.title ? 26 : 0;

      const sources = parts.filter((x) => x.p.type === 'generator' || x.p.type === 'solar');
      const emitters = parts.filter((x) => x.p.type === 'emitter');
      const storages = parts.filter((x) => x.p.type === 'storage');

      const sideRows = Math.max(sources.length, emitters.length, 1);
      const hasStorage = storages.length > 0;
      const rows = sideRows + (hasStorage ? 1 : 0);
      const H = titleH + MARGIN + (rows - 1) * ROW_H + BOX_H + MARGIN;

      const rowY = (i) => titleH + MARGIN + i * ROW_H;

      let maxMag = 0.0001;
      parts.forEach((x) => { if (x.flow.active) maxMag = Math.max(maxMag, x.flow.mag); });

      const conn = (x1, y1, x2, y2, flow, forwardWhen) => {
        if (!flow.active || !flow.dir) {
          return '<line class="hfc-line hfc-line-off" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
        }
        const w = 2.5 + 3.5 * Math.min(1, flow.mag / maxMag);
        const cls = (flow.dir === forwardWhen) ? 'hfc-fwd' : 'hfc-rev';
        return '<line class="hfc-line hfc-flow ' + cls + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#ff7043" stroke-width="' + w.toFixed(1) + '"/>';
      };

      let out = '';

      const yTop = rowY(0) + BOX_H / 2;
      const ySideBot = rowY(sideRows - 1) + BOX_H / 2;
      const sby = hasStorage ? rowY(sideRows) : null;
      const yBusEnd = hasStorage ? sby - 5 : ySideBot;
      if (yBusEnd > yTop) {
        out += '<line class="hfc-bus" x1="' + BUS_X + '" y1="' + yTop + '" x2="' + BUS_X + '" y2="' + yBusEnd + '"/>';
      }

      sources.forEach((x, i) => {
        const cy = rowY(i) + BOX_H / 2;
        out += conn(MARGIN + BOX_W + 5, cy, BUS_X, cy, x.flow, 'from');
      });
      emitters.forEach((x, i) => {
        const cy = rowY(i) + BOX_H / 2;
        out += conn(BUS_X, cy, W - MARGIN - BOX_W - 5, cy, x.flow, 'to');
      });

      sources.forEach((x, i) => { out += participantBox(x, MARGIN, rowY(i), BOX_W, BOX_H); });
      emitters.forEach((x, i) => { out += participantBox(x, W - MARGIN - BOX_W, rowY(i), BOX_W, BOX_H); });

      if (hasStorage) {
        const sx = storages[0];
        const storW = 150;
        const sbx = BUS_X - storW / 2;
        out += storageBox(sx, sbx, sby, storW, BOX_H, minT, maxT);
        const sf = sx.flow;
        if (sf.active && sf.dir && sby - 5 > ySideBot) {
          out += conn(BUS_X, ySideBot, BUS_X, sby - 5, sf, 'to');
        }
      }

      const title = cfg.title
        ? '<text class="hfc-title" x="' + MARGIN + '" y="' + (titleH - 8) + '">' + esc(cfg.title) + '</text>'
        : '';

      this._height = H;
      // CSS is embedded inside the SVG because HA renders cards inside a
      // shadow root, where document-level styles do not apply.
      this.innerHTML = '<svg class="hfc-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img"><style>' + CSS + '</style>' + title + out + '</svg>';
    }
  }

  class HeatingFlowCardEditor extends HTMLElement {
    constructor() {
      super();
      this._config = {};
      this.addEventListener('input', () => this._onInput());
    }

    setConfig(config) {
      this._config = JSON.parse(JSON.stringify(config || {}));
      this._renderEditor();
    }

    setProperty(config) {
      this.setConfig(config);
    }

    set hass(_hass) {}

    _renderEditor() {
      const c = this._config;
      this.innerHTML =
        '<div style="margin-bottom:8px"><label style="display:block;font-size:12px">Title</label>' +
        '<input id="hfc-ed-title" style="width:100%" value="' + esc(c.title || '') + '"></div>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
        '<div style="flex:1"><label style="display:block;font-size:12px">min_temp</label>' +
        '<input id="hfc-ed-min" type="number" style="width:100%" value="' + (c.min_temp != null ? c.min_temp : 5) + '"></div>' +
        '<div style="flex:1"><label style="display:block;font-size:12px">max_temp</label>' +
        '<input id="hfc-ed-max" type="number" style="width:100%" value="' + (c.max_temp != null ? c.max_temp : 80) + '"></div></div>' +
        '<label style="display:block;font-size:12px">participants (JSON)</label>' +
        '<textarea id="hfc-ed-parts" rows="14" style="width:100%;font-family:monospace">' +
        esc(JSON.stringify(c.participants || [], null, 2)) + '</textarea>' +
        '<div id="hfc-ed-err" style="color:#ff5252;font-size:12px;margin-top:4px"></div>';
    }

    _buildConfig(title, min, max, participantsJson) {
      const participants = JSON.parse(participantsJson);
      const config = { type: CARD_TYPE, participants };
      if (title) config.title = title;
      if (Number.isFinite(min)) config.min_temp = min;
      if (Number.isFinite(max)) config.max_temp = max;
      return config;
    }

    _onInput() {
      const err = this.querySelector('#hfc-ed-err');
      try {
        const config = this._buildConfig(
          this.querySelector('#hfc-ed-title').value,
          parseFloat(this.querySelector('#hfc-ed-min').value),
          parseFloat(this.querySelector('#hfc-ed-max').value),
          this.querySelector('#hfc-ed-parts').value
        );
        this._config = config;
        if (err) err.textContent = '';
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
      } catch (e) {
        if (err) err.textContent = String((e && e.message) || e);
      }
    }
  }

  if (!customElements.get(CARD_TYPE)) {
    customElements.define(CARD_TYPE, HeatingFlowCard);
  }
  if (!customElements.get('heating-flow-card-editor')) {
    customElements.define('heating-flow-card-editor', HeatingFlowCardEditor);
  }

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TYPE,
    name: 'Heating Flow Card',
    description: 'Visualizes heating systems with animated flows based on temperature differences and pump enable signals.',
    preview: true
  });
})();
