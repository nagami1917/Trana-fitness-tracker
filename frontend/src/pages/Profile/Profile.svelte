<script>
  import { onMount } from 'svelte';
  import { CircleUserRound, Save, LoaderCircle, Flame, Footprints, CalendarDays, Activity, Scale, SlidersHorizontal } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import CityRegionInput from '../../components/common/CityRegionInput.svelte';
  import { api } from '../../services/client.js';
  import { profile, session, notify } from '../../stores/index.js';
  import {
    fromDisplayHeight,
    fromDisplayTemp,
    fromDisplayWeight,
    heightUnit,
    tempUnit,
    toDisplayHeight,
    toDisplayTemp,
    toDisplayWeight,
    weightUnit,
  } from '../../lib/units.js';

  // Step 4 — the fitness profile feeds every prediction. `age` and
  // `fitness_level` are the spec's names; the API maps them onto the stored
  // birth_year / experience_level columns.
  let form = $state({
    name: '',
    city: '',
    weight_kg: 60,
    height_cm: '',
    age: '',
    sex: 'other',
    sweat_profile: 'normal',
    fitness_level: 3,
    activity_experience: '',
    typical_temperature_c: 26,
    units: 'metric',
  });
  let quick = $state({ weight_kg: 60, fitness_level: 3, busy: '' });
  let loading = $state(false);
  let locating = $state(false);

  function fillForm(p) {
    if (!p) return;
    form.name = p.name ?? '';
    form.city = p.city ?? '';
    form.weight_kg = p.weight_kg ?? 60;
    form.height_cm = p.height_cm ?? '';
    form.age = p.age ?? '';
    form.sex = p.sex ?? 'other';
    form.sweat_profile = p.sweat_profile ?? 'normal';
    form.fitness_level = p.fitness_level ?? p.experience_level ?? 3;
    form.activity_experience = p.activity_experience ?? '';
    form.typical_temperature_c = p.typical_temperature_c ?? 26;
    form.units = p.units ?? 'metric';
    quick.weight_kg = form.weight_kg;
    quick.fitness_level = form.fitness_level;
  }

  onMount(() => fillForm($profile));

  const initial = $derived((form.name || $session?.name || 'N').slice(0, 1).toUpperCase());
  const nullableNumber = (value) => (value == null || value === '' ? null : Number(value));

  async function save(event) {
    event.preventDefault();
    if (loading || locating) return;
    loading = true;
    let written = false;
    try {
      const updated = await api.profile.update({
        name: form.name.trim() || undefined,
        city: form.city.trim() || null,
        weight_kg: Number(form.weight_kg),
        height_cm: nullableNumber(form.height_cm),
        age: nullableNumber(form.age),
        sex: form.sex,
        sweat_profile: form.sweat_profile,
        fitness_level: Number(form.fitness_level),
        activity_experience: nullableNumber(form.activity_experience),
        typical_temperature_c: Number(form.typical_temperature_c),
        units: form.units,
      });
      written = true;
      profile.set(updated);
      if (updated?.name) session.update((s) => (s ? { ...s, name: updated.name } : s));
      fillForm(updated);
      notify('Profile saved');
    } catch (err) {
      notify(written ? 'Profile saved, but the view could not refresh. Reload when connected.' : (err.message || 'Could not save your profile'), 'error');
    } finally {
      loading = false;
    }
  }

  /** PATCH /profile/weight — the value the fueling math depends on. */
  async function saveWeight() {
    if (quick.busy) return;
    quick.busy = 'weight';
    try {
      const updated = await api.profile.updateWeight(Number(quick.weight_kg));
      profile.set(updated);
      fillForm(updated);
      notify('Body mass updated');
    } catch (err) {
      notify(err.message || 'Could not update your weight', 'error');
    } finally {
      quick.busy = '';
    }
  }

  /** PATCH /profile/fitness-level — a user-owned level survives activity logging. */
  async function saveLevel(level) {
    if (quick.busy) return;
    quick.busy = 'level';
    try {
      const updated = await api.profile.updateFitnessLevel(Number(level));
      profile.set(updated);
      fillForm(updated);
      notify('Fitness level updated');
    } catch (err) {
      notify(err.message || 'Could not update your fitness level', 'error');
    } finally {
      quick.busy = '';
    }
  }
</script>

<svelte:head>
  <title>TRANA — Profile</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-end justify-between gap-3">
  <div>
    <span class="pill w-fit bg-brand-50 text-brand-600"><CircleUserRound size={12} /> Profile</span>
    <h1 class="mt-2 font-display text-2xl font-extrabold tracking-tight text-ink-900">Your athlete profile</h1>
    <p class="max-w-lg text-sm font-semibold text-ink-400">
      Everything on this page feeds the prediction model and the fueling math — keep it current.
    </p>
  </div>
  <a href="/settings" class="btn-ghost text-xs"><SlidersHorizontal size={14} /> Theme, devices & data</a>
</header>

<div class="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
  <div class="flex flex-col gap-5">
    <!-- identity card -->
    <Card class="flex h-fit flex-col items-center gap-4 p-6 text-center">
      <div class="grid h-24 w-24 place-items-center rounded-full bg-brand-gradient font-display text-3xl font-extrabold text-white shadow-glow">
        {initial}
      </div>
      <div>
        <p class="text-lg font-extrabold text-ink-900">{$profile?.name ?? 'Athlete'}</p>
        <p class="text-xs font-semibold text-ink-400">{$session?.email ?? ''}</p>
        {#if $profile?.city}<p class="mt-1 text-xs font-bold text-brand-600">{$profile.city}</p>{/if}
      </div>
      <div class="grid w-full grid-cols-2 gap-3">
        <div class="rounded-2xl bg-brand-50/70 px-3 py-3">
          <Footprints size={16} class="mx-auto text-brand-500" />
          <p class="num-tabular mt-1 text-lg font-extrabold leading-none text-ink-900">{$profile?.total_activities ?? 0}</p>
          <p class="mt-1 text-[11px] font-bold uppercase tracking-wider text-ink-400">activities</p>
        </div>
        <div class="rounded-2xl bg-brand-50/70 px-3 py-3">
          <Flame size={16} class="mx-auto text-brand-500" />
          <p class="num-tabular mt-1 text-lg font-extrabold leading-none text-ink-900">{$profile?.daily_calorie_goal ?? '—'}</p>
          <p class="mt-1 text-[11px] font-bold uppercase tracking-wider text-ink-400">kcal / day goal</p>
        </div>
        <div class="rounded-2xl bg-brand-50/70 px-3 py-3">
          <CalendarDays size={16} class="mx-auto text-brand-500" />
          <p class="num-tabular mt-1 text-lg font-extrabold leading-none text-ink-900">{$profile?.age ?? '—'}</p>
          <p class="mt-1 text-[11px] font-bold uppercase tracking-wider text-ink-400">age</p>
        </div>
        <div class="rounded-2xl bg-brand-50/70 px-3 py-3">
          <Activity size={16} class="mx-auto text-brand-500" />
          <p class="num-tabular mt-1 text-lg font-extrabold leading-none text-ink-900">
            {$profile?.fitness_level ?? $profile?.experience_level ?? 3}<span class="text-xs">/5</span>
          </p>
          <p class="mt-1 text-[11px] font-bold uppercase tracking-wider text-ink-400">fitness level</p>
        </div>
      </div>
      {#if $profile?.activity_experience != null}
        <p class="text-[11px] font-semibold text-ink-400">
          {$profile.activity_experience} {Number($profile.activity_experience) === 1 ? 'year' : 'years'} of consistent training
        </p>
      {/if}
    </Card>

    <!-- quick updates: the dedicated weight / fitness-level endpoints -->
    <Card class="flex flex-col gap-4 p-6">
      <div class="flex items-center gap-2.5">
        <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-100 text-brand-600"><Scale size={16} /></span>
        <div>
          <p class="text-sm font-extrabold text-ink-900">Quick update</p>
          <p class="text-[11px] font-semibold text-ink-400">Body mass and fitness level save on their own.</p>
        </div>
      </div>

      <div>
        <label class="label" for="quick-weight">Body mass ({weightUnit(form.units)})</label>
        <div class="flex gap-2">
          <input
            id="quick-weight"
            type="number"
            min="25"
            max="550"
            step="0.5"
            class="input"
            value={Math.round(toDisplayWeight(quick.weight_kg, form.units) * 10) / 10}
            oninput={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isFinite(v)) quick.weight_kg = Math.round(fromDisplayWeight(v, form.units) * 10) / 10;
            }}
            disabled={quick.busy !== ''}
          />
          <button type="button" class="btn-primary shrink-0 !px-4" onclick={saveWeight} disabled={quick.busy !== ''}>
            {#if quick.busy === 'weight'}
              <LoaderCircle size={15} class="animate-spin" />
            {:else}
              Save weight
            {/if}
          </button>
        </div>
      </div>

      <div>
        <p class="label">Fitness level</p>
        <Segmented
          value={String(quick.fitness_level)}
          onSelect={(id) => saveLevel(id)}
          options={[
            { id: '1', label: '1 · New' },
            { id: '2', label: '2' },
            { id: '3', label: '3 · Regular' },
            { id: '4', label: '4' },
            { id: '5', label: '5 · Elite' },
          ]}
        />
        <p class="mt-2 text-[11px] font-semibold text-ink-400">
          Your own rating shapes the model and is not overwritten when you log a session.
        </p>
      </div>
    </Card>
  </div>

  <!-- edit form -->
  <Card class="p-6">
    <form class="grid gap-5 sm:grid-cols-2" onsubmit={save}>
      <div>
        <label class="label" for="name">Name</label>
        <input id="name" class="input" bind:value={form.name} maxlength="80" required />
      </div>
      <CityRegionInput id="profile-city" bind:value={form.city} bind:busy={locating} disabled={loading} />

      <div>
        <label class="label" for="weight">Weight ({weightUnit(form.units)})</label>
        <input
          id="weight"
          type="number"
          min="25"
          max="550"
          step="0.5"
          class="input"
          value={Math.round(toDisplayWeight(form.weight_kg, form.units) * 10) / 10}
          oninput={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isFinite(v)) form.weight_kg = Math.round(fromDisplayWeight(v, form.units) * 10) / 10;
          }}
          required
        />
      </div>
      <div>
        <label class="label" for="height">Height ({heightUnit(form.units)})</label>
        <input
          id="height"
          type="number"
          min="36"
          max="250"
          step="0.5"
          class="input"
          value={form.height_cm === '' || form.height_cm == null ? '' : Math.round(toDisplayHeight(form.height_cm, form.units) * 10) / 10}
          oninput={(e) => {
            const raw = e.currentTarget.value;
            if (raw === '') {
              form.height_cm = '';
              return;
            }
            const v = Number(raw);
            if (Number.isFinite(v)) form.height_cm = Math.round(fromDisplayHeight(v, form.units) * 10) / 10;
          }}
          placeholder="optional"
        />
      </div>

      <div>
        <label class="label" for="age">Age (years)</label>
        <input id="age" type="number" min="10" max="110" step="1" class="input" bind:value={form.age} placeholder="optional" />
      </div>
      <div>
        <label class="label" for="experience-years">Training experience (years)</label>
        <input
          id="experience-years"
          type="number"
          min="0"
          max="70"
          step="0.5"
          class="input"
          bind:value={form.activity_experience}
          placeholder="optional"
        />
      </div>

      <div class="sm:col-span-2">
        <p class="label">Sex</p>
        <Segmented
          value={form.sex}
          onSelect={(id) => (form.sex = id)}
          options={[
            { id: 'female', label: 'Female' },
            { id: 'male', label: 'Male' },
            { id: 'other', label: 'Other' },
          ]}
        />
      </div>

      <div class="sm:col-span-2">
        <p class="label">Sweat profile</p>
        <Segmented
          value={form.sweat_profile}
          onSelect={(id) => (form.sweat_profile = id)}
          options={[
            { id: 'low', label: 'Light sweater' },
            { id: 'normal', label: 'Average' },
            { id: 'high', label: 'Salty sweater' },
          ]}
        />
      </div>

      <div class="sm:col-span-2">
        <p class="label">Fitness level</p>
        <Segmented
          value={String(form.fitness_level)}
          onSelect={(id) => (form.fitness_level = Number(id))}
          options={[
            { id: '1', label: '1 · New' },
            { id: '2', label: '2' },
            { id: '3', label: '3 · Regular' },
            { id: '4', label: '4' },
            { id: '5', label: '5 · Elite' },
          ]}
        />
      </div>

      <div class="sm:col-span-2">
        <div class="flex items-baseline justify-between">
          <label class="label" for="temp">Typical training temperature</label>
          <p class="text-sm font-extrabold text-brand-700">{Math.round(toDisplayTemp(form.typical_temperature_c, form.units))}{tempUnit(form.units)}</p>
        </div>
        <input id="temp" type="range" min="-10" max="50" step="1" bind:value={form.typical_temperature_c} class="mt-2 w-full accent-brand-500" />
      </div>

      <div class="sm:col-span-2">
        <p class="label">Units</p>
        <Segmented
          value={form.units}
          onSelect={(id) => (form.units = id)}
          options={[
            { id: 'metric', label: 'Metric (km, kg)' },
            { id: 'imperial', label: 'Imperial (mi, lb)' },
          ]}
        />
      </div>

      <div class="sm:col-span-2">
        <button type="submit" class="btn-primary w-full !py-3" disabled={loading || locating}>
          {#if loading}
            <LoaderCircle size={17} class="animate-spin" /> Saving…
          {:else}
            <Save size={17} /> Save profile
          {/if}
        </button>
      </div>
    </form>
  </Card>
</div>
