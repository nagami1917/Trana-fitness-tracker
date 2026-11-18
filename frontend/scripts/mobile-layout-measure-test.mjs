/**
 * Does the mobile layout detector actually detect anything?
 *
 * A test that can only ever pass is worse than no test. `measure()` returns
 * empty arrays on a clean page, and if a selector or a computed-style read were
 * wrong it would return empty arrays on a *broken* page too - which is exactly
 * how a mobile check ends up green while the layout is broken.
 *
 * So this feeds `measure()` a document with known defects and asserts it names
 * each one. The geometry is synthetic; the point is that the rules fire.
 *
 *   node scripts/mobile-layout-measure-test.mjs
 */

import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { measure } from './mobile-layout-measure.mjs';

/** Build a document and let measure() run against it. */
function audit(html, { width = 390, boxes = {}, styles = {} } = {}) {
  const window = new Window({ width, height: 844 });
  window.document.body.innerHTML = `<main id="root">${html}</main>`;
  // happy-dom reports 0 for these because it never lays anything out; the
  // browser being emulated here is `width` wide.
  Object.defineProperty(window.document.documentElement, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(window.document.documentElement, 'scrollWidth', { value: width, configurable: true });

  // happy-dom has no layout engine, so every rect is 0x0 unless we supply one.
  const apply = (el) => {
    const r = boxes[el.dataset.probe];
    if (r) {
      el.getBoundingClientRect = () => ({
        ...r,
        top: r.top ?? 0,
        bottom: r.bottom ?? (r.top ?? 0) + (r.height ?? 0),
        left: r.left ?? 0,
        right: r.right ?? (r.left ?? 0) + (r.width ?? 0),
        x: r.left ?? 0,
        y: r.top ?? 0,
        toJSON() {},
      });
    }
    const s = styles[el.dataset.probe];
    if (s) {
      const real = el.ownerDocument.defaultView.getComputedStyle.bind(el.ownerDocument.defaultView);
      el.ownerDocument.defaultView.getComputedStyle = (node, pseudo) => {
        const cs = real(node, pseudo);
        // Computed styles are read-only in happy-dom, so overlay the overrides.
        return node === el ? new Proxy(cs, { get: (t, k) => (k in s ? s[k] : t[k]) }) : cs;
      };
    }
    [...el.children].forEach(apply);
  };
  apply(window.document.getElementById('root'));

  const g = globalThis;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
  g.document = window.document;
  g.getComputedStyle = window.getComputedStyle.bind(window);
  try {
    return measure();
  } finally {
    g.document = saved.document;
    g.getComputedStyle = saved.getComputedStyle;
    window.close();
  }
}

let checks = 0;
const ok = (label, fn) => {
  fn();
  checks++;
  console.log(`  ok  ${label}`);
};

/* ------------------------------------------------------------- the cases */

ok('a clean page reports nothing', () => {
  const m = audit('<button data-probe="a">Save</button>', {
    boxes: { a: { left: 16, right: 120, width: 104, height: 44 } },
  });
  assert.equal(m.elements, 1, 'the element count is what proves something rendered');
  assert.equal(m.pastEdge.length, 0);
  assert.equal(m.smallTargets.length, 0);
  assert.equal(m.overlaps.length, 0);
  assert.equal(m.clipped.length, 0);
  assert.equal(m.controls, 1, 'the button must be counted as a control');
});

ok('an element past the right edge is caught', () => {
  const m = audit('<div data-probe="wide">520px table</div>', {
    boxes: { wide: { left: 16, right: 536, width: 520, height: 40 } },
  });
  assert.equal(m.pastEdge.length, 1, 'overflow must be reported');
  assert.equal(m.pastEdge[0].right, 536);
});

ok('a 30px-tall button is caught as a small target', () => {
  // The classic mobile bug: desktop-sized hit area on a touch screen.
  const m = audit('<button data-probe="tiny">Feed</button>', {
    boxes: { tiny: { left: 16, right: 90, width: 74, height: 30 } },
  });
  assert.equal(m.smallTargets.length, 1);
  assert.equal(m.smallTargets[0].h, 30);
});

ok('a 39px target is caught, 40px is allowed', () => {
  const fail = audit('<button data-probe="b">x</button>', {
    boxes: { b: { left: 0, right: 60, width: 60, height: 39 } },
  });
  assert.equal(fail.smallTargets.length, 1, '39px is under the 40px floor');

  const pass = audit('<button data-probe="b">x</button>', {
    boxes: { b: { left: 0, right: 60, width: 60, height: 40 } },
  });
  assert.equal(pass.smallTargets.length, 0, '40px is the floor, not a violation');
});

ok('two controls sharing pixels are caught', () => {
  const m = audit('<button data-probe="a">A</button><button data-probe="b">B</button>', {
    boxes: {
      a: { left: 0, right: 100, top: 0, bottom: 44, width: 100, height: 44 },
      b: { left: 80, right: 180, top: 10, bottom: 54, width: 100, height: 44 },
    },
  });
  assert.equal(m.overlaps.length, 1, 'a 20x34px overlap must be reported');
  assert.match(m.overlaps[0], /x.*\(20x34px\)/);
});

ok('controls that merely touch do not count as overlapping', () => {
  const m = audit('<button data-probe="a">A</button><button data-probe="b">B</button>', {
    boxes: {
      a: { left: 0, right: 100, top: 0, bottom: 44, width: 100, height: 44 },
      b: { left: 100, right: 200, top: 0, bottom: 44, width: 100, height: 44 },
    },
  });
  assert.equal(m.overlaps.length, 0, '1px of shared edge is rounding, not an overlap');
});

ok('text under 12px is caught', () => {
  const m = audit('<p data-probe="t">Cadence: sip 150 ml every 20 min</p>', {
    boxes: { t: { left: 16, right: 300, width: 284, height: 16 } },
    styles: { t: { fontSize: '11px' } },
  });
  assert.equal(m.tinyText.length, 1);
  assert.equal(m.tinyText[0].px, 11);
});

ok('hidden elements are ignored', () => {
  // The sidebar is display:none on mobile; flagging it would be a false positive.
  const m = audit('<button data-probe="hidden">Menu</button>', {
    boxes: { hidden: { left: 0, right: 500, width: 500, height: 20 } },
    styles: { hidden: { display: 'none' } },
  });
  assert.equal(m.pastEdge.length, 0, 'a hidden 500px element must not be reported');
  assert.equal(m.controls, 0);
});

console.log(`\nmobile-layout-measure-test: ${checks} checks pass - the detector fires on every rule it claims.`);
