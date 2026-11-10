/**
 * TRANA map configuration.
 *
 * The map's visual identity, route styles, markers and thresholds live here so
 * the theme (colours, widths, opacity, label visibility, speed colour bands)
 * can be retouched without touching any map component.
 *
 * Map style:
 *   VITE_MAP_STYLE_URL   full style URL (default: MapLibre community demo style,
 *                         OpenStreetMap-based, no API key required)
 *   VITE_MAP_API_KEY     optional key appended to the style URL when using a
 *                         provider such as MapTiler / Stadia Maps. The key is
 *                         only needed for those providers — it must never be
 *                         hardcoded here.
 *
 * The default demo style is fine for development and previews. For production,
 * swap VITE_MAP_STYLE_URL for your own style (self-hosted or a provider style
 * URL that already contains its key) and keep any provider key out of the repo.
 */

/* ------------------------------------------------------------------ style */

export const MAP_STYLE_URL =
  import.meta.env?.VITE_MAP_STYLE_URL ??
  'https://demotiles.maplibre.org/style.json';

export const MAP_API_KEY = import.meta.env?.VITE_MAP_API_KEY ?? '';

/* ------------------------------------------------------------------ theme */

export const TRANA_THEME = {
  // Dark, fitness-focused map appearance (applied on top of the base style).
  surface: '#0b111a',        // map background / chrome
  water: '#121b26',
  land: '#161c25',
  park: '#1e2a22',
  building: '#1e293b',
  roadMajor: '#334155',
  roadMajorCasing: '#475569',
  roadMinor: '#262f3d',
  path: '#374151',
  label: '#94a3b8',
  labelOpacity: 0.55,
  halo: 'rgba(0,0,0,0.6)',

  // Brand accents used for markers and controls.
  brand: '#f9569b',
  brandOnWhite: '#ec4899',

  // Control surfaces.
  controlBg: 'rgba(255, 255, 255, 0.9)',
  controlBorder: '#e2e8f0',
  controlText: '#3f2333',
};

/* -------------------------------------------------------- route appearance */

// Route layer widths / opacity — tweak here, not inside components.
export const ACTUAL_ROUTE_WIDTH = 5;
export const ACTUAL_ROUTE_OPACITY = 0.95;
export const PLANNED_ROUTE_WIDTH = 5;
export const PLANNED_ROUTE_OPACITY = 0.7;
export const PLANNED_ROUTE_DASH = '3 2';

// Speed colour bands (km/h). Segments are coloured by the speed of that segment.
export const SLOW_SPEED_KMH = 8;
export const MODERATE_SPEED_KMH = 13;

export const SLOW_ROUTE_COLOR = '#f9569b';    // brand pink — easy effort
export const MODERATE_ROUTE_COLOR = '#f59e0b'; // amber — tempo
export const FAST_ROUTE_COLOR = '#10b981';    // emerald — fast

export const ROUTE_MIN_WIDTH = 3;
export const ROUTE_MAX_WIDTH = 7;

/* -------------------------------------------------------- markers */

export const MARKER_SIZE = 28;
export const CURRENT_LOCATION_PULSE = true;

export const MARKER_COLORS = {
  start: '#22c55e',      // green
  current: TRANA_THEME.brand,
  finish: '#0f172a',     // near-black, high contrast
  nutrition: '#f59e0b',
};

/* ----------------------------------------------------- nutrition checkpoints */

// Optional, time-based fueling hints shown along the route.
// Set NUTRITION_CHECKPOINTS_ENABLED via config or pass an empty array to hide.
export const NUTRITION_CHECKPOINTS = [
  { minutes: 30, label: '~250 kcal', message: 'Top up with a sip of drink mix.' },
  { minutes: 45, label: 'Carbohydrates', message: '~30–60 g carbs per hour from here.' },
  { minutes: 60, label: 'Electrolytes', message: 'Sweat losses add up — consider sodium.' },
];

export const NUTRITION_MAX_MARKERS = 6; // keep the map uncluttered

/* ----------------------------------------------------- road snapping */

// Road snapping uses the free Overpass API (OpenStreetMap) — no API key required.
// Query road ways near the GPS point and snap to the nearest road segment.
export const ROAD_SNAPPING = {
  enabled: true,                    // toggle road snapping on/off
  maxSearchRadiusM: 50,             // max metres to search for a road
  snapThresholdM: 100,              // if nearest road is farther than this, keep raw point
  overpassUrl: 'https://overpass-api.de/api/interpreter',
  // OSM road types to include in snapping
  roadTypes: [
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'residential', 'unclassified', 'road', 'living_street',
    'service', 'track', 'path', 'cycleway', 'footway',
  ],
};

/* ---------------------------------------------------------- road routing */
// OpenRouteService directions used to snap routes drawn on the map onto the
// real road network. Requires the VITE_ORS_API_KEY build-time env var
// (Vercel → trana-web); without a key the app falls back to straight lines.
export const ROUTING = {
  baseUrl: 'https://api.openrouteservice.org/v2/directions',
  timeoutMs: 10000, // give up and keep straight lines after 10s
  // activity type → ORS routing profile
  profiles: {
    run: 'foot-walking',
    walk: 'foot-walking',
    hike: 'foot-hiking',
    ride: 'cycling-regular',
  },
  defaultProfile: 'foot-walking',
};

/* -------------------------------------------------------- layer helpers */

// Base-style layer ids to restyle for the TRANA dark theme. Applied only when
// the layer actually exists in the chosen style.
export const DARK_LAYER_OVERRIDES = [
  { id: 'background', paint: { 'background-color': '#0b111a' } },
  { id: 'water', paint: { 'fill-color': '#121b26', 'fill-opacity': 0.9 } },
  { id: 'waterway', paint: { 'line-color': '#1f2a36', 'line-opacity': 0.7 } },
  { id: 'waterway-label', paint: { 'text-color': '#94a3b8', 'text-opacity': 0.5 } },
  { id: 'landuse', paint: { 'fill-color': '#161c25' } },
  { id: 'park', paint: { 'fill-color': '#1e2a22', 'fill-opacity': 0.8 } },
  { id: 'forests', paint: { 'fill-color': '#1e2a22', 'fill-opacity': 0.8 } },
  { id: 'building', paint: { 'fill-color': '#1e293b', 'fill-opacity': 0.9 } },
  { id: 'road_major', paint: { 'line-color': '#334155', 'line-opacity': 0.9 } },
  { id: 'road_major_casing', paint: { 'line-color': '#475569', 'line-opacity': 0.9 } },
  { id: 'road_minor', paint: { 'line-color': '#262f3d', 'line-opacity': 0.6 } },
  { id: 'path', paint: { 'line-color': '#374151', 'line-opacity': 0.5 } },
  { id: 'trail', paint: { 'line-color': '#5b6b7a', 'line-opacity': 0.6 } },
  { id: 'place_label', paint: { 'text-color': '#94a3b8', 'text-opacity': 0.55 } },
  { id: 'road_label', paint: { 'text-color': '#64748b', 'text-opacity': 0.45 } },
  { id: 'boundary', paint: { 'line-color': '#262f3d', 'line-opacity': 0.4 } },
];
