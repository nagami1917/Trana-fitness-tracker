import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // Vite does not populate process.env with .env files while loading config.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [
      svelte(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'mascot-cat.png', 'apple-touch-icon.png'],
        manifest: {
          name: 'TRANA — Personalized Activity Fueling',
          short_name: 'TRANA',
          description:
            'Predict how long your next run, ride or hike will take — and exactly what to eat and drink for it.',
          theme_color: '#ec4899',
          background_color: '#fff5f8',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          // Keep index.html and registerSW.js out of the Cache-First precache so
          // normal page loads and refreshes always hit Vercel first for the latest bundle.
          // Defer heavy route/map vendor bundles & ML model JSON to runtime caching.
          globPatterns: ['**/*.{js,css,woff2}'],
          globIgnores: ['**/registerSW.js', '**/maplibre-gl-worker-*', '**/vendor-maplibre-*'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          navigateFallback: null,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'html-pages',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            {
              urlPattern: /\/assets\/.*\.(?:js|css)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'vite-assets',
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              urlPattern: /\/models\/.*\.json$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'ml-models',
                expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: /^https:\/\/[abc]?\.?tile\.openstreetmap\.org\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'osm-tiles',
                expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('maplibre-gl')) return 'vendor-maplibre';
            if (id.includes('leaflet')) return 'vendor-leaflet';
            if (id.includes('chart.js')) return 'vendor-charts';
            if (id.includes('lucide-svelte')) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      proxy: {
        // Only used when you run the Laravel API locally; the browser always talks
        // to a same-origin /api path so no CORS or localhost leaks into the PWA.
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8001',
          changeOrigin: true,
        },
      },
    },
    preview: { host: '0.0.0.0', allowedHosts: true },
  };
});
