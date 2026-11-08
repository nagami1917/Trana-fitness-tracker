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
    LoaderCircle,
    Brain,
    MoreHorizontal,
  } from 'lucide-svelte';
  import StatCard from '../../components/dashboard/StatCard.svelte';
  import Card from '../../components/common/Card.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import RouteMap from '../../components/route/RouteMap.svelte';
  import DonutRing from '../../components/common/DonutRing.svelte';
  import ProgressBar from '../../components/common/ProgressBar.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import LineChart from '../../components/analytics/LineChart.svelte';
  import { activities, profile, goals, todayStats, weekStats, trends, chartSeries, modelCard, plans } from '../../stores/index.js';
  import { navigate } from '../../lib/router.js';
  import { loadModel, predictDuration } from '../../lib/ml/duration.js';
  import { recommendFueling, INTENSITY_COPY } from '../../lib/ml/fueling.js';
  import { duration as fmtDuration, kcal, km, nf, dayLabel, timeLabel, greeting, pct, shortDate, activityLabel } from '../../lib/format.js';

  let model = $state(null);
  let loadingModel = $state(true);
  let draft = $state({ type: 'run', distance: 5, elevation: 45 });
  let range = $state('7D');
  let metric = $state('calories');

  onMount(async () => {
    model = await loadModel();
    loadingModel = false;
  });

  const TYPES = [
    { id: 'run', label: 'Run' },
    { id: 'ride', label: 'Ride' },
    { id: 'walk', label: 'Walk' },
    { id: 'hike', label: 'Hike' },
  ];

  const METRICS = [
    { id: 'calories', label: 'Calories', unit: 'kcal' },
    { id: 'distance', label: 'Distance', unit: 'km' },
    { id: 'minutes', label: 'Time', unit: 'min' },
  ];

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
    });
    return { d, f };
  });

  const series = $derived($chartSeries[range] ?? []);
  const labels = $derived(series.map((s) => s.label));
  const values = $derived(series.map((s) => Math.round(s[metric] ?? 0)));
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
      unit: 'km',
      tone: 'sky',
      decimals: 1,
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
  <!-- greeting -->
  <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div class="flex items-start gap-4">
      <img
        src="/mascot-cat.png"
        alt=""
        class="h-16 w-16 shrink-0 rounded-2xl bg-white/70 p-1 ring-1 ring-white/80 shadow-soft sm:h-[74px] sm:w-[74px]"
      />
      <div>
        <h1 class="font-display text-[26px] leading-tight sm:text-3xl">
          {greeting()}, {$profile?.name ?? 'athlete'}! <span class="inline-block animate-wiggle">🎉</span>
        </h1>
        <p class="mt-1 text-sm font-semibold text-ink-400">
          Plan your workout and see how long it takes — and how much fuel it needs. 💗
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2 self-start rounded-2xl border border-white/80 bg-white/80 px-4 py-2.5 shadow-soft">
      <MapPin size={15} class="shrink-0 text-brand-500" />
      <div class="min-w-0 max-w-[15rem]">
        {#if $profile?.city?.trim()}
          <p class="truncate text-xs font-extrabold text-ink-700" title={$profile.city}>{$profile.city}</p>
        {:else}
          <button class="text-xs font-extrabold text-brand-600 hover:underline" onclick={() => navigate('/profile')}>Add city / region</button>
        {/if}
        <p class="text-[10px] font-semibold text-ink-400">
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>
    </div>
  </div>

  <!-- stat cards -->
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
      value={km($todayStats.distance)}
      unit="km"
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

  <div class="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
    <!-- left column -->
    <div class="space-y-5">
      <!-- plan / track card -->
      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3">
            <ActivityIcon type={draft.type} size="md" />
            <div>
              <h2 class="text-lg leading-tight">Track Activity</h2>
              <p class="text-xs font-semibold text-ink-400">Pick a sport like Strava and see your predicted effort</p>
            </div>
          </div>
          <button class="pill bg-rose-50 text-rose-500" onclick={() => navigate('/plan')}>
            <span class="h-1.5 w-1.5 rounded-full bg-rose-400"></span> Live tracking
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
                <input class="input" type="number" min="0.5" step="0.5" bind:value={draft.distance} />
                <span class="grid w-16 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">km</span>
              </div>
            </div>

            <div>
              <span class="label">Elevation gain</span>
              <div class="flex gap-2">
                <input class="input" type="number" min="0" step="5" bind:value={draft.elevation} />
                <span class="grid w-16 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">m</span>
              </div>
            </div>

            <button class="btn-primary w-full" onclick={planDeeper}>
              <Play size={16} fill="currentColor" /> Plan this activity
            </button>
          </div>

          <div class="relative">
            <RouteMap points={previewRoute} height={214} showAttribution={false} class="!rounded-2xl">
              <div class="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/85 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-brand-600 shadow-soft">
                Your last route
              </div>
            </RouteMap>
          </div>
        </div>

        <!-- estimate -->
        <div class="mt-4 flex items-center gap-4 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 via-white to-brand-50 p-4">
          <span class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-brand-500 shadow-soft">
            <Flame size={22} />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-extrabold uppercase tracking-[0.1em] text-brand-500">Predicted effort</p>
            {#if loadingModel || !prediction}
              <div class="mt-2 flex items-center gap-2 text-sm font-bold text-ink-400">
                <LoaderCircle size={15} class="animate-spin" /> Loading your model…
              </div>
            {:else}
              <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p class="font-display text-2xl font-extrabold leading-none text-ink-900">
                  {fmtDuration(prediction.d.minutes)}
                </p>
                <p class="text-sm font-bold text-ink-400">
                  ≈ <span class="text-brand-600">{kcal(prediction.f.calories.total)} kcal</span>
                </p>
              </div>
              <p class="mt-1 text-[11px] font-semibold text-ink-400">
                {prediction.f.carbs.perHourG} g carbs/h · {prediction.f.sodium.perHourMg} mg sodium/h ·
                {INTENSITY_COPY[prediction.f.intensity]?.label ?? prediction.f.intensity} intensity
              </p>
            {/if}
          </div>
          <img src="/mascot-cat.png" alt="" class="hidden h-16 w-auto animate-float sm:block" />
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
          <span class="font-display text-2xl font-extrabold">{nf(values.reduce((a, b) => a + b, 0))}</span>
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

        <div class="mt-4 flex items-center gap-5">
          <DonutRing value={goalPercent} label={`${Math.round(goalPercent)}%`} sublabel="of daily goal" size={132} />
          <div class="min-w-0 flex-1 space-y-3">
            {#each summaryRows as row (row.label)}
              <div>
                <div class="flex items-baseline justify-between gap-2">
                  <span class="text-[11px] font-bold text-ink-500">{row.label}</span>
                  <span class="text-[11px] font-extrabold text-ink-900">
                    {row.decimals ? km(row.value) : nf(Math.round(row.value))}
                    <span class="font-bold text-ink-400">/ {row.decimals ? row.goal : nf(row.goal)} {row.unit}</span>
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

      <!-- recent -->
      <Card>
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
            <button class="flex w-full items-center gap-3 py-3 text-left transition hover:opacity-80" onclick={() => navigate('/activities')}>
              <ActivityIcon type={activity.activity_type} size="md" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-extrabold text-ink-900">{activityLabel(activity.activity_type)}</p>
                <p class="truncate text-[11px] font-semibold text-ink-400">
                  {km(activity.distance_km)} km · {fmtDuration(activity.duration_min)} · {kcal(activity.calories)} kcal
                </p>
              </div>
              <span class="shrink-0 text-[11px] font-bold text-ink-400">{dayLabel(activity.started_at)}</span>
            </button>
          {/each}
        </div>
      </Card>

      <!-- next planned -->
      {#if $plans.length}
        {@const plan = $plans[0]}
        <Card cls="!p-0 overflow-hidden">
          <div class="flex items-center justify-between bg-gradient-to-r from-brand-50 to-white px-5 py-3">
            <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-600">Next planned session</p>
            <button class="text-[11px] font-extrabold text-brand-600" onclick={() => navigate('/plan')}>Open</button>
          </div>
          <div class="space-y-3 p-5 pt-3">
            <div class="flex items-center gap-3">
              <ActivityIcon type={plan.activity_type} size="md" />
              <div>
                <p class="text-sm font-extrabold capitalize">{plan.distance_km} km {plan.activity_type}</p>
                <p class="text-[11px] font-semibold text-ink-400">
                  ~{fmtDuration(plan.duration.minutes)} · {kcal(plan.fueling.calories.total)} kcal
                </p>
              </div>
              <span class="ml-auto text-[11px] font-bold text-ink-400">{shortDate(plan.created_at)}</span>
            </div>
            <div class="grid grid-cols-3 gap-2 text-center">
              {#each [
                { label: 'Carbs/h', value: `${plan.fueling.carbs.perHourG} g` },
                { label: 'Sodium/h', value: `${plan.fueling.sodium.perHourMg} mg` },
                { label: 'Fluid/h', value: `${nf(plan.fueling.fluid.perHourMl)} ml` },
              ] as chip (chip.label)}
                <div class="rounded-xl bg-brand-50/80 py-2">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-ink-400">{chip.label}</p>
                  <p class="text-xs font-extrabold text-ink-900">{chip.value}</p>
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
    <span class="inline-flex items-center gap-1"><Gauge size={11} /> {timeLabel(new Date())} · {new Date().toLocaleDateString()}</span>
  </p>
</div>
