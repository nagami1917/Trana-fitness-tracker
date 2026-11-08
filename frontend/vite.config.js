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
          globPatterns: ['**/*.{js,css,html,png,svg,woff2,json}'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: '/index.html',
          runtimeCaching: [
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
