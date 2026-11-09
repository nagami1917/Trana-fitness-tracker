# TRANA frontend (Svelte 5 + Tailwind PWA)

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # dist/ + service worker
npm run preview   # serve the production build
node scripts/smoke.mjs   # headless prediction pipeline check
```

## API connection

| `VITE_API_BASE_URL` | Behaviour |
| --- | --- |
| empty or `/` | Same-origin `/api`; Vite proxies to `VITE_PROXY_TARGET` during development |
| `https://api…` | Sanctum bearer tokens against the deployed Laravel API |

A Laravel API and configured database are required; there is no browser-local
sample dataset. Data saved by the previous browser-only mode is not automatically
imported or deleted; it remains in that browser until explicitly removed. Existing
real records in Supabase are not changed by this update.

The default proxy target is `http://127.0.0.1:8001` on the Vite server. Set
`VITE_PROXY_TARGET` in `.env.local` if Laravel uses another port, and restart
Vite. Never put a database password or Supabase service-role key in `VITE_*`
variables. A failed startup shows a retry screen instead of sample data.

## City / region detection

Onboarding, Profile and Settings allow manual entry or **Use current location**.
Detection only starts after the user clicks the button and grants browser
geolocation permission. Geolocation requires a secure context (HTTPS or
`localhost`) and an internet connection. The browser sends coordinates and its
IP directly to BigDataCloud's free client-side reverse-geocoding service;
BigDataCloud uses them to improve IP geolocation, as disclosed in the form. Only
the resulting editable city / region is sent to TRANA when the user saves or
finishes setup; coordinates are not stored by TRANA. Failed or denied detection
leaves manual entry available. This field does not change the activity route map's
starting point.

The free endpoint is for a device's current, permission-granted location only.
Never use it from the server, with stored coordinates, or for automated tests;
`npm test` uses mocked geolocation and responses instead.

## Map

```
src/
  App.svelte              auth gate + shell mounting
  routes/index.js         ROUTES table — maps paths to pages
  components/
    common/               AppShell, Card, Modal, Toaster, Logo, Segmented…
    dashboard/            StatCard, Sparkline
    activities/           ActivityIcon
    route/                RouteMap (Leaflet)
    fueling/              FuelingPlan
    analytics/            BarChart, DoughnutChart, LineChart, theme.js
  pages/                  Login · Register · Dashboard · Activities · PlanActivity ·
                          Fueling · Analytics · Goals · Profile · Settings · Onboarding · NotFound
  stores/index.js         global state + derived analytics
  services/               client.js (Laravel API) · config.js
  lib/
    router.js             history-API router (no dependency)
    ml/                   duration.js (tree evaluator) · fueling.js · index.js
    format.js             number / date helpers
public/
  models/                 exported trees + model card (shipped to the browser)
  mascot-cat.png, icons   brand assets
```

## Prediction previews

`public/models/duration_model.json` is exported by `ml/duration_model/train.py`
and evaluated locally for previews. The bundled model was trained on synthetic
activities; its metrics are not real-world validation. To keep a retrained model
in sync, copy **both** `duration_model.json` and `model_card.json` from
`ml/duration_model/` to `frontend/public/models/` and redeploy the frontend.
The authoritative saved result comes from Laravel and FastAPI. Signing in,
loading account data, and saving changes require a server connection; writes are
not queued offline.

## Design tokens

Pink kawaii theme: `brand.50–900`, `ink.400–900`, `shadow-soft|card|glow`,
`rounded-3xl` cards, Quicksand/Poppins type, mascot `public/mascot-cat.png`.
