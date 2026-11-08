<script>
  import { sparkPath } from '../../lib/format.js';

  let { values = [], width = 92, height = 30, class: cls = '', stroke = '#f9569b' } = $props();

  let line = $derived(sparkPath(values, width, height));
  let area = $derived(line ? `${line} L${width},${height} L0,${height} Z` : '');
  let gid = $derived(`sp${Math.random().toString(36).slice(2, 8)}`);
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" fill="none" class={cls} aria-hidden="true">
  <defs>
    <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color={stroke} stop-opacity="0.28" />
      <stop offset="100%" stop-color={stroke} stop-opacity="0" />
    </linearGradient>
  </defs>
  {#if line}
    <path d={area} fill="url(#{gid})" />
    <path d={line} stroke={stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  {/if}
</svg>
