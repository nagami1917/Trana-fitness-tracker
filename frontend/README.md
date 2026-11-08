# TRANA frontend (Svelte 5 + Tailwind PWA)

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # dist/ + service worker
npm run preview   # serve the production build
node scripts/smoke.mjs   # headless prediction pipeline check
```

## Data mode

| `VITE_API_BASE_URL` | Behaviour |
| --- | --- |
| empty | **Demo mode** — seeded athlete, localStorage persistence, on-device model |
| `https://api…` | **Live mode** — Sanctum bearer tokens against the Laravel API |

Nothing else changes: every screen consumes the same shapes, because
`src/services/demo.js` mirrors the Laravel contract exactly.

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
  services/               client.js (live API) · demo.js (offline backend) · seed.js
  lib/
    router.js             history-API router (no dependency)
    ml/                   duration.js (tree evaluator) · fueling.js · index.js
    format.js             number / date helpers
public/
  models/                 exported trees + model card (shipped to the browser)
  mascot-cat.png, icons   brand assets
```

## Offline parity

`public/models/duration_model.json` is produced by `ml/duration_model/train.py`.
The browser walks the very same trees (`lib/ml/duration.js`), so a prediction made
offline in the air matches one made by the server. Regenerate the file after every
retrain — the `train` script writes it to `ml/duration_model/`, copy it into
`frontend/public/models/`.

## Design tokens

Pink kawaii theme: `brand.50–900`, `ink.400–900`, `shadow-soft|card|glow`,
`rounded-3xl` cards, Quicksand/Poppins type, mascot `public/mascot-cat.png`.
