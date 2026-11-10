<script>
  import { onMount } from 'svelte';
  import { dailySessionApi } from '../../services/dailySessionService.js';
  import { notify } from '../../stores/index.js';
  import DailyProgress from '../../components/activity/DailyProgress.svelte';
  import FoodLogger from '../../components/activity/FoodLogger.svelte';
  import { query } from '../../lib/router.js';

  let { sessionId = null } = $props();

  let session = $state(null);
  let loading = $state(true);

  const idFromQuery = $query.get('id');

  onMount(async () => {
    const id = sessionId || idFromQuery;
    if (!id) return;
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

<div class="min-h-[calc(100vh-64px)] w-full flex flex-col">
  {#if loading}
    <div class="flex-1 flex items-center justify-center text-ink-400 text-sm">Loading session…</div>
  {:else if !session}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <p class="text-ink-500 text-sm font-semibold">Session not found.</p>
      </div>
    </div>
  {:else}
    <div class="flex-1">
      <div class="p-4 sm:p-6">
        <div class="flex items-center justify-between mb-6">
          <div>
            <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Session Detail</p>
            <p class="text-2xl font-display font-extrabold text-ink-900">
              {new Date(session.session_date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="px-3 py-1 rounded-full text-[10px] font-bold {session.net_calories > 0 ? 'bg-rose-50 text-rose-600' : session.net_calories < 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600'}"
            >
              {session.net_calories > 0 ? `+${session.net_calories}` : session.net_calories} kcal net
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-2">
            <DailyProgress {session} />
          </div>
          <div class="lg:col-span-1">
            <FoodLogger {session} />
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>