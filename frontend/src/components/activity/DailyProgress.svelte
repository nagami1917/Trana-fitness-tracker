<script>
  import { onMount } from 'svelte';
  import { dailySessionApi } from '../../services/dailySessionService.js';
  import { notify } from '../../stores/index.js';

  export let session = null;
  export let loading = $state(false);

  let editing = $state(false);
  let form = $state({
    calories_burned: session?.calories_burned ?? 0,
    calories_eaten: session?.calories_eaten ?? 0,
    water_ml: session?.water_ml ?? 0,
    notes: session?.notes ?? '',
  });

  onMount(async () => {
    loading = true;
    try {
      const data = await dailySessionApi.today();
      if (data?.data) {
        session = data.data;
        form.calories_burned = session.calories_burned;
        form.calories_eaten = session.calories_eaten;
        form.water_ml = session.water_ml;
        form.notes = session.notes ?? '';
      }
    } catch {
      // Session may not exist yet — that's fine
    } finally {
      loading = false;
    }
  });

  $: netCalories = (Number(form.calories_eaten) || 0) - (Number(form.calories_burned) || 0);
  $: status = netCalories > 0 ? 'surplus' : netCalories < 0 ? 'deficit' : 'balanced';
  $: statusLabel = netCalories > 0 ? `+${netCalories} kcal` : netCalories < 0 ? `${netCalories} kcal` : 'Balanced';
  $: statusColor = netCalories > 0 ? 'text-rose-500' : netCalories < 0 ? 'text-emerald-500' : 'text-ink-500';

  async function save() {
    loading = true;
    try {
      await dailySessionApi.saveToday({
        calories_burned: Number(form.calories_burned) || 0,
        calories_eaten: Number(form.calories_eaten) || 0,
        water_ml: Number(form.water_ml) || 0,
        notes: form.notes?.trim() || null,
      });
      notify('Session updated', 'success');
      editing = false;
      const data = await dailySessionApi.today();
      if (data?.data) {
        session = data.data;
        form.calories_burned = session.calories_burned;
        form.calories_eaten = session.calories_eaten;
        form.water_ml = session.water_ml;
        form.notes = session.notes ?? '';
      }
    } catch (error) {
      notify(error.message || 'Failed to save session', 'error');
    } finally {
      loading = false;
    }
  }

  function toggleEdit() {
    editing = !editing;
    if (!editing) {
      form.calories_burned = session?.calories_burned ?? 0;
      form.calories_eaten = session?.calories_eaten ?? 0;
      form.water_ml = session?.water_ml ?? 0;
      form.notes = session?.notes ?? '';
    }
  }
</script>

<div class="rounded-2xl border border-brand-100 bg-white shadow-card p-4 sm:p-6">
  <div class="flex items-center justify-between mb-4">
    <div>
      <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Today's Session</p>
      <p class="text-xl font-display font-extrabold text-ink-900">
        {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
      </p>
    </div>
    {#if session}
      <button
        class="rounded-xl p-2 text-ink-400 hover:bg-brand-50 hover:text-brand-700 transition"
        onclick={toggleEdit}
        aria-label={editing ? 'Cancel edit' : 'Edit session'}
      >
        {editing ? '✕' : '✎'}
      </button>
    {/if}
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-8 text-ink-400 text-sm">Loading session…</div>
  {:else if !session}
    <div class="text-center py-10">
      <p class="text-ink-500 text-sm font-semibold">No session tracked yet today.</p>
      <p class="text-ink-400 text-xs mt-1">Start an activity or log your first meal to begin.</p>
    </div>
  {/if}

  {#if session}
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Burned</p>
        <div class="flex items-baseline gap-1 mt-1">
          <span class="font-display text-2xl font-extrabold text-emerald-500">{session.calories_burned}</span>
          <span class="text-sm font-bold text-ink-400">kcal</span>
        </div>
        <div class="mt-2 w-full bg-brand-100 rounded-full h-2">
          <div class="bg-emerald-500 h-2 rounded-full" style="width:{Math.min(100, (session.calories_burned / 1000) * 100)}%"></div>
        </div>
      </div>

      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Eaten</p>
        <div class="flex items-baseline gap-1 mt-1">
          <span class="font-display text-2xl font-extrabold text-rose-500">{session.calories_eaten}</span>
          <span class="text-sm font-bold text-ink-400">kcal</span>
        </div>
        <div class="mt-2 w-full bg-brand-100 rounded-full h-2">
          <div class="bg-rose-500 h-2 rounded-full" style="width:{Math.min(100, (session.calories_eaten / 1000) * 100)}%"></div>
        </div>
      </div>

      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Water</p>
        <div class="flex items-baseline gap-1 mt-1">
          <span class="font-display text-2xl font-extrabold text-brand-500">{Math.round(session.water_ml / 100)}</span>
          <span class="text-sm font-bold text-ink-400">glasses</span>
        </div>
      </div>

      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Net</p>
        <div class="flex items-baseline gap-1 mt-1">
          <span class={statusColor} class="font-display text-2xl font-extrabold">{statusLabel}</span>
        </div>
      </div>
    </div>

    {#if editing}
      <form class="mt-4 grid grid-cols-2 gap-3" onsubmit|prevent={save}>
        <div class="rounded-xl border border-brand-100 bg-white p-3 shadow-sm">
          <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Calories Burned</p>
          <input
            type="number"
            bind:value={form.calories_burned}
            class="w-full mt-1 text-sm font-bold text-ink-900 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="0"
          />
        </div>
        <div class="rounded-xl border border-brand-100 bg-white p-3 shadow-sm">
          <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Calories Eaten</p>
          <input
            type="number"
            bind:value={form.calories_eaten}
            class="w-full mt-1 text-sm font-bold text-ink-900 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="0"
          />
        </div>
        <div class="rounded-xl border border-brand-100 bg-white p-3 shadow-sm">
          <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Water (ml)</p>
          <input
            type="number"
            bind:value={form.water_ml}
            class="w-full mt-1 text-sm font-bold text-ink-900 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="0"
          />
        </div>
        <div class="rounded-xl border border-brand-100 bg-white p-3 shadow-sm col-span-2">
          <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Notes</p>
          <textarea
            bind:value={form.notes}
            rows="2"
            class="w-full mt-1 text-sm text-ink-700 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="How did today feel?"
          ></textarea>
        </div>
        <div class="col-span-2 flex gap-2 mt-2">
          <button
            type="submit"
            class="flex-1 rounded-xl py-3 border border-transparent bg-brand-gradient text-white font-bold shadow-glow hover:scale-[1.02] transition disabled:opacity-60"
            disabled={loading}
          >
            Save Session
          </button>
          <button
            type="button"
            onclick={toggleEdit}
            class="flex-1 rounded-xl py-3 border border-brand-100 bg-white text-ink-700 font-bold hover:bg-brand-50 transition"
          >
            Cancel
          </button>
        </div>
      </form>
    {/if}
  {/if}

  <slot />
</div>