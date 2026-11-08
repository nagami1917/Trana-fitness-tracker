import assert from 'node:assert/strict';
import { resolveApiConfig } from '../src/services/config.js';

// A missing or blank setting must still use the real same-origin API.
assert.deepEqual(resolveApiConfig(), { base: '' });
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: '  ' }), { base: '' });
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: '/' }), { base: '' });
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: 'https://api.example.com/' }), {
  base: 'https://api.example.com',
});
assert.deepEqual(resolveApiConfig({ VITE_API_BASE_URL: '/backend/' }), { base: '/backend' });
console.log('API configuration smoke checks passed');
