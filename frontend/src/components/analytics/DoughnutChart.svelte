<script>
  import { onMount } from 'svelte';
  import Chart from 'chart.js/auto';
  import { PALETTE, tooltipStyle } from './theme.js';
  import { theme } from '../../lib/theme.js';

  let { labels = [], values = [], colors = PALETTE, height = 200, cutout = '72%', class: cls = '' } = $props();

  let canvas;
  let chart;

  const options = () => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout,
    plugins: {
      legend: { display: false },
      tooltip: tooltipStyle(),
    },
  });

  onMount(() => {
    chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 6,
            spacing: 2,
          },
        ],
      },
      options: options(),
    });
    return () => chart?.destroy();
  });

  $effect(() => {
    void $theme;
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].backgroundColor = colors;
    chart.options = options();
    chart.update('none');
  });
</script>

<div class="relative w-full" style="height:{height}px">
  <canvas bind:this={canvas} class={cls}></canvas>
</div>
