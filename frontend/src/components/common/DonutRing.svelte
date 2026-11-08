<script>
  let { value = 0, size = 148, thickness = 13, label = '', sublabel = '', track = '#ffe1ee' } = $props();

  const r = $derived((size - thickness) / 2);
  const c = $derived(2 * Math.PI * r);
  const dash = $derived((Math.min(100, Math.max(0, value)) / 100) * c);
  const gid = $derived(`dg${Math.random().toString(36).slice(2, 8)}`);
</script>

<div class="relative grid place-items-center" style="width:{size}px;height:{size}px">
  <svg width={size} height={size} class="-rotate-90">
    <defs>
      <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ff9ec4" />
        <stop offset="55%" stop-color="#fb5c9f" />
        <stop offset="100%" stop-color="#db2777" />
      </linearGradient>
    </defs>
    <circle cx={size / 2} cy={size / 2} {r} stroke={track} stroke-width={thickness} fill="none" />
    <circle
      cx={size / 2}
      cy={size / 2}
      {r}
      stroke="url(#{gid})"
      stroke-width={thickness}
      stroke-linecap="round"
      fill="none"
      stroke-dasharray="{dash} {c}"
      class="transition-all duration-700 ease-out"
    />
  </svg>
  <div class="absolute inset-0 grid place-items-center text-center">
    <div>
      <div class="font-display text-3xl font-extrabold leading-none text-ink-900">{label || `${Math.round(value)}%`}</div>
      {#if sublabel}
        <div class="mt-0.5 text-[11px] font-semibold text-ink-400">{sublabel}</div>
      {/if}
    </div>
  </div>
</div>
