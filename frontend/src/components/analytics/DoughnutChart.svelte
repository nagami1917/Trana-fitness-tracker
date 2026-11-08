<script>
  import { onMount } from 'svelte';
  import Chart from 'chart.js/auto';
  import { PALETTE, tooltipStyle } from './theme.js';

  let { labels = [], values = [], colors = PALETTE, height = 200, cutout = '72%', class: cls = '' } = $props();

  let canvas;
  let chart;

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
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout,
        plugins: {
          legend: { display: false },
          tooltip: tooltipStyle,
        },
      },
    });
    return () => chart?.destroy();
  });

  $effect(() => {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.update('none');
    void colors;
  });
</script>

<div class="relative w-full" style="height:{height}px">
  <canvas bind:this={canvas} class={cls}></canvas>
</div>
