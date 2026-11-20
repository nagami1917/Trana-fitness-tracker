/**
 * TRANA map configuration.
 *
 * The map's visual identity, route styles, markers and thresholds live here so
 * the theme (colours, widths, opacity, label visibility, speed colour bands)
 * can be retouched without touching any map component.
 *
 * Map style:
 *   VITE_MAP_STYLE_URL        full MapLibre style URL. Defaults to OpenFreeMap
 *                             "positron": free, keyless, no signup, commercial
 *                             use allowed. Override to point at MapTiler,
 *                             Stadia Maps, a self-hosted style, or the
 *                             OpenFreeMap "dark" style.
 *   VITE_MAP_DARK_STYLE_URL   style used when the app theme is dark. Defaults to
 *                             OpenFreeMap "dark".
 *   VITE_MAP_TILE_URL         optional raster XYZ template for the Leaflet
 *                             preview maps (RouteMap.svelte). Leave blank to
 *                             keep them on the same vector style as MapLibre.
 *   VITE_MAP_API_KEY          optional key for providers that require one. It
 *                             must never be hardcoded here.
 *
 * Why not tile.openstreetmap.org directly: OSM's tile servers are donated
 * infrastructure. Their usage policy forbids app-style production traffic and
 * will block a site that leans on them, and they carry no SLA. OpenFreeMap
 * serves the same OpenStreetMap data as vector tiles with no key, no volume
 * limit and no signup, so it carries no rate-limit cliff.
 * https://operations.osmfoundation.org/policies/tiles/
 */

/* ------------------------------------------------------------------ style */

const rawStyleUrl = (import.meta.env?.VITE_MAP_STYLE_URL ?? '').trim();
const rawDarkStyleUrl = (import.meta.env?.VITE_MAP_DARK_STYLE_URL ?? '').trim();
const rawTileUrl = (import.meta.env?.VITE_MAP_TILE_URL ?? '').trim();

const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const DEFAULT_DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** True only when the deployer pinned their own style — theme overrides are
 *  then skipped so a provider style is never painted over. */
export const HAS_CUSTOM_STYLE = Boolean(rawStyleUrl);

export const MAP_STYLE_URL = rawStyleUrl || DEFAULT_STYLE_URL;
export const MAP_DARK_STYLE_URL = rawDarkStyleUrl || (rawStyleUrl ? rawStyleUrl : DEFAULT_DARK_STYLE_URL);
export const MAP_STYLE = MAP_STYLE_URL;

/** Optional raster tile template for the Leaflet preview maps. */
export const MAP_TILE_URL = rawTileUrl;

/**
 * Attribution required by the default tile provider. OpenFreeMap's terms ask
 * for OpenFreeMap + OpenMapTiles + OpenStreetMap; the OpenMapTiles and OSM
 * credits are also required by their respective data licences. If you switch
 * providers, this string must change to theirs — an uncredited basemap is a
 * licence violation for every provider, not just this one.
 */
export const MAP_ATTRIBUTION = [
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
  '&copy; <a href="https://www.openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a>',
  '&mdash; Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
].join(' ');

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
  brand: '#b7f34a',
  brandOnWhite: '#b7f34a',

  // Control surfaces.
  controlBg: 'rgba(255, 255, 255, 0.9)',
  controlBorder: '#e2e8f0',
  controlText: '#3f2333',
};

/* -------------------------------------------------------- route appearance */

// Route layer widths / opacity — tweak here, not inside components.
export const ACTUAL_ROUTE_WIDTH = 5;
export const ACTUAL_ROUTE_OPACITY = 0.95;
export const ACTIVITY_LINE_WIDTH = ACTUAL_ROUTE_WIDTH;
export const ACTIVITY_LINE_OPACITY = ACTUAL_ROUTE_OPACITY;
export const PLANNED_ROUTE_COLOR = '#b7f34a';
export const PLANNED_ROUTE_WIDTH = 5;
export const PLANNED_ROUTE_OPACITY = 0.88;
export const PLANNED_ROUTE_DASH = [3, 2];

// Speed colour bands (km/h). Segments are coloured by the speed of that segment.
export const SLOW_SPEED_KMH = 8;
export const MODERATE_SPEED_KMH = 13;

export const SLOW_ROUTE_COLOR = '#b7f34a';    // brand pink — easy effort
export const MODERATE_ROUTE_COLOR = '#f59e0b'; // amber — tempo
export const FAST_ROUTE_COLOR = '#45c78a';    // emerald — fast

export const SPEED_COLOR_RAMP = [
  'interpolate',
  ['linear'],
  ['coalesce', ['get', 'speedKmh'], SLOW_SPEED_KMH],
  0, SLOW_ROUTE_COLOR,
  SLOW_SPEED_KMH, SLOW_ROUTE_COLOR,
  MODERATE_SPEED_KMH, MODERATE_ROUTE_COLOR,
  20, FAST_ROUTE_COLOR,
];

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
// Road & path routing follows streets, footpaths, trails, and bikeways.
// OpenRouteService (VITE_ORS_API_KEY) is tried first when configured, with
// public OpenStreetMap OSRM (routed-foot / routed-bike) and Valhalla FOSSGIS
// fallbacks so auto-road-following works out of the box even without a key.
export const ROUTING = {
  baseUrl: 'https://api.openrouteservice.org/v2/directions',
  osrmUrls: {
    run: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
    walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
    hike: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
    ride: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
  },
  valhallaUrl: 'https://valhalla1.openstreetmap.de/route',
  nominatimUrl: 'https://nominatim.openstreetmap.org/search',
  timeoutMs: 8000, // give up on ORS after 8s so fallbacks can respond quickly
  fallbackTimeoutMs: 5000, // snappy per-provider timeout for OSRM / Valhalla
  orsSnapRadiusM: 1000, // generous road/trail snap tolerance per waypoint
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
