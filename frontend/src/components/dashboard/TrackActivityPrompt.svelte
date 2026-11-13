<script>
  import {
    Activity,
    ArrowRight,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    LoaderCircle,
    MapPin,
    Pause,
    Play,
    RotateCcw,
    Square,
    X,
    XCircle,
  } from 'lucide-svelte';
  import Card from '../common/Card.svelte';
  import ActivityIcon from '../activities/ActivityIcon.svelte';
  import RouteMap from '../route/RouteMap.svelte';
  import GPSStatus from '../activity/GPSStatus.svelte';
  import { activities, unitSystem } from '../../stores/index.js';
  import { navigate } from '../../lib/router.js';
  import { liveTracker } from '../../lib/liveTracker.svelte.js';
  import { livePosition } from '../../lib/liveLocation.svelte.js';
  import {
    activityLabel,
    clock,
    dayLabel,
    duration as fmtDuration,
    elevationWithUnit,
    formatDistance,
    formatPace,
    formatSpeed,
    kcal,
    timeLabel,
  } from '../../lib/format.js';
  import { distanceUnit, paceUnit, speedUnit } from '../../lib/units.js';

  let { fallbackCenter = [14.676, 121.0437] } = $props();

  let historyMapExpanded = $state(false);

  const liveUserPos = $derived(
    liveTracker.currentPosition ??
      (livePosition.current &&
      Number.isFinite(livePosition.current.latitude) &&
      Number.isFinite(livePosition.current.longitude)
        ? [livePosition.current.latitude, livePosition.current.longitude]
        : null),
  );

  const mapCenter = $derived(liveUserPos ?? fallbackCenter);

  const latestGpsActivity = $derived($activities.find((a) => a.source === 'gps') ?? null);

  const view = $derived.by(() => {
    if (liveTracker.tracking) {
      const status = liveTracker.saving ? 'saving' : liveTracker.paused ? 'paused' : 'tracking';
      return {
        isLive: true,
        fromHistory: false,
        status,
        statusLabel: status === 'saving' ? 'Saving…' : status === 'paused' ? 'Paused' : 'In progress',
        activity_type: liveTracker.activityType,
        pathLabel: liveTracker.plannedLabel || 'Free GPS',
        started_at: liveTracker.startedAtIso,
        ended_at: null,
        route: liveTracker.recordedCoords,
        plannedPath: liveTracker.plannedPath,
        distance_km: liveTracker.distanceKm,
        duration_sec: liveTracker.durationSec,
        duration_min: liveTracker.durationMin,
        pace_min_km: liveTracker.avgPaceMinKm,
        speed_kmh: liveTracker.avgSpeedKmh,
        elevation_gain_m: liveTracker.elevationM,
        calories: liveTracker.estimatedCalories,
        gpsStatus: liveTracker.gpsStatus,
        gpsMessage: liveTracker.gpsMessage,
        note: liveTracker.statusNote,
      };
    }

    const outcome = liveTracker.lastOutcome;
    if (outcome) {
      const stillExists =
        outcome.status !== 'completed' ||
        outcome.activityId == null ||
        $activities.some((a) => String(a.id) === String(outcome.activityId));

      if (stillExists) {
        const dKm = Number(outcome.distance_km) || 0;
        const dMin = Number(outcome.duration_min) || 0;
        const paceVal = outcome.average_pace ?? (dKm > 0 && dMin > 0 ? dMin / dKm : 0);
        const speedVal = outcome.average_speed ?? (dKm > 0 && dMin > 0 ? dKm / (dMin / 60) : 0);
        return {
          isLive: false,
          fromHistory: false,
          status: outcome.status,
          statusLabel: outcome.status === 'completed' ? 'Completed & saved' : 'Discarded',
          activity_type: outcome.activity_type || 'run',
          pathLabel: outcome.plannedLabel || 'Free GPS',
          started_at: outcome.started_at,
          ended_at: outcome.ended_at,
          route: Array.isArray(outcome.route) ? outcome.route : [],
          plannedPath: Array.isArray(outcome.plannedPath) ? outcome.plannedPath : [],
          distance_km: dKm,
          duration_sec: outcome.duration_sec ?? null,
          duration_min: dMin,
          pace_min_km: paceVal,
          speed_kmh: speedVal,
          elevation_gain_m: Number(outcome.elevation_gain_m) || 0,
          calories: Number(outcome.calories) || 0,
          gpsStatus: 'idle',
          gpsMessage: '',
          note: outcome.note || '',
        };
      }
    }

    if (latestGpsActivity) {
      const dKm = Number(latestGpsActivity.distance_km) || 0;
      const dMin = Number(latestGpsActivity.duration_min) || 0;
      const paceVal = latestGpsActivity.average_pace ?? (dKm > 0 && dMin > 0 ? dMin / dKm : 0);
      const speedVal = latestGpsActivity.average_speed ?? (dKm > 0 && dMin > 0 ? dKm / (dMin / 60) : 0);
      return {
        isLive: false,
        fromHistory: true,
        status: 'completed',
        statusLabel: 'Completed & saved',
        activity_type: latestGpsActivity.activity_type || 'run',
        pathLabel: 'GPS tracked',
        started_at: latestGpsActivity.started_at,
        ended_at: latestGpsActivity.ended_at,
        route: Array.isArray(latestGpsActivity.route) ? latestGpsActivity.route : [],
        plannedPath: [],
        distance_km: dKm,
        duration_sec: null,
        duration_min: dMin,
        pace_min_km: paceVal,
        speed_kmh: speedVal,
        elevation_gain_m: Number(latestGpsActivity.elevation_gain_m) || 0,
        calories: Number(latestGpsActivity.calories) || 0,
        gpsStatus: 'idle',
        gpsMessage: '',
        note: 'Latest Track Activity result synced to Activities & Today’s Summary.',
      };
    }

    return null;
  });

  const metricTiles = $derived.by(() => {
    if (!view) return [];
    const timeText = view.duration_sec !== null ? clock(view.duration_sec) : fmtDuration(view.duration_min);
    return [
      { label: 'Distance', value: `${formatDistance(view.distance_km, $unitSystem)} ${distanceUnit($unitSystem)}` },
      { label: 'Time', value: timeText },
      { label: 'Pace', value: view.pace_min_km > 0 ? `${formatPace(view.pace_min_km, $unitSystem)} ${paceUnit($unitSystem)}` : '—:—' },
      { label: 'Speed', value: view.speed_kmh > 0 ? `${formatSpeed(view.speed_kmh, $unitSystem)} ${speedUnit($unitSystem)}` : '—' },
      { label: 'Elevation', value: elevationWithUnit(view.elevation_gain_m, $unitSystem) },
      { label: 'Calories', value: `${kcal(view.calories)} kcal` },
    ];
  });

  const mapBadge = $derived.by(() => {
    if (!view) return '';
    if (view.isLive) {
      if (view.route.length >= 2) return `Live map · ${view.route.length} GPS pts`;
      if (view.route.length === 1) return 'Start pinned · Waiting for movement';
      if (view.plannedPath.length >= 2) return 'Planned route · Waiting for GPS';
      return 'GPS map · Locating…';
    }
    if (view.route.length >= 2) return `Recorded map · ${view.route.length} pts`;
    if (view.route.length === 1) return 'Start location pinned';
    return 'No GPS path recorded';
  });

  const whenSummary = $derived.by(() => {
    if (!view?.started_at) return '';
    if (view.isLive) return `Started ${timeLabel(view.started_at)}`;
    const startPart = `${dayLabel(view.started_at)}, ${timeLabel(view.started_at)}`;
    return view.ended_at ? `${startPart} → ${timeLabel(view.ended_at)}` : startPart;
  });
</script>

{#if !view}
  <!-- Compact Tier-1 idle banner -->
  <Card flat class="!p-3.5 sm:!p-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-100/70 text-brand-600">
          <MapPin size={19} />
        </span>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-sm sm:text-base font-extrabold text-ink-900">Track Activity</h2>
            <span class="rounded-full bg-brand-100/80 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-brand-700">
              Ready
            </span>
          </div>
          <p class="mt-0.5 truncate text-xs font-semibold text-ink-400">
            Live GPS map, timer, distance, pace, and fueling checkpoints sync automatically here.
          </p>
        </div>
      </div>

      <button
        type="button"
        class="btn-ghost w-full shrink-0 !py-2 !px-3.5 !text-xs font-extrabold text-brand-600 sm:w-auto"
        onclick={() => navigate('/track')}
      >
        <Play size={13} fill="currentColor" /> Start in Track Activity
      </button>
    </div>
  </Card>
{:else if view.fromHistory && !historyMapExpanded}
  <!-- Compact Tier-1 summary bar when returning to Dashboard with a past GPS session (avoids dual maps above the fold) -->
  <Card flat class="!p-3.5 sm:!p-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3 min-w-0">
        <ActivityIcon type={view.activity_type} size="md" />
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-sm sm:text-base font-extrabold text-ink-900">
              Last GPS Track · {activityLabel(view.activity_type)}
            </h2>
            <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700">
              <CheckCircle2 size={11} /> {view.statusLabel}
            </span>
          </div>
          <p class="num-tabular mt-0.5 truncate text-xs font-semibold text-ink-400">
            {formatDistance(view.distance_km, $unitSystem)} {distanceUnit($unitSystem)} · {fmtDuration(view.duration_min)} · {kcal(view.calories)} kcal{#if whenSummary} · {whenSummary}{/if}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          class="btn-ghost !py-2 !px-3 !text-xs"
          onclick={() => (historyMapExpanded = true)}
        >
          <ChevronDown size={13} /> Map preview
        </button>
        <button
          type="button"
          class="btn-ghost !py-2 !px-3 !text-xs font-extrabold text-brand-600"
          onclick={() => navigate('/track')}
        >
          <Activity size={13} /> Track new activity
        </button>
      </div>
    </div>
  </Card>
{:else}
  <Card class="!p-4 sm:!p-5 border {view.isLive ? 'border-emerald-200 bg-gradient-to-br from-white via-white to-emerald-50/40' : view.status === 'discarded' ? 'border-rose-100 bg-white' : 'border-brand-100 bg-white'}">
    <!-- header row -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex items-start gap-3 min-w-0">
        <ActivityIcon type={view.activity_type} size="md" />
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-base sm:text-lg font-extrabold text-ink-900 leading-tight">
              Track Activity · {activityLabel(view.activity_type)}
            </h2>

            {#if view.status === 'tracking'}
              <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700">
                <span class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                {view.statusLabel}
              </span>
            {:else if view.status === 'paused'}
              <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-800">
                <Pause size={11} />
                {view.statusLabel}
              </span>
            {:else if view.status === 'saving'}
              <span class="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-extrabold text-brand-700">
                <LoaderCircle size={11} class="animate-spin" />
                {view.statusLabel}
              </span>
            {:else if view.status === 'completed'}
              <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700">
                <CheckCircle2 size={12} />
                {view.statusLabel}
              </span>
            {:else}
              <span class="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-extrabold text-rose-600">
                <XCircle size={12} />
                {view.statusLabel}
              </span>
            {/if}

            {#if view.isLive}
              <GPSStatus status={view.gpsStatus} message={view.gpsMessage} />
            {/if}
          </div>

          <p class="mt-1 text-xs font-semibold text-ink-400">
            {view.pathLabel}{#if whenSummary} · {whenSummary}{/if}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        {#if view.fromHistory}
          <button
            type="button"
            class="btn-ghost !py-2 !px-3 !text-xs"
            onclick={() => (historyMapExpanded = false)}
          >
            <ChevronUp size={13} /> Collapse
          </button>
        {/if}
        {#if view.isLive}
          <button
            type="button"
            class="btn-ghost !py-2 !px-3 !text-xs"
            onclick={() => navigate('/track')}
          >
            Open Track Activity <ArrowRight size={13} />
          </button>
        {:else if view.status === 'completed'}
          <button
            type="button"
            class="btn-ghost !py-2 !px-3 !text-xs"
            onclick={() => navigate('/activities')}
          >
            View in Activities
          </button>
          <button
            type="button"
            class="btn-primary !py-2 !px-3.5 !text-xs"
            onclick={() => navigate('/track')}
          >
            <Activity size={13} /> Track new activity
          </button>
        {:else}
          <button
            type="button"
            class="btn-primary !py-2 !px-3.5 !text-xs"
            onclick={() => navigate('/track')}
          >
            <Play size={13} fill="currentColor" /> Start new track
          </button>
          <button
            type="button"
            class="btn-ghost !py-2 !px-2.5 !text-xs"
            aria-label="Dismiss discarded track update"
            onclick={() => liveTracker.clearOutcome()}
          >
            <X size={14} /> Dismiss
          </button>
        {/if}
      </div>
    </div>

    <!-- recorded map + stats/controls -->
    <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div class="relative">
        <RouteMap
          points={view.route}
          plannedPath={view.plannedPath}
          live={view.isLive}
          center={mapCenter}
          userLocation={liveUserPos}
          height={212}
          showAttribution={false}
          class="!rounded-2xl"
        >
          <div class="pointer-events-none absolute left-3 top-3 z-10 rounded-xl bg-white/90 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-brand-600 shadow-soft">
            {mapBadge}
          </div>
          {#if !view.isLive && view.route.length < 2 && view.plannedPath.length < 2}
            <div class="pointer-events-none absolute inset-x-3 bottom-3 z-10 rounded-xl bg-white/90 px-3 py-1.5 text-center text-[11px] font-semibold text-ink-500 shadow-soft">
              No multi-point GPS route was captured for this session.
            </div>
          {/if}
        </RouteMap>
      </div>

      <div class="flex flex-col justify-between gap-3">
        <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {#each metricTiles as tile (tile.label)}
            <div class="rounded-2xl border border-brand-100 bg-brand-50/40 px-3.5 py-2.5">
              <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">{tile.label}</p>
              <p class="num-tabular mt-0.5 font-display text-base sm:text-lg font-extrabold text-ink-900">
                {tile.value}
              </p>
            </div>
          {/each}
        </div>

        {#if view.note}
          <p class="rounded-2xl border px-3.5 py-2 text-xs font-bold {view.isLive ? 'border-amber-200 bg-amber-50 text-amber-800' : view.status === 'completed' ? 'border-emerald-100 bg-emerald-50/70 text-emerald-800' : 'border-brand-100 bg-brand-50/60 text-ink-600'}">
            {view.note}
          </p>
        {:else if view.isLive}
          <p class="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-3.5 py-2 text-xs font-semibold text-emerald-800">
            {view.status === 'paused'
              ? 'Workout paused — resume to keep recording GPS route and time, or save once you reach 0.05 km and 1:00.'
              : 'Live GPS map, timer, and distance stay recording even while you view Dashboard.'}
          </p>
        {/if}

        {#if view.isLive}
          <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {#if view.status === 'paused'}
              <button
                type="button"
                class="btn-primary min-h-[40px] !py-2.5 !px-4 !text-xs"
                disabled={liveTracker.saving}
                onclick={() => liveTracker.resumeActivity()}
              >
                <Play size={14} fill="currentColor" /> Resume
              </button>
            {:else}
              <button
                type="button"
                class="btn-ghost min-h-[40px] !py-2.5 !px-4 !text-xs"
                disabled={liveTracker.saving}
                onclick={() => liveTracker.pauseActivity()}
              >
                <Pause size={14} /> Pause
              </button>
            {/if}

            <button
              type="button"
              class="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-extrabold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60 cursor-pointer"
              disabled={liveTracker.saving}
              onclick={() => liveTracker.stopActivity()}
            >
              <Square size={13} strokeWidth={2.5} />
              {liveTracker.saving ? 'Saving…' : 'End & save'}
            </button>

            <button
              type="button"
              class="col-span-2 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-2xl border border-rose-200 bg-white px-3.5 py-2.5 text-xs font-extrabold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 cursor-pointer sm:col-span-1"
              disabled={liveTracker.saving}
              onclick={() => liveTracker.discardActivity()}
            >
              <RotateCcw size={13} /> Discard
            </button>
          </div>
        {/if}
      </div>
    </div>
  </Card>
{/if}
