import assert from 'node:assert/strict';
import { resolveApiConfig, resolveGoogleClientId } from '../src/services/config.js';

// A missing or blank setting must still use the real same-origin API.
assert.deepEqual(resolveApiConfig(), { base: '' });
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: '  ' }), { base: '' });
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: '/' }), { base: '' });
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: 'https://api.example.com/' }), {
  base: 'https://api.example.com',
});
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: '/backend/' }), { base: '/backend' });
assert.equal(resolveGoogleClientId(), '');
assert.equal(resolveGoogleClientId({ VITE_GOOGLE_CLIENT_ID: '  web-client-id  ' }), 'web-client-id');
console.log('API and Google client configuration smoke checks passed');
