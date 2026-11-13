<script>
  import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import { activities, plans, unitSystem } from '../../stores/index.js';
  import { navigate } from '../../lib/router.js';
  import { distanceUnit } from '../../lib/units.js';
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

  const weekEmpty = $derived(weekDays.every((d) => plansFor(d).length === 0 && activitiesFor(d).length === 0));
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
    <div class="flex flex-wrap gap-1.5">
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
    </div>
  </div>

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

            {#if dayPlans.length === 0 && dayActs.length === 0}
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
