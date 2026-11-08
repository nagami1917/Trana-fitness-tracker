<script>
  import { onMount } from 'svelte';
  import Chart from 'chart.js/auto';
  import { baseOptions, PINK } from './theme.js';

  let {
    labels = [],
    series = [],
    height = 240,
    fill = true,
    showY = true,
    showX = true,
    yTicks = (v) => v,
    tooltipLabel = null,
    class: cls = '',
  } = $props();

  let canvas;
  let chart;

  function buildDatasets() {
    return series.map((s, index) => ({
      label: s.label,
      data: s.data,
      borderColor: s.color ?? (index === 0 ? PINK : '#c084fc'),
      borderWidth: s.borderWidth ?? 2.6,
      tension: 0.42,
      fill: fill && (s.fill ?? index === 0),
      pointRadius: s.pointRadius ?? 0,
      pointHoverRadius: 5,
      pointBackgroundColor: '#fff',
      pointBorderColor: s.color ?? PINK,
      pointBorderWidth: 2.5,
      borderDash: s.dashed ? [6, 6] : undefined,
      backgroundColor: (context) => {
        const { ctx, chartArea } = context.chart;
        if (!chartArea) return 'transparent';
        const color = (s.color ?? PINK).startsWith('#')
          ? hexToRgbTemplate(s.color ?? PINK)
          : 'rgba(249, 86, 155, ALPHA)';
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, color.replace('ALPHA', '0.30'));
        gradient.addColorStop(1, color.replace('ALPHA', '0.01'));
        return gradient;
      },
    }));
  }

  function hexToRgbTemplate(hex) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ALPHA)`;
  }

  const options = () => {
    const base = baseOptions({ yTicks, showX, showY });
    if (tooltipLabel) {
      base.plugins.tooltip.callbacks = { label: (ctx) => tooltipLabel(ctx) };
    }
    return base;
  };

  onMount(() => {
    chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: buildDatasets() },
      options: options(),
    });
    return () => chart?.destroy();
  });

  $effect(() => {
    if (!chart) return;
    const nextLabels = labels;
    const nextSeries = series;
    chart.data.labels = nextLabels;
    chart.data.datasets = buildDatasets();
    chart.options = options();
    chart.update('none');
    void nextSeries;
  });
</script>

<div class="relative w-full" style="height:{height}px">
  <canvas bind:this={canvas} class={cls}></canvas>
</div>
