<script>
  import { formatDistance, formatDuration, formatPace, formatSpeed } from '../../lib/format.js';

  let {
    distanceKm = 0,
    durationMin = 0,
    avgSpeedKmh = 0,
    avgPaceMinKm = 0,
    elevationGainM = 0,
    calories = 0,
  } = $props();
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-4 w-full max-w-xs mx-auto">
  {#each [
    { label: 'Distance', value: formatDistance(distanceKm), unit: 'km' },
    { label: 'Time', value: formatDuration(durationMin), unit: '' },
    { label: 'Pace', value: formatPace(avgPaceMinKm), unit: '/km' },
    { label: 'Speed', value: formatSpeed(avgSpeedKmh), unit: 'km/h' },
  ] as stat (stat.label)}
    <div class="rounded-2xl border border-brand-100 bg-white p-3 shadow-soft">
      <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">{stat.label}</p>
      <p class="mt-0.5 font-display text-lg font-extrabold text-ink-900">
        {stat.value}<span class="text-xs font-bold text-ink-400">{stat.unit}</span>
      </p>
    </div>
  {/each}

  {#if elevationGainM > 0}
    <div class="rounded-2xl border border-brand-100 bg-white p-3 shadow-soft">
      <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Elevation</p>
      <p class="mt-0.5 font-display text-lg font-extrabold text-ink-900">
        {Math.round(elevationGainM)}<span class="text-xs font-bold text-ink-400"> m</span>
      </p>
    </div>
  {/if}

  {#if calories > 0}
    <div class="rounded-2xl border border-brand-100 bg-white p-3 shadow-soft">
      <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Calories</p>
      <p class="mt-0.5 font-display text-lg font-extrabold text-ink-900">
        {Math.round(calories)}<span class="text-xs font-bold text-ink-400"> kcal</span>
      </p>
    </div>
  {/if}
</div>