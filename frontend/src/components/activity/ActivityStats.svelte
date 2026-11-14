<script>
  import { clock, formatDistance, formatDuration, formatPace, formatSpeed } from '../../lib/format.js';
  import { unitSystem } from '../../stores/index.js';
  import { distanceUnit, elevationUnit, paceUnit, speedUnit, toDisplayElevation } from '../../lib/units.js';

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
  let waitingForReliablePace = $derived(durationSec !== null && durationSec > 0 && distanceKm < 0.05);

  let stats = $derived([
    { label: 'Distance', value: formatDistance(distanceKm, $unitSystem), unit: ` ${distanceUnit($unitSystem)}` },
    { label: 'Time', value: timeText, unit: '' },
    { label: 'Pace', value: formatPace(avgPaceMinKm, $unitSystem), unit: avgPaceMinKm > 0 ? ` ${paceUnit($unitSystem)}` : '' },
    { label: 'Speed', value: formatSpeed(avgSpeedKmh, $unitSystem), unit: avgSpeedKmh > 0 ? ` ${speedUnit($unitSystem)}` : '' },
    { label: 'Elevation', value: String(Math.round(toDisplayElevation(elevationGainM, $unitSystem))), unit: ` ${elevationUnit($unitSystem)}` },
    { label: 'Calories', value: String(Math.round(calories)), unit: ' kcal' },
  ]);
</script>

<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 w-full">
  {#each stats as stat (stat.label)}
    <div class="card-flat px-3.5 py-3 sm:px-4">
      <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">{stat.label}</p>
      <p class="num-tabular mt-0.5 truncate font-display text-lg font-extrabold text-ink-900 sm:text-xl">
        {stat.value}<span class="text-xs font-bold text-ink-400">{stat.unit}</span>
      </p>
    </div>
  {/each}
</div>
{#if waitingForReliablePace}
  <p class="mt-2 text-center text-xs font-semibold text-ink-400" role="status">
    Pace and speed appear after 50 m of reliable GPS movement.
  </p>
{/if}
