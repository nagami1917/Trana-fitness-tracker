<script>
  import { Mountain } from 'lucide-svelte';
  import { unitSystem } from '../../stores/index.js';
  import { distanceUnit, elevationUnit, toDisplayDistance, toDisplayElevation } from '../../lib/units.js';
  import Skeleton from '../common/Skeleton.svelte';

  let {
    profile = [], // [{ distKm, eleM }]
    gainM = 0,
    lossM = 0,
    source = 'dem', // 'dem' | 'gpx' | 'estimate'
    loading = false,
  } = $props();

  const valid = $derived(Array.isArray(profile) && profile.length >= 2);

  const stats = $derived.by(() => {
    if (!valid) return null;
    const eles = profile.map((p) => Number(p.eleM));
    const min = Math.min(...eles);
    const max = Math.max(...eles);
    const totalKm = Math.max(0.01, Number(profile.at(-1)?.distKm ?? 0));
    const span = Math.max(8, max - min);

    const W = 320;
    const H = 68;
    const padY = 6;
    const coords = profile.map((p, i) => {
      const x = profile.length > 1 ? (i / (profile.length - 1)) * W : 0;
      const y = H - padY - ((p.eleM - min) / span) * (H - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const linePath = `M${coords.join(' L')}`;
    const areaPath = `${linePath} L${W},${H} L0,${H} Z`;

    return { min, max, totalKm, linePath, areaPath, W, H };
  });
</script>

{#if loading && !valid}
  <div class="rounded-2xl border border-brand-100 bg-brand-50/40 p-3">
    <div class="mb-2 flex items-center justify-between">
      <span class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Elevation profile</span>
    </div>
    <Skeleton variant="chart" height={64} />
  </div>
{:else if valid && stats}
  <div class="rounded-2xl border border-brand-100 bg-brand-50/40 p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-ink-500">
        <Mountain size={13} class="text-brand-600" />
        Elevation profile
        <span class="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-brand-600 border border-brand-100">
          {source === 'gpx' ? 'GPX' : 'DEM terrain'}
        </span>
      </p>
      <p class="num-tabular text-[11px] font-bold text-ink-500">
        +{Math.round(toDisplayElevation(gainM, $unitSystem))} {elevationUnit($unitSystem)}
        {#if lossM > 0}
          · -{Math.round(toDisplayElevation(lossM, $unitSystem))} {elevationUnit($unitSystem)}
        {/if}
        · {Math.round(toDisplayElevation(stats.min, $unitSystem))}–{Math.round(toDisplayElevation(stats.max, $unitSystem))} {elevationUnit($unitSystem)}
      </p>
    </div>

    <svg viewBox="0 0 {stats.W} {stats.H}" class="mt-2 h-16 w-full overflow-visible" aria-label="Route elevation profile">
      <defs>
        <linearGradient id="trana-ele-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f97316" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#f97316" stop-opacity="0.03" />
        </linearGradient>
      </defs>
      <path d={stats.areaPath} fill="url(#trana-ele-grad)" />
      <path d={stats.linePath} fill="none" stroke="#ea580c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>

    <div class="num-tabular mt-1 flex justify-between text-[11px] font-semibold text-ink-400">
      <span>0 {distanceUnit($unitSystem)}</span>
      <span>{(toDisplayDistance(stats.totalKm, $unitSystem)).toFixed(1)} {distanceUnit($unitSystem)}</span>
    </div>
  </div>
{/if}
