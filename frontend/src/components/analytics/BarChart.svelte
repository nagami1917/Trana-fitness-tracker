<script>
  import { onMount } from 'svelte';
  import Chart from 'chart.js/auto';
  import { baseOptions, PINK } from './theme.js';
  import { theme } from '../../lib/theme.js';

  let {
    labels = [],
    series = [],
    height = 220,
    stacked = false,
    showX = true,
    showY = true,
    yTicks = (v) => v,
    tooltipLabel = null,
    maxBarThickness = 26,
    class: cls = '',
  } = $props();

  let canvas;
  let chart;

  const build = () =>
    series.map((s, index) => ({
      label: s.label,
      data: s.data,
      backgroundColor: s.colors ?? s.color ?? (index === 0 ? PINK : '#ffc2d9'),
      borderRadius: 8,
      borderSkipped: false,
      maxBarThickness,
      hoverBackgroundColor: s.hoverColor ?? '#db2777',
    }));

  const options = () => {
    const base = baseOptions({ yTicks, showX, showY });
    base.scales.x.stacked = stacked;
    base.scales.y.stacked = stacked;
    if (tooltipLabel) base.plugins.tooltip.callbacks = { label: (ctx) => tooltipLabel(ctx) };
    return base;
  };

  onMount(() => {
    chart = new Chart(canvas, { type: 'bar', data: { labels, datasets: build() }, options: options() });
    return () => chart?.destroy();
  });

  $effect(() => {
    void $theme;
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets = build();
    chart.options = options();
    chart.update('none');
    void series;
  });
</script>

<div class="relative w-full" style="height:{height}px">
  <canvas bind:this={canvas} class={cls}></canvas>
</div>
