<script>
  import { onMount } from 'svelte';
  import { link, query } from '../../lib/router.js';
  import { dailySessionApi, formatSessionDate } from '../../services/dailySessionService.js';
  import { notify } from '../../stores/index.js';
  import DailyProgress from '../../components/activity/DailyProgress.svelte';
  import FoodLogger from '../../components/activity/FoodLogger.svelte';

  let { sessionId = null } = $props();

  let session = $state(null);
  let loading = $state(true);

  const idFromQuery = $query.get('id');

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
    <div class="rounded-2xl border border-brand-100 bg-white p-12 text-center text-ink-400 text-sm">
      Loading session…
    </div>
  {:else if !session}
    <div class="rounded-2xl border border-brand-100 bg-white p-12 text-center">
      <p class="text-ink-600 text-sm font-semibold">Session not found.</p>
      <a
        href="/track/history"
        use:link
        class="mt-4 inline-flex items-center justify-center rounded-xl px-5 py-2.5 bg-brand-gradient text-white text-xs font-bold shadow-glow"
      >
        Browse session history
      </a>
    </div>
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Session Detail</p>
        <h1 class="text-2xl font-display font-extrabold text-ink-900">
          {formatSessionDate(session.session_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </h1>
      </div>
      <span
        class="px-3.5 py-1.5 rounded-full text-xs font-bold {session.net_calories > 0 ? 'bg-rose-50 text-rose-600' : session.net_calories < 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-700'}"
      >
        {session.net_calories > 0 ? `+${session.net_calories}` : session.net_calories} kcal net
      </span>
    </div>

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
