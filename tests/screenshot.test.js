'use strict';

// Render test that doubles as screenshot generator: it renders the example
// configuration and writes screenshot.svg / screenshot.png to the repo root
// (the PNG step needs `pip install svglib reportlab pypdfium2 pillow` and is
// skipped gracefully when unavailable).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installDom, loadCard, renderCard, EXAMPLE_CONFIG, EXAMPLE_STATES, inlineStyles } = require('./helpers.cjs');

installDom();
const { Card } = loadCard();

const ROOT = path.join(__dirname, '..');

test('screenshot: render example config to screenshot.svg and screenshot.png', () => {
  const el = renderCard(Card, EXAMPLE_CONFIG, EXAMPLE_STATES);
  const H = el._height, W = 420, S = 2;
  let svg = inlineStyles(el.innerHTML);
  svg = svg.replace('<svg ', `<svg width="${W * S}" height="${H * S}" `);
  const i = svg.indexOf('>');
  svg = svg.slice(0, i + 1) +
    `<rect x="0" y="0" width="${W * S}" height="${H * S}" fill="#fafafa"/>` +
    svg.slice(i + 1);
  svg = svg.replace('stroke="var(--primary-text-color, #ffffff)"', 'stroke="#ffffff"');

  const svgPath = path.join(ROOT, 'screenshot.svg');
  fs.writeFileSync(svgPath, svg);
  assert.ok(fs.statSync(svgPath).size > 1000);

  const pngPath = path.join(ROOT, 'screenshot.png');
  const py = `
from svglib.svglib import svg2rlg
from reportlab.graphics import renderPDF
import pypdfium2 as pdfium
d = svg2rlg(${JSON.stringify(svgPath)})
renderPDF.drawToFile(d, ${JSON.stringify(path.join(ROOT, 'screenshot.pdf'))})
img = pdfium.PdfDocument(${JSON.stringify(path.join(ROOT, 'screenshot.pdf'))})[0].render(scale=2).to_pil()
img.save(${JSON.stringify(pngPath)})
`;
  try {
    execFileSync('python3', ['-c', py], { stdio: 'pipe' });
    assert.ok(fs.statSync(pngPath).size > 10000, 'screenshot.png written');
  } catch (e) {
    console.warn('PNG rasterization skipped (install: pip install svglib reportlab pypdfium2 pillow)');
  }
  // the SVG alone must always show the full card
  assert.match(svg, /<svg/);
  assert.equal((el.innerHTML.match(/class="hfc-box"/g) || []).length, 5);
  assert.ok(svg.includes('stroke-dasharray'));
});
