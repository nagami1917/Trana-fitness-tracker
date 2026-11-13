<script>
  import { onMount } from 'svelte';
  import { CalendarDays, ChevronLeft, ChevronRight, Plus, Flag, Wheat, Trash2, LoaderCircle } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import { activities, plans, profile, raceEvents, loadRaceEvents, notify, unitSystem } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { buildRacePrepPlan } from '../../lib/analytics/racePlanner.js';
  import { navigate } from '../../lib/router.js';
  import { distanceUnit, toDisplayDistance } from '../../lib/units.js';
  import {
    startOfWeek,
    isSameDay,
    weekdayShort,
    activityLabel,
    formatDistance,
    duration,
    timeLabel,
  } from '../../lib/format.js';

  const TYPES = ['run', 'ride', 'walk', 'hike'];
  let sportFilter = $state('all');
  let showRaceForm = $state(false);
  let savingRace = $state(false);
  let raceDraft = $state({
    title: '',
    activity_type: 'run',
    distance_km: 21.1,
    race_date: '',
    goal_time_min: '',
    carb_loading_enabled: true,
  });

  onMount(() => {
    void loadRaceEvents();
  });

  let weekStart = $state(startOfWeek(new Date()));

  const weekDays = $derived(
    [...Array(7)].map((_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)),
  );

  function isoDay(day) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  }

  const rangeLabel = $derived(
    `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`,
  );

  function shiftWeek(days) {
    weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + days);
  }

  function goToday() {
    weekStart = startOfWeek(new Date());
  }

  const activeTypes = $derived(sportFilter === 'all' ? TYPES : [sportFilter]);
  const weekPlans = $derived($plans.filter((p) => activeTypes.includes(p.activity_type) && p.status === 'planned' && p.planned_for));
  const weekActivities = $derived($activities.filter((a) => activeTypes.includes(a.activity_type) && a.started_at));

  const racePreps = $derived(
    $raceEvents.map((race) => ({
      race,
      prep: buildRacePrepPlan(race, Number($profile?.weight_kg) || 60),
    })),
  );

  const primaryRace = $derived(racePreps.find((item) => item.prep && item.prep.daysUntil >= 0) ?? null);

  function racesForDay(day) {
    const key = isoDay(day);
    return $raceEvents.filter((r) => r.race_date === key);
  }

  function carbDaysForDay(day) {
    const key = isoDay(day);
    const matches = [];
    for (const item of racePreps) {
      if (!item.prep?.carbLoadDays) continue;
      for (const cd of item.prep.carbLoadDays) {
        if (cd.date === key) matches.push({ raceName: item.race.title || item.race.name, ...cd });
      }
    }
    return matches;
  }

  async function saveRace(event) {
    event?.preventDefault?.();
    if (!raceDraft.title.trim() || !raceDraft.race_date || savingRace) return;
    savingRace = true;
    try {
      const created = await api.raceEvents.create({
        title: raceDraft.title.trim(),
        activity_type: raceDraft.activity_type,
        distance_km: Math.max(0.5, Number(raceDraft.distance_km) || 10),
        race_date: raceDraft.race_date,
        goal_time_min: raceDraft.goal_time_min ? Number(raceDraft.goal_time_min) : null,
        carb_loading_enabled: Boolean(raceDraft.carb_loading_enabled),
      });
      raceEvents.update((rows) => [...rows, created].sort((a, b) => a.race_date.localeCompare(b.race_date)));
      raceDraft = { title: '', activity_type: 'run', distance_km: 21.1, race_date: '', goal_time_min: '', carb_loading_enabled: true };
      showRaceForm = false;
      notify('Target race added to calendar & carb-load schedule.');
    } catch (err) {
      notify(err?.message || 'Could not save race event', 'error');
    } finally {
      savingRace = false;
    }
  }

  async function removeRace(id) {
    try {
      await api.raceEvents.remove(id);
      raceEvents.update((rows) => rows.filter((r) => r.id !== id));
      notify('Race removed from calendar.', 'info');
    } catch (err) {
      notify(err?.message || 'Could not delete race', 'error');
    }
  }

  function plansFor(day) {
    return weekPlans
      .filter((p) => isSameDay(p.planned_for, day))
      .sort((a, b) => new Date(a.planned_for) - new Date(b.planned_for));
  }

  function activitiesFor(day) {
    return weekActivities
      .filter((a) => isSameDay(a.started_at, day))
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  }

  const weekEmpty = $derived(
    weekDays.every((d) => plansFor(d).length === 0 && activitiesFor(d).length === 0 && racesForDay(d).length === 0 && carbDaysForDay(d).length === 0),
  );
</script>

<div class="space-y-5">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-2.5">
      <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
        <CalendarDays size={20} strokeWidth={2.2} />
      </span>
      <div>
        <h1 class="text-lg font-extrabold text-ink-900">Week calendar</h1>
        <p class="text-[11px] font-semibold text-ink-400">Runs, rides, walks & hikes — planned vs done</p>
      </div>
    </div>

    <div class="flex items-center gap-1.5">
      <button
        type="button"
        class="rounded-xl border border-brand-100 bg-white p-2 text-ink-500 transition hover:border-brand-300 hover:text-brand-600"
        aria-label="Previous week"
        onclick={() => shiftWeek(-7)}
      >
        <ChevronLeft size={16} />
      </button>
      <button type="button" class="pill" onclick={goToday}>Today</button>
      <button
        type="button"
        class="rounded-xl border border-brand-100 bg-white p-2 text-ink-500 transition hover:border-brand-300 hover:text-brand-600"
        aria-label="Next week"
        onclick={() => shiftWeek(7)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  </div>

  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="text-sm font-extrabold tracking-tight text-ink-500">{rangeLabel}</p>
    <div class="flex flex-wrap items-center gap-1.5">
      {#each ['all', 'run', 'ride', 'walk', 'hike'] as s (s)}
        <button
          type="button"
          class="btn-chip !py-1"
          class:btn-chip-active={sportFilter === s}
          onclick={() => (sportFilter = s)}
        >
          {s === 'all' ? 'All sports' : activityLabel(s)}
        </button>
      {/each}
      <button type="button" class="btn-chip !py-1 !border-brand-300 !text-brand-700" onclick={() => (showRaceForm = !showRaceForm)}>
        <Flag size={12} /> {showRaceForm ? 'Close' : 'Add race'}
      </button>
    </div>
  </div>

  {#if showRaceForm}
    <Card>
      <h2 class="text-sm font-extrabold text-ink-900">Schedule a target race (unlocks taper & 48h carb-loading)</h2>
      <form class="mt-3 grid gap-2.5 sm:grid-cols-6" onsubmit={saveRace}>
        <input class="input sm:col-span-2" placeholder="Race name (e.g. Manila Half Marathon)" bind:value={raceDraft.title} required />
        <select class="input" bind:value={raceDraft.activity_type}>
          <option value="run">Run</option>
          <option value="ride">Ride</option>
          <option value="walk">Walk</option>
          <option value="hike">Hike</option>
        </select>
        <input class="input num-tabular" type="number" step="0.1" min="0.5" placeholder="Distance (km)" bind:value={raceDraft.distance_km} required />
        <input class="input" type="date" bind:value={raceDraft.race_date} required />
        <button type="submit" class="btn-primary !py-2" disabled={savingRace}>
          {#if savingRace}<LoaderCircle size={14} class="animate-spin" />{:else}Save race{/if}
        </button>
      </form>
      <label class="mt-2 inline-flex items-center gap-2 text-xs font-bold text-ink-600 cursor-pointer">
        <input type="checkbox" bind:checked={raceDraft.carb_loading_enabled} class="accent-brand-600 rounded" />
        Highlight 48-hour pre-race carb-loading window (8–10 g/kg/day)
      </label>
    </Card>
  {/if}

  {#if primaryRace}
    <Card class="bg-gradient-to-br from-brand-50 to-white">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span class="pill !bg-brand-gradient !text-white">
            <Flag size={11} /> {primaryRace.prep.daysUntil === 0 ? 'Race Day!' : `${primaryRace.prep.daysUntil} days to ${primaryRace.race.title || primaryRace.race.name}`}
          </span>
          <p class="mt-2 text-xs font-semibold text-ink-500">
            {primaryRace.race.distance_km} km {activityLabel(primaryRace.race.activity_type)} · Race morning breakfast target: <span class="font-extrabold text-ink-900">{primaryRace.prep.raceDayBreakfastCarbsG} g carbs</span>
          </p>
        </div>
        <button type="button" class="btn-ghost !py-1 !text-rose-500" onclick={() => removeRace(primaryRace.race.id)}>
          <Trash2 size={13} /> Remove
        </button>
      </div>

      <div class="mt-3 grid gap-2 sm:grid-cols-4">
        {#each primaryRace.prep.weeklyPlan.slice(-4) as wk (wk.weeksOut)}
          <div class="rounded-2xl border border-brand-100 bg-white p-2.5">
            <p class="text-[10px] font-extrabold uppercase text-brand-700">{wk.label} · {wk.phase}</p>
            <p class="num-tabular text-sm font-extrabold text-ink-900 mt-0.5">
              {Math.round(toDisplayDistance(wk.targetKm, $unitSystem))} {distanceUnit($unitSystem)} / wk
            </p>
            <p class="num-tabular text-[11px] font-semibold text-ink-400">
              Long session ~{Math.round(toDisplayDistance(wk.longKm, $unitSystem))} {distanceUnit($unitSystem)}
            </p>
          </div>
        {/each}
      </div>
    </Card>
  {/if}

  {#if weekEmpty}
    <EmptyState
      title="No workouts scheduled this week"
      description="Plan one and it shows up here next to everything you've already logged."
    >
      <button type="button" class="btn-primary" onclick={() => navigate('/plan')}>Plan a workout</button>
    </EmptyState>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {#each weekDays as day (day.toISOString())}
        {@const dayPlans = plansFor(day)}
        {@const dayActs = activitiesFor(day)}
        {@const dayRaces = racesForDay(day)}
        {@const dayCarbs = carbDaysForDay(day)}
        {@const today = isSameDay(day, new Date())}
        <div
          class="rounded-2xl border p-3 {today
            ? 'border-brand-300 bg-brand-50/60 shadow-soft'
            : 'border-brand-100 bg-white'}"
        >
          <div class="flex items-start justify-between">
            <button
              type="button"
              class="leading-tight text-left transition hover:opacity-75"
              title="Schedule for {isoDay(day)}"
              onclick={() => navigate(`/plan?date=${isoDay(day)}`)}
            >
              <p class="text-[11px] font-extrabold uppercase tracking-wider {today ? 'text-brand-700' : 'text-ink-400'}">
                {weekdayShort[day.getDay()]}
              </p>
              <p class="num-tabular text-lg font-extrabold {today ? 'text-brand-700' : 'text-ink-900'}">{day.getDate()}</p>
            </button>
            <button
              type="button"
              class="rounded-lg p-1.5 text-ink-400 transition hover:bg-brand-50 hover:text-brand-600"
              aria-label="Plan a workout"
              onclick={() => navigate('/plan')}
            >
              <Plus size={14} />
            </button>
          </div>

          <div class="mt-2 space-y-1.5">
            {#each dayRaces as race (race.id)}
              <div class="flex items-center gap-1.5 rounded-xl bg-brand-gradient px-2 py-1.5 text-white shadow-soft">
                <Flag size={13} class="shrink-0" />
                <div class="min-w-0 flex-1 leading-tight">
                  <p class="truncate text-[11px] font-extrabold">{race.title || race.name}</p>
                  <p class="num-tabular truncate text-[10px] font-bold text-white/90">
                    {formatDistance(race.distance_km, $unitSystem)} {distanceUnit($unitSystem)} Race Day
                  </p>
                </div>
              </div>
            {/each}

            {#each dayCarbs as cd (cd.raceName + cd.date)}
              <div class="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900">
                <Wheat size={13} class="shrink-0 text-amber-600" />
                <div class="min-w-0 flex-1 leading-tight">
                  <p class="truncate text-[11px] font-extrabold">Carb-Load ({cd.perKg}g/kg)</p>
                  <p class="num-tabular truncate text-[10px] font-bold text-amber-700">{cd.carbsG}g carbs · {cd.raceName}</p>
                </div>
              </div>
            {/each}

            {#each dayPlans as plan (plan.id)}
              {@const matchedDone = dayActs.some((a) => a.activity_type === plan.activity_type)}
              <button
                type="button"
                class="flex w-full items-center gap-1.5 rounded-xl border border-dashed border-brand-300 bg-white/80 px-2 py-1.5 text-left transition hover:border-brand-500 hover:bg-brand-50/50"
                onclick={() => navigate(`/plan?plan=${plan.id}`)}
              >
                <ActivityIcon type={plan.activity_type} size="xs" />
                <div class="min-w-0 flex-1 leading-tight">
                  <p class="truncate text-[11px] font-extrabold text-ink-900">
                    {activityLabel(plan.activity_type)}
                    {#if matchedDone}<span class="ml-1 text-[11px] text-emerald-600">· Done</span>{/if}
                  </p>
                  <p class="num-tabular truncate text-[11px] font-semibold text-ink-400">
                    {timeLabel(plan.planned_for)} · {formatDistance(plan.distance_km, $unitSystem)} {distanceUnit($unitSystem)} · {duration(plan.duration_min ?? plan.duration?.minutes)}
                  </p>
                </div>
              </button>
            {/each}

            {#each dayActs as act (act.id)}
              <button
                type="button"
                class="flex w-full items-center gap-1.5 rounded-xl bg-brand-50 px-2 py-1.5 text-left transition hover:bg-brand-100/80"
                onclick={() => navigate(`/activities?id=${act.id}`)}
              >
                <ActivityIcon type={act.activity_type} size="xs" />
                <div class="min-w-0 flex-1 leading-tight">
                  <p class="truncate text-[11px] font-extrabold text-brand-700">{activityLabel(act.activity_type)}</p>
                  <p class="num-tabular truncate text-[11px] font-semibold text-ink-400">
                    ✓ {formatDistance(act.distance_km, $unitSystem)} {distanceUnit($unitSystem)} · {duration(act.duration_min)}
                  </p>
                </div>
              </button>
            {/each}

            {#if dayPlans.length === 0 && dayActs.length === 0 && dayRaces.length === 0 && dayCarbs.length === 0}
              <p class="py-2 text-center text-[11px] font-semibold text-ink-300">—</p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <Card>
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-semibold text-ink-400">
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-5 rounded border border-dashed border-brand-300 bg-white/80"></span>
        Planned (tap to open)
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-5 rounded bg-brand-100"></span>
        Done ✓ (tap for splits & details)
      </span>
      <span>Tap a day number to schedule for that date.</span>
    </div>
  </Card>
</div>
