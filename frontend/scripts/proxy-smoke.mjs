/** Confirm Vite's same-origin /api proxy respects VITE_PROXY_TARGET. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ path: req.url, host: req.headers.host }));
});
await new Promise((resolveListen, reject) => {
  upstream.once('error', reject);
  upstream.listen(0, '127.0.0.1', resolveListen);
});
const upstreamPort = upstream.address().port;
process.env.VITE_PROXY_TARGET = `http://127.0.0.1:${upstreamPort}`;
let vite;
try {
  vite = await createServer({
    root,
    configFile: resolve(root, 'vite.config.js'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
  });
  await vite.listen();
  const port = vite.httpServer.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/docs`, {
    headers: { Host: 'trana-preview.e2b.app' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { path: '/api/docs', host: `127.0.0.1:${upstreamPort}` });
  console.log('Vite same-origin API proxy check passed');
} finally {
  if (vite) await vite.close();
  await new Promise((resolveClose) => upstream.close(resolveClose));
}
