<script>
  import { onMount } from 'svelte';
  import {
    Flame,
    Footprints,
    Timer,
    ChartColumn,
    Sparkles,
    ArrowRight,
    Play,
    MapPin,
    Gauge,
    Trophy,
    Brain,
    MoreHorizontal,
    Activity as ActivityIconLucide,
    Flag,
    Wheat,
  } from 'lucide-svelte';
  import StatCard from '../../components/dashboard/StatCard.svelte';
  import TrackActivityPrompt from '../../components/dashboard/TrackActivityPrompt.svelte';
  import Card from '../../components/common/Card.svelte';
  import Skeleton from '../../components/common/Skeleton.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import RouteMap from '../../components/route/RouteMap.svelte';
  import DonutRing from '../../components/common/DonutRing.svelte';
  import ProgressBar from '../../components/common/ProgressBar.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import LineChart from '../../components/analytics/LineChart.svelte';
  import {
    activities,
    profile,
    goals,
    todayStats,
    weekStats,
    trends,
    chartSeries,
    modelCard,
    plans,
    trainingLoad,
    activeRacePrep,
    loadRaceEvents,
    unitSystem,
  } from '../../stores/index.js';
  import { navigate } from '../../lib/router.js';
  import { api } from '../../services/client.js';
  import { detectPlace, readCachedPlace, writeCachedPlace } from '../../lib/location.js';
  import { acquireLivePosition, releaseLivePosition, seedLivePosition, livePosition } from '../../lib/liveLocation.svelte.js';
  import { loadModel, predictDuration } from '../../lib/ml/duration.js';
  import { recommendFueling, INTENSITY_COPY } from '../../lib/ml/fueling.js';
  import { duration as fmtDuration, kcal, km, ml, nf, dayLabel, timeLabel, greeting, pct, shortDate, activityLabel } from '../../lib/format.js';
  import {
    distanceUnit,
    elevationUnit,
    fromDisplayDistance,
    fromDisplayElevation,
    toDisplayDistance,
    toDisplayElevation,
  } from '../../lib/units.js';

  let model = $state(null);
  let loadingModel = $state(true);
  let livePlace = $state(null); // { label, latitude, longitude } from device GPS
  let locating = $state(false);
  let draft = $state({ type: 'run', distance: 5, elevation: 45 });
  let range = $state('7D');
  let metric = $state('calories');

  let lastLookup = null; // { latitude, longitude, at } — throttle reverse-geocoding

  /** Persist a detected place: chip label, 10-min cache, profile city sync. */
  async function applyLivePlace(place, { sync = true } = {}) {
    livePlace = place;
    writeCachedPlace(place);
    lastLookup = { latitude: place.latitude, longitude: place.longitude, at: Date.now() };
    if (sync && $profile && ($profile.city ?? '').trim() !== place.label) {
      try {
        await api.profile.update({ city: place.label });
        profile.update((p) => (p ? { ...p, city: place.label } : p));
      } catch {
        // Persisting is best-effort — the indicator already shows the live place.
      }
    }
  }

  function distanceKm(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }

  async function locateLive() {
    const cached = readCachedPlace();
    if (cached) {
      livePlace = cached;
      seedLivePosition(cached);
      lastLookup = { latitude: cached.latitude, longitude: cached.longitude, at: Date.now() };
      return;
    }
    locating = true;
    try {
      const place = await detectPlace();
      await applyLivePlace(place);
      seedLivePosition(place);
    } catch {
      // Permission denied / offline / lookup failed -> keep stored city.
    } finally {
      locating = false;
    }
  }

  async function refreshPlaceFrom(pos) {
    const moved = !lastLookup || distanceKm(lastLookup, pos) >= 1;
    const cooled = !lastLookup || Date.now() - lastLookup.at >= 90_000;
    if (!moved || !cooled) return;
    lastLookup = { latitude: pos.latitude, longitude: pos.longitude, at: Date.now() };
    try {
      await applyLivePlace(await detectPlace());
    } catch {
      // Silent — dot keeps moving; label keeps last known place.
    }
  }

  onMount(() => {
    void locateLive();
    acquireLivePosition();
    void loadRaceEvents();
    void (async () => {
      model = await loadModel();
      loadingModel = false;
    })();
    return () => {
      releaseLivePosition();
    };
  });

  $effect(() => {
    const pos = livePosition.current;
    if (pos) void refreshPlaceFrom(pos);
  });

  const TYPES = [
    { id: 'run', label: 'Run' },
    { id: 'ride', label: 'Ride' },
    { id: 'walk', label: 'Walk' },
    { id: 'hike', label: 'Hike' },
  ];

  const METRICS = $derived([
    { id: 'calories', label: 'Calories', unit: 'kcal' },
    { id: 'distance', label: 'Distance', unit: distanceUnit($unitSystem) },
    { id: 'minutes', label: 'Time', unit: 'min' },
  ]);

  const previewRoute = $derived($activities.find((a) => a.route?.length)?.route ?? $plans[0]?.route ?? []);

  const prediction = $derived.by(() => {
    if (!model || !$profile) return null;
    const distance = Math.max(0.5, Number(draft.distance) || 0);
    const elevation = Math.max(0, Number(draft.elevation) || 0);
    const d = predictDuration({
      model,
      activityType: draft.type,
      distanceKm: distance,
      elevationGainM: elevation,
      weightKg: $profile.weight_kg,
      experienceLevel: $profile.experience_level,
      history: $activities,
    });
    const f = recommendFueling({
      activityType: draft.type,
      durationMin: d.minutes,
      weightKg: $profile.weight_kg,
      elevationPerKm: elevation / distance,
      avgSpeedKmh: d.speedKmh,
      sweatProfile: $profile.sweat_profile,
      temperatureC: $profile.typical_temperature_c,
      dailyCarbTargetG: $goals?.carb_target_g ?? $profile.daily_carb_goal_g,
      energyCalibrationFactor: Number($profile.energy_calibration_factor) || 1,
      maxHr: $profile.max_hr ?? null,
      restingHr: $profile.resting_hr ?? null,
      acwr: $trainingLoad?.acwr ?? null,
      carbLoading: Boolean($activeRacePrep?.prep?.inCarbLoadWindow),
    });
    return { d, f };
  });

  const series = $derived($chartSeries[range] ?? []);
  const labels = $derived(series.map((s) => s.label));
  const values = $derived(
    series.map((s) => {
      if (metric === 'distance') return Math.round(toDisplayDistance(s.distance ?? 0, $unitSystem) * 10) / 10;
      return Math.round(s[metric] ?? 0);
    }),
  );
  const spark = $derived(($chartSeries['7D'] ?? []).map((d) => d.calories));

  const summaryRows = $derived([
    {
      label: 'Calories',
      value: $todayStats.calories,
      goal: $goals?.daily_calories ?? 2700,
      unit: 'kcal',
      tone: 'brand',
    },
    {
      label: 'Distance',
      value: $todayStats.distance,
      goal: $goals?.daily_distance_km ?? 10,
      unit: distanceUnit($unitSystem),
      tone: 'sky',
      decimals: 1,
      isDistance: true,
    },
    {
      label: 'Active time',
      value: $todayStats.minutes,
      goal: $goals?.daily_active_min ?? 90,
      unit: 'min',
      tone: 'amber',
    },
  ]);

  const goalPercent = $derived(pct(summaryRows[0].value, summaryRows[0].goal));
  const recent = $derived($activities.slice(0, 4));
  const metricUnit = $derived(METRICS.find((m) => m.id === metric)?.unit ?? '');

  function planDeeper() {
    const params = new URLSearchParams({
      type: draft.type,
      distance: String(draft.distance),
      elevation: String(draft.elevation),
    });
    navigate(`/plan?${params.toString()}`);
  }
</script>

<div class="space-y-5">
  <!-- Clean typography-led greeting (mascot reserved for guide, onboarding & empty states) -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h1 class="font-display text-[26px] leading-tight sm:text-3xl">
        {greeting()}, {$profile?.name ?? 'athlete'}
      </h1>
      <p class="mt-1 text-sm font-semibold text-ink-400">
        Plan your workout to forecast duration, pacing, and fueling needs.
      </p>
    </div>

    <div class="flex items-center gap-2.5 self-start rounded-2xl border border-brand-100 bg-white/85 px-4 py-2.5">
      <MapPin size={15} class="shrink-0 text-brand-500" />
      <div class="min-w-0 max-w-[15rem]">
        {#if livePlace?.label || $profile?.city?.trim()}
          <p class="truncate text-xs font-extrabold text-ink-700" title={livePlace?.label ?? $profile.city}>
            {livePlace?.label ?? $profile.city}
          </p>
        {:else}
          <button class="text-xs font-extrabold text-brand-600 hover:underline" onclick={() => navigate('/settings')}>Add city / region</button>
        {/if}
        <p class="text-[11px] font-semibold text-ink-400">
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}{#if locating}<span class="text-brand-500"> · locating…</span>{/if}
        </p>
      </div>
    </div>
  </div>

  <div class="space-y-4 scroll-mt-20" data-tour="dashboard-overview">
    <!-- Readiness (ACWR) & Race Carb-Loading strip -->
    {#if $trainingLoad?.meta || $activeRacePrep}
      <div class="flex flex-wrap items-center gap-2">
        {#if $trainingLoad?.meta}
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-2xl border border-brand-100 bg-white/90 px-3.5 py-2 text-xs font-extrabold text-ink-900 shadow-soft transition hover:border-brand-300"
            onclick={() => navigate('/analytics')}
          >
            <ActivityIconLucide size={14} class="text-brand-600" />
            <span>Readiness: {$trainingLoad.meta.label}</span>
            {#if $trainingLoad.acwr != null}
              <span class="num-tabular rounded-full px-2 py-0.5 text-[11px] {$trainingLoad.meta.tone}">
                ACWR {$trainingLoad.acwr.toFixed(2)}
              </span>
            {/if}
          </button>
        {/if}

        {#if $activeRacePrep}
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2 text-xs font-extrabold shadow-soft transition {$activeRacePrep.prep.inCarbLoadWindow
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-brand-100 bg-white/90 text-ink-900 hover:border-brand-300'}"
            onclick={() => navigate('/calendar')}
          >
            {#if $activeRacePrep.prep.inCarbLoadWindow}
              <Wheat size={14} class="text-amber-600" />
              <span>Carb-load active for {$activeRacePrep.race.title || $activeRacePrep.race.name} ({$activeRacePrep.prep.daysUntil}d)</span>
            {:else}
              <Flag size={14} class="text-brand-600" />
              <span>{$activeRacePrep.race.title || $activeRacePrep.race.name} in {$activeRacePrep.prep.daysUntil} days</span>
            {/if}
          </button>
        {/if}
      </div>
    {/if}

    <!-- compact idle / live expandable track status -->
    <TrackActivityPrompt fallbackCenter={livePlace ? [livePlace.latitude, livePlace.longitude] : [14.676, 121.0437]} />

    <!-- Tier 1 flat stat cards -->
    <div class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatCard
        label="Calories burned"
        value={kcal($todayStats.calories)}
        unit="kcal"
        delta={$trends.calories}
        icon={Flame}
        tone="rose"
        spark={spark}
      />
      <StatCard
        label="Distance"
        value={km($todayStats.distance, $unitSystem)}
        unit={distanceUnit($unitSystem)}
        delta={$trends.distance}
        icon={Footprints}
        tone="brand"
        spark={spark.map((v) => v * 0.02)}
      />
      <StatCard
        label="Active time"
        value={Math.round($todayStats.minutes)}
        unit="min"
        delta={$trends.minutes}
        icon={Timer}
        tone="sky"
        spark={spark.map((v) => v * 0.015)}
      />
      <StatCard
        label="This week"
        value={kcal($weekStats.calories)}
        unit="kcal"
        hint={`${$weekStats.count} session${$weekStats.count === 1 ? '' : 's'}`}
        icon={ChartColumn}
        tone="amber"
        spark={spark}
      />
    </div>
  </div>

  <div class="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
    <!-- left column -->
    <div class="space-y-5">
      <!-- Tier 2 elevated primary workflow: Quick Plan -->
      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3">
            <ActivityIcon type={draft.type} size="md" />
            <div>
              <h2 class="text-lg leading-tight">Quick Plan</h2>
              <p class="text-xs font-semibold text-ink-400">Pick a sport and preview your predicted effort</p>
            </div>
          </div>
          <button class="pill bg-rose-50 text-rose-600 transition hover:bg-rose-100" onclick={() => navigate('/track')}>
            <span class="h-1.5 w-1.5 rounded-full bg-rose-500"></span> Live tracking
          </button>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          {#each TYPES as type (type.id)}
            <button
              class="btn-chip"
              class:btn-chip-active={draft.type === type.id}
              onclick={() => (draft.type = type.id)}
            >
              <ActivityIcon type={type.id} size="xs" tone={draft.type === type.id ? 'solid' : 'brand'} />
              {type.label}
            </button>
          {/each}
          <button class="btn-chip" onclick={() => navigate('/plan')}>
            <MoreHorizontal size={15} /> Other
          </button>
        </div>

        <div class="mt-4 grid gap-4 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div class="space-y-3">
            <div>
              <span class="label">Distance</span>
              <div class="flex gap-2">
                <input
                  class="input num-tabular"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={Math.round(toDisplayDistance(draft.distance, $unitSystem) * 10) / 10}
                  oninput={(e) => {
                    const val = Number(e.currentTarget.value);
                    if (Number.isFinite(val)) draft.distance = fromDisplayDistance(val, $unitSystem);
                  }}
                />
                <span class="grid w-16 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">{distanceUnit($unitSystem)}</span>
              </div>
            </div>

            <div>
              <span class="label">Elevation gain</span>
              <div class="flex gap-2">
                <input
                  class="input num-tabular"
                  type="number"
                  min="0"
                  step="5"
                  value={Math.round(toDisplayElevation(draft.elevation, $unitSystem))}
                  oninput={(e) => {
                    const val = Number(e.currentTarget.value);
                    if (Number.isFinite(val)) draft.elevation = fromDisplayElevation(val, $unitSystem);
                  }}
                />
                <span class="grid w-16 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">{elevationUnit($unitSystem)}</span>
              </div>
            </div>

            <button class="btn-primary w-full" onclick={planDeeper}>
              <Play size={16} fill="currentColor" /> Plan this activity
            </button>
          </div>

          <div class="relative">
            <RouteMap
              points={previewRoute}
              height={214}
              showAttribution={false}
              userLocation={livePosition.current ? [livePosition.current.latitude, livePosition.current.longitude] : null}
              class="!rounded-2xl"
            >
              <div class="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/90 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-brand-600 shadow-soft">
                Your last route
              </div>
            </RouteMap>
          </div>
        </div>

        <!-- estimate (no extra mascot illustration inside calculator) -->
        <div class="mt-4 flex items-center gap-4 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 via-white to-brand-50 p-4">
          <span class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-brand-500 shadow-soft">
            <Flame size={22} />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-extrabold uppercase tracking-[0.1em] text-brand-700">Predicted effort</p>
            {#if loadingModel || !prediction}
              <div class="mt-2"><Skeleton variant="lines" count={2} /></div>
            {:else}
              <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p class="num-tabular font-display text-2xl font-extrabold leading-none text-ink-900">
                  {fmtDuration(prediction.d.minutes)}
                </p>
                <p class="num-tabular text-sm font-bold text-ink-400">
                  ≈ <span class="text-brand-700">{kcal(prediction.f.calories.total)} kcal</span>
                </p>
              </div>
              <p class="num-tabular mt-1 text-[11px] font-semibold text-ink-400">
                {prediction.f.carbs.perHourG} g carbs/h · {prediction.f.sodium.perHourMg} mg sodium/h ·
                {INTENSITY_COPY[prediction.f.intensity]?.label ?? prediction.f.intensity} intensity
              </p>
            {/if}
          </div>
        </div>
      </Card>

      <!-- chart -->
      <Card>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <ChartColumn size={18} class="text-brand-500" />
            <h2 class="text-lg">Your Activity Chart</h2>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="inline-flex items-center gap-1 rounded-full border border-brand-100 bg-white/70 p-1">
              {#each METRICS as m (m.id)}
                <button
                  class="rounded-full px-3 py-1.5 text-[11px] font-bold transition"
                  class:bg-brand-gradient={metric === m.id}
                  class:text-white={metric === m.id}
                  class:shadow-glow={metric === m.id}
                  class:text-ink-500={metric !== m.id}
                  onclick={() => (metric = m.id)}
                >
                  {m.label}
                </button>
              {/each}
            </div>
            <Segmented
              options={[{ id: '7D', label: '7D' }, { id: '1M', label: '1M' }, { id: '3M', label: '3M' }]}
              value={range}
              onSelect={(value) => (range = value)}
            />
          </div>
        </div>

        <div class="mt-4 flex items-baseline gap-2">
          <span class="num-tabular font-display text-2xl font-extrabold">{nf(values.reduce((a, b) => a + b, 0))}</span>
          <span class="text-xs font-bold text-ink-400">{metricUnit} in this period</span>
        </div>

        <div class="mt-2">
          <LineChart
            {labels}
            series={[{ label: metricUnit, data: values }]}
            height={230}
            tooltipLabel={(ctx) => `${nf(ctx.parsed.y)} ${metricUnit}`}
            yTicks={(v) => (v >= 1000 ? `${nf(v / 1000, 1)}k` : v)}
          />
        </div>
      </Card>
    </div>

    <!-- right column -->
    <div class="space-y-5">
      <!-- today's summary -->
      <Card>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Trophy size={18} class="text-brand-500" />
            <h2 class="text-lg">Today’s Summary</h2>
          </div>
          <button class="text-[11px] font-extrabold text-brand-600" onclick={() => navigate('/goals')}>
            Details <ArrowRight size={12} class="inline" />
          </button>
        </div>

        <div class="mt-4 flex flex-col items-center gap-4 min-[420px]:flex-row sm:gap-5">
          <DonutRing value={goalPercent} label={`${Math.round(goalPercent)}%`} sublabel="of daily goal" size={132} />
          <div class="w-full min-w-0 flex-1 space-y-3">
            {#each summaryRows as row (row.label)}
              <div>
                <div class="flex items-baseline justify-between gap-2">
                  <span class="text-[11px] font-bold text-ink-500">{row.label}</span>
                  <span class="num-tabular text-[11px] font-extrabold text-ink-900">
                    {row.isDistance ? km(row.value, $unitSystem) : nf(Math.round(row.value))}
                    <span class="font-bold text-ink-400">/ {row.isDistance ? km(row.goal, $unitSystem) : nf(row.goal)} {row.unit}</span>
                  </span>
                </div>
                <div class="mt-1"><ProgressBar value={row.value} max={row.goal} tone={row.tone} height="h-2" /></div>
              </div>
            {/each}
          </div>
        </div>
      </Card>

      <!-- ml insight -->
      <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-600 to-brand-700 p-5 text-white shadow-card">
        <div class="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10"></div>
        <div class="absolute -bottom-10 left-10 h-24 w-24 rounded-full bg-white/5"></div>
        <div class="relative">
          <div class="flex items-center gap-2">
            <span class="grid h-8 w-8 place-items-center rounded-xl bg-white/20"><Brain size={16} /></span>
            <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/80">Your model</p>
          </div>
          <p class="mt-3 font-display text-xl font-extrabold leading-tight">Estimates based on your history</p>
          <p class="mt-1 text-xs font-semibold text-white/80">
            {#if $modelCard?.training_source === 'synthetic'}
              The bundled model was trained on synthetic activities. Real-world accuracy is not validated.
            {:else}
              Results are estimates and may differ from your actual performance.
            {/if}
          </p>
          <button class="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-1.5 text-[11px] font-extrabold backdrop-blur transition hover:bg-white/25" onclick={() => navigate('/analytics')}>
            See how it works <ArrowRight size={13} />
          </button>
        </div>
      </div>

      <!-- recent (Tier 1 flat secondary widget) -->
      <Card flat>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Sparkles size={18} class="text-brand-500" />
            <h2 class="text-lg">Recent Activities</h2>
          </div>
          <button class="text-[11px] font-extrabold text-brand-600" onclick={() => navigate('/activities')}>
            View all <ArrowRight size={12} class="inline" />
          </button>
        </div>

        <div class="mt-3 divide-y divide-brand-100/70">
          {#each recent as activity (activity.id)}
            <button class="flex w-full items-center gap-3 py-3 text-left transition hover:opacity-80" onclick={() => navigate(`/activities?id=${activity.id}`)}>
              <ActivityIcon type={activity.activity_type} size="md" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-extrabold text-ink-900">{activityLabel(activity.activity_type)}</p>
                <p class="num-tabular truncate text-[11px] font-semibold text-ink-400">
                  {km(activity.distance_km, $unitSystem)} {distanceUnit($unitSystem)} · {fmtDuration(activity.duration_min)} · {kcal(activity.calories)} kcal
                </p>
              </div>
              <span class="shrink-0 text-[11px] font-bold text-ink-400">{dayLabel(activity.started_at)}</span>
            </button>
          {/each}
        </div>
      </Card>

      <!-- next planned (Tier 1 flat secondary widget) -->
      {#if $plans.length}
        {@const plan = $plans[0]}
        <Card flat class="!p-0 overflow-hidden">
          <div class="flex items-center justify-between bg-gradient-to-r from-brand-50 to-white px-5 py-3">
            <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-600">Next planned session</p>
            <button class="text-[11px] font-extrabold text-brand-600" onclick={() => navigate(`/plan?plan=${plan.id}`)}>Open</button>
          </div>
          <div class="space-y-3 p-5 pt-3">
            <div class="flex items-center gap-3">
              <ActivityIcon type={plan.activity_type} size="md" />
              <div>
                <p class="num-tabular text-sm font-extrabold capitalize">{km(plan.distance_km, $unitSystem)} {distanceUnit($unitSystem)} {plan.activity_type}</p>
                <p class="num-tabular text-[11px] font-semibold text-ink-400">
                  ~{fmtDuration(plan.duration.minutes)} · {kcal(plan.fueling.calories.total)} kcal
                </p>
              </div>
              <span class="ml-auto text-[11px] font-bold text-ink-400">{shortDate(plan.created_at)}</span>
            </div>
            <div class="grid grid-cols-3 gap-2 text-center">
              {#each [
                { label: 'Carbs/h', value: `${plan.fueling.carbs.perHourG} g` },
                { label: 'Sodium/h', value: `${plan.fueling.sodium.perHourMg} mg` },
                { label: 'Fluid/h', value: ml(plan.fueling.fluid.perHourMl, $unitSystem) },
              ] as chip (chip.label)}
                <div class="rounded-xl bg-white/80 py-2">
                  <p class="text-[11px] font-bold uppercase tracking-wide text-ink-400">{chip.label}</p>
                  <p class="num-tabular text-xs font-extrabold text-ink-900">{chip.value}</p>
                </div>
              {/each}
            </div>
          </div>
        </Card>
      {/if}
    </div>
  </div>

  <p class="pb-2 text-center text-[11px] font-semibold text-ink-400">
    Predictions are estimates for healthy adults, not medical advice.
    <span class="num-tabular inline-flex items-center gap-1"><Gauge size={11} /> {timeLabel(new Date())} · {new Date().toLocaleDateString()}</span>
  </p>
</div>
