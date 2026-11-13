<script>
  import { User, Target, Droplets, ArrowRight, LoaderCircle, Check, MapPin, Sparkles } from 'lucide-svelte';
  import { profile, goals, notify, session } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { navigate } from '../../lib/router.js';
  import { mascotTour } from '../../lib/mascotTour.svelte.js';
  import {
    distanceUnit,
    fromDisplayDistance,
    fromDisplayHeight,
    fromDisplayTemp,
    fromDisplayWeight,
    heightUnit,
    tempUnit,
    toDisplayDistance,
    toDisplayHeight,
    toDisplayTemp,
    toDisplayWeight,
    weightUnit,
  } from '../../lib/units.js';
  import Segmented from '../../components/common/Segmented.svelte';
  import CityRegionInput from '../../components/common/CityRegionInput.svelte';

  const STEPS = [
    { id: 0, label: 'You', Icon: User },
    { id: 1, label: 'Training', Icon: Target },
    { id: 2, label: 'Sweat', Icon: Droplets },
  ];

  const TRAINING_PRESETS = [
    {
      id: 'active',
      title: 'Stay Active · 3x/wk',
      summary: 'Balanced fitness & daily walks/runs',
      experience_level: 2,
      daily_calorie_goal: 2000,
      daily_distance_goal_km: 5,
      daily_active_min_goal: 45,
    },
    {
      id: 'runner',
      title: '5K / 10K Runner',
      summary: 'Consistent weekly tempo & base miles',
      experience_level: 3,
      daily_calorie_goal: 2400,
      daily_distance_goal_km: 10,
      daily_active_min_goal: 60,
    },
    {
      id: 'endurance',
      title: 'Endurance / Half+',
      summary: 'High-volume sessions & structured fueling',
      experience_level: 4,
      daily_calorie_goal: 2900,
      daily_distance_goal_km: 16,
      daily_active_min_goal: 90,
    },
  ];

  let step = $state(0);
  let saving = $state(false);
  let locating = $state(false);
  let activePreset = $state('runner');

  let form = $state({
    units: $profile?.units ?? 'metric',
    weight_kg: $profile?.weight_kg ?? 60,
    height_cm: $profile?.height_cm ?? '',
    birth_year: $profile?.birth_year ?? '',
    sex: $profile?.sex ?? 'other',
    city: $profile?.city ?? '',
    experience_level: $profile?.experience_level ?? 3,
    typical_temperature_c: $profile?.typical_temperature_c ?? 26,
    sweat_profile: $profile?.sweat_profile ?? 'normal',
    daily_calorie_goal: $profile?.daily_calorie_goal ?? 2400,
    daily_distance_goal_km: $profile?.daily_distance_goal_km ?? 10,
    daily_active_min_goal: $profile?.daily_active_min_goal ?? 60,
  });

  function applyPreset(preset) {
    activePreset = preset.id;
    form.experience_level = preset.experience_level;
    form.daily_calorie_goal = preset.daily_calorie_goal;
    form.daily_distance_goal_km = preset.daily_distance_goal_km;
    form.daily_active_min_goal = preset.daily_active_min_goal;
  }

  const canContinue = $derived.by(() => {
    if (step === 0) {
      const year = form.birth_year;
      const validYear = year == null || year === '' || (Number(year) >= 1930 && Number(year) <= new Date().getFullYear());
      return !locating && Number(form.weight_kg) >= 25 && Number(form.weight_kg) <= 250 && validYear;
    }
    if (step === 1) return Number(form.experience_level) >= 1;
    return true;
  });

  async function finish(target = '/plan') {
    if (saving || locating) return;
    saving = true;
    let written = false;
    try {
      const updated = await api.profile.update({
        ...form,
        height_cm: form.height_cm == null || form.height_cm === '' ? null : Number(form.height_cm),
        birth_year: form.birth_year == null || form.birth_year === '' ? null : Number(form.birth_year),
        city: form.city.trim() || null,
        units: form.units,
        onboarded: true,
      });
      written = true;
      profile.set(updated);
      mascotTour.queueForUser($session?.id);
      const latestGoals = await api.goals.get();
      goals.set(latestGoals);
      if (target === '/plan') notify(`All set, ${$session?.name ?? 'athlete'}! Let’s plan your first session.`);
      navigate(target, { replace: true });
    } catch (error) {
      if (written) {
        notify('Profile saved, but the view could not refresh. Reload when connected.', 'error');
        navigate(target, { replace: true });
      } else {
        notify(error.message || 'Could not save your profile', 'error');
      }
    } finally {
      saving = false;
    }
  }
</script>

<div class="grid min-h-screen place-items-center px-4 py-8">
  <div class="w-full max-w-xl">
    <!-- header -->
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <span class="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl bg-white ring-1 ring-white shadow-soft">
          <img src="/mascot-cat.png" alt="" class="h-[86%] w-auto" />
        </span>
        <div class="leading-none">
          <p class="font-display text-lg font-extrabold tracking-tight text-brand-700">TRANA</p>
          <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">let’s set you up</p>
        </div>
      </div>
      <span class="pill num-tabular">Step {step + 1} of {STEPS.length}</span>
    </div>

    <!-- progress -->
    <div class="mb-5 flex gap-1.5">
      {#each STEPS as item (item.id)}
        <div class="h-1.5 flex-1 rounded-full {item.id <= step ? 'bg-brand-gradient' : 'bg-brand-100'}"></div>
      {/each}
    </div>

    <div class="card p-6 animate-slide-up">
      {#if step === 0}
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-100 text-brand-600"><User size={20} /></span>
          <div>
            <h1 class="text-xl leading-tight">A little about you</h1>
            <p class="text-xs font-semibold text-ink-400">Body mass and preferred units drive every pace and fueling estimate.</p>
          </div>
        </div>

        <div class="mt-4">
          <span class="label">Preferred units</span>
          <Segmented
            options={[
              { id: 'metric', label: 'Metric (km, kg)' },
              { id: 'imperial', label: 'Imperial (mi, lb)' },
            ]}
            value={form.units}
            onSelect={(v) => (form.units = v)}
          />
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <span class="label">Body mass ({weightUnit(form.units)})</span>
            <input
              class="input num-tabular"
              type="number"
              step="0.5"
              min="25"
              max="550"
              value={Math.round(toDisplayWeight(form.weight_kg, form.units) * 10) / 10}
              oninput={(e) => {
                const v = Number(e.currentTarget.value);
                if (Number.isFinite(v)) form.weight_kg = Math.round(fromDisplayWeight(v, form.units) * 10) / 10;
              }}
            />
          </div>
          <div>
            <span class="label">Height ({heightUnit(form.units)}, optional)</span>
            <input
              class="input num-tabular"
              type="number"
              step="1"
              min="36"
              max="250"
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
            />
          </div>
          <div>
            <span class="label">Birth year (optional)</span>
            <input class="input num-tabular" type="number" min="1930" max={new Date().getFullYear()} bind:value={form.birth_year} />
          </div>
          <CityRegionInput id="onboarding-city" bind:value={form.city} bind:busy={locating} disabled={saving} />
        </div>

        <div class="mt-3">
          <span class="label">Sex (fine-tunes sweat & energy estimates)</span>
          <Segmented
            options={[
              { id: 'female', label: 'Female' },
              { id: 'male', label: 'Male' },
              { id: 'other', label: 'Prefer not to say' },
            ]}
            value={form.sex}
            onSelect={(v) => (form.sex = v)}
          />
        </div>
      {:else if step === 1}
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-100 text-brand-600"><Target size={20} /></span>
          <div>
            <h1 class="text-xl leading-tight">How do you train?</h1>
            <p class="text-xs font-semibold text-ink-400">Pick a quick preset or dial in your own daily goals.</p>
          </div>
        </div>

        <!-- 3 quick-select training presets -->
        <div class="mt-4 grid gap-2.5 sm:grid-cols-3">
          {#each TRAINING_PRESETS as preset (preset.id)}
            <button
              type="button"
              class="rounded-2xl border p-3 text-left transition {activePreset === preset.id
                ? 'border-brand-400 bg-brand-50/90 shadow-soft'
                : 'border-brand-100 bg-white hover:border-brand-200'}"
              onclick={() => applyPreset(preset)}
            >
              <p class="text-xs font-extrabold text-ink-900">{preset.title}</p>
              <p class="mt-1 text-[11px] font-semibold leading-snug text-ink-400">{preset.summary}</p>
              <p class="num-tabular mt-2 text-[11px] font-extrabold text-brand-600">
                {Math.round(toDisplayDistance(preset.daily_distance_goal_km, form.units) * 10) / 10} {distanceUnit(form.units)} · {preset.daily_active_min_goal}m
              </p>
            </button>
          {/each}
        </div>

        <div class="mt-5">
          <span class="label">Experience level ({form.experience_level}/5)</span>
          <input class="w-full accent-brand-500" type="range" min="1" max="5" step="1" bind:value={form.experience_level} />
          <div class="flex justify-between text-[11px] font-bold text-ink-400">
            <span>Just starting</span><span>Seasoned</span>
          </div>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <span class="label">Daily kcal</span>
            <input class="input num-tabular" type="number" step="50" bind:value={form.daily_calorie_goal} oninput={() => (activePreset = '')} />
          </div>
          <div>
            <span class="label">Daily {distanceUnit(form.units)}</span>
            <input
              class="input num-tabular"
              type="number"
              step="0.5"
              value={Math.round(toDisplayDistance(form.daily_distance_goal_km, form.units) * 10) / 10}
              oninput={(e) => {
                const v = Number(e.currentTarget.value);
                if (Number.isFinite(v)) {
                  form.daily_distance_goal_km = Math.round(fromDisplayDistance(v, form.units) * 10) / 10;
                  activePreset = '';
                }
              }}
            />
          </div>
          <div>
            <span class="label">Daily minutes</span>
            <input class="input num-tabular" type="number" step="5" bind:value={form.daily_active_min_goal} oninput={() => (activePreset = '')} />
          </div>
        </div>
      {:else}
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-100 text-brand-600"><Droplets size={20} /></span>
          <div>
            <h1 class="text-xl leading-tight">How much do you sweat?</h1>
            <p class="text-xs font-semibold text-ink-400">Sets your sodium and fluid baseline.</p>
          </div>
        </div>

        <div class="mt-5 space-y-3">
          <div>
            <span class="label">Sweat profile</span>
            <Segmented
              options={[
                { id: 'low', label: 'Light sweater' },
                { id: 'normal', label: 'Average' },
                { id: 'high', label: 'Heavy sweater' },
              ]}
              value={form.sweat_profile}
              onSelect={(v) => (form.sweat_profile = v)}
            />
            <p class="mt-2 text-[11px] font-semibold text-ink-400">
              {form.sweat_profile === 'high'
                ? 'Heavy sweaters lose salt quickly — TRANA will push sodium and fluid up.'
                : form.sweat_profile === 'low'
                  ? 'Light sweaters need less sodium; fluid targets stay conservative.'
                  : 'Average needs: about 550 mg sodium and 650 ml per hour in mild conditions.'}
            </p>
          </div>

          <div>
            <span class="label"><MapPin size={11} class="mr-1 inline" /> Typical training temperature ({tempUnit(form.units)})</span>
            <input
              class="input num-tabular"
              type="number"
              min="-20"
              max="130"
              value={Math.round(toDisplayTemp(form.typical_temperature_c, form.units))}
              oninput={(e) => {
                const v = Number(e.currentTarget.value);
                if (Number.isFinite(v)) form.typical_temperature_c = Math.round(fromDisplayTemp(v, form.units));
              }}
            />
          </div>

          <div class="rounded-2xl bg-brand-50/70 p-3 text-[11px] font-semibold leading-relaxed text-ink-500">
            <Check size={13} class="mr-1 inline text-emerald-500" />
            TRANA will refine all of this as you log sessions — the model learns your real pace.
          </div>
        </div>
      {/if}

      <div class="mt-6 flex items-center gap-2">
        {#if step > 0}
          <button class="btn-ghost" onclick={() => (step -= 1)}>Back</button>
        {:else}
          <button class="btn-ghost" onclick={() => finish('/')} disabled={saving || locating}>Skip for now</button>
        {/if}

        {#if step < STEPS.length - 1}
          <button class="btn-primary ml-auto" disabled={saving || !canContinue} onclick={() => (step += 1)}>
            Continue <ArrowRight size={16} />
          </button>
        {:else}
          <button class="btn-primary ml-auto" disabled={saving} onclick={() => finish()}>
            {#if saving}
              <LoaderCircle size={16} class="animate-spin" /> Saving…
            {:else}
              <Sparkles size={16} /> Start planning
            {/if}
          </button>
        {/if}
      </div>
    </div>

    <p class="mt-4 text-center text-[11px] font-semibold text-ink-400">
      You can change any of this later in Settings.
    </p>
  </div>
</div>
