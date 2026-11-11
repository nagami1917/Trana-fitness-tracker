<script>
  import { onMount } from 'svelte';
  import { dailySessionApi, formatSessionDate, todayDate } from '../../services/dailySessionService.js';
  import { notify } from '../../stores/index.js';

  let {
    session: sessionProp = undefined,
    onSessionChange = null,
    children = null,
  } = $props();

  let internalSession = $state(null);
  let loading = $state(false);
  let editing = $state(false);
  let form = $state({
    calories_burned: 0,
    calories_eaten: 0,
    water_ml: 0,
    notes: '',
  });

  let session = $derived(sessionProp !== undefined ? sessionProp : internalSession);

  function syncForm(src) {
    form.calories_burned = src?.calories_burned ?? 0;
    form.calories_eaten = src?.calories_eaten ?? 0;
    form.water_ml = src?.water_ml ?? 0;
    form.notes = src?.notes ?? '';
  }

  function applySession(updated) {
    internalSession = updated;
    syncForm(updated);
    onSessionChange?.(updated);
  }

  $effect(() => {
    if (sessionProp !== undefined && !editing) {
      syncForm(sessionProp);
    }
  });

  onMount(async () => {
    if (sessionProp !== undefined) return;
    loading = true;
    try {
      const data = await dailySessionApi.today();
      if (data?.data) applySession(data.data);
    } catch {
      // Session may not exist yet — that's fine.
    } finally {
      loading = false;
    }
  });

  let displayDate = $derived(
    session?.session_date
      ? formatSessionDate(session.session_date)
      : formatSessionDate(todayDate())
  );

  let netCalories = $derived(
    editing
      ? (Number(form.calories_eaten) || 0) - (Number(form.calories_burned) || 0)
      : Number(session?.net_calories ?? ((session?.calories_eaten ?? 0) - (session?.calories_burned ?? 0)))
  );
  let statusLabel = $derived(
    netCalories > 0 ? `+${netCalories} kcal` : netCalories < 0 ? `${netCalories} kcal` : 'Balanced'
  );
  let statusColor = $derived(
    netCalories > 0 ? 'text-rose-500' : netCalories < 0 ? 'text-emerald-500' : 'text-ink-500'
  );

  async function startToday() {
    loading = true;
    try {
      const res = await dailySessionApi.saveToday({});
      if (res?.data) {
        applySession(res.data);
        notify("Started today's session", 'success');
      }
    } catch (error) {
      notify(error.message || "Failed to start today's session", 'error');
    } finally {
      loading = false;
    }
  }

  async function save() {
    loading = true;
    try {
      const payload = {
        calories_burned: Number(form.calories_burned) || 0,
        calories_eaten: Number(form.calories_eaten) || 0,
        water_ml: Number(form.water_ml) || 0,
        notes: form.notes?.trim() || null,
      };
      const isToday = !session?.session_date || session.session_date === todayDate();
      const res = isToday
        ? await dailySessionApi.saveToday(payload)
        : await dailySessionApi.update(session.id, payload);

      if (res?.data) applySession(res.data);
      editing = false;
      notify('Session updated', 'success');
    } catch (error) {
      notify(error.message || 'Failed to save session', 'error');
    } finally {
      loading = false;
    }
  }

  function toggleEdit() {
    editing = !editing;
    syncForm(session);
  }
</script>

<div class="rounded-2xl border border-brand-100 bg-white shadow-card p-4 sm:p-6">
  <div class="flex items-center justify-between mb-4">
    <div>
      <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Daily Session</p>
      <p class="text-xl font-display font-extrabold text-ink-900">{displayDate}</p>
    </div>
    {#if session}
      <button
        type="button"
        class="rounded-xl px-3 py-1.5 text-xs font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700 transition cursor-pointer"
        onclick={toggleEdit}
        aria-label={editing ? 'Cancel edit' : 'Edit session'}
      >
        {editing ? '✕ Cancel' : '✎ Edit'}
      </button>
    {/if}
  </div>

  {#if loading && !session}
    <div class="flex items-center justify-center py-8 text-ink-400 text-sm">Loading session…</div>
  {:else if !session}
    <div class="text-center py-8">
      <p class="text-ink-600 text-sm font-semibold">No session tracked yet today.</p>
      <p class="text-ink-400 text-xs mt-1">Start a GPS activity above, or open today's session now to log water &amp; meals.</p>
      <button
        type="button"
        onclick={startToday}
        disabled={loading}
        class="mt-4 inline-flex items-center justify-center rounded-xl px-5 py-2.5 bg-brand-gradient text-white text-xs font-bold shadow-glow hover:scale-[1.01] transition cursor-pointer disabled:opacity-60"
      >
        Start today's session
      </button>
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Burned</p>
        <div class="flex items-baseline gap-1 mt-1">
          <span class="font-display text-2xl font-extrabold text-emerald-600">{session.calories_burned}</span>
          <span class="text-xs font-bold text-ink-400">kcal</span>
        </div>
        <div class="mt-2 w-full bg-brand-100 rounded-full h-2">
          <div class="bg-emerald-500 h-2 rounded-full" style="width:{Math.min(100, (session.calories_burned / 1000) * 100)}%"></div>
        </div>
      </div>

      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Eaten</p>
        <div class="flex items-baseline gap-1 mt-1">
          <span class="font-display text-2xl font-extrabold text-rose-500">{session.calories_eaten}</span>
          <span class="text-xs font-bold text-ink-400">kcal</span>
        </div>
        <div class="mt-2 w-full bg-brand-100 rounded-full h-2">
          <div class="bg-rose-500 h-2 rounded-full" style="width:{Math.min(100, (session.calories_eaten / 2500) * 100)}%"></div>
        </div>
      </div>

      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Water</p>
        <div class="flex items-baseline gap-1 mt-1">
          <span class="font-display text-2xl font-extrabold text-brand-600">{session.water_ml}</span>
          <span class="text-xs font-bold text-ink-400">ml</span>
        </div>
        <p class="text-[11px] font-semibold text-ink-400 mt-1">{Math.round((session.water_ml || 0) / 250)} × 250ml cups</p>
      </div>

      <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Net</p>
        <div class="flex items-baseline gap-1 mt-1">
          <span class="{statusColor} font-display text-xl font-extrabold">{statusLabel}</span>
        </div>
      </div>
    </div>

    {#if session.notes && !editing}
      <p class="mt-4 rounded-xl bg-brand-50/60 px-3.5 py-2.5 text-xs text-ink-600">
        <span class="font-bold text-ink-700">Notes:</span> {session.notes}
      </p>
    {/if}

    {#if editing}
      <form class="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3" onsubmit={(event) => { event.preventDefault(); save(); }}>
        <div class="rounded-xl border border-brand-100 bg-white p-3 shadow-sm">
          <label for="ds-burned" class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Calories Burned</label>
          <input
            id="ds-burned"
            type="number"
            min="0"
            bind:value={form.calories_burned}
            class="w-full mt-1 text-sm font-bold text-ink-900 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="0"
          />
        </div>
        <div class="rounded-xl border border-brand-100 bg-white p-3 shadow-sm">
          <label for="ds-eaten" class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Calories Eaten</label>
          <input
            id="ds-eaten"
            type="number"
            min="0"
            bind:value={form.calories_eaten}
            class="w-full mt-1 text-sm font-bold text-ink-900 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="0"
          />
        </div>
        <div class="rounded-xl border border-brand-100 bg-white p-3 shadow-sm">
          <label for="ds-water" class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Water (ml)</label>
          <input
            id="ds-water"
            type="number"
            min="0"
            step="50"
            bind:value={form.water_ml}
            class="w-full mt-1 text-sm font-bold text-ink-900 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="0"
          />
        </div>
        <div class="rounded-xl border border-brand-100 bg-white p-3 shadow-sm sm:col-span-3">
          <label for="ds-notes" class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Notes</label>
          <textarea
            id="ds-notes"
            bind:value={form.notes}
            rows="2"
            class="w-full mt-1 text-sm text-ink-700 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="How did today feel?"
          ></textarea>
        </div>
        <div class="sm:col-span-3 flex gap-2 mt-1">
          <button
            type="submit"
            class="flex-1 rounded-xl py-2.5 border border-transparent bg-brand-gradient text-white text-sm font-bold shadow-glow hover:scale-[1.01] transition disabled:opacity-60 cursor-pointer"
            disabled={loading}
          >
            Save Session
          </button>
          <button
            type="button"
            onclick={toggleEdit}
            class="flex-1 rounded-xl py-2.5 border border-brand-100 bg-white text-ink-700 text-sm font-bold hover:bg-brand-50 transition cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </form>
    {/if}
  {/if}

  {#if children}
    {@render children()}
  {/if}
</div>
