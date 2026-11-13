<script>
  import { onMount } from 'svelte';
  import { Salad, Flame, Wheat, Droplets, Soup, ArrowRight, Package, Plus, Trash2, Check } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import DailyProgress from '../../components/activity/DailyProgress.svelte';
  import FoodLogger from '../../components/activity/FoodLogger.svelte';
  import { recommendFueling, INTENSITY_COPY, gelEquivalent, DEFAULT_KIT_ITEMS } from '../../lib/ml/fueling.js';
  import { goals, profile, unitSystem, fuelItems, loadFuelItems, trainingLoad, activeRacePrep, loadRaceEvents, notify } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { navigate } from '../../lib/router.js';
  import { dailySessionApi } from '../../services/dailySessionService.js';
  import {
    elevationUnit,
    fluidUnit,
    tempUnit,
    toDisplayElevation,
    toDisplayFluid,
    toDisplayTemp,
    toDisplayWeight,
    weightUnit,
  } from '../../lib/units.js';

  // Typical easy speeds per modality — used only to seed the MET estimate.
  const SPEEDS = { run: 9.0, ride: 21.0, walk: 4.8, hike: 3.8 };

  let activityType = $state('run');
  let durationMin = $state(90);
  let temperatureC = $state($profile?.typical_temperature_c ?? 26);
  let elevationPerKm = $state(0);
  let todaySession = $state(undefined);

  // Custom Fuel Kit state
  let addingItem = $state(false);
  let itemSaving = $state(false);
  let newItem = $state({ name: '', category: 'gel', carbs_g: 25, sodium_mg: 55, fluid_ml: 0 });

  onMount(async () => {
    void loadFuelItems();
    void loadRaceEvents();
    try {
      const res = await dailySessionApi.today();
      todaySession = res?.data ?? null;
    } catch {
      todaySession = null;
    }
  });

  const activeKitSource = $derived($fuelItems.length ? $fuelItems : DEFAULT_KIT_ITEMS);

  const plan = $derived(
    recommendFueling({
      activityType,
      durationMin,
      weightKg: Number($profile?.weight_kg) || 60,
      elevationPerKm,
      avgSpeedKmh: SPEEDS[activityType],
      sweatProfile: $profile?.sweat_profile ?? 'normal',
      temperatureC,
      dailyCarbTargetG: $goals?.carb_target_g ?? $profile?.daily_carb_goal_g,
      energyCalibrationFactor: Number($profile?.energy_calibration_factor) || 1,
      maxHr: $profile?.max_hr ?? null,
      restingHr: $profile?.resting_hr ?? null,
      acwr: $trainingLoad?.acwr ?? null,
      carbLoading: Boolean($activeRacePrep?.prep?.inCarbLoadWindow),
      fuelItems: activeKitSource,
    }),
  );
  const intensityCopy = $derived(INTENSITY_COPY[plan.intensity] ?? INTENSITY_COPY.moderate);

  async function saveCustomFuelItem(event) {
    event?.preventDefault?.();
    if (!newItem.name.trim() || itemSaving) return;
    itemSaving = true;
    try {
      const created = await api.fuelItems.create({
        name: newItem.name.trim(),
        category: newItem.category,
        carbs_g: Math.max(0, Math.round(Number(newItem.carbs_g) || 0)),
        sodium_mg: Math.max(0, Math.round(Number(newItem.sodium_mg) || 0)),
        fluid_ml: Math.max(0, Math.round(Number(newItem.fluid_ml) || 0)),
        is_active: true,
      });
      fuelItems.update((rows) => [created, ...rows]);
      newItem = { name: '', category: 'gel', carbs_g: 25, sodium_mg: 55, fluid_ml: 0 };
      addingItem = false;
      notify('Added to your fueling kit.');
    } catch (err) {
      notify(err?.message || 'Could not save fuel item', 'error');
    } finally {
      itemSaving = false;
    }
  }

  async function toggleFuelItemActive(item) {
    if (!item?.id) return;
    try {
      const updated = await api.fuelItems.update(item.id, { is_active: !item.is_active });
      fuelItems.update((rows) => rows.map((r) => (r.id === item.id ? updated : r)));
    } catch (err) {
      notify(err?.message || 'Could not update item', 'error');
    }
  }

  async function removeFuelItem(id) {
    if (!id) return;
    try {
      await api.fuelItems.remove(id);
      fuelItems.update((rows) => rows.filter((r) => r.id !== id));
      notify('Removed item from kit.', 'info');
    } catch (err) {
      notify(err?.message || 'Could not delete item', 'error');
    }
  }

  function applyToPlanner() {
    const estKm = Math.max(1, Math.round((SPEEDS[activityType] * (durationMin / 60)) * 10) / 10);
    const estEle = Math.round(elevationPerKm * estKm);
    const params = new URLSearchParams({
      sport: activityType,
      elevation: String(estEle),
      temp: String(temperatureC),
    });
    navigate(`/plan?${params.toString()}`);
  }
</script>

<svelte:head>
  <title>TRANA — Fueling calculator</title>
</svelte:head>

<!-- header -->
<header class="mb-6 flex flex-col gap-1">
  <span class="pill w-fit bg-brand-50 text-brand-600"><Salad size={12} /> Fueling</span>
  <h1 class="font-display text-2xl font-extrabold tracking-tight text-ink-900">What to eat & drink</h1>
  <p class="max-w-lg text-sm font-semibold text-ink-400">
    Set the session and TRANA computes carbs, sodium and fluid from your profile, the heat and the clock —
    nothing to memorise.
  </p>
</header>

<div class="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
  <!-- controls -->
  <Card class="p-5">
    <p class="label">Activity</p>
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

    <div class="mt-5">
      <div class="flex items-baseline justify-between">
        <p class="label">Duration</p>
        <p class="text-sm font-extrabold text-brand-700">{durationMin} min</p>
      </div>
      <input type="range" min="15" max="300" step="5" bind:value={durationMin} class="mt-2 w-full accent-brand-500" />
    </div>

    <div class="mt-5">
      <div class="flex items-baseline justify-between">
        <p class="label">Climb per km</p>
        <p class="text-sm font-extrabold text-brand-700">{Math.round(toDisplayElevation(elevationPerKm, $unitSystem))} {elevationUnit($unitSystem)}</p>
      </div>
      <input type="range" min="0" max="120" step="5" bind:value={elevationPerKm} class="mt-2 w-full accent-brand-500" />
    </div>

    <div class="mt-5">
      <div class="flex items-baseline justify-between">
        <p class="label">Temperature</p>
        <p class="text-sm font-extrabold text-brand-700">{Math.round(toDisplayTemp(temperatureC, $unitSystem))}{tempUnit($unitSystem)}</p>
      </div>
      <input type="range" min="-5" max="40" step="1" bind:value={temperatureC} class="mt-2 w-full accent-brand-500" />
    </div>

    <p class="mt-5 rounded-2xl bg-brand-50/70 px-4 py-3 text-[11px] font-semibold leading-relaxed text-brand-800">
      Using your profile: {Math.round(toDisplayWeight(Number($profile?.weight_kg) || 60, $unitSystem))} {weightUnit($unitSystem)} · sweat profile “{$profile?.sweat_profile ?? 'normal'}”.
      Adjust those in <a class="font-extrabold underline" href="/profile">Profile</a>.
    </p>

    <button type="button" class="btn-primary mt-4 w-full" onclick={applyToPlanner}>
      Apply to Route Planner <ArrowRight size={15} />
    </button>
  </Card>

  <!-- output -->
  <div class="flex min-w-0 flex-col gap-5">
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card flat class="p-4">
        <Flame size={18} class="text-brand-500" />
        <p class="num-tabular mt-2 text-xl font-extrabold text-ink-900">{plan.calories.total}</p>
        <p class="text-[11px] font-bold uppercase tracking-wider text-ink-400">kcal total</p>
      </Card>
      <Card flat class="p-4">
        <Wheat size={18} class="text-amber-500" />
        <p class="num-tabular mt-2 text-xl font-extrabold text-ink-900">{plan.carbs.perHourG} g</p>
        <p class="text-[11px] font-bold uppercase tracking-wider text-ink-400">carbs / h</p>
      </Card>
      <Card flat class="p-4">
        <Soup size={18} class="text-sky-500" />
        <p class="num-tabular mt-2 text-xl font-extrabold text-ink-900">{plan.sodium.perHourMg}</p>
        <p class="text-[11px] font-bold uppercase tracking-wider text-ink-400">mg sodium / h</p>
      </Card>
      <Card flat class="p-4">
        <Droplets size={18} class="text-blue-500" />
        <p class="num-tabular mt-2 text-xl font-extrabold text-ink-900">
          {$unitSystem === 'imperial' ? Math.round(toDisplayFluid(plan.fluid.perHourMl, 'imperial')) : plan.fluid.perHourMl}
        </p>
        <p class="text-[11px] font-bold uppercase tracking-wider text-ink-400">{fluidUnit($unitSystem)} fluid / h</p>
      </Card>
    </div>

    <Card class="p-5">
      <div class="flex flex-wrap items-center gap-3">
        <span class="pill {intensityCopy.tone}">{intensityCopy.label}</span>
        <p class="text-sm font-bold text-ink-500">MET {plan.met} · {plan.carbs.totalG} g carbs total · daily target {plan.carbs.dailyTargetG} g</p>
      </div>
      <p class="mt-3 text-sm font-semibold leading-relaxed text-ink-700">
        ≈ {gelEquivalent(plan.carbs.perHourG)} per hour. Pre-session: {plan.carbs.preSessionG} g carbs in the last meal/snack.
      </p>

      <ul class="mt-4 space-y-2">
        {#each plan.notes as note}
          <li class="flex items-start gap-2 text-sm font-semibold leading-snug text-ink-700">
            <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"></span>
            {note}
          </li>
        {/each}
      </ul>
    </Card>

    <Card class="p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-700">
          <Package size={14} /> Race-Day Fueling Kit
        </p>
        {#if plan.kit?.cadence?.feedEveryMin}
          <span class="pill num-tabular">Every ~{plan.kit.cadence.feedEveryMin} min</span>
        {/if}
      </div>

      {#if plan.kit?.items?.length}
        <div class="mt-3 flex flex-wrap gap-2">
          {#each plan.kit.items as entry (entry.id || entry.name)}
            <span class="inline-flex items-center gap-1.5 rounded-2xl border border-brand-100 bg-brand-50/70 px-3 py-1.5 text-xs font-extrabold text-ink-900">
              <span class="num-tabular text-brand-700">{entry.quantity}×</span>
              <span>{entry.name}</span>
              <span class="text-[11px] font-bold text-ink-400">
                ({entry.carbsG}g{#if entry.fluidMl > 0}, {entry.fluidMl}ml{/if})
              </span>
            </span>
          {/each}
        </div>
        {#if plan.kit.cadence?.sipEveryMin}
          <p class="mt-2.5 text-xs font-semibold text-ink-500 num-tabular">
            Drink ~{plan.kit.cadence.sipMl} ml every {plan.kit.cadence.sipEveryMin} min · Kit covers {plan.kit.totals?.carbsG ?? 0} g carbs &amp; {plan.kit.totals?.sodiumMg ?? 0} mg sodium.
          </p>
        {/if}
      {:else}
        <p class="mt-2 text-xs font-semibold text-ink-500">
          Sessions under 45 minutes run comfortably on stored glycogen + water.
        </p>
      {/if}

      <!-- Manage user's custom pantry/kit -->
      <div class="mt-4 border-t border-brand-100 pt-3">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[11px] font-extrabold uppercase tracking-wide text-ink-400">
            Your custom items ({$fuelItems.length})
          </p>
          <button type="button" class="btn-chip !py-1" onclick={() => (addingItem = !addingItem)}>
            <Plus size={12} /> {addingItem ? 'Close' : 'Add gel / drink / snack'}
          </button>
        </div>

        {#if addingItem}
          <form class="mt-3 grid gap-2 rounded-2xl border border-brand-100 bg-brand-50/40 p-3 sm:grid-cols-6" onsubmit={saveCustomFuelItem}>
            <input class="input sm:col-span-2" placeholder="Name (e.g. Maurten Gel 100)" bind:value={newItem.name} required />
            <select class="input" bind:value={newItem.category}>
              <option value="gel">Gel</option>
              <option value="chew">Chew</option>
              <option value="drink">Drink</option>
              <option value="salt">Electrolyte</option>
              <option value="food">Real food</option>
            </select>
            <input class="input num-tabular" type="number" min="0" max="250" placeholder="Carbs (g)" bind:value={newItem.carbs_g} />
            <input class="input num-tabular" type="number" min="0" max="3000" placeholder="Fluid (ml)" bind:value={newItem.fluid_ml} />
            <button type="submit" class="btn-primary !py-2" disabled={itemSaving}>Save</button>
          </form>
        {/if}

        {#if $fuelItems.length > 0}
          <div class="mt-2.5 flex flex-wrap gap-1.5">
            {#each $fuelItems as item (item.id)}
              <div class="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-bold {item.is_active ? 'border-brand-200 bg-white text-ink-900' : 'border-brand-100 bg-brand-50/40 text-ink-400'}">
                <button type="button" class="inline-flex items-center gap-1" onclick={() => toggleFuelItemActive(item)}>
                  <Check size={12} class={item.is_active ? 'text-emerald-600' : 'text-ink-300'} />
                  <span>{item.name}</span>
                  <span class="num-tabular text-[11px] text-ink-400">({item.carbs_g}g)</span>
                </button>
                <button type="button" class="text-ink-300 hover:text-rose-500" aria-label="Delete {item.name}" onclick={() => removeFuelItem(item.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </Card>

    <Card class="p-5">
      <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-700">Timeline</p>
      <ol class="mt-3 space-y-3">
        {#each plan.timeline as step}
          <li class="flex items-start gap-3">
            <div class="w-28 shrink-0 rounded-xl bg-brand-50 px-2.5 py-1.5 text-center text-[11px] font-extrabold uppercase leading-tight text-brand-700">
              {step.window}
            </div>
            <div class="min-w-0">
              <p class="text-sm font-extrabold leading-tight text-ink-900">{step.label}</p>
              <p class="text-xs font-semibold text-ink-500">{step.detail}</p>
            </div>
            {#if step.carbsG > 0}
              <span class="num-tabular ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold text-amber-700">
                {step.carbsG} g
              </span>
            {/if}
          </li>
        {/each}
      </ol>
    </Card>
  </div>
</div>

<!-- Daily hydration & meal tracker directly inside Fueling -->
<div class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
  <div class="lg:col-span-2">
    <DailyProgress session={todaySession} onSessionChange={(updated) => (todaySession = updated)} />
  </div>
  <div class="lg:col-span-1">
    <FoodLogger session={todaySession} onSessionChange={(updated) => (todaySession = updated)} />
  </div>
</div>
