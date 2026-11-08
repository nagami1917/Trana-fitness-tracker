import assert from 'node:assert/strict';
import { resolveApiConfig } from '../src/services/config.js';

assert.deepEqual(resolveApiConfig(), { isLive: false, base: '' });
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: '  ' }), { isLive: false, base: '' });
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: '/' }), { isLive: true, base: '' });
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: 'https://api.example.com/' }), {
  isLive: true,
  base: 'https://api.example.com',
});
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: '/backend/' }), { isLive: true, base: '/backend' });
console.log('API configuration smoke checks passed');
