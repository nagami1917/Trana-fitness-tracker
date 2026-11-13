<script>
  import { onMount } from 'svelte';
  import { link } from '../../lib/router.js';
  import { dailySessionApi } from '../../services/dailySessionService.js';
  import SessionCard from './SessionCard.svelte';
  import Skeleton from '../common/Skeleton.svelte';
  import { notify } from '../../stores/index.js';

  let sessions = $state([]);
  let loading = $state(false);

  onMount(async () => {
    loading = true;
    try {
      const data = await dailySessionApi.list({ limit: 30 });
      sessions = Array.isArray(data?.data) ? data.data : [];
    } catch (error) {
      sessions = [];
      notify(error.message || 'Failed to load sessions', 'error');
    } finally {
      loading = false;
    }
  });

  let totalDays = $derived(sessions.length);
  let totalBurned = $derived(sessions.reduce((s, d) => s + Number(d.calories_burned || 0), 0));
  let totalEaten = $derived(sessions.reduce((s, d) => s + Number(d.calories_eaten || 0), 0));
  let avgNet = $derived(
    sessions.length > 0
      ? Math.round(sessions.reduce((s, d) => s + Number(d.net_calories || 0), 0) / sessions.length)
      : 0
  );
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <p class="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Session History</p>
      <h1 class="font-display text-2xl sm:text-3xl font-extrabold text-ink-900">Your Tracking Days</h1>
    </div>
    <a href="/track" use:link class="btn-ghost text-xs">
      ← Back to Track
    </a>
  </div>

  <div class="card p-4 sm:p-6">
    {#if loading}
      <div class="space-y-4">
        <Skeleton variant="cards" count={4} />
        <Skeleton variant="rows" count={3} />
      </div>
    {:else if sessions.length === 0}
      <div class="text-center py-12">
        <p class="text-ink-600 text-sm font-semibold">No sessions yet.</p>
        <p class="text-ink-400 text-xs mt-1">Track an activity or log food on the Track page to create your first day.</p>
        <a
          href="/track"
          use:link
          class="btn-primary mt-4 !text-xs"
        >
          Go to Track Activity
        </a>
      </div>
    {:else}
      <div class="num-tabular grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div class="card-flat p-4">
          <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Days Tracked</p>
          <div class="text-2xl font-display font-extrabold text-ink-900 mt-1">{totalDays}</div>
        </div>
        <div class="card-flat p-4">
          <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Total Burned</p>
          <div class="text-2xl font-display font-extrabold text-emerald-600 mt-1">{totalBurned} kcal</div>
        </div>
        <div class="card-flat p-4">
          <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Total Eaten</p>
          <div class="text-2xl font-display font-extrabold text-rose-500 mt-1">{totalEaten} kcal</div>
        </div>
        <div class="card-flat p-4">
          <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Avg Net/Day</p>
          <div class="text-2xl font-display font-extrabold {avgNet > 0 ? 'text-rose-500' : avgNet < 0 ? 'text-emerald-600' : 'text-ink-500'} mt-1">
            {avgNet > 0 ? `+${avgNet}` : avgNet} kcal
          </div>
        </div>
      </div>

      <div class="space-y-3">
        {#each sessions as session (session.id)}
          <SessionCard {session} />
        {/each}
      </div>
    {/if}
  </div>
</div>
