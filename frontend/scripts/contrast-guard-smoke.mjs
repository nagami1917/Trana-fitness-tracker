/**
 * Contrast guard for the Midnight Navy / Electric Lime identity.
 *
 * White text on Electric Lime (#b7f34a) is 1.32:1 — effectively invisible. The
 * first re-theme pass missed several of these because it only inspected
 * `class="..."` attributes, so three other syntaxes slipped through:
 *
 *   class:text-white={cond}          Svelte class directive
 *   cond ? 'text-white' : '...'      literal inside a ternary
 *   text-white/80                    alpha variant of the same mistake
 *
 * Each of those reads as white text to the browser but as something else to a
 * naive grep. This checks the rendered class strings instead, for every
 * element whose background resolves to a lime fill.
 *
 *   node scripts/contrast-guard-smoke.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LIME = '#b7f34a';
const NAVY = '#101b2d';

/* ------------------------------------------------------------ colour math */

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const composite = (fgHex, bgHex, alpha) => {
  const fg = [1, 3, 5].map((i) => parseInt(fgHex.slice(i, i + 2), 16));
  const bg = [1, 3, 5].map((i) => parseInt(bgHex.slice(i, i + 2), 16));
  const out = fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
};

/* ---------------------------------------------------------------- walking */

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith('.svelte')) files.push(full);
  }
};
walk(join(root, 'src'));

/* A lime background is any brand gradient stop or solid brand fill. The
 * `from-`/`via-`/`to-` forms were the ones that used to be invisible to grep. */
const LIME_BG = /\b(?:from|via|to)-brand-(?:400|500|600|700)\b|\bbg-brand-(?:gradient|400|500|600|700)\b|\bbg-brand-gradient\b/;

/* White text in any of the three syntaxes, with optional alpha. */
const WHITE_TEXT = /\btext-white(?:\/\d+)?\b/;

const violations = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    // Class strings: a quoted class attribute, or any quoted literal that
    // looks like a class list (ternary branches live in these).
    const strings = [
      ...line.matchAll(/class\s*=\s*"([^"]*)"/g),
      ...line.matchAll(/class\s*=\s*'([^']*)'/g),
      ...line.matchAll(/'([^']*?)'/g),
    ].map((m) => m[1]);

    for (const cls of strings) {
      if (LIME_BG.test(cls) && WHITE_TEXT.test(cls)) {
        violations.push({
          file: file.replace(root + '/', ''),
          line: i + 1,
          cls: cls.trim().slice(0, 90),
        });
      }
    }

    // Svelte class directives applied alongside a lime background.
    if (/class:text-white/.test(line)) {
      violations.push({
        file: file.replace(root + '/', ''),
        line: i + 1,
        cls: 'class:text-white directive',
      });
    }
  });
}

assert.deepEqual(
  violations,
  [],
  `White text on an Electric Lime background (1.32:1) in ${violations.length} place(s):\n` +
    violations.map((v) => `  ${v.file}:${v.line}  ${v.cls}`).join('\n')
);

/* ------------------------------------------------- numeric contrast checks */

// The pair that must hold wherever lime is used as a fill.
assert.ok(
  contrast(NAVY, LIME) >= 4.5,
  `Navy label on lime must clear WCAG AA, got ${contrast(NAVY, LIME).toFixed(2)}:1`
);

// Secondary text is navy at reduced opacity, composited over the lime fill.
// /70 is the lightest step that still clears 4.5:1 — anything lighter fails.
for (const alpha of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
  const ratio = contrast(composite(NAVY, LIME, alpha), LIME);
  assert.ok(
    ratio >= 4.5,
    `Navy label at ${alpha * 100}% on lime is ${ratio.toFixed(2)}:1, below 4.5`
  );
}

// The specific mistake this file exists to prevent.
assert.ok(
  contrast('#ffffff', LIME) < 3,
  'White on lime is expected to fail; if this changes, revisit the palette'
);

console.log(`✔ contrast guard: ${files.length} Svelte files scanned`);
console.log('✔ no white text on Electric Lime backgrounds');
console.log(
  `✔ navy on lime ${contrast(NAVY, LIME).toFixed(2)}:1, secondary down to 70% clears AA`
);
