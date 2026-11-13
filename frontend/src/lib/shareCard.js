/**
 * Branded 1080×1080 PNG Activity Share Card renderer using HTML5 Canvas.
 */

import { duration as fmtDuration, pace, speed, kcal, km, fullDate } from './format.js';

/**
 * Draw an activity share card onto an HTMLCanvasElement (or offscreen canvas) and return data URL / Blob.
 */
export function renderActivityShareCard({
  activity,
  unit = 'metric',
  carbsG = null,
  athleteName = 'TRANA Athlete',
} = {}) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Background gradient (high-contrast berry pink -> deep plum)
  const bg = ctx.createLinearGradient(0, 0, 1080, 1080);
  bg.addColorStop(0, '#3f2333');
  bg.addColorStop(0.55, '#6b1d45');
  bg.addColorStop(1, '#be185d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1080, 1080);

  // Subtle decorative glow orbs
  ctx.fillStyle = 'rgba(249, 86, 155, 0.16)';
  ctx.beginPath();
  ctx.arc(890, 180, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(170, 910, 220, 0, Math.PI * 2);
  ctx.fill();

  // Header brand pill
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  roundRect(ctx, 72, 72, 230, 52, 26);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 24px Poppins, Quicksand, sans-serif';
  ctx.fillText('TRANA', 108, 107);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.font = '600 22px Quicksand, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(athleteName, 1008, 106);
  ctx.textAlign = 'left';

  // Activity title + date
  const actType = (activity?.activity_type || 'run').toUpperCase();
  ctx.fillStyle = '#f9a8d4';
  ctx.font = '800 22px Quicksand, sans-serif';
  ctx.fillText(`${actType} SUMMARY`, 72, 188);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 32px Quicksand, sans-serif';
  ctx.fillText(activity?.started_at ? fullDate(activity.started_at) : 'Today', 72, 234);

  // Route silhouette panel
  roundRect(ctx, 72, 278, 936, 370, 36);
  ctx.fillStyle = 'rgba(15, 19, 29, 0.42)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawRouteTrace(ctx, activity?.route, 120, 316, 840, 294);

  // Primary distance hero
  const distText = `${km(activity?.distance_km ?? 0, unit)} ${unit === 'imperial' ? 'mi' : 'km'}`;
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 84px Poppins, sans-serif';
  ctx.fillText(distText, 72, 756);

  // Metric tiles
  const isPaceSport = ['run', 'walk', 'hike'].includes(activity?.activity_type);
  const paceOrSpeed = activity?.distance_km > 0 && activity?.duration_min > 0
    ? isPaceSport
      ? pace(activity.duration_min / activity.distance_km, unit)
      : speed(activity.distance_km / (activity.duration_min / 60), unit)
    : '—';

  const metrics = [
    { label: 'DURATION', value: fmtDuration(activity?.duration_min ?? 0) },
    { label: isPaceSport ? 'AVG PACE' : 'AVG SPEED', value: paceOrSpeed },
    { label: 'ENERGY', value: `${kcal(activity?.calories ?? 0)} kcal` },
    { label: carbsG ? 'CARBS TARGET' : 'ELEV GAIN', value: carbsG ? `${carbsG} g` : `+${Math.round(activity?.elevation_gain_m ?? 0)} m` },
  ];

  const cardW = 216;
  metrics.forEach((m, i) => {
    const x = 72 + i * (cardW + 24);
    const y = 804;
    roundRect(ctx, x, y, cardW, 152, 24);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fill();
    ctx.fillStyle = '#fbcfe8';
    ctx.font = '800 17px Quicksand, sans-serif';
    ctx.fillText(m.label, x + 22, y + 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 30px Poppins, sans-serif';
    ctx.fillText(String(m.value), x + 22, y + 104);
  });

  // Footer
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '600 20px Quicksand, sans-serif';
  ctx.fillText('Plan the effort. Know the fuel.', 72, 1020);

  return canvas;
}

export function downloadShareCard(options = {}) {
  const canvas = renderActivityShareCard(options);
  if (!canvas) return false;
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `trana-${options.activity?.activity_type || 'activity'}-${options.activity?.id || 'card'}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

function drawRouteTrace(ctx, route, x, y, w, h) {
  if (!Array.isArray(route) || route.length < 2) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '700 24px Quicksand, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Activity logged without GPS route', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    return;
  }

  const lats = route.map((p) => Number(p[0]));
  const lngs = route.map((p) => Number(p[1]));
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = Math.max(0.0005, maxLat - minLat);
  const spanLng = Math.max(0.0005, maxLng - minLng);
  const scale = Math.min(w / spanLng, h / spanLat);
  const offsetX = x + (w - spanLng * scale) / 2;
  const offsetY = y + (h - spanLat * scale) / 2;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(249, 86, 155, 0.35)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  route.forEach(([lat, lng], idx) => {
    const px = offsetX + (lng - minLng) * scale;
    const py = offsetY + (maxLat - lat) * scale;
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.strokeStyle = '#ff85b8';
  ctx.lineWidth = 6;
  ctx.stroke();

  // Start & end dots
  const startPx = offsetX + (route[0][1] - minLng) * scale;
  const startPy = offsetY + (maxLat - route[0][0]) * scale;
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(startPx, startPy, 10, 0, Math.PI * 2);
  ctx.fill();

  const endPt = route[route.length - 1];
  const endPx = offsetX + (endPt[1] - minLng) * scale;
  const endPy = offsetY + (maxLat - endPt[0]) * scale;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(endPx, endPy, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
