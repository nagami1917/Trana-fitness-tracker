/**
 * True GPS split analyzer + Minetti Grade-Adjusted Pace (GAP) & elevation scrub lookup.
 */

import { haversineKm } from '../../services/mapService.js';
import { KM_TO_MI } from '../units.js';

/**
 * Minetti energy-cost polynomial factor relative to flat running (grade as decimal, e.g. 0.05 = 5%).
 * Clamped to [-0.35, 0.35] to keep GPS elevation spikes sensible.
 */
export function gradeCostFactor(gradeDecimal) {
  const i = Math.max(-0.35, Math.min(0.35, Number(gradeDecimal) || 0));
  const cost = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
  return Math.max(0.55, Math.min(3.5, cost / 3.6));
}

function normalizeTrackPoint(pt) {
  if (Array.isArray(pt) && pt.length >= 2) {
    return { lat: Number(pt[0]), lng: Number(pt[1]), ele: pt[2] != null ? Number(pt[2]) : null, t: null, hr: null };
  }
  if (pt && typeof pt === 'object') {
    const lat = Number(pt.latitude ?? pt.lat);
    const lng = Number(pt.longitude ?? pt.lng);
    const ele = pt.elevation_m ?? pt.altitudeM ?? pt.ele ?? null;
    const rawT = pt.recorded_at ?? pt.recordedAt ?? pt.time ?? pt.t ?? null;
    const t = typeof rawT === 'number' ? rawT : rawT ? Date.parse(rawT) : null;
    const hr = pt.heart_rate ?? pt.hr ?? null;
    return {
      lat,
      lng,
      ele: ele != null && Number.isFinite(Number(ele)) ? Number(ele) : null,
      t: t != null && Number.isFinite(t) ? t : null,
      hr: hr != null && Number.isFinite(Number(hr)) ? Number(hr) : null,
    };
  }
  return null;
}

/**
 * Compute per-km or per-mile splits from GPS points (or route + elevation profile fallback).
 */
export function computeGpsSplits({
  points = [],
  elevationProfile = [],
  totalDurationMin = 0,
  totalDistanceKm = 0,
  unit = 'metric',
} = {}) {
  const norm = (Array.isArray(points) ? points : [])
    .map(normalizeTrackPoint)
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const splitSizeKm = unit === 'imperial' ? 1 / KM_TO_MI : 1.0;

  if (norm.length < 2) {
    const dist = Math.max(0, Number(totalDistanceKm) || 0);
    if (dist <= 0 || totalDurationMin <= 0) return [];
    const basePace = totalDurationMin / dist;
    const count = Math.min(50, Math.ceil(dist / splitSizeKm));
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const segKm = Math.min(splitSizeKm, dist - i * splitSizeKm);
      if (segKm <= 0.02) break;
      out.push({
        split: i + 1,
        distanceKm: segKm,
        durationMin: basePace * segKm,
        paceMinPerKm: basePace,
        gapMinPerKm: basePace,
        gainM: 0,
        lossM: 0,
        gradePct: 0,
        avgHr: null,
        hasTimestamps: false,
      });
    }
    return out;
  }

  // Merge elevation profile onto points when points lack embedded elevation
  const hasPointEle = norm.some((p) => p.ele !== null);
  if (!hasPointEle && Array.isArray(elevationProfile) && elevationProfile.length >= 2) {
    for (let i = 0; i < norm.length; i += 1) {
      const profIdx = Math.min(
        elevationProfile.length - 1,
        Math.round((i / Math.max(1, norm.length - 1)) * (elevationProfile.length - 1)),
      );
      const eleM = Number(elevationProfile[profIdx]?.eleM);
      if (Number.isFinite(eleM)) norm[i].ele = eleM;
    }
  }

  const hasTimestamps = norm.filter((p) => p.t !== null).length >= Math.max(2, Math.floor(norm.length * 0.5));
  let totalTrackKm = 0;
  const enriched = [{ ...norm[0], cumKm: 0 }];
  for (let i = 1; i < norm.length; i += 1) {
    const segKm = haversineKm([norm[i - 1].lat, norm[i - 1].lng], [norm[i].lat, norm[i].lng]);
    totalTrackKm += segKm;
    enriched.push({ ...norm[i], cumKm: totalTrackKm });
  }
  if (totalTrackKm <= 0.02) return [];

  const avgPace = totalDurationMin > 0 ? totalDurationMin / totalTrackKm : 6.0;
  const splits = [];
  let bucketStartIdx = 0;
  let nextBoundaryKm = splitSizeKm;
  let splitNum = 1;

  const finalizeBucket = (startIdx, endIdx) => {
    const startPt = enriched[startIdx];
    const endPt = enriched[endIdx];
    const distKm = endPt.cumKm - startPt.cumKm;
    if (distKm <= 0.02) return;

    let gainM = 0;
    let lossM = 0;
    const hrs = [];
    for (let k = startIdx + 1; k <= endIdx; k += 1) {
      const prev = enriched[k - 1];
      const curr = enriched[k];
      if (prev.ele !== null && curr.ele !== null) {
        const diff = curr.ele - prev.ele;
        if (diff > 0) gainM += diff;
        else lossM += Math.abs(diff);
      }
      if (curr.hr !== null) hrs.push(curr.hr);
    }

    const netEleM = startPt.ele !== null && endPt.ele !== null ? endPt.ele - startPt.ele : gainM - lossM;
    const gradeDec = netEleM / (distKm * 1000);
    const costFactor = gradeCostFactor(gradeDec);

    let durationMin;
    if (hasTimestamps && startPt.t !== null && endPt.t !== null && endPt.t > startPt.t) {
      durationMin = (endPt.t - startPt.t) / 60000;
    } else {
      durationMin = avgPace * distKm * (1 + (costFactor - 1) * 0.55);
    }
    const paceMinPerKm = durationMin / distKm;
    const gapMinPerKm = paceMinPerKm / costFactor;

    splits.push({
      split: splitNum++,
      distanceKm: Math.round(distKm * 100) / 100,
      durationMin: Math.round(durationMin * 100) / 100,
      paceMinPerKm: Math.round(paceMinPerKm * 100) / 100,
      gapMinPerKm: Math.round(gapMinPerKm * 100) / 100,
      gainM: Math.round(gainM),
      lossM: Math.round(lossM),
      gradePct: Math.round(gradeDec * 1000) / 10,
      avgHr: hrs.length ? Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length) : null,
      hasTimestamps,
    });
  };

  for (let i = 1; i < enriched.length; i += 1) {
    if (enriched[i].cumKm >= nextBoundaryKm) {
      finalizeBucket(bucketStartIdx, i);
      bucketStartIdx = i;
      nextBoundaryKm += splitSizeKm;
    }
  }
  if (bucketStartIdx < enriched.length - 1) {
    finalizeBucket(bucketStartIdx, enriched.length - 1);
  }

  return splits;
}

/**
 * Given a fractional progress [0..1] along a route, return the interpolated [lat, lng].
 */
export function interpolateRoutePosition(route = [], progress = 0) {
  if (!Array.isArray(route) || route.length === 0) return null;
  if (route.length === 1) return [Number(route[0][0]), Number(route[0][1])];
  const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  const segLengths = [];
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    const d = haversineKm(route[i - 1], route[i]);
    segLengths.push(d);
    total += d;
  }
  if (total <= 0) return [Number(route[0][0]), Number(route[0][1])];
  const target = clamped * total;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i += 1) {
    const seg = segLengths[i];
    if (acc + seg >= target || i === segLengths.length - 1) {
      const frac = seg > 0 ? Math.max(0, Math.min(1, (target - acc) / seg)) : 0;
      const a = route[i];
      const b = route[i + 1];
      return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
    }
    acc += seg;
  }
  return route.at(-1);
}
