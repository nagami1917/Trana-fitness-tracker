/**
 * Layout audit that runs inside the page.
 *
 * Kept in its own module so `page.evaluate(measure)` receives a plain
 * self-contained function (Playwright serialises it - it cannot close over
 * anything in Node).
 *
 * Every rule here is something that visibly breaks on a phone:
 *   pastEdge    - content sticking out past the right edge (horizontal scroll)
 *   clipped     - text cut off by a fixed-height box with overflow:hidden
 *   smallTargets- a tap target under 40px (hard to hit with a thumb, gloves or
 *                 while moving)
 *   overlaps    - two controls sharing pixels, so a tap can hit the wrong one
 *   tinyText    - text under 12px, unreadable outdoors at arm's length
 */
export function measure() {
  const vw = document.documentElement.clientWidth;
  const root = document.getElementById('root') || document.body;
  const out = {
    viewport: vw,
    docScroll: document.documentElement.scrollWidth,
    pastEdge: [],
    clipped: [],
    smallTargets: [],
    overlaps: [],
    tinyText: [],
    controls: 0,
  };

  const rect = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const cs = getComputedStyle(el);
    // Guard the empty string: Number('') is 0, which would make every element
    // look transparent and silently skip the whole audit.
    const transparent = cs.opacity !== '' && Number(cs.opacity) === 0;
    if (cs.display === 'none' || cs.visibility === 'hidden' || transparent) return false;
    const r = rect(el);
    return r.width > 0 && r.height > 0;
  };
  const desc = (el) => {
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 36);
    return `<${el.tagName.toLowerCase()}${cls}>${text ? ` "${text}"` : ''}`;
  };

  for (const el of root.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const r = rect(el);
    const cs = getComputedStyle(el);

    // 2. anything whose box crosses the right edge (1px slack for rounding)
    if (r.right > vw + 1) {
      out.pastEdge.push({ el: desc(el), right: Math.round(r.right), w: Math.round(r.width) });
    }

    // Leaf text nodes only: an ancestor's box is not "text"
    if (!el.children.length && (el.textContent || '').trim()) {
      // 3. clipped by a fixed height
      if (cs.overflow === 'hidden' && cs.height !== 'auto' && el.scrollHeight > el.clientHeight + 1) {
        out.clipped.push({ el: desc(el), needs: el.scrollHeight, has: el.clientHeight });
      }
      // 6. below the readable floor
      const fs = parseFloat(cs.fontSize);
      if (fs > 0 && fs < 12) out.tinyText.push({ el: desc(el), px: fs });
    }
  }

  // 4./5. tap targets
  const controls = [
    ...root.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex="0"]'),
  ].filter(visible);
  out.controls = controls.length;
  for (const el of controls) {
    const r = rect(el);
    // Height is what matters for a thumb; width for a lone icon button. 40 is
    // the floor - Apple asks 44, Material 48.
    if (r.width < 40 || r.height < 40) {
      out.smallTargets.push({ el: desc(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = rect(controls[i]);
      const b = rect(controls[j]);
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) {
        out.overlaps.push(`${desc(controls[i])} x ${desc(controls[j])} (${Math.round(ox)}x${Math.round(oy)}px)`);
      }
    }
  }
  return out;
}
