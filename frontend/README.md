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
`src/lib/api/demo.js` mirrors the Laravel contract exactly.

## Map

```
src/
  App.svelte              router + auth gate
  lib/
    api/                  client (live) · demo backend · seed dataset
    ml/                   duration.js (tree evaluator) · fueling.js · index.js
    components/           shell, cards, charts, map, modal…
    routes/               Dashboard · Plan · Activities · Analytics · Goals · Settings
    stores.js             global state + derived analytics
    format.js             number / date helpers
public/
  models/                 exported trees + model card (shipped to the browser)
  mascot-cat.png, icons   brand assets
```

## Offline parity

`public/models/duration_model.json` is produced by `ml-service/training/train.py`.
The browser walks the very same trees (`lib/ml/duration.js`), so a prediction made
offline in the air matches one made by the server. Regenerate the file after every
retrain — the `train` script writes it to `ml-service/artifacts/`, copy it into
`frontend/public/models/`.

## Design tokens

Pink kawaii theme: `brand.50–900`, `ink.400–900`, `shadow-soft|card|glow`,
`rounded-3xl` cards, Quicksand/Poppins type, mascot `public/mascot-cat.png`.
