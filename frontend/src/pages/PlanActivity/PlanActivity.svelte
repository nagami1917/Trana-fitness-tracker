<script>
  import { onMount } from 'svelte';
  import { Sparkles, MapPin, Route, Trash2, LoaderCircle, Save, Ruler, Thermometer, Droplets, ArrowRight, Play } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import RouteMap from '../../components/route/RouteMap.svelte';
  import FuelingPlan from '../../components/fueling/FuelingPlan.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import { activities, profile, plans, notify, refresh } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { navigate, query } from '../../lib/router.js';
  import { loadModel, predictPlan } from '../../lib/ml/index.js';
  import { routeLengthKm, suggestElevation } from '../../lib/ml/index.js';
  import { nf, km, pace } from '../../lib/format.js';

  const TYPES = [
    { id: 'run', label: 'Run', hint: 'Road, trail or treadmill' },
    { id: 'ride', label: 'Ride', hint: 'Road or gravel' },
    { id: 'walk', label: 'Walk', hint: 'Easy or brisk' },
    { id: 'hike', label: 'Hike', hint: 'Trail with climbing' },
  ];

  let model = $state(null);
  let saving = $state(false);
  let saved = $state(null);
  let drawing = $state(false);

  let form = $state({
    activity_type: 'run',
    distance_km: 5,
    elevation_gain_m: 45,
    temperature_c: 26,
    route: [],
    sweat_profile: 'normal',
    planned_for: '',
  });

  let prediction = $state(null);
  let computing = $state(false);

  onMount(async () => {
    model = await loadModel();
    // hydrate from the dashboard shortcut (?type=run&distance=5&elevation=45)
    const params = $query;
    if (params.get('type')) form.activity_type = params.get('type');
    if (params.get('distance')) form.distance_km = Number(params.get('distance'));
    if (params.get('elevation')) form.elevation_gain_m = Number(params.get('elevation'));
    form.temperature_c = $profile?.typical_temperature_c ?? 26;
    form.sweat_profile = $profile?.sweat_profile ?? 'normal';
    if ($activities[0]?.route?.length) form.route = $activities[0].route;
    await run();
  });

  const routeKm = $derived(form.route.length > 1 ? routeLengthKm(form.route) : 0);
  const effectiveDistance = $derived(routeKm > 0.05 ? routeKm : Number(form.distance_km) || 0);

  async function run() {
    if (!$profile || !model) return;
    computing = true;
    try {
      prediction = await predictPlan({
        activity: {
          activity_type: form.activity_type,
          distance_km: effectiveDistance,
          elevation_gain_m: Number(form.elevation_gain_m) || 0,
          temperature_c: Number(form.temperature_c),
          route: form.route.length > 1 ? form.route : null,
        },
        profile: { ...$profile, sweat_profile: form.sweat_profile },
        activities: $activities,
      });
    } finally {
      computing = false;
    }
  }

  // Recompute whenever a relevant input changes (debounced).
  let timer;
  $effect(() => {
    // touch the reactive inputs
    void form.activity_type;
    void form.distance_km;
    void form.elevation_gain_m;
    void form.temperature_c;
    void form.sweat_profile;
    void form.planned_for;
    void form.route.length;
    void $activities.length;
    saved = null;
    clearTimeout(timer);
    timer = setTimeout(run, 160);
  });

  function startOver() {
    form = {
      activity_type: 'run',
      distance_km: 5,
      elevation_gain_m: 45,
      temperature_c: $profile?.typical_temperature_c ?? 26,
      route: [],
      sweat_profile: $profile?.sweat_profile ?? 'normal',
      planned_for: '',
    };
    saved = null;
    prediction = null;
    drawing = false;
  }

  function pickType(id) {
    form.activity_type = id;
    if (!form.route.length) {
      form.elevation_gain_m = suggestElevation(Number(form.distance_km) || 0, id);
    }
  }

  function onPick(mode, index, latlng) {
    if (!latlng) return;
    const point = [Number(latlng.lat.toFixed(5)), Number(latlng.lng.toFixed(5))];
    form.route = mode === 'move'
      ? form.route.map((existing, i) => (i === index ? point : existing))
      : [...form.route, point];
  }

  function useRouteDistance() {
    if (routeKm > 0) {
      form.distance_km = Number(routeKm.toFixed(2));
      drawing = false;
    }
  }

  async function save() {
    if (!prediction) return;
    saving = true;
    let written = false;
    let created = null;
    try {
      created = await api.predictions.create({
        activity_type: form.activity_type,
        distance_km: Number(effectiveDistance.toFixed(2)),
        elevation_gain_m: Number(form.elevation_gain_m) || 0,
        route: form.route.length > 1 ? form.route : null,
        temperature_c: Number(form.temperature_c),
        sweat_profile: form.sweat_profile,
        planned_for: form.planned_for ? new Date(form.planned_for).toISOString() : null,
      });
      written = true;
      await refresh();
      saved = created;
      // The server's calculation is authoritative; the on-device result is a preview.
      prediction = created;
      notify('Plan saved — it’s on your dashboard.');
    } catch (error) {
      if (written) {
        saved = created;
        prediction = created;
      }
      notify(written ? 'Plan saved, but the view could not refresh. Reload when connected.' : (error.message || 'Could not save the plan'), 'error');
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-5">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <span class="pill mb-2"><Sparkles size={12} /> TRANA prediction</span>
      <h1 class="font-display text-2xl sm:text-3xl">Plan your next session</h1>
      <p class="mt-1 text-sm font-semibold text-ink-400">
        Preview an estimate on this device using your history. Saving a plan uses the server’s prediction service.
      </p>
    </div>
    <button class="btn-ghost self-start" onclick={() => navigate('/activities')}>
      Log a past activity <ArrowRight size={15} />
    </button>
  </div>

  <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
    <!-- input -->
    <div class="space-y-4">
      <Card>
        <h2 class="text-lg">Activity</h2>
        <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {#each TYPES as type (type.id)}
            <button
              class="flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition {form.activity_type === type.id
                ? 'border-transparent bg-brand-gradient text-white shadow-glow'
                : 'border-brand-100 bg-white/70 text-ink-500 hover:border-brand-200'}"
              onclick={() => pickType(type.id)}
            >
              <ActivityIcon type={type.id} size="sm" tone={form.activity_type === type.id ? 'solid' : 'brand'} />
              <span class="text-sm font-extrabold">{type.label}</span>
              <span class="text-[10px] font-semibold leading-tight {form.activity_type === type.id ? 'text-white/80' : 'text-ink-400'}">
                {type.hint}
              </span>
            </button>
          {/each}
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <span class="label">Distance {routeKm > 0 ? '(from route)' : ''}</span>
            <div class="flex gap-2">
              <input
                class="input"
                type="number"
                min="0.5"
                step="0.5"
                bind:value={form.distance_km}
                disabled={routeKm > 0}
                class:bg-brand-50={routeKm > 0}
              />
              <span class="grid w-14 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">km</span>
            </div>
            {#if routeKm > 0}
              <p class="mt-1 text-[10px] font-bold text-brand-600">Route measured {nf(routeKm, 2)} km</p>
            {/if}
          </div>

          <div>
            <span class="label">Elevation gain</span>
            <div class="flex gap-2">
              <input class="input" type="number" min="0" step="10" bind:value={form.elevation_gain_m} />
              <span class="grid w-14 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">m</span>
            </div>
          </div>

          <div>
            <span class="label"><Thermometer size={11} class="mr-1 inline" /> Expected temperature</span>
            <div class="flex gap-2">
              <input class="input" type="number" min="-5" max="45" bind:value={form.temperature_c} />
              <span class="grid w-14 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">°C</span>
            </div>
          </div>

          <div>
            <span class="label">When</span>
            <input class="input" type="datetime-local" bind:value={form.planned_for} />
          </div>
        </div>

        <div class="mt-4">
          <span class="label"><Droplets size={11} class="mr-1 inline" /> Sweat profile</span>
          <Segmented
            options={[
              { id: 'low', label: 'Light sweater' },
              { id: 'normal', label: 'Average' },
              { id: 'high', label: 'Heavy sweater' },
            ]}
            value={form.sweat_profile}
            onSelect={(v) => (form.sweat_profile = v)}
          />
        </div>
      </Card>

      <Card>
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg">Route</h2>
            <p class="text-xs font-semibold text-ink-400">Draw your planned route — TRANA measures it for you.</p>
          </div>
          <div class="flex gap-2">
            <button class="btn-chip" class:btn-chip-active={drawing} onclick={() => (drawing = !drawing)}>
              <Route size={13} /> {drawing ? 'Drawing…' : 'Draw'}
            </button>
            {#if form.route.length}
              <button class="btn-chip" onclick={() => (form.route = [])}><Trash2 size={13} /> Clear</button>
            {/if}
          </div>
        </div>

        <div class="mt-3">
          <RouteMap
            points={form.route}
            height={250}
            interactive={drawing}
            onPick={onPick}
          />
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span class="pill"><MapPin size={12} /> {form.route.length ? `${form.route.length} points` : 'No route yet'}</span>
          <span class="pill"><Ruler size={12} /> {routeKm > 0 ? `${nf(routeKm, 2)} km` : '—'}</span>
          {#if routeKm > 0}
            <button class="btn-chip ml-auto" onclick={useRouteDistance}>
              Use this distance
            </button>
          {/if}
        </div>
        {#if drawing}
          <p class="mt-2 text-[11px] font-semibold text-ink-400">
            Tap along the map to drop points. Drag any dot to adjust it.
          </p>
        {/if}
      </Card>
    </div>

    <!-- result -->
    <div class="space-y-4">
      {#if computing && !prediction}
        <Card class="grid place-items-center !py-16">
          <LoaderCircle size={26} class="animate-spin text-brand-400" />
          <p class="mt-3 text-sm font-bold text-ink-400">Reading your history…</p>
        </Card>
      {:else if prediction}
        <Card class="!p-4 sm:!p-5">
          <div class="mb-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <ActivityIcon type={form.activity_type} size="sm" />
              <div>
                <p class="text-sm font-extrabold capitalize">{nf(effectiveDistance, 2)} km {form.activity_type}</p>
                <p class="text-[11px] font-semibold text-ink-400">
                  {nf(form.elevation_gain_m)} m gain · {form.temperature_c} °C
                </p>
              </div>
            </div>
            {#if computing}
              <LoaderCircle size={15} class="animate-spin text-brand-400" />
            {/if}
          </div>

          <FuelingPlan plan={prediction} />

          <div class="mt-4 flex flex-col gap-2 sm:flex-row">
            <button class="btn-primary flex-1" onclick={save} disabled={saving || Boolean(saved)}>
              {#if saving}
                <LoaderCircle size={16} class="animate-spin" /> Saving…
              {:else if saved}
                <Save size={16} /> Saved
              {:else}
                <Save size={16} /> Save this plan
              {/if}
            </button>
            <button class="btn-ghost flex-1" onclick={startOver}>
              <Play size={15} /> Start over
            </button>
          </div>

          {#if saved}
            <div class="mt-3 rounded-2xl bg-emerald-50 p-3 text-[11px] font-bold text-emerald-700">
              Plan #{saved.id} saved. Tap “Activities” to log it once you’re done — TRANA will learn from the real time.
            </div>
          {/if}
        </Card>
      {/if}

      {#if $plans.length > 0}
        <Card>
          <h2 class="text-base">Saved plans</h2>
          <div class="mt-2 divide-y divide-brand-100/70">
            {#each $plans.slice(0, 4) as plan (plan.id)}
              <button
                class="flex w-full items-center gap-3 py-2.5 text-left transition hover:opacity-75"
                onclick={() => {
                  clearTimeout(timer);
                  prediction = plan;
                  saved = plan;
                }}
              >
                <ActivityIcon type={plan.activity_type} size="sm" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-extrabold capitalize">{plan.distance_km} km {plan.activity_type}</p>
                  <p class="text-[10px] font-semibold text-ink-400">
                    ~{Math.round(plan.duration.minutes)} min · {plan.fueling.carbs.perHourG} g carbs/h
                  </p>
                </div>
                <span class="shrink-0 text-[10px] font-bold text-ink-400">
                  {new Date(plan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </button>
            {/each}
          </div>
        </Card>
      {/if}
    </div>
  </div>
</div>
