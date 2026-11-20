/** Shared Chart.js styling for TRANA (adapts to light and outdoor dark themes). */
export const LIME = '#b7f34a';
export const PINK = LIME; // legacy alias kept for existing imports
export const PINK_SOFT = 'rgba(183, 243, 74, 0.18)';

export const SPORT_COLORS = {
  run: '#b7f34a',   // Lime
  ride: '#5fd4e8',  // Cyan
  walk: '#7d9bc4',  // Muted Blue
  hike: '#45c78a',  // Success Green
};

export const PALETTE = [SPORT_COLORS.run, SPORT_COLORS.ride, SPORT_COLORS.walk, SPORT_COLORS.hike, '#ffb547'];

export function chartColors() {
  if (typeof document === 'undefined') {
    return {
      tick: '#a6b3c2',
      grid: 'rgba(125, 155, 196, 0.18)',
      pointBg: '#ffffff',
      tooltipBg: 'rgba(10, 18, 30, 0.96)',
      tooltipText: '#ffffff',
    };
  }
  const isDark = document.documentElement.classList.contains('theme-dark');
  const css = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
  const read = (name, fallback) => css?.getPropertyValue(name)?.trim() || fallback;
  return {
    tick: read('--chart-tick', isDark ? '#cbd5e1' : '#a6b3c2'),
    grid: read('--chart-grid', isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(255, 169, 205, 0.42)'),
    pointBg: read('--chart-point-bg', isDark ? '#1a2940' : '#1a2940'),
    tooltipBg: read('--chart-tooltip-bg', isDark ? 'rgba(15, 19, 29, 0.96)' : 'rgba(63, 35, 51, 0.94)'),
    tooltipText: read('--chart-tooltip-text', isDark ? '#ffffff' : '#ffffff'),
  };
}

export function tooltipStyle() {
  const c = chartColors();
  return {
    backgroundColor: c.tooltipBg,
    titleColor: c.tooltipText,
    bodyColor: c.tooltipText,
    padding: 12,
    cornerRadius: 14,
    titleFont: { family: 'Space Grotesk, Inter, sans-serif', size: 12, weight: '700' },
    bodyFont: { family: 'Space Grotesk, Inter, sans-serif', size: 12, weight: '600' },
    displayColors: false,
  };
}

export function baseOptions({ yTicks = (v) => v, showX = true, showY = true } = {}) {
  const c = chartColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 8, right: 6, left: 0, bottom: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: tooltipStyle(),
    },
    scales: {
      x: {
        display: showX,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: c.tick,
          font: { family: 'Space Grotesk, Inter, sans-serif', size: 11, weight: '600' },
          maxRotation: 0,
          autoSkipPadding: 18,
        },
      },
      y: {
        display: showY,
        beginAtZero: true,
        grid: { color: c.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: c.tick,
          font: { family: 'Space Grotesk, Inter, sans-serif', size: 11, weight: '600' },
          padding: 8,
          callback: (value) => yTicks(value),
        },
      },
    },
  };
}

export function verticalGradient(ctx, area, color, topAlpha = 0.35) {
  if (!area) return color;
  const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, color.replace('ALPHA', String(topAlpha)));
  gradient.addColorStop(1, color.replace('ALPHA', '0'));
  return gradient;
}
