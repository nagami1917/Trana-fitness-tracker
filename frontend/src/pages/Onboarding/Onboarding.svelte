<script>
  import { User, Target, Droplets, Footprints, Timer, ArrowRight, LoaderCircle, Check, MapPin, Sparkles, Plus, Trash2 } from 'lucide-svelte';
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
    { id: 3, label: 'Sports', Icon: Footprints },
    { id: 4, label: 'Baseline', Icon: Timer },
  ];

  /** Mirrors App\Models\Activity::TYPES. */
  const ACTIVITY_TYPES = [
    { id: 'run', label: 'Running', hint: 'Road, trail or treadmill' },
    { id: 'ride', label: 'Cycling', hint: 'Road or gravel' },
    { id: 'walk', label: 'Walking', hint: 'Easy or brisk' },
    { id: 'hike', label: 'Hiking', hint: 'Trail with climbing' },
  ];

  /**
   * Plausible speed per sport, in km/h. Mirrors the server's
   * SPEED_BOUNDS_KMH, which mirrors the model's own filter: a row outside
   * these bounds is silently discarded by the duration model, so we warn
   * before the athlete submits rather than after.
   */
  const SPEED_BOUNDS = {
    run: [2.5, 30],
    ride: [1.5, 65],
    walk: [0.5, 14],
    hike: [0.5, 14],
  };

  /** Coarse recency, so nobody has to recall an exact day. */
  const PERIODS = [
    { id: 'this_week', label: 'This week' },
    { id: 'last_week', label: 'Last week' },
    { id: 'this_month', label: 'This month' },
    { id: 'few_months', label: 'A few months ago' },
    { id: 'longer_ago', label: 'Longer ago' },
  ];

  function blankBaselineRow(type) {
    return {
      activity_type: type,
      mode: 'pace', // distance + pace, or distance + time
      distance_km: '',
      duration_min: '',
      pace_min_per_km: '',
      elevation_gain_m: '',
      performed_period: 'last_week',
    };
  }

  /** The session's duration, whichever way the athlete chose to express it. */
  function rowMinutes(row) {
    if (row.mode === 'pace') {
      const distance = Number(row.distance_km);
      const pace = Number(row.pace_min_per_km);
      if (!(distance > 0) || !(pace > 0)) return 0;
      return pace * distance;
    }
    const minutes = Number(row.duration_min);
    return minutes > 0 ? minutes : 0;
  }

  /** The derived value, shown read-only so the two can never disagree. */
  function rowPace(row) {
    const distance = Number(row.distance_km);
    const minutes = rowMinutes(row);
    if (!(distance > 0) || !(minutes > 0)) return '';
    const pace = minutes / distance;
    const mm = Math.floor(pace);
    const ss = Math.round((pace - mm) * 60);
    return `${mm}:${String(ss).padStart(2, '0')} /${distanceUnit(form.units)}`;
  }

  /** Speed in km/h, used for the plausibility check. */
  function rowSpeedKmh(row) {
    const distance = Number(row.distance_km);
    const minutes = rowMinutes(row);
    if (!(distance > 0) || !(minutes > 0)) return 0;
    return distance / (minutes / 60);
  }

  /** A row is complete when everything the model needs is present. */
  function validBaseline(row) {
    const distance = Number(row.distance_km);
    const elevation = row.elevation_gain_m === '' ? 0 : Number(row.elevation_gain_m);
    if (!(distance >= 0.1 && distance <= 500)) return false;
    const minutes = rowMinutes(row);
    if (!(minutes >= 1 && minutes <= 1440)) return false;
    if (!(elevation >= 0 && elevation <= 12000)) return false;
    return true;
  }

  /** Non-blocking warning: the model would discard this row. */
  function speedWarning(row) {
    if (!validBaseline(row)) return '';
    const [min, max] = SPEED_BOUNDS[row.activity_type] ?? [0.5, 60];
    const speed = rowSpeedKmh(row);
    if (speed < min || speed > max) {
      return `That works out to ${speed.toFixed(1)} km/h, which the model can't use for ${activityLabel(row.activity_type).toLowerCase()} (${min}–${max} km/h). Check the distance and ${row.mode === 'pace' ? 'pace' : 'time'}.`;
    }
    return '';
  }

  function activityLabel(id) {
    return ACTIVITY_TYPES.find((type) => type.id === id)?.label ?? id;
  }

  /** Ask about the sports the athlete actually picked; all four if unpicked. */
  const baselineSports = $derived(
    preferredActivities.length > 0 ? [...preferredActivities] : ACTIVITY_TYPES.map((t) => t.id),
  );

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
  // Null in storage means "never asked"; the UI starts with nothing selected.
  let preferredActivities = $state(Array.isArray($profile?.preferred_activities) ? [...$profile.preferred_activities] : []);
  // Two reference points per sport: the model fits one pace curve per
  // activity type, so two walks never help a planned ride.
  //
  // Every sport's rows exist up front. Creating them lazily on render would
  // mutate state while the template is evaluating, which Svelte forbids;
  // unused sports are simply never posted.
  let baselineRows = $state(
    Object.fromEntries(ACTIVITY_TYPES.map((type) => [type.id, [blankBaselineRow(type.id), blankBaselineRow(type.id)]])),
  );
  let baselineSaving = $state(false);
  let baselineError = $state('');

  /** Rows for one sport — always present, never created during render. */
  function rowsFor(type) {
    return baselineRows[type] ?? [];
  }

  /** Sports with at least one usable row — the ones we actually post. */
  const filledBySport = $derived.by(() => {
    const filled = {};
    for (const type of baselineSports) {
      const rows = (baselineRows[type] ?? []).filter(validBaseline);
      if (rows.length > 0) filled[type] = rows;
    }
    return filled;
  });

  const filledSportCount = $derived(Object.keys(filledBySport).length);
  const anyBaselineWarning = $derived(
    baselineSports.some((type) => (baselineRows[type] ?? []).some((row) => speedWarning(row))),
  );

  function toggleActivity(id) {
    preferredActivities = preferredActivities.includes(id)
      ? preferredActivities.filter((item) => item !== id)
      : [...preferredActivities, id];
  }
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
    // Sports: allow "everything" explicitly, but not an unanswered question.
    if (step === 3) return Array.isArray(preferredActivities);
    // Baseline: each sport is optional, but a filled row must be usable —
    // the model would silently discard an implausible one.
    if (step === 4) return !anyBaselineWarning;
    return true;
  });

  /**
   * Post the filled baseline rows, grouped by sport. Rows already saved on a
   * previous attempt are not re-sent, so retrying after a network error cannot
   * create duplicates — the API caps each sport at two and answers 409.
   */
  async function saveBaselines() {
    const bySport = filledBySport;
    if (Object.keys(bySport).length === 0) return;

    baselineSaving = true;
    baselineError = '';
    try {
      const existing = await api.baselineActivities.list();
      const alreadySaved = {};
      for (const row of existing?.data ?? []) {
        alreadySaved[row.activity_type] = (alreadySaved[row.activity_type] ?? 0) + 1;
      }

      for (const [type, rows] of Object.entries(bySport)) {
        let saved = alreadySaved[type] ?? 0;
        for (const row of rows) {
          if (saved >= 2) break;
          await api.baselineActivities.create({
            activity_type: type,
            distance_km: Number(row.distance_km),
            duration_min: Number(rowMinutes(row).toFixed(2)),
            elevation_gain_m: row.elevation_gain_m === '' ? 0 : Number(row.elevation_gain_m),
            performed_period: row.performed_period,
          });
          saved += 1;
        }
      }
    } catch (error) {
      baselineError = error.message || 'Could not save your past sessions.';
      throw error;
    } finally {
      baselineSaving = false;
    }
  }

  async function finish(target = '/plan') {
    if (saving || locating) return;
    saving = true;
    let written = false;
    try {
      // The past sessions go in first: they are the only part that can fail on
      // a per-row basis, and a profile saved as onboarded cannot be retried.
      if (filledSportCount > 0) {
        await saveBaselines();
      }

      const updated = await api.profile.update({
        ...form,
        height_cm: form.height_cm == null || form.height_cm === '' ? null : Number(form.height_cm),
        birth_year: form.birth_year == null || form.birth_year === '' ? null : Number(form.birth_year),
        city: form.city.trim() || null,
        units: form.units,
        preferred_activities: preferredActivities,
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
      {:else if step === 2}
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
      {:else if step === 3}
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-100 text-brand-600"><Footprints size={20} /></span>
          <div>
            <h1 class="text-xl leading-tight">What do you actually do?</h1>
            <p class="text-xs font-semibold text-ink-400">Pick every sport you train. The planner and dashboard lead with your choices.</p>
          </div>
        </div>

        <div class="mt-5 grid gap-2 sm:grid-cols-2">
          {#each ACTIVITY_TYPES as type (type.id)}
            {@const selected = preferredActivities.includes(type.id)}
            <button
              type="button"
              class="flex items-center gap-3 rounded-2xl border p-3 text-left transition {selected ? 'border-brand-500 bg-brand-50' : 'border-brand-100 bg-white hover:border-brand-300'}"
              aria-pressed={selected}
              onclick={() => toggleActivity(type.id)}
            >
              <span class="grid h-9 w-9 flex-none place-items-center rounded-xl {selected ? 'bg-brand-500 text-white' : 'bg-brand-100 text-brand-600'}">
                {#if selected}<Check size={16} />{:else}<Plus size={16} />{/if}
              </span>
              <span class="min-w-0">
                <span class="block text-sm font-bold text-ink-700">{type.label}</span>
                <span class="block text-[11px] font-semibold text-ink-400">{type.hint}</span>
              </span>
            </button>
          {/each}
        </div>

        <p class="mt-3 text-[11px] font-semibold text-ink-400">
          {preferredActivities.length === 0
            ? 'Nothing selected means TRANA plans for all four — you can narrow this any time in Settings.'
            : `Selected: ${preferredActivities.map((id) => ACTIVITY_TYPES.find((t) => t.id === id)?.label).join(', ')}`}
        </p>
      {:else}
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-100 text-brand-600"><Timer size={20} /></span>
          <div>
            <h1 class="text-xl leading-tight">Two sessions per sport</h1>
            <p class="text-xs font-semibold text-ink-400">
              Only the sports you train matter here. Fill any one of them — each sport learns its own pace.
            </p>
          </div>
        </div>

        <div class="mt-4 space-y-3">
          {#each baselineSports as sport (sport)}
            {@const rows = rowsFor(sport)}
            <div class="rounded-2xl border border-brand-100 bg-white p-3">
              <div class="mb-2 flex items-center justify-between gap-2">
                <span class="flex items-center gap-1.5 text-sm font-bold text-ink-700">
                  {activityLabel(sport)}
                  {#if rows.filter(validBaseline).length >= 2}
                    <Check size={14} class="text-emerald-600" />
                  {/if}
                </span>
                <span class="text-[11px] font-semibold text-ink-400">
                  {rows.filter(validBaseline).length} of 2
                </span>
              </div>

              <div class="space-y-2">
                {#each rows as row, index (index)}
                  <div class="rounded-xl border border-brand-100 bg-brand-50/40 p-2.5">
                    <div class="mb-1.5 flex items-center justify-between gap-2">
                      <span class="text-[10px] font-bold uppercase tracking-wide text-ink-400">Session {index + 1}</span>
                      {#if rowPace(row)}
                        <span class="pill num-tabular" title="Derived from distance and time">{rowPace(row)}</span>
                      {/if}
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                      <label class="col-span-2 block">
                        <span class="label">How do you remember it?</span>
                        <select class="input" bind:value={row.mode}>
                          <option value="pace">Distance + pace</option>
                          <option value="time">Distance + time</option>
                        </select>
                      </label>

                      <label class="block">
                        <span class="label">Distance ({distanceUnit(form.units)})</span>
                        <input class="input num-tabular" type="number" min="0.1" step="0.1" placeholder="5.0" bind:value={row.distance_km} />
                      </label>

                      {#if row.mode === 'pace'}
                        <label class="block">
                          <span class="label">Pace (min/{distanceUnit(form.units)})</span>
                          <input class="input num-tabular" type="number" min="0.5" step="0.1" placeholder="6.0" bind:value={row.pace_min_per_km} />
                        </label>
                      {:else}
                        <label class="block">
                          <span class="label">Time (minutes)</span>
                          <input class="input num-tabular" type="number" min="1" step="1" placeholder="28" bind:value={row.duration_min} />
                        </label>
                      {/if}

                      <label class="block">
                        <span class="label">Climb (m, optional)</span>
                        <input class="input num-tabular" type="number" min="0" step="5" placeholder="0" bind:value={row.elevation_gain_m} />
                      </label>

                      <label class="block">
                        <span class="label">When</span>
                        <select class="input" bind:value={row.performed_period}>
                          {#each PERIODS as period (period.id)}
                            <option value={period.id}>{period.label}</option>
                          {/each}
                        </select>
                      </label>
                    </div>

                    {#if speedWarning(row)}
                      <p class="mt-1.5 text-[11px] font-semibold text-amber-700" role="alert">{speedWarning(row)}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>

        {#if baselineError}
          <p class="mt-2 text-[11px] font-semibold text-rose-600" role="alert">{baselineError}</p>
        {/if}

        <p class="mt-3 text-[11px] font-semibold leading-relaxed text-ink-400">
          {#if anyBaselineWarning}
            Fix the highlighted session and TRANA can use it — an implausible pace would otherwise be ignored.
          {:else if filledSportCount > 0}
            {activityLabel(Object.keys(filledBySport)[0])} will use your own pace. Other sports start from a generic average until you add past sessions.
          {:else}
            Fill any one sport and its first plan uses your own pace. You can add the rest later — TRANA starts from a generic pace until you do.
          {/if}
        </p>
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
          {#if step === 4 && filledSportCount === 0}
            <button class="btn-ghost ml-auto" disabled={saving || anyBaselineWarning} onclick={() => finish()}>
              I don't remember
            </button>
          {/if}
          <button class="btn-primary {step === 4 && filledSportCount === 0 ? '' : 'ml-auto'}" disabled={saving || anyBaselineWarning} onclick={() => finish()}>
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
