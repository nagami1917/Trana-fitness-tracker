/**
 * Same-origin API deployment checks.
 *
 * TRANA signs users in with an HttpOnly cookie. When the SPA and the API sit on
 * two different `*.vercel.app` hosts those are two different *sites* (vercel.app
 * is on the Public Suffix List), so the cookie is third-party and browsers that
 * block third-party cookies — Brave by default, Safari and Firefox too — drop it
 * and the user silently lands back on the marketing page.
 *
 * The fix is to serve the API from the SPA's own origin through a rewrite in
 * frontend/vercel.json. This suite pins the three things that must agree for
 * that to work, because each one fails quietly:
 *
 *   1. vercel.json proxies /api BEFORE the SPA catch-all rewrite.
 *   2. Nothing asks the browser for an absolute API origin any more.
 *   3. api.js keeps the /api prefix exactly once (no /api/api doubles).
 *
 *   node scripts/same-origin-api-smoke.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/* ---------------------------------------------------------- 1. vercel.json */

const config = JSON.parse(read('vercel.json'));
const rewrites = config.rewrites ?? [];

const apiIndex = rewrites.findIndex((r) => /^\/api\//.test(r.source));
const spaIndex = rewrites.findIndex((r) => r.destination === '/index.html');

assert.notEqual(apiIndex, -1, 'vercel.json must proxy /api to the API project');
assert.notEqual(spaIndex, -1, 'vercel.json must keep the SPA catch-all rewrite');
assert.ok(
  apiIndex < spaIndex,
  'the /api proxy must be listed BEFORE the SPA catch-all, or every API call returns index.html',
);

const apiRule = rewrites[apiIndex];
assert.match(apiRule.destination, /^https:\/\//, 'the API proxy needs an absolute destination');
assert.ok(
  apiRule.destination.endsWith('/api/:path*'),
  `the API destination must keep the /api prefix, got ${apiRule.destination}`,
);
assert.ok(
  !/\$1|\{\{/.test(apiRule.destination),
  'the API destination must not mix :path* wildcards with legacy $1 substitution',
);
// Proxying to the preview hostname would pin production traffic to one build.
assert.ok(
  !/trana-[a-z0-9]+-final-thesis\.vercel\.app/.test(apiRule.destination),
  'proxy to the stable alias, not a per-deployment hostname',
);

/* ------------------------------------------------------- 2. no absolute API */

const clientSource = read('src/services/client.js');
assert.ok(
  clientSource.includes('resolveApiConfig'),
  'client.js must resolve the API base from config, not hardcode it',
);

const configSource = read('src/services/config.js');
assert.ok(
  /base:\s*configured\.replace/.test(configSource),
  'config.js must derive the API base from VITE_API_BASE_URL',
);

// The built app must be able to talk to its own origin. An absolute value
// would put the auth cookie back on a second site.
const envExample = read('.env.example');
assert.match(
  envExample,
  /VITE_API_BASE_URL=(\/)?\n/,
  'the documented default must be same-origin (blank or "/")',
);

/* ------------------------------------------------------ 3. no doubled /api */

// client.js builds URLs as `${BASE}/api${path}`. A BASE that still ended in
// /api would produce /api/api/... and 404 on every call.
assert.ok(
  !/VITE_API_BASE_URL=.*\/api\/?$/m.test(envExample),
  'VITE_API_BASE_URL must be an origin, never an origin plus /api',
);
assert.match(
  clientSource,
  /\$\{BASE\}\/api\$\{path\}/,
  'client.js must join BASE + /api + path exactly once',
);

console.log('same-origin API deployment checks passed');
