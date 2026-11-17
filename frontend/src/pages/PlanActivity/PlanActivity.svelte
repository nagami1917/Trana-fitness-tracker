<script>
  import { onMount } from 'svelte';
  import {
    Sparkles,
    MapPin,
    Trash2,
    LoaderCircle,
    Save,
    Thermometer,
    Droplets,
    ArrowRight,
    Play,
    Mountain,
    Activity,
  } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import Skeleton from '../../components/common/Skeleton.svelte';
  import BusyOverlay from '../../components/common/BusyOverlay.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import FuelingPlan from '../../components/fueling/FuelingPlan.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import {
    goals,
    profile,
    plans,
    fuelItems,
    loadFuelItems,
    loadRaceEvents,
    trainingLoad,
    activeRacePrep,
    notify,
    upsertPlan,
    removePlanById,
    unitSystem,
    activities,
  } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { navigate, query } from '../../lib/router.js';
  import { loadModel, predictPlan } from '../../lib/ml/index.js';
  import { fetchRouteWeather } from '../../services/weatherService.js';
  import {
    distanceUnit,
    elevationUnit,
    fromDisplayElevation,
    fromDisplayTemp,
    tempUnit,
    toDisplayDistance,
    toDisplayElevation,
    toDisplayTemp,
  } from '../../lib/units.js';
  import { readCachedPlace } from '../../lib/location.js';
  import { nf, toDatetimeLocal } from '../../lib/format.js';

  const TYPES = [
    { id: 'run', label: 'Run', hint: 'Road, trail or treadmill' },
    { id: 'ride', label: 'Ride', hint: 'Road or gravel' },
    { id: 'walk', label: 'Walk', hint: 'Easy or brisk' },
    { id: 'hike', label: 'Hike', hint: 'Trail with climbing' },
  ];

  let model = $state(null);
  let saving = $state(false);
  let saved = $state(null);
  let saveSeq = 0;
  let loadedFromSaved = $state(false);
  let confirmDeletePlanId = $state(null);
  let deletingPlanId = $state(null);
  let showAllPlans = $state(false);
  let customPlannedFor = $state(false);

  let forecast = $state(null);
  let weatherSeq = 0;

  let form = $state({
    activity_type: 'run',
    distance_km: '',
    elevation_gain_m: '',
    temperature_c: 26,
    sweat_profile: 'normal',
    planned_for: toDatetimeLocal(new Date()),
  });

  let prediction = $state(null);
  let computing = $state(false);

  const visiblePlans = $derived(showAllPlans ? $plans : $plans.slice(0, 4));

  /** Distance in km the model should use, or 0 when the field is unusable. */
  const typedDistanceKm = $derived.by(() => {
    const raw = Number(form.distance_km);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    // The field is edited in the athlete's own unit system.
    return $unitSystem === 'imperial' ? raw * 1.609344 : raw;
  });

  const canPredict = $derived(Boolean($profile) && Boolean(model) && typedDistanceKm > 0.1);

  onMount(() => {
    void loadFuelItems();
    void loadRaceEvents();
    void (async () => {
      model = await loadModel();
      const params = $query;
      const planId = params.get('plan');
      const requestedPlan = planId ? $plans.find((p) => String(p.id) === String(planId)) : null;

      if (requestedPlan) {
        loadSavedPlan(requestedPlan);
      } else {
        const sportParam = params.get('type') || params.get('sport');
        if (sportParam && TYPES.some((t) => t.id === sportParam)) form.activity_type = sportParam;
        const tempParam = Number(params.get('temp'));
        form.temperature_c = Number.isFinite(tempParam) && params.get('temp') !== null
          ? tempParam
          : ($profile?.typical_temperature_c ?? 26);
        const eleParam = Number(params.get('elevation'));
        if (Number.isFinite(eleParam) && params.get('elevation') !== null && eleParam >= 0) {
          form.elevation_gain_m = String(Math.round(toDisplayElevation(eleParam, $unitSystem)));
        }
        const distParam = Number(params.get('distance'));
        if (Number.isFinite(distParam) && params.get('distance') !== null && distParam > 0) {
          form.distance_km = toDisplayDistance(distParam, $unitSystem).toFixed(2);
        }
        form.sweat_profile = $profile?.sweat_profile ?? 'normal';
        const dateParam = params.get('date');
        if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
          form.planned_for = `${dateParam}T07:00`;
          customPlannedFor = true;
        } else if (!customPlannedFor && !form.planned_for) {
          form.planned_for = toDatetimeLocal(new Date());
        }
      }
    })();

    // Optional convenience: the forecast for the athlete's last known place.
    // Purely informational — it prefills nothing, and a failure is silent.
    const cachedPlace = readCachedPlace();
    if (cachedPlace) {
      const seq = ++weatherSeq;
      void fetchRouteWeather(cachedPlace.latitude, cachedPlace.longitude, new Date().toISOString())
        .then((result) => {
          if (seq === weatherSeq) forecast = result;
        });
    }
  });

  function markEdited() {
    saveSeq += 1;
    saved = null;
    loadedFromSaved = false;
  }

  async function run() {
    if (!canPredict) {
      computing = false;
      return;
    }
    computing = true;
    try {
      prediction = await predictPlan({
        activity: {
          activity_type: form.activity_type,
          distance_km: typedDistanceKm,
          elevation_gain_m: Number(form.elevation_gain_m) || 0,
          temperature_c: Number(form.temperature_c),
          // No drawn route any more: the athlete states the distance.
          route: null,
        },
        profile: {
          ...$profile,
          sweat_profile: form.sweat_profile,
          daily_carb_goal_g: $goals?.carb_target_g ?? $profile?.daily_carb_goal_g,
        },
        activities: $activities,
        fuelItems: $fuelItems,
        acwr: $trainingLoad?.acwr ?? null,
        carbLoading: Boolean($activeRacePrep?.prep?.inCarbLoadWindow),
      });
    } finally {
      computing = false;
    }
  }

  // Recompute whenever the inputs change (debounced), so the fueling numbers
  // follow the fields live instead of waiting for a button press.
  let timer;
  $effect(() => {
    void model;
    void $profile;
    void form.activity_type;
    void form.distance_km;
    void form.elevation_gain_m;
    void form.temperature_c;
    void form.sweat_profile;
    void form.planned_for;
    void $activities.length;

    clearTimeout(timer);
    if (loadedFromSaved) return;

    if (!canPredict) {
      computing = false;
      prediction = null;
      return;
    }

    timer = setTimeout(run, 180);
  });

  function startOver() {
    clearTimeout(timer);
    saveSeq += 1;
    customPlannedFor = false;
    saved = null;
    loadedFromSaved = false;
    confirmDeletePlanId = null;
    prediction = null;
    computing = false;
    form = {
      activity_type: 'run',
      distance_km: '',
      elevation_gain_m: '',
      temperature_c: $profile?.typical_temperature_c ?? 26,
      sweat_profile: $profile?.sweat_profile ?? 'normal',
      planned_for: toDatetimeLocal(new Date()),
    };
  }

  function pickType(id) {
    markEdited();
    form.activity_type = id;
  }

  function loadSavedPlan(plan) {
    if (!plan) return;
    clearTimeout(timer);
    confirmDeletePlanId = null;
    loadedFromSaved = true;
    form.activity_type = plan.activity_type || 'run';
    form.distance_km = toDisplayDistance(Number(plan.distance_km) || 0, $unitSystem).toFixed(2);
    form.elevation_gain_m = String(Math.round(toDisplayElevation(Number(plan.elevation_gain_m) || 0, $unitSystem)));
    customPlannedFor = Boolean(plan.planned_for);
    form.temperature_c = Number(plan.temperature_c ?? ($profile?.typical_temperature_c ?? 26));
    form.sweat_profile = plan.sweat_profile || $profile?.sweat_profile || 'normal';
    form.planned_for = plan.planned_for ? toDatetimeLocal(plan.planned_for) : toDatetimeLocal(new Date());
    // Show exactly what was saved. Editing any field releases this and the
    // numbers recompute from the new inputs.
    prediction = plan;
    saved = plan;
  }

  async function save() {
    if (!prediction || saving) return;
    saving = true;
    const seq = ++saveSeq;
    let written = false;
    let created = null;
    if (!customPlannedFor) {
      form.planned_for = toDatetimeLocal(new Date());
    }
    const plannedDate = form.planned_for ? new Date(form.planned_for) : null;
    const plannedForIso =
      plannedDate && Number.isFinite(plannedDate.getTime()) ? plannedDate.toISOString() : null;
    try {
      created = await api.predictions.create({
        activity_type: form.activity_type,
        distance_km: Number(typedDistanceKm.toFixed(2)),
        elevation_gain_m: Number(form.elevation_gain_m) || 0,
        // Deliberately omitted: there is no drawn route to send.
        temperature_c: Number(form.temperature_c),
        sweat_profile: form.sweat_profile,
        planned_for: plannedForIso,
      });
      written = true;
      upsertPlan(created);
      if (seq === saveSeq) {
        saved = created;
        prediction = created;
      }
      notify('Plan saved — it’s on your dashboard.');
    } catch (error) {
      if (written && seq === saveSeq) {
        saved = created;
        prediction = created;
      }
      notify(written ? 'Plan saved, but the view could not refresh. Reload when connected.' : (error.message || 'Could not save the plan'), 'error');
    } finally {
      saving = false;
    }
  }

  async function deleteSavedPlan(plan) {
    if (!plan || deletingPlanId) return;
    deletingPlanId = plan.id;
    let deleted = false;
    try {
      await api.predictions.remove(plan.id);
      deleted = true;
      confirmDeletePlanId = null;

      removePlanById(plan.id);
      if ($plans.length <= 4) showAllPlans = false;

      if (saved && String(saved.id) === String(plan.id)) {
        if (loadedFromSaved) {
          startOver();
        } else {
          saved = null;
          if (prediction && String(prediction.id) === String(plan.id)) {
            prediction = { ...prediction, id: undefined };
          }
        }
      }

      notify('Saved plan deleted.', 'info');
    } catch (error) {
      notify(
        deleted
          ? 'Plan deleted, but the view could not refresh. Reload when connected.'
          : (error.message || 'Could not delete the saved plan'),
        'error',
      );
    } finally {
      deletingPlanId = null;
    }
  }
</script>

<BusyOverlay open={saving} label="Saving your plan…" />

<div class="space-y-5">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <span class="pill mb-2"><Sparkles size={12} /> TRANA prediction</span>
      <h1 class="font-display text-2xl sm:text-3xl">Plan your next session</h1>
      <p class="mt-1 text-sm font-semibold text-ink-400">
        Tell TRANA how far you're going and what you're doing. You'll get the time it should take and exactly what to eat and drink beforehand.
      </p>
    </div>
    <button class="btn-ghost self-start" onclick={() => navigate('/activities')}>
      Log a past activity <ArrowRight size={15} />
    </button>
  </div>

  <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
    <div class="space-y-4 min-w-0">
      <div class="scroll-mt-20" data-tour="plan-activity-card">
        <Card flat>
          <h2 class="text-lg">Activity & conditions</h2>
          <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {#each TYPES as type (type.id)}
              <button
                class="flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition {form.activity_type === type.id
                  ? 'border-transparent bg-brand-gradient text-white shadow-glow'
                  : 'border-brand-100 bg-white/80 text-ink-500 hover:border-brand-200'}"
                onclick={() => pickType(type.id)}
              >
                <ActivityIcon type={type.id} size="sm" tone={form.activity_type === type.id ? 'solid' : 'brand'} />
                <span class="text-sm font-extrabold">{type.label}</span>
                <span class="text-[11px] font-semibold leading-tight {form.activity_type === type.id ? 'text-white/80' : 'text-ink-400'}">
                  {type.hint}
                </span>
              </button>
            {/each}
          </div>
        </Card>
      </div>

      <Card>
        <div class="flex items-center gap-2">
          <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-100 text-brand-600"><Activity size={17} /></span>
          <div>
            <h2 class="text-lg leading-tight">How far are you going?</h2>
            <p class="text-xs font-semibold text-ink-400">This is the only number TRANA needs to estimate your fuel.</p>
          </div>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div class="min-w-0">
            <span class="label">Distance</span>
            <div class="flex gap-2">
              <input
                class="input num-tabular"
                type="number"
                min="0"
                step="0.1"
                inputmode="decimal"
                placeholder="e.g. 10"
                aria-label="Distance"
                value={form.distance_km}
                oninput={(e) => { markEdited(); form.distance_km = e.currentTarget.value; }}
              />
              <span class="grid w-14 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">{distanceUnit($unitSystem)}</span>
            </div>
            {#if typedDistanceKm > 0}
              <p class="mt-1 text-[11px] font-bold text-brand-600">Plan length set</p>
            {:else}
              <p class="mt-1 text-[11px] font-semibold text-ink-400">Enter a distance to see your plan</p>
            {/if}
          </div>

          <div class="min-w-0">
            <span class="label"><Mountain size={11} class="mr-1 inline" /> Climb (optional)</span>
            <div class="flex gap-2">
              <input
                class="input num-tabular"
                type="number"
                min="0"
                step="10"
                inputmode="numeric"
                placeholder="0"
                aria-label="Elevation gain"
                value={form.elevation_gain_m}
                oninput={(e) => { markEdited(); form.elevation_gain_m = e.currentTarget.value; }}
              />
              <span class="grid w-14 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">{elevationUnit($unitSystem)}</span>
            </div>
            <p class="mt-1 text-[11px] font-semibold text-ink-400">Leave 0 if it's flat.</p>
          </div>

          <div class="min-w-0">
            <span class="label"><Thermometer size={11} class="mr-1 inline" /> Expected temperature</span>
            <div class="flex gap-2">
              <input
                class="input num-tabular"
                type="number"
                min="-15"
                max="120"
                value={Math.round(toDisplayTemp(form.temperature_c, $unitSystem))}
                oninput={(e) => {
                  const val = Number(e.currentTarget.value);
                  markEdited();
                  if (Number.isFinite(val)) form.temperature_c = Math.round(fromDisplayTemp(val, $unitSystem));
                }}
              />
              <span class="grid w-14 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">{tempUnit($unitSystem)}</span>
            </div>
            {#if forecast?.tempC != null}
              <div class="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-brand-600">
                <span class="num-tabular">
                  Forecast{forecast.hourLabel ? ` (${forecast.hourLabel})` : ''}: {Math.round(toDisplayTemp(forecast.tempC, $unitSystem))}{tempUnit($unitSystem)}
                  {#if forecast.humidityPct != null} · {forecast.humidityPct}% RH{/if}
                </span>
                <button
                  type="button"
                  class="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-extrabold text-brand-700 hover:bg-brand-100"
                  onclick={() => { markEdited(); form.temperature_c = forecast.tempC; }}
                >
                  Apply
                </button>
              </div>
            {/if}
          </div>

          <div class="min-w-0">
            <span class="label">When</span>
            <input
              class="input"
              type="datetime-local"
              aria-label="When"
              bind:value={form.planned_for}
              oninput={() => { customPlannedFor = true; markEdited(); }}
            />
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
            onSelect={(v) => { markEdited(); form.sweat_profile = v; }}
          />
        </div>
      </Card>
    </div>

    <!-- result -->
    <div class="space-y-4">
      {#if computing && !prediction}
        <Card class="space-y-4 p-5">
          <Skeleton variant="chart" height={120} />
          <Skeleton variant="cards" count={4} />
          <Skeleton variant="rows" count={3} />
        </Card>
      {:else if !prediction}
        <Card class="grid place-items-center text-center !py-14 px-6 border-dashed border-brand-200 bg-brand-50/40">
          <div class="grid h-12 w-12 place-items-center rounded-2xl bg-white text-brand-500 shadow-soft">
            <MapPin size={22} />
          </div>
          <h3 class="mt-4 font-display text-lg font-extrabold text-ink-900">
            Enter a distance to see your fueling plan
          </h3>
          <p class="mt-1.5 max-w-sm text-xs font-semibold text-ink-500">
            TRANA turns the distance and climb into the time it should take, then the calories, carbs, and electrolytes you'll need before you set off.
          </p>
        </Card>
      {:else if prediction}
        <Card class="!p-4 sm:!p-5">
          <div class="mb-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <ActivityIcon type={form.activity_type} size="sm" />
              <div>
                <p class="text-sm font-extrabold capitalize">{nf(toDisplayDistance(typedDistanceKm, $unitSystem), 2)} {distanceUnit($unitSystem)} {form.activity_type}</p>
                <p class="text-[11px] font-semibold text-ink-400">
                  {nf(Math.round(toDisplayElevation(Number(form.elevation_gain_m) || 0, $unitSystem)))} {elevationUnit($unitSystem)} gain · {Math.round(toDisplayTemp(form.temperature_c, $unitSystem))} {tempUnit($unitSystem)}
                </p>
              </div>
            </div>
            {#if computing}
              <LoaderCircle size={15} class="animate-spin text-brand-400" />
            {/if}
          </div>

          <FuelingPlan plan={prediction} />

          {#if Number(prediction?.duration?.historyCount ?? 0) === 0}
            <!-- The estimate above is a population average for this sport.
                 This is the one place the athlete can act on that. -->
            <div class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p class="text-[11px] font-semibold leading-relaxed text-amber-900">
                This uses a generic {prediction?.activity_type ?? 'sport'} pace. Add two past sessions and TRANA estimates from your own data.
              </p>
              <button type="button" class="btn-chip !border-amber-300 !bg-white !text-amber-800" onclick={() => navigate('/onboarding')}>
                Add past sessions
              </button>
            </div>
          {/if}

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
            <button class="btn-ghost" onclick={startOver}>
              <Play size={15} /> Start over
            </button>
          </div>

          {#if saved}
            <div class="mt-3 rounded-2xl bg-emerald-50 p-3 text-[11px] font-bold text-emerald-700">
              Plan #{saved.id} saved. Once you've done it, log what actually happened under Activities — TRANA compares the two.
            </div>
          {/if}
        </Card>
      {/if}

      {#if $plans.length > 0}
        <Card>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <h2 class="text-base">Saved plans</h2>
              <span class="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-ink-500">
                {$plans.length}
              </span>
            </div>
            {#if $plans.length > 4}
              <button
                type="button"
                class="text-[11px] font-extrabold text-brand-600 hover:underline"
                onclick={() => (showAllPlans = !showAllPlans)}
              >
                {showAllPlans ? 'Show recent (4)' : `Show all (${$plans.length})`}
              </button>
            {/if}
          </div>
          <div class="mt-2 divide-y divide-brand-100/70">
            {#each visiblePlans as plan (plan.id)}
              <div class="flex flex-wrap items-center justify-between gap-2 py-2.5 sm:flex-nowrap">
                <button
                  type="button"
                  class="flex min-w-[180px] flex-1 items-center gap-3 text-left transition hover:opacity-75"
                  onclick={() => loadSavedPlan(plan)}
                >
                  <ActivityIcon type={plan.activity_type} size="sm" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-extrabold capitalize">
                      {$unitSystem === 'imperial' ? `${Number(toDisplayDistance(plan.distance_km, 'imperial').toFixed(2))} mi` : `${plan.distance_km} km`} {plan.activity_type}
                    </p>
                    <p class="text-[10px] font-semibold text-ink-400">
                      ~{Math.round(plan.duration?.minutes ?? 0)} min · {plan.fueling?.carbs?.perHourG ?? 0} g carbs/h
                    </p>
                  </div>
                  <span class="shrink-0 text-[10px] font-bold text-ink-400">
                    {new Date(plan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </button>
                {#if confirmDeletePlanId === plan.id}
                  <div class="ml-auto flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      class="btn-chip !border-rose-200 !bg-rose-50 !text-rose-600 hover:!bg-rose-100"
                      disabled={deletingPlanId === plan.id}
                      onclick={() => deleteSavedPlan(plan)}
                    >
                      {#if deletingPlanId === plan.id}
                        <LoaderCircle size={11} class="animate-spin" /> Deleting…
                      {:else}
                        Delete
                      {/if}
                    </button>
                    <button
                      type="button"
                      class="btn-chip"
                      disabled={deletingPlanId === plan.id}
                      onclick={() => (confirmDeletePlanId = null)}
                    >
                      Cancel
                    </button>
                  </div>
                {:else}
                  <div class="ml-auto flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-100 bg-white/80 text-ink-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      title="Delete saved plan"
                      aria-label="Delete saved plan {$unitSystem === 'imperial' ? `${Number(toDisplayDistance(plan.distance_km, 'imperial').toFixed(2))} mi` : `${plan.distance_km} km`} {plan.activity_type}"
                      disabled={Boolean(deletingPlanId)}
                      onclick={() => (confirmDeletePlanId = plan.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </Card>
      {/if}
    </div>
  </div>
</div>
