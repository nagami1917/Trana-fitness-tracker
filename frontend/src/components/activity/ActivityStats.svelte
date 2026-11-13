<script>
  import { clock, formatDistance, formatDuration, formatPace, formatSpeed } from '../../lib/format.js';

  let {
    distanceKm = 0,
    durationMin = 0,
    durationSec = null,
    avgSpeedKmh = 0,
    avgPaceMinKm = 0,
    elevationGainM = 0,
    calories = 0,
  } = $props();

  let timeText = $derived(durationSec !== null ? clock(durationSec) : formatDuration(durationMin));

  let stats = $derived([
    { label: 'Distance', value: formatDistance(distanceKm), unit: ' km' },
    { label: 'Time', value: timeText, unit: '' },
    { label: 'Pace', value: formatPace(avgPaceMinKm), unit: avgPaceMinKm > 0 ? ' /km' : '' },
    { label: 'Speed', value: formatSpeed(avgSpeedKmh), unit: avgSpeedKmh > 0 ? ' km/h' : '' },
    { label: 'Elevation', value: String(Math.round(elevationGainM)), unit: ' m' },
    { label: 'Calories', value: String(Math.round(calories)), unit: ' kcal' },
  ]);
</script>

<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 w-full">
  {#each stats as stat (stat.label)}
    <div class="rounded-2xl border border-brand-100 bg-white px-3 py-2.5 shadow-soft sm:px-4 sm:py-3">
      <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">{stat.label}</p>
      <p class="mt-0.5 truncate font-display text-base font-extrabold text-ink-900 tabular-nums sm:text-lg">
        {stat.value}<span class="text-xs font-bold text-ink-400">{stat.unit}</span>
      </p>
    </div>
  {/each}
</div>
