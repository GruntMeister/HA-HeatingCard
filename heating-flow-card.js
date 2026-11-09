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
    '.hfc-temp { fill: #ffffff; font-weight: 700; }',
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
      lines += '<text class="hfc-sub" x="' + (bx + 46) + '" y="' + (by + 42) + '">' +
        'VL <tspan class="hfc-temp">' + (x.tf != null ? x.tf.toFixed(1) + '°' : '–') + '</tspan>' + '  ' +
        'RL <tspan class="hfc-temp">' + (x.tr != null ? x.tr.toFixed(1) + '°' : '–') + '</tspan></text>';
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
        '<tspan class="hfc-temp">' + (layers[i].temp != null ? layers[i].temp.toFixed(1) + '°' : '–') + '</tspan></text>';
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
        type: 'custom:' + CARD_TYPE,
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

      // Direction is conveyed by the dash animation: forward along the drawn
      // path, reversed against it.
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
      this._config = { type: CARD_TYPE, participants: [] };
      this._hass = null;
      this.addEventListener('input', (ev) => this._onInput(ev));
      this.addEventListener('change', (ev) => this._onChange(ev));
      this.addEventListener('value-changed', (ev) => this._onValueChanged(ev));
      this.addEventListener('click', (ev) => this._onClick(ev));
    }

    setConfig(config) {
      const c = JSON.parse(JSON.stringify(config || {}));
      c.type = 'custom:' + CARD_TYPE;
      if (!Array.isArray(c.participants)) c.participants = [];
      // migrate configs saved by older editor versions that stored the pump under sensors
      c.participants.forEach((p) => {
        if (p && p.sensors && p.sensors.pump) {
          if (!p.pump) p.pump = p.sensors.pump;
          delete p.sensors.pump;
        }
      });
      this._config = c;
      this._renderEditor();
    }

    setProperty(config) {
      this.setConfig(config);
    }

    set hass(h) {
      this._hass = h;
    }

    _commit(rerender) {
      const config = JSON.parse(JSON.stringify(this._config));
      config.type = 'custom:' + CARD_TYPE;
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config },
        bubbles: true,
        composed: true
      }));
      if (rerender) this._renderEditor();
    }

    _setCardField(field, value) {
      if (field === 'title') {
        if (value) this._config.title = value; else delete this._config.title;
      } else if (Number.isFinite(value)) {
        this._config[field] = value;
      } else {
        delete this._config[field];
      }
      this._commit(false);
    }

    _setParticipantField(i, field, value) {
      const p = this._config.participants[i];
      if (!p) return;
      if (field === 'type') {
        p.type = value;
        if (value === 'storage' && !Array.isArray(p.layers)) p.layers = [{ name: 'Top', temp: '' }];
        if (value !== 'storage') delete p.layers;
        this._commit(true);
      } else if (field === 'name') {
        p.name = value;
        this._commit(false);
      } else if (field === 'pump_direction') {
        if (value) p.pump_direction = value; else delete p.pump_direction;
        this._commit(false);
      } else if (field === 'pump') {
        if (value) p.pump = value; else delete p.pump;
        this._commit(false);
      } else if (field.indexOf('sensor.') === 0) {
        const key = field.slice(7);
        p.sensors = p.sensors || {};
        if (value) p.sensors[key] = value; else delete p.sensors[key];
        this._commit(false);
      }
    }

    _setLayerField(i, j, field, value) {
      const p = this._config.participants[i];
      if (!p || !Array.isArray(p.layers) || !p.layers[j]) return;
      if (field === 'name') p.layers[j].name = value;
      else if (field === 'temp') {
        if (value) p.layers[j].temp = value; else delete p.layers[j].temp;
      }
      this._commit(false);
    }

    _addParticipant() {
      this._config.participants.push({
        id: 'p' + this._config.participants.length,
        type: 'generator',
        name: 'New participant',
        sensors: {}
      });
      this._commit(true);
    }

    _removeParticipant(i) {
      this._config.participants.splice(i, 1);
      this._commit(true);
    }

    _addLayer(i) {
      const p = this._config.participants[i];
      if (!p) return;
      p.layers = p.layers || [];
      p.layers.push({ name: 'Layer ' + (p.layers.length + 1), temp: '' });
      this._commit(true);
    }

    _removeLayer(i, j) {
      const p = this._config.participants[i];
      if (p && Array.isArray(p.layers)) {
        p.layers.splice(j, 1);
        this._commit(true);
      }
    }

    _onInput(ev) {
      const t = ev.target, role = t.dataset && t.dataset.role;
      if (!role) return;
      if (role === 'title') this._setCardField('title', t.value);
      else if (role === 'min_temp') this._setCardField('min_temp', parseFloat(t.value));
      else if (role === 'max_temp') this._setCardField('max_temp', parseFloat(t.value));
      else if (role === 'p-name') this._setParticipantField(+t.dataset.idx, 'name', t.value);
      else if (role === 'layer-name') this._setLayerField(+t.dataset.idx, +t.dataset.layer, 'name', t.value);
    }

    _onChange(ev) {
      const t = ev.target, role = t.dataset && t.dataset.role;
      if (!role) return;
      if (role === 'p-type') this._setParticipantField(+t.dataset.idx, 'type', t.value);
      else if (role === 'p-dir') this._setParticipantField(+t.dataset.idx, 'pump_direction', t.value);
    }

    _onValueChanged(ev) {
      const t = ev.target, role = t.dataset && t.dataset.role;
      if (!role) return;
      const value = (ev.detail && ev.detail.value) || '';
      if (role === 'p-sensor') {
        const field = t.dataset.field === 'pump' ? 'pump' : 'sensor.' + t.dataset.field;
        this._setParticipantField(+t.dataset.idx, field, value);
      } else if (role === 'layer-temp') {
        this._setLayerField(+t.dataset.idx, +t.dataset.layer, 'temp', value);
      }
    }

    _onClick(ev) {
      const t = ev.target, action = t.dataset && t.dataset.action;
      if (!action) return;
      if (action === 'add-participant') this._addParticipant();
      else if (action === 'remove-participant') this._removeParticipant(+t.dataset.idx);
      else if (action === 'add-layer') this._addLayer(+t.dataset.idx);
      else if (action === 'remove-layer') this._removeLayer(+t.dataset.idx, +t.dataset.layer);
    }

    _field(labelText, control) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px';
      if (labelText) {
        const lab = document.createElement('label');
        lab.textContent = labelText;
        lab.style.cssText = 'display:block;font-size:12px;margin-bottom:2px';
        wrap.appendChild(lab);
      }
      wrap.appendChild(control);
      return wrap;
    }

    _textInput(value, role, extra) {
      const inp = document.createElement('input');
      inp.value = value || '';
      inp.dataset.role = role;
      if (extra) Object.assign(inp.dataset, extra);
      inp.style.cssText = 'width:100%;box-sizing:border-box';
      return inp;
    }

    _numInput(value, role) {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.value = value;
      inp.dataset.role = role;
      inp.style.cssText = 'width:100%;box-sizing:border-box';
      return inp;
    }

    _select(value, options, role, extra) {
      const sel = document.createElement('select');
      sel.dataset.role = role;
      if (extra) Object.assign(sel.dataset, extra);
      sel.style.cssText = 'width:100%';
      options.forEach(([val, label]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        if (val === value) opt.selected = true;
        sel.appendChild(opt);
      });
      return sel;
    }

    _entityPicker(labelText, value, role, extra) {
      const picker = document.createElement('ha-entity-picker');
      if (this._hass) picker.hass = this._hass;
      picker.label = labelText;
      picker.value = value || '';
      picker.dataset.role = role;
      if (extra) Object.assign(picker.dataset, extra);
      return this._field(null, picker);
    }

    _button(labelText, action, extra) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = labelText;
      btn.dataset.action = action;
      if (extra) Object.assign(btn.dataset, extra);
      btn.style.cssText = 'margin:4px 8px 4px 0;cursor:pointer';
      return btn;
    }

    _participantEditor(p, i) {
      const fs = document.createElement('fieldset');
      fs.style.cssText = 'margin:0 0 12px;padding:8px;border:1px solid #424242;border-radius:8px';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:8px';
      head.appendChild(this._field('Type', this._select(p.type, [
        ['generator', 'Generator'], ['solar', 'Solar'], ['emitter', 'Emitter'], ['storage', 'Storage (tank)']
      ], 'p-type', { idx: i })));
      head.appendChild(this._field('Name', this._textInput(p.name || '', 'p-name', { idx: i })));
      head.appendChild(this._button('Remove', 'remove-participant', { idx: i }));
      fs.appendChild(head);

      if (p.type === 'storage') {
        (p.layers || []).forEach((l, j) => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:8px;align-items:flex-end';
          row.appendChild(this._field('Layer name', this._textInput(l.name || '', 'layer-name', { idx: i, layer: j })));
          row.appendChild(this._entityPicker('Temperature sensor', l.temp, 'layer-temp', { idx: i, layer: j }));
          row.appendChild(this._button('Remove', 'remove-layer', { idx: i, layer: j }));
          fs.appendChild(row);
        });
        fs.appendChild(this._button('+ Add layer', 'add-layer', { idx: i }));
      } else {
        const s = p.sensors || {};
        fs.appendChild(this._entityPicker('Flow temperature (flow_temp)', s.flow_temp, 'p-sensor', { idx: i, field: 'flow_temp' }));
        fs.appendChild(this._entityPicker('Return temperature (return_temp)', s.return_temp, 'p-sensor', { idx: i, field: 'return_temp' }));
        fs.appendChild(this._entityPicker('Power kW (optional)', s.power, 'p-sensor', { idx: i, field: 'power' }));
        fs.appendChild(this._entityPicker('Pump (optional)', p.pump, 'p-sensor', { idx: i, field: 'pump' }));
        fs.appendChild(this._field('Pump direction', this._select(p.pump_direction || '', [
          ['', 'default by type'], ['to', 'to (towards participant)'], ['from', 'from (away from participant)']
        ], 'p-dir', { idx: i })));
      }
      return fs;
    }

    _renderEditor() {
      const c = this._config;
      this.innerHTML = '';
      const box = document.createElement('div');
      box.appendChild(this._field('Title', this._textInput(c.title || '', 'title')));
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px';
      row.appendChild(this._field('min_temp', this._numInput(c.min_temp != null ? c.min_temp : 5, 'min_temp')));
      row.appendChild(this._field('max_temp', this._numInput(c.max_temp != null ? c.max_temp : 80, 'max_temp')));
      box.appendChild(row);
      c.participants.forEach((p, i) => box.appendChild(this._participantEditor(p, i)));
      box.appendChild(this._button('+ Add participant', 'add-participant'));
      this.appendChild(box);
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
