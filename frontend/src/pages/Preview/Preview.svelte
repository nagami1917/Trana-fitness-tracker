<script>
  import { onMount } from 'svelte';
  import { Sparkles, Timer, Flame, Wheat, Droplets, Soup, ArrowRight, ArrowLeft, Compass } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import { loadModel, predictDuration } from '../../lib/ml/duration.js';
  import { recommendFueling, INTENSITY_COPY, gelEquivalent } from '../../lib/ml/fueling.js';
  import { duration as fmtDuration, kcal, nf } from '../../lib/format.js';
  import { navigate } from '../../lib/router.js';

  let model = $state(null);
  let activityType = $state('run');
  let distanceKm = $state(10);
  let elevationGainM = $state(120);
  let temperatureC = $state(26);
  let weightKg = $state(65);
  let experienceLevel = $state(3);
  let sweatProfile = $state('normal');

  onMount(async () => {
    try {
      model = await loadModel();
    } catch {
      model = null;
    }
  });

  const plan = $derived.by(() => {
    if (!model) return null;
    const distance = Math.max(0.5, Number(distanceKm) || 0);
    const elevation = Math.max(0, Number(elevationGainM) || 0);
    const duration = predictDuration({
      model,
      activityType,
      distanceKm: distance,
      elevationGainM: elevation,
      weightKg,
      experienceLevel,
      history: [],
    });
    const fueling = recommendFueling({
      activityType,
      durationMin: duration.minutes,
      weightKg,
      elevationPerKm: elevation / distance,
      avgSpeedKmh: duration.speedKmh,
      sweatProfile,
      temperatureC,
    });
    return { duration, fueling };
  });

  const intensityCopy = $derived(plan ? (INTENSITY_COPY[plan.fueling.intensity] ?? INTENSITY_COPY.moderate) : INTENSITY_COPY.moderate);
</script>

<svelte:head>
  <title>TRANA — Live Prediction & Fueling Preview</title>
</svelte:head>

<div class="space-y-5">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <button type="button" class="btn-ghost text-xs" onclick={() => navigate('/login')}>
      <ArrowLeft size={14} /> Back to sign in
    </button>
    <button type="button" class="btn-primary text-xs" onclick={() => navigate('/register')}>
      Create free account <ArrowRight size={14} />
    </button>
  </div>

  <Card class="p-6">
    <div class="flex flex-wrap items-center gap-2">
      <span class="pill bg-brand-50 text-brand-600"><Compass size={12} /> Interactive preview</span>
      <span class="pill">Runs locally in your browser · No account required</span>
    </div>
    <h1 class="mt-3 font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-900">
      Try TRANA’s duration & fueling engine
    </h1>
    <p class="mt-1.5 text-sm font-semibold text-ink-500">
      Dial in distance, climbing, temperature, and body weight below to see how TRANA predicts your finish window and builds a pre/during/post hydration & carbohydrate plan.
    </p>

    <div class="mt-5 grid gap-5 sm:grid-cols-2">
      <div class="space-y-4">
        <div>
          <span class="label">Sport</span>
          <Segmented
            value={activityType}
            onSelect={(id) => (activityType = id)}
            options={[
              { id: 'run', label: 'Run' },
              { id: 'ride', label: 'Ride' },
              { id: 'walk', label: 'Walk' },
              { id: 'hike', label: 'Hike' },
            ]}
          />
        </div>

        <div>
          <div class="flex items-baseline justify-between">
            <span class="label">Distance</span>
            <span class="text-sm font-extrabold text-brand-700">{nf(distanceKm, 1)} km</span>
          </div>
          <input type="range" min="1" max="100" step="0.5" bind:value={distanceKm} class="mt-1 w-full accent-brand-500" />
        </div>

        <div>
          <div class="flex items-baseline justify-between">
            <span class="label">Elevation gain</span>
            <span class="text-sm font-extrabold text-brand-700">{elevationGainM} m</span>
          </div>
          <input type="range" min="0" max="2000" step="20" bind:value={elevationGainM} class="mt-1 w-full accent-brand-500" />
        </div>
      </div>

      <div class="space-y-4">
        <div>
          <div class="flex items-baseline justify-between">
            <span class="label">Body weight</span>
            <span class="text-sm font-extrabold text-brand-700">{weightKg} kg</span>
          </div>
          <input type="range" min="40" max="130" step="1" bind:value={weightKg} class="mt-1 w-full accent-brand-500" />
        </div>

        <div>
          <div class="flex items-baseline justify-between">
            <span class="label">Temperature</span>
            <span class="text-sm font-extrabold text-brand-700">{temperatureC}°C</span>
          </div>
          <input type="range" min="-5" max="42" step="1" bind:value={temperatureC} class="mt-1 w-full accent-brand-500" />
        </div>

        <div>
          <span class="label">Sweat profile</span>
          <Segmented
            value={sweatProfile}
            onSelect={(id) => (sweatProfile = id)}
            options={[
              { id: 'low', label: 'Light' },
              { id: 'normal', label: 'Average' },
              { id: 'high', label: 'Heavy' },
            ]}
          />
        </div>
      </div>
    </div>
  </Card>

  {#if plan}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card class="p-4">
        <Timer size={18} class="text-brand-500" />
        <p class="mt-2 text-2xl font-extrabold text-ink-900">{fmtDuration(plan.duration.minutes)}</p>
        <p class="text-[10px] font-bold uppercase tracking-wider text-ink-400">
          likely · {fmtDuration(plan.duration.low)} – {fmtDuration(plan.duration.high)}
        </p>
      </Card>
      <Card class="p-4">
        <Flame size={18} class="text-brand-500" />
        <p class="mt-2 text-2xl font-extrabold text-ink-900">{kcal(plan.fueling.calories.total)}</p>
        <p class="text-[10px] font-bold uppercase tracking-wider text-ink-400">kcal estimated burn</p>
      </Card>
      <Card class="p-4">
        <Wheat size={18} class="text-amber-500" />
        <p class="mt-2 text-2xl font-extrabold text-ink-900">{plan.fueling.carbs.perHourG} g/h</p>
        <p class="text-[10px] font-bold uppercase tracking-wider text-ink-400">≈ {gelEquivalent(plan.fueling.carbs.perHourG)}</p>
      </Card>
      <Card class="p-4">
        <Droplets size={18} class="text-blue-500" />
        <p class="mt-2 text-2xl font-extrabold text-ink-900">{plan.fueling.fluid.perHourMl} ml/h</p>
        <p class="text-[10px] font-bold uppercase tracking-wider text-ink-400">
          <Soup size={10} class="inline -mt-0.5" /> {plan.fueling.sodium.perHourMg} mg sodium/h
        </p>
      </Card>
    </div>

    <Card class="p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <Sparkles size={15} class="text-brand-500" />
          <p class="text-sm font-extrabold text-ink-900">Your fueling timeline</p>
        </div>
        <span class="pill {intensityCopy.tone}">{intensityCopy.label}</span>
      </div>
      <ol class="mt-4 space-y-2.5">
        {#each plan.fueling.timeline as step (step.window + step.label)}
          <li class="flex items-start gap-3">
            <div class="w-24 shrink-0 rounded-xl bg-brand-50 px-2 py-1 text-center text-[10px] font-extrabold uppercase text-brand-700">
              {step.window}
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-extrabold text-ink-900">{step.label}</p>
              <p class="text-xs font-semibold text-ink-500">{step.detail}</p>
            </div>
          </li>
        {/each}
      </ol>
      <div class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand-50/70 p-4">
        <p class="text-xs font-semibold text-ink-600">
          Create an account to draw routes on real roads, sync live GPS tracking, and calibrate predictions to your own pace history.
        </p>
        <button type="button" class="btn-primary shrink-0" onclick={() => navigate('/register')}>
          Get started free <ArrowRight size={14} />
        </button>
      </div>
    </Card>
  {/if}
</div>
