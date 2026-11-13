/**
 * Lightweight pure-JavaScript Garmin `.FIT` binary protocol decoder.
 *
 * Extracts GPS trackpoints (`record` msg 20) and session metadata (`session` msg 18)
 * including semicircle coordinates, enhanced/legacy altitude, timestamps,
 * heart rate, total distance, duration, ascent, and sport without external dependencies.
 */

import { haversineKm } from '../services/mapService.js';

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);
const SEMICIRCLE_TO_DEG = 180 / 2147483648; // 180 / 2^31

const SPORT_MAP = {
  1: 'run',
  2: 'ride',
  5: 'ride',
  11: 'walk',
  17: 'hike',
};

function readBaseValue(view, offset, size, baseType, littleEndian) {
  const num = baseType & 0x1f;
  if (offset + size > view.byteLength) return null;
  switch (num) {
    case 0: // enum
    case 2: // uint8
    case 10: // uint8z
      return size >= 1 ? view.getUint8(offset) : null;
    case 1: // sint8
      return size >= 1 ? view.getInt8(offset) : null;
    case 3: // sint16
      return size >= 2 ? view.getInt16(offset, littleEndian) : null;
    case 4: // uint16
    case 11: // uint16z
      return size >= 2 ? view.getUint16(offset, littleEndian) : null;
    case 5: // sint32
      return size >= 4 ? view.getInt32(offset, littleEndian) : null;
    case 6: // uint32
    case 12: // uint32z
      return size >= 4 ? view.getUint32(offset, littleEndian) : null;
    case 8: // float32
      return size >= 4 ? view.getFloat32(offset, littleEndian) : null;
    case 9: // float64
      return size >= 8 ? view.getFloat64(offset, littleEndian) : null;
    default:
      return null;
  }
}

function isInvalidValue(val, baseType) {
  if (val === null || !Number.isFinite(val)) return true;
  const num = baseType & 0x1f;
  if (num === 0 || num === 2) return val === 0xff;
  if (num === 1) return val === 0x7f;
  if (num === 3) return val === 0x7fff;
  if (num === 4) return val === 0xffff;
  if (num === 5) return val === 0x7fffffff;
  if (num === 6) return val === 0xffffffff;
  if (num === 10 || num === 11 || num === 12) return val === 0;
  return false;
}

/**
 * Check whether an ArrayBuffer / Uint8Array looks like a Garmin FIT binary file.
 */
export function isFitBuffer(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.byteLength < 14) return false;
  const headerSize = bytes[0];
  if (headerSize !== 12 && headerSize !== 14) return false;
  return bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54; // ".FIT"
}

/**
 * Decode a `.fit` binary buffer into points + session metadata.
 */
export function decodeFit(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isFitBuffer(bytes)) {
    throw new Error('This file is not a valid Garmin .FIT binary.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0];
  const dataSize = view.getUint32(4, true);
  const dataEnd = Math.min(bytes.byteLength, headerSize + dataSize);

  const defs = new Map(); // localMsgType -> { globalMsg, littleEndian, fields, devFields }
  const points = [];
  let sessionMeta = {};
  let lastTimestamp = null;

  let offset = headerSize;
  while (offset < dataEnd) {
    const header = bytes[offset++];
    const isCompressedTimestamp = (header & 0x80) !== 0;

    if (isCompressedTimestamp) {
      const localType = (header >> 5) & 0x03;
      const timeOffset = header & 0x1f;
      if (lastTimestamp !== null) {
        const base = lastTimestamp & ~0x1f;
        lastTimestamp = timeOffset >= (lastTimestamp & 0x1f) ? base + timeOffset : base + 32 + timeOffset;
      }
      const def = defs.get(localType);
      if (!def) break;
      const rec = {};
      for (const f of def.fields) {
        const val = readBaseValue(view, offset, f.size, f.baseType, def.littleEndian);
        if (!isInvalidValue(val, f.baseType)) rec[f.num] = val;
        offset += f.size;
      }
      for (const df of def.devFields) offset += df.size;
      if (def.globalMsg === 20) pushRecord(rec, lastTimestamp, points);
      continue;
    }

    const isDefinition = (header & 0x40) !== 0;
    const hasDevData = (header & 0x20) !== 0;
    const localType = header & 0x0f;

    if (isDefinition) {
      offset += 1; // reserved
      const arch = bytes[offset++]; // 0 = little, 1 = big
      const littleEndian = arch === 0;
      const globalMsg = view.getUint16(offset, littleEndian);
      offset += 2;
      const numFields = bytes[offset++];
      const fields = [];
      for (let i = 0; i < numFields && offset + 3 <= dataEnd; i += 1) {
        fields.push({
          num: bytes[offset++],
          size: bytes[offset++],
          baseType: bytes[offset++],
        });
      }
      const devFields = [];
      if (hasDevData && offset < dataEnd) {
        const numDev = bytes[offset++];
        for (let i = 0; i < numDev && offset + 3 <= dataEnd; i += 1) {
          devFields.push({ num: bytes[offset++], size: bytes[offset++], devIdx: bytes[offset++] });
        }
      }
      defs.set(localType, { globalMsg, littleEndian, fields, devFields });
    } else {
      const def = defs.get(localType);
      if (!def) break;
      const rec = {};
      for (const f of def.fields) {
        const val = readBaseValue(view, offset, f.size, f.baseType, def.littleEndian);
        if (!isInvalidValue(val, f.baseType)) rec[f.num] = val;
        offset += f.size;
      }
      for (const df of def.devFields) offset += df.size;

      if (rec[253] != null) lastTimestamp = rec[253];
      if (def.globalMsg === 20) {
        pushRecord(rec, rec[253] ?? lastTimestamp, points);
      } else if (def.globalMsg === 18) {
        sessionMeta = {
          sport: SPORT_MAP[rec[5]] ?? sessionMeta.sport ?? 'run',
          totalDistanceKm: rec[9] != null ? rec[9] / 100000 : sessionMeta.totalDistanceKm, // 100 * m -> km = / 100_000
          durationMin: rec[7] != null ? rec[7] / 60000 : sessionMeta.durationMin, // 1000 * s -> min = / 60_000
          elevationGainM: rec[22] != null ? rec[22] : sessionMeta.elevationGainM,
          avgHeartRate: rec[16] != null ? rec[16] : sessionMeta.avgHeartRate,
          calories: rec[11] != null ? rec[11] : sessionMeta.calories,
          startTimeMs: rec[2] != null ? FIT_EPOCH_MS + rec[2] * 1000 : sessionMeta.startTimeMs,
        };
      }
    }
  }

  // Fallback distance from points if session didn't carry total_distance
  let pointDistKm = 0;
  for (let i = 1; i < points.length; i += 1) {
    pointDistKm += haversineKm([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
  }

  return {
    points,
    activityType: sessionMeta.sport || 'run',
    distanceKm: sessionMeta.totalDistanceKm ?? pointDistKm,
    durationMin: sessionMeta.durationMin ?? null,
    elevationGainM: sessionMeta.elevationGainM ?? null,
    avgHeartRate: sessionMeta.avgHeartRate ?? null,
    calories: sessionMeta.calories ?? null,
    startTimeMs: sessionMeta.startTimeMs ?? null,
  };
}

function pushRecord(rec, fitTimestamp, out) {
  const latRaw = rec[0];
  const lngRaw = rec[1];
  if (latRaw == null || lngRaw == null) return;
  const lat = latRaw * SEMICIRCLE_TO_DEG;
  const lng = lngRaw * SEMICIRCLE_TO_DEG;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

  const altRaw = rec[78] ?? rec[2]; // prefer enhanced_altitude (78), fallback altitude (2)
  const ele = altRaw != null ? altRaw / 5 - 500 : null;
  const hr = rec[3] != null && rec[3] >= 30 && rec[3] <= 240 ? rec[3] : null;
  const time = fitTimestamp != null ? FIT_EPOCH_MS + fitTimestamp * 1000 : null;

  out.push({ lat, lng, ele, hr, time });
}
