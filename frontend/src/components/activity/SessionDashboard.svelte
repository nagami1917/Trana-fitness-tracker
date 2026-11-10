<script>
  import { onMount } from 'svelte';
  import { dailySessionApi } from '../../services/dailySessionService.js';
  import SessionCard from './SessionCard.svelte';
  import { notify } from '../../stores/index.js';

  let sessions = $state([]);
  let loading = $state(false);

  onMount(async () => {
    loading = true;
    try {
      const data = await dailySessionApi.list({ limit: 30 });
      sessions = data?.data ?? [];
    } catch {
      sessions = [];
    } finally {
      loading = false;
    }
  });

  $: totalDays = sessions.length;
  $: totalBurned = sessions.reduce((s, d) => s + Number(d.calories_burned || 0), 0);
  $: totalEaten = sessions.reduce((s, d) => s + Number(d.calories_eaten || 0), 0);
  $: avgNet = sessions.length > 0
    ? Math.round(sessions.reduce((s, d) => s + (Number(d.net_calories || 0)), 0) / sessions.length)
    : 0;
</script>

<div class="rounded-2xl border border-brand-100 bg-white shadow-card p-4 sm:p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Session History</p>
      <p class="text-lg font-display font-extrabold text-ink-900">Your Tracking Days</p>
    </div>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-8 text-ink-400 text-sm">Loading sessions…</div>
  {:else if sessions.length === 0}
    <div class="text-center py-12">
      <p class="text-ink-500 text-sm font-semibold">No sessions yet.</p>
      <p class="text-ink-400 text-xs mt-1">Track an activity or log food to create your first day.</p>
    </div>
  {/if}

  {#if sessions.length > 0}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Days Tracked</p>
        <div class="text-2xl font-display font-extrabold text-ink-900 mt-1">{totalDays}</div>
      </div>
      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Total Burned</p>
        <div class="text-2xl font-display font-extrabold text-emerald-500 mt-1">{totalBurned} kcal</div>
      </div>
      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Total Eaten</p>
        <div class="text-2xl font-display font-extrabold text-rose-500 mt-1">{totalEaten} kcal</div>
      </div>
      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Avg Net/Day</p>
        <div class="text-2xl font-display font-extrabold {avgNet > 0 ? 'text-rose-500' : avgNet < 0 ? 'text-emerald-500' : 'text-ink-500'} mt-1">
          {avgNet > 0 ? `+${avgNet}` : avgNet} kcal
        </div>
      </div>
    </div>

    <div class="space-y-2">
      {#each sessions as session (session.id)}
        <SessionCard {session} />
      {/each}
    </div>
  {/if}
</div>