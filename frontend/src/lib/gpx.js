/**
 * GPX & TCX route import/export utilities for TRANA.
 *
 * Lets athletes upload watch/Strava `.gpx` or `.tcx` files directly in
 * Activities or Plan Activity, and export any planned/completed route as GPX 1.1.
 */

import { haversineKm } from '../services/mapService.js';

const escapeXml = (str = '') =>
  String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** Thin a point array evenly to `maxPoints` while preserving start and end. */
export function thinPoints(points, maxPoints = 400) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points ?? [];
  const out = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}

/** Compute positive elevation gain with a 2.5m hysteresis deadband against GPS noise. */
export function computeSmoothedElevationGain(altitudes = []) {
  const valid = altitudes.filter((a) => typeof a === 'number' && Number.isFinite(a));
  if (valid.length < 2) return 0;
  let gain = 0;
  let anchor = valid[0];
  for (let i = 1; i < valid.length; i += 1) {
    const ele = valid[i];
    if (ele > anchor + 2.5) {
      gain += ele - anchor;
      anchor = ele;
    } else if (ele < anchor - 2.5) {
      anchor = ele;
    }
  }
  return Math.round(gain);
}

/** Build a valid GPX 1.1 XML string from `[lat, lng]` route coordinates. */
export function exportGpx({
  name = 'TRANA Route',
  activityType = 'run',
  startedAt = new Date().toISOString(),
  route = [],
  elevations = [],
  elevationProfile = [],
} = {}) {
  const safeRoute = Array.isArray(route) ? route : [];
  const pts = safeRoute
    .map((pt, idx) => {
      const lat = Array.isArray(pt) ? Number(pt[0]) : Number(pt?.latitude);
      const lng = Array.isArray(pt) ? Number(pt[1]) : Number(pt?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
      const rawEle = elevations[idx]?.eleM ?? elevations[idx] ?? elevationProfile[idx]?.eleM ?? pt?.altitudeM;
      const ele = rawEle != null && rawEle !== '' ? Number(rawEle) : NaN;
      const eleTag = Number.isFinite(ele) ? `<ele>${ele.toFixed(1)}</ele>` : '';
      return `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">${eleTag}</trkpt>`;
    })
    .filter(Boolean)
    .join('\n');

  const safeDate = Number.isNaN(Date.parse(startedAt)) ? new Date().toISOString() : new Date(startedAt).toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TRANA" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${safeDate}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <type>${escapeXml(activityType)}</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadGpx(options = {}) {
  if (typeof document === 'undefined') return;
  const xml = exportGpx(options);
  const blob = new Blob([xml], { type: 'application/gpx+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const slug = String(options.name || 'trana-route')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'trana-route';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function mapSportTag(raw = '') {
  const s = String(raw).toLowerCase();
  if (s.includes('cycl') || s.includes('bik') || s.includes('ride')) return 'ride';
  if (s.includes('hik') || s.includes('trail')) return 'hike';
  if (s.includes('walk')) return 'walk';
  return 'run';
}

function parseWithRegex(text, isTcx) {
  const points = [];
  if (isTcx) {
    const tpRe = /<Trackpoint[^>]*>([\s\S]*?)<\/Trackpoint>/gi;
    let m;
    while ((m = tpRe.exec(text)) !== null) {
      const block = m[1];
      const latM = block.match(/<LatitudeDegrees>([^<]+)<\/LatitudeDegrees>/i);
      const lngM = block.match(/<LongitudeDegrees>([^<]+)<\/LongitudeDegrees>/i);
      if (!latM || !lngM) continue;
      const lat = Number(latM[1]);
      const lng = Number(lngM[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const eleM = block.match(/<AltitudeMeters>([^<]+)<\/AltitudeMeters>/i);
      const timeM = block.match(/<Time>([^<]+)<\/Time>/i);
      const hrM = block.match(/<HeartRateBpm[\s\S]*?<Value>([^<]+)<\/Value>/i);
      points.push({
        lat,
        lng,
        ele: eleM ? Number(eleM[1]) : null,
        time: timeM ? Date.parse(timeM[1]) : null,
        hr: hrM ? Number(hrM[1]) : null,
      });
    }
  } else {
    const ptRe = /<(trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/\1>|<(trkpt|rtept)\b([^>]*)\/>/gi;
    let m;
    while ((m = ptRe.exec(text)) !== null) {
      const attrs = m[2] || m[5] || '';
      const body = m[3] || '';
      const latM = attrs.match(/lat=["']([^"']+)["']/i);
      const lngM = attrs.match(/lon=["']([^"']+)["']/i);
      if (!latM || !lngM) continue;
      const lat = Number(latM[1]);
      const lng = Number(lngM[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const eleM = body.match(/<ele>([^<]+)<\/ele>/i);
      const timeM = body.match(/<time>([^<]+)<\/time>/i);
      const hrM = body.match(/<(?:[\w-]+:)?hr>([^<]+)<\/(?:[\w-]+:)?hr>/i);
      points.push({
        lat,
        lng,
        ele: eleM ? Number(eleM[1]) : null,
        time: timeM ? Date.parse(timeM[1]) : null,
        hr: hrM ? Number(hrM[1]) : null,
      });
    }
  }
  const typeMatch = text.match(/<type>([^<]+)<\/type>|Sport=["']([^"']+)["']/i);
  const nameMatch = text.match(/<name>([^<]+)<\/name>/i);
  return {
    points,
    activityType: mapSportTag(typeMatch?.[1] || typeMatch?.[2] || 'run'),
    name: nameMatch?.[1]?.trim() || '',
  };
}

/**
 * Parse `.gpx` or `.tcx` text into TRANA activity + route metrics.
 * Throws a clear error if fewer than 2 valid GPS trackpoints exist.
 */
export function parseActivityFile(text, fileName = '') {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('The uploaded file is empty.');
  }

  const lowerName = fileName.toLowerCase();
  const isTcx = lowerName.endsWith('.tcx') || /<TrainingCenterDatabase/i.test(text);

  let points = [];
  let activityType = 'run';
  let name = '';

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (!doc.querySelector('parsererror')) {
        if (isTcx) {
          const actEl = doc.querySelector('Activity');
          activityType = mapSportTag(actEl?.getAttribute('Sport') || 'run');
          name = doc.querySelector('Notes')?.textContent?.trim() || '';
          for (const tp of doc.querySelectorAll('Trackpoint')) {
            const lat = Number(tp.querySelector('Position > LatitudeDegrees')?.textContent);
            const lng = Number(tp.querySelector('Position > LongitudeDegrees')?.textContent);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            const eleRaw = tp.querySelector('AltitudeMeters')?.textContent;
            const timeRaw = tp.querySelector('Time')?.textContent;
            const hrRaw = tp.querySelector('HeartRateBpm > Value')?.textContent;
            points.push({
              lat,
              lng,
              ele: eleRaw != null ? Number(eleRaw) : null,
              time: timeRaw ? Date.parse(timeRaw) : null,
              hr: hrRaw != null ? Number(hrRaw) : null,
            });
          }
        } else {
          const trk = doc.querySelector('trk');
          name = trk?.querySelector('name')?.textContent?.trim()
            || doc.querySelector('metadata > name')?.textContent?.trim()
            || '';
          activityType = mapSportTag(trk?.querySelector('type')?.textContent || 'run');
          const nodes = doc.querySelectorAll('trkpt, rtept');
          for (const node of nodes) {
            const lat = Number(node.getAttribute('lat'));
            const lng = Number(node.getAttribute('lon'));
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            const eleRaw = node.querySelector('ele')?.textContent;
            const timeRaw = node.querySelector('time')?.textContent;
            const hrEl = [...node.getElementsByTagName('*')].find((el) => el.localName === 'hr');
            points.push({
              lat,
              lng,
              ele: eleRaw != null ? Number(eleRaw) : null,
              time: timeRaw ? Date.parse(timeRaw) : null,
              hr: hrEl ? Number(hrEl.textContent) : null,
            });
          }
        }
      }
    } catch {
      // Fallback to regex parser below
    }
  }

  if (points.length === 0) {
    const parsed = parseWithRegex(text, isTcx);
    points = parsed.points;
    activityType = parsed.activityType;
    name = name || parsed.name;
  }

  if (points.length < 2) {
    throw new Error('Could not find at least 2 GPS coordinates in this file.');
  }

  let distanceKm = 0;
  for (let i = 1; i < points.length; i += 1) {
    distanceKm += haversineKm([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
  }

  const altitudes = points.map((p) => (Number.isFinite(p.ele) ? p.ele : null));
  const elevationGainM = computeSmoothedElevationGain(altitudes);

  const validTimes = points.map((p) => p.time).filter((t) => typeof t === 'number' && Number.isFinite(t));
  const startedAt = validTimes.length > 0 ? new Date(validTimes[0]).toISOString() : new Date().toISOString();
  const endedAt = validTimes.length > 1 ? new Date(validTimes.at(-1)).toISOString() : null;
  let durationMin = 0;
  if (validTimes.length >= 2 && validTimes.at(-1) > validTimes[0]) {
    durationMin = Math.round(((validTimes.at(-1) - validTimes[0]) / 60000) * 10) / 10;
  }

  const hrs = points.map((p) => p.hr).filter((h) => typeof h === 'number' && Number.isFinite(h) && h >= 30 && h <= 240);
  const avgHeartRate = hrs.length > 0 ? Math.round(hrs.reduce((s, h) => s + h, 0) / hrs.length) : null;

  const thinned = thinPoints(points, 400);
  const route = thinned.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6]);
  const routeGeojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { activity_type: activityType, source: isTcx ? 'tcx' : 'gpx' },
        geometry: {
          type: 'LineString',
          coordinates: route.map(([lat, lng]) => [lng, lat]),
        },
      },
    ],
  };

  return {
    name,
    activityType,
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMin: durationMin >= 1 ? durationMin : null,
    elevationGainM,
    avgHeartRate,
    startedAt,
    endedAt,
    route,
    routeGeojson,
    elevationProfile: thinned
      .map((p, idx) => (Number.isFinite(p.ele) ? { index: idx, eleM: Math.round(p.ele) } : null))
      .filter(Boolean),
    source: isTcx ? 'tcx' : 'gpx',
  };
}
