/** Shared Chart.js styling for the TRANA pink theme. */
export const PINK = '#f9569b';
export const PINK_SOFT = 'rgba(249, 86, 155, 0.16)';
export const PALETTE = ['#f9569b', '#ff9ec4', '#ffc2d9', '#c084fc', '#fdba74'];

export const tooltipStyle = {
  backgroundColor: 'rgba(63, 35, 51, 0.94)',
  padding: 12,
  cornerRadius: 14,
  titleFont: { family: 'Quicksand, sans-serif', size: 12, weight: '700' },
  bodyFont: { family: 'Quicksand, sans-serif', size: 12, weight: '600' },
  displayColors: false,
};

export function baseOptions({ yTicks = (v) => v, showX = true, showY = true } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 8, right: 6, left: 0, bottom: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: tooltipStyle,
    },
    scales: {
      x: {
        display: showX,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: '#a98595',
          font: { family: 'Quicksand, sans-serif', size: 11, weight: '600' },
          maxRotation: 0,
          autoSkipPadding: 18,
        },
      },
      y: {
        display: showY,
        beginAtZero: true,
        grid: { color: 'rgba(255, 207, 228, 0.55)', drawTicks: false },
        border: { display: false },
        ticks: {
          color: '#a98595',
          font: { family: 'Quicksand, sans-serif', size: 11, weight: '600' },
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
