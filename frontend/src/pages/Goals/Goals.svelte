<script>
  import { onMount } from 'svelte';
  import { Target, Flame, MapPin, Timer, Save, LoaderCircle, Trophy, Check, CalendarDays } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import DonutRing from '../../components/common/DonutRing.svelte';
  import ProgressBar from '../../components/common/ProgressBar.svelte';
  import { activities, goals, todayStats, weekStats, profile, notify, refresh } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { nf, km, duration as fmtDuration, pct, startOfWeek, weekdayShort, kcal } from '../../lib/format.js';

  let form = $state({
    daily_calories: $goals?.daily_calories ?? 2700,
    daily_distance_km: $goals?.daily_distance_km ?? 10,
    daily_active_min: $goals?.daily_active_min ?? 90,
    weekly_calories: $goals?.weekly_calories ?? 15000,
    weekly_distance_km: $goals?.weekly_distance_km ?? 45,
  });
  let saving = $state(false);
  let dirty = $state(false);
  let history = $state([]);
  let historyLoading = $state(true);

  onMount(async () => {
    try {
      history = await api.goals.history();
    } catch {
      history = []; // history is non-blocking — the page works without it
    } finally {
      historyLoading = false;
    }
  });

  const GOAL_META = {
    daily_calories: { label: 'Calories burned', Icon: Flame, dec: 0, unit: 'kcal' },
    daily_distance_km: { label: 'Distance', Icon: MapPin, dec: 1, unit: 'km' },
    daily_active_min: { label: 'Active time', Icon: Timer, dec: 0, unit: 'min' },
    weekly_calories: { label: 'Weekly energy', Icon: Flame, dec: 0, unit: 'kcal' },
    weekly_distance_km: { label: 'Weekly distance', Icon: MapPin, dec: 1, unit: 'km' },
  };

  /** Rows from the API are newest-first; group consecutive rows per date. */
  const historyGroups = $derived.by(() => {
    const groups = [];
    for (const event of history) {
      let group = groups[groups.length - 1];
      if (!group || group.date !== event.date) {
        group = { date: event.date, events: [] };
        groups.push(group);
      }
      group.events.push(event);
    }
    return groups;
  });

  function prettyDate(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatGoalValue(goalKey, value) {
    const meta = GOAL_META[goalKey];
    if (!meta) return nf(Math.round(value));
    return meta.dec ? nf(value, meta.dec) : nf(Math.round(value));
  }

  $effect(() => {
    if ($goals && !dirty) {
      form = {
        daily_calories: $goals.daily_calories,
        daily_distance_km: $goals.daily_distance_km,
        daily_active_min: $goals.daily_active_min,
        weekly_calories: $goals.weekly_calories,
        weekly_distance_km: $goals.weekly_distance_km,
      };
    }
  });

  const daily = $derived([
    { key: 'daily_calories', label: 'Calories', value: $todayStats.calories, unit: 'kcal', Icon: Flame, tone: 'brand', step: 50 },
    { key: 'daily_distance_km', label: 'Distance', value: $todayStats.distance, unit: 'km', Icon: MapPin, tone: 'sky', step: 1, decimals: 1 },
    { key: 'daily_active_min', label: 'Active time', value: $todayStats.minutes, unit: 'min', Icon: Timer, tone: 'amber', step: 5 },
  ]);

  const weekly = $derived([
    { key: 'weekly_calories', label: 'Weekly energy', value: $weekStats.calories, unit: 'kcal', tone: 'brand' },
    { key: 'weekly_distance_km', label: 'Weekly distance', value: $weekStats.distance, unit: 'km', tone: 'sky' },
  ]);

  const overall = $derived(pct($todayStats.calories, form.daily_calories));

  /** Last 12 weeks of consistency, Monday-first grid. */
  const heatmap = $derived.by(() => {
    const weeks = [];
    const today = new Date();
    const start = startOfWeek(new Date(today.getTime() - 11 * 7 * 86400000));
    for (let w = 0; w < 12; w += 1) {
      const days = [];
      for (let d = 0; d < 7; d += 1) {
        const day = new Date(start.getTime() + (w * 7 + d) * 86400000);
        const load = $activities
          .filter((a) => new Date(a.started_at).toDateString() === day.toDateString())
          .reduce((s, a) => s + a.duration_min, 0);
        days.push({ date: day, minutes: load, future: day > today });
      }
      weeks.push(days);
    }
    return weeks;
  });

  function tone(minutes) {
    if (!minutes) return 'bg-brand-100/70';
    if (minutes < 25) return 'bg-brand-200';
    if (minutes < 50) return 'bg-brand-300';
    if (minutes < 80) return 'bg-brand-400';
    return 'bg-brand-600';
  }

  async function save() {
    saving = true;
    let written = false;
    try {
      await api.goals.update({
        daily_calories: Number(form.daily_calories),
        daily_distance_km: Number(form.daily_distance_km),
        daily_active_min: Number(form.daily_active_min),
        weekly_calories: Number(form.weekly_calories),
        weekly_distance_km: Number(form.weekly_distance_km),
      });
      written = true;
      await refresh();
      dirty = false;
      notify('Goals updated — TRANA will hold you to them.');
    } catch (error) {
      notify(written ? 'Goals saved, but the view could not refresh. Reload when connected.' : (error.message || 'Could not save goals'), 'error');
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-5">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" data-tour="goals-header">
    <div>
      <span class="pill mb-2"><Target size={12} /> Goals</span>
      <h1 class="font-display text-2xl sm:text-3xl">What you’re aiming for</h1>
      <p class="mt-1 text-sm font-semibold text-ink-400">Daily targets drive your summary ring and fueling day-plan.</p>
    </div>
    <button class="btn-primary self-start" onclick={save} disabled={saving}>
      {#if saving}<LoaderCircle size={15} class="animate-spin" /> Saving…{:else}<Save size={15} /> Save goals{/if}
    </button>
  </div>

  <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
    <Card class="flex flex-col items-center">
      <div class="flex w-full items-center justify-between">
        <div class="flex items-center gap-2">
          <Trophy size={17} class="text-brand-500" />
          <h2 class="text-lg">Today</h2>
        </div>
        <span class="pill">{Math.round(overall)}% complete</span>
      </div>

      <div class="mt-4">
        <DonutRing value={overall} size={190} thickness={15} label={`${Math.round(overall)}%`} sublabel="of daily goal" />
      </div>

      <div class="mt-5 w-full space-y-3">
        {#each daily as item (item.key)}
          <div class="rounded-2xl bg-brand-50/60 p-3">
            <div class="flex items-center gap-2">
              <item.Icon size={14} class="text-brand-500" />
              <span class="text-[11px] font-extrabold uppercase tracking-wide text-ink-400">{item.label}</span>
              <span class="ml-auto text-[11px] font-extrabold text-ink-900">
                {item.decimals ? km(item.value) : nf(Math.round(item.value))} / {nf(form[item.key], item.decimals ? 1 : 0)} {item.unit}
              </span>
            </div>
            <div class="mt-1.5"><ProgressBar value={item.value} max={Number(form[item.key]) || 1} tone={item.tone} height="h-2" /></div>
            <div class="mt-2 flex items-center gap-2">
              <span class="text-[10px] font-bold uppercase tracking-wide text-ink-400">Target</span>
              <input class="input !py-1.5 !text-xs max-w-[110px]" type="number" step={item.step} bind:value={form[item.key]} oninput={() => (dirty = true)} />
              <span class="text-[10px] font-bold text-ink-400">{item.unit}</span>
            </div>
          </div>
        {/each}
      </div>
    </Card>

    <div class="space-y-5">
      <Card>
        <div class="flex items-center gap-2">
          <CalendarDays size={17} class="text-brand-500" />
          <h2 class="text-lg">This week</h2>
        </div>
        <div class="mt-3 space-y-3">
          {#each weekly as item (item.key)}
            <div>
              <div class="flex items-baseline justify-between">
                <span class="text-[11px] font-extrabold uppercase tracking-wide text-ink-400">{item.label}</span>
                <span class="text-[11px] font-extrabold text-ink-900">
                  {item.unit === 'km' ? nf(item.value, 1) : nf(Math.round(item.value))} / {nf(form[item.key])} {item.unit}
                </span>
              </div>
              <div class="mt-1.5"><ProgressBar value={item.value} max={Number(form[item.key]) || 1} tone={item.tone} /></div>
              <input class="input mt-2 !py-1.5 !text-xs max-w-[130px]" type="number" bind:value={form[item.key]} oninput={() => (dirty = true)} />
            </div>
          {/each}
        </div>
      </Card>

      <Card>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Flame size={17} class="text-brand-500" />
            <h2 class="text-lg">Consistency</h2>
          </div>
          <span class="pill">last 12 weeks</span>
        </div>

        <div class="mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {#each heatmap as week, wi (wi)}
            <div class="flex flex-col gap-1.5">
              {#each week as day (day.date.toISOString())}
                <div
                  class="h-5 w-5 rounded-md {day.future ? 'bg-transparent' : tone(day.minutes)}"
                  title={day.future ? '' : `${day.date.toDateString()} · ${Math.round(day.minutes)} min`}
                ></div>
              {/each}
            </div>
          {/each}
        </div>

        <div class="mt-2 flex items-center justify-between">
          <div class="flex gap-1.5">
            {#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as label (label)}
              <span class="w-5 text-center text-[8px] font-bold text-ink-400">{label.slice(0, 1)}</span>
            {/each}
          </div>
          <div class="flex items-center gap-1">
            <span class="text-[9px] font-bold text-ink-400">less</span>
            {#each ['bg-brand-100/70', 'bg-brand-200', 'bg-brand-300', 'bg-brand-400', 'bg-brand-600'] as cls (cls)}
              <span class="h-3 w-3 rounded {cls}"></span>
            {/each}
            <span class="text-[9px] font-bold text-ink-400">more</span>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <div class="rounded-2xl bg-brand-50/70 p-3">
            <p class="text-[10px] font-extrabold uppercase tracking-wide text-ink-400">Sessions this month</p>
            <p class="font-display text-xl font-extrabold text-ink-900">
              {$activities.filter((a) => new Date(a.started_at).getMonth() === new Date().getMonth()).length}
            </p>
          </div>
          <div class="rounded-2xl bg-brand-50/70 p-3">
            <p class="text-[10px] font-extrabold uppercase tracking-wide text-ink-400">Longest this month</p>
            <p class="font-display text-xl font-extrabold text-ink-900">
              {(() => {
                const rows = $activities.filter((a) => new Date(a.started_at).getMonth() === new Date().getMonth());
                return rows.length ? `${km(Math.max(...rows.map((r) => r.distance_km)))} km` : '—';
              })()}
            </p>
          </div>
        </div>
      </Card>

      <Card class="bg-gradient-to-br from-brand-600 to-brand-700 text-white">
        <div class="flex items-start gap-3">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/20"><Check size={18} /></span>
          <div>
            <p class="text-sm font-extrabold">Daily carbs target: {nf(form.daily_calories ? Math.round(($profile?.weight_kg ?? 60) * 6) : 0)} g</p>
            <p class="mt-1 text-[11px] font-semibold leading-relaxed text-white/80">
              Based on {$profile?.weight_kg ?? 60} kg body mass and 6 g/kg for your training load. TRANA splits this into
              pre-, during- and post-session fuel on every plan.
            </p>
            <p class="mt-2 text-[11px] font-bold text-white/70">
              This week: {kcal($weekStats.calories)} kcal · {fmtDuration($weekStats.minutes)} · {nf($weekStats.distance, 1)} km
            </p>
          </div>
        </div>
      </Card>
    </div>
  </div>

  <!-- Achievement log: one row per goal reached, grouped by day (newest first). -->
  <Card>
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Trophy size={17} class="text-brand-500" />
        <h2 class="text-lg">Goal history</h2>
      </div>
      <span class="pill">
        {history.length} {history.length === 1 ? 'achievement' : 'achievements'}
      </span>
    </div>

    {#if historyLoading}
      <div class="mt-4 flex items-center gap-2 text-sm font-semibold text-ink-400">
        <LoaderCircle size={15} class="animate-spin" /> Loading history…
      </div>
    {:else if !historyGroups.length}
      <p class="mt-4 rounded-2xl bg-brand-50/60 p-4 text-sm font-semibold text-ink-400">
        No achievements yet — finish an activity that pushes a daily or weekly target over the line
        and it'll appear here, grouped by day.
      </p>
    {:else}
      <div class="mt-4 space-y-3">
        {#each historyGroups as group (group.date)}
          <div class="rounded-2xl bg-brand-50/60 p-3">
            <div class="flex items-center justify-between">
              <span class="flex items-center gap-1.5 text-xs font-extrabold text-ink-900">
                <CalendarDays size={13} class="text-brand-500" />
                {prettyDate(group.date)}
              </span>
              <span class="pill !py-0.5">
                {group.events.length} {group.events.length === 1 ? 'achievement' : 'achievements'}
              </span>
            </div>
            <div class="mt-2 space-y-1.5">
              {#each group.events as event (event.goal_key + event.created_at)}
                {@const meta = GOAL_META[event.goal_key]}
                <div class="flex items-center gap-2 rounded-xl bg-white px-2.5 py-1.5">
                  {#if meta}
                    <meta.Icon size={13} class="text-brand-500" />
                    <span class="text-[11px] font-bold text-ink-700">{meta.label}</span>
                    <span class="ml-auto text-[11px] font-extrabold text-ink-900">
                      {formatGoalValue(event.goal_key, event.achieved_value)} /
                      {formatGoalValue(event.goal_key, event.target)} {meta.unit}
                    </span>
                  {:else}
                    <span class="text-[11px] font-bold text-ink-700">{event.goal_key}</span>
                  {/if}
                  <Check size={13} class="text-emerald-500" />
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
</div>
