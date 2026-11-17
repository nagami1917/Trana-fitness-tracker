<script>
  import { onMount } from 'svelte';
  import { link, query } from '../../lib/router.js';
  import { dailySessionApi, formatSessionDate } from '../../services/dailySessionService.js';
  import { notify } from '../../stores/index.js';
  import DailyProgress from '../../components/activity/DailyProgress.svelte';
  import FoodLogger from '../../components/activity/FoodLogger.svelte';
  import Skeleton from '../../components/common/Skeleton.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import { Activity, Clock, Flame, Route as RouteIcon } from 'lucide-svelte';

  let { sessionId = null } = $props();

  let session = $state(null);
  let loading = $state(true);
  const idFromQuery = $query.get('id');

  /** Activities finished that day, as logged. No GPS track is drawn. */
  let dayActivities = $derived(session?.activities ?? []);

  function typeLabel(type) {
    if (!type) return 'Activity';
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  function formatDuration(minutes) {
    const total = Math.round(Number(minutes) || 0);
    if (total < 60) return `${total} min`;
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }

  function formatDistance(km) {
    const value = Number(km) || 0;
    return value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(2)} km`;
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  onMount(async () => {
    const id = sessionId || idFromQuery;
    if (!id) {
      loading = false;
      return;
    }
    try {
      const data = await dailySessionApi.get(id);
      session = data?.data ?? null;
    } catch (error) {
      notify(error.message || 'Failed to load session', 'error');
    } finally {
      loading = false;
    }
  });
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <a href="/track/history" use:link class="btn-ghost text-xs">
      ← Back to History
    </a>
    <a href="/track" use:link class="btn-ghost text-xs">
      Track Activity
    </a>
  </div>

  {#if loading}
    <div class="card p-6 space-y-4">
      <Skeleton variant="cards" count={4} />
      <Skeleton variant="rows" count={3} />
    </div>
  {:else if !session}
    <div class="card p-12 text-center">
      <p class="text-ink-600 text-sm font-semibold">Session not found.</p>
      <a
        href="/track/history"
        use:link
        class="btn-primary mt-4 !text-xs"
      >
        Browse session history
      </a>
    </div>
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Session Detail</p>
        <h1 class="text-2xl font-display font-extrabold text-ink-900">
          {formatSessionDate(session.session_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </h1>
      </div>
      <span
        class="num-tabular px-3.5 py-1.5 rounded-full text-xs font-bold {session.net_calories > 0 ? 'bg-rose-50 text-rose-600' : session.net_calories < 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-700'}"
      >
        {session.net_calories > 0 ? `+${session.net_calories}` : session.net_calories} kcal net
      </span>
    </div>

    <!-- Activities finished that day -->
    {#if dayActivities.length > 0}
      <div class="card overflow-hidden">
        <div class="p-4 sm:px-6 sm:py-4">
          <p class="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Accomplished</p>
          <h2 class="font-display text-lg font-extrabold text-ink-900">
            {dayActivities.length === 1 ? 'Session you finished' : `Sessions you finished (${dayActivities.length})`}
          </h2>
        </div>

        <div class="divide-y divide-brand-100 border-t border-brand-100">
          {#each dayActivities as activity (activity.id)}
            <div class="flex items-center gap-3 px-4 py-3 sm:px-6">
              <ActivityIcon type={activity.activity_type} size="sm" />
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span class="text-sm font-extrabold text-ink-900">{typeLabel(activity.activity_type)}</span>
                  {#if activity.started_at}
                    <span class="text-[11px] font-bold text-ink-400">{formatTime(activity.started_at)}</span>
                  {/if}
                  {#if activity.source === 'manual'}
                    <span class="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-500">
                      Logged
                    </span>
                  {/if}
                </span>
                <span class="num-tabular mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-bold text-ink-500">
                  <span class="inline-flex items-center gap-1"><RouteIcon size={11} />{formatDistance(activity.distance_km)}</span>
                  <span class="inline-flex items-center gap-1"><Clock size={11} />{formatDuration(activity.duration_min)}</span>
                  {#if activity.calories}
                    <span class="inline-flex items-center gap-1"><Flame size={11} />{activity.calories} kcal</span>
                  {/if}
                </span>
              </span>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="card p-6">
        <div class="flex items-center gap-3">
          <span class="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-brand-700">
            <Activity size={18} />
          </span>
          <div>
            <p class="text-sm font-extrabold text-ink-900">No activity on this day</p>
            <p class="text-xs text-ink-500">
              Only food or water was logged, so there is no session to show.
            </p>
          </div>
        </div>
      </div>
    {/if}

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2">
        <DailyProgress {session} onSessionChange={(updated) => (session = updated)} />
      </div>
      <div class="lg:col-span-1">
        <FoodLogger {session} onSessionChange={(updated) => (session = updated)} />
      </div>
    </div>
  {/if}
</div>
