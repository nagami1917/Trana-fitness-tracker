<script>
  import { onMount } from 'svelte';
  import { Droplets, Pencil, X } from 'lucide-svelte';
  import { dailySessionApi, formatSessionDate, todayDate } from '../../services/dailySessionService.js';
  import { goals, notify, profile, unitSystem } from '../../stores/index.js';
  import { fluidUnit, toDisplayFluid } from '../../lib/units.js';
  import Skeleton from '../common/Skeleton.svelte';

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
    netCalories > 0 ? 'text-rose-500' : netCalories < 0 ? 'text-emerald-600' : 'text-ink-500'
  );

  let dailyCalorieGoal = $derived(Number($goals?.daily_calories ?? $profile?.daily_calorie_goal ?? 2400) || 2400);
  let dailyBurnTarget = $derived(Math.max(400, Math.round(dailyCalorieGoal * 0.35)));
  let isTodaySession = $derived(!session?.session_date || session.session_date === todayDate());

  async function quickAddWater(addMl) {
    if (loading) return;
    loading = true;
    const prevWater = Number(session?.water_ml ?? 0);
    const targetSessionId = session?.id;
    const wasToday = isTodaySession;
    try {
      const nextWater = prevWater + addMl;
      const res = wasToday
        ? await dailySessionApi.saveToday({ water_ml: nextWater })
        : await dailySessionApi.update(targetSessionId, { water_ml: nextWater });
      if (res?.data) applySession(res.data);
      notify(`+${addMl} ml water logged`, {
        tone: 'success',
        onUndo: async () => {
          const revert = wasToday
            ? await dailySessionApi.saveToday({ water_ml: prevWater })
            : await dailySessionApi.update(targetSessionId, { water_ml: prevWater });
          if (revert?.data) applySession(revert.data);
        },
      });
    } catch (error) {
      notify(error.message || 'Could not log water', 'error');
    } finally {
      loading = false;
    }
  }

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

<div class="card p-4 sm:p-6">
  <div class="flex items-center justify-between mb-4">
    <div>
      <p class="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Daily Session</p>
      <p class="text-xl font-display font-extrabold text-ink-900">{displayDate}</p>
    </div>
    {#if session}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700 transition cursor-pointer"
        onclick={toggleEdit}
        aria-label={editing ? 'Cancel edit' : 'Edit session'}
      >
        {#if editing}<X size={13} /> Cancel{:else}<Pencil size={13} /> Edit{/if}
      </button>
    {/if}
  </div>

  {#if loading && !session}
    <Skeleton variant="cards" count={4} />
  {:else if !session}
    <div class="text-center py-8">
      <p class="text-ink-600 text-sm font-semibold">No session tracked yet today.</p>
      <p class="text-ink-400 text-xs mt-1">Start a GPS activity above, or open today's session now to log water &amp; meals.</p>
      <button
        type="button"
        onclick={startToday}
        disabled={loading}
        class="btn-primary mt-4 !text-xs"
      >
        Start today's session
      </button>
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="card-flat p-4">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Burned</p>
        <div class="num-tabular flex items-baseline gap-1 mt-1">
          <span class="font-display text-2xl font-extrabold text-emerald-600">{session.calories_burned}</span>
          <span class="text-xs font-bold text-ink-400">kcal</span>
        </div>
        <div class="mt-2 w-full bg-brand-100 rounded-full h-2">
          <div class="bg-emerald-500 h-2 rounded-full" style="width:{Math.min(100, (session.calories_burned / dailyBurnTarget) * 100)}%"></div>
        </div>
        <p class="num-tabular text-[11px] font-semibold text-ink-400 mt-1">Goal ~{dailyBurnTarget} kcal</p>
      </div>

      <div class="card-flat p-4">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Eaten</p>
        <div class="num-tabular flex items-baseline gap-1 mt-1">
          <span class="font-display text-2xl font-extrabold text-rose-500">{session.calories_eaten}</span>
          <span class="text-xs font-bold text-ink-400">kcal</span>
        </div>
        <div class="mt-2 w-full bg-brand-100 rounded-full h-2">
          <div class="bg-rose-500 h-2 rounded-full" style="width:{Math.min(100, (session.calories_eaten / dailyCalorieGoal) * 100)}%"></div>
        </div>
        <p class="num-tabular text-[11px] font-semibold text-ink-400 mt-1">Target {dailyCalorieGoal} kcal</p>
      </div>

      <div class="card-flat p-4">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Water</p>
        <div class="num-tabular flex items-baseline gap-1 mt-1">
          <span class="font-display text-2xl font-extrabold text-brand-600">
            {$unitSystem === 'imperial' ? Math.round(toDisplayFluid(session.water_ml, 'imperial')) : session.water_ml}
          </span>
          <span class="text-xs font-bold text-ink-400">{fluidUnit($unitSystem)}</span>
        </div>
        <p class="num-tabular text-[11px] font-semibold text-ink-400 mt-1">{Math.round((session.water_ml || 0) / 250)} × 250ml cups</p>
        {#if !editing}
          <div class="mt-2 flex gap-1.5">
            <button
              type="button"
              disabled={loading}
              onclick={() => quickAddWater(250)}
              class="inline-flex items-center gap-0.5 rounded-lg border border-brand-100 bg-white px-2 py-1 text-[11px] font-extrabold text-brand-700 hover:bg-brand-100 transition cursor-pointer disabled:opacity-50"
            >
              <Droplets size={11} /> +250ml
            </button>
            <button
              type="button"
              disabled={loading}
              onclick={() => quickAddWater(500)}
              class="inline-flex items-center gap-0.5 rounded-lg border border-brand-100 bg-white px-2 py-1 text-[11px] font-extrabold text-brand-700 hover:bg-brand-100 transition cursor-pointer disabled:opacity-50"
            >
              +500ml
            </button>
          </div>
        {/if}
      </div>

      <div class="card-flat p-4">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Net</p>
        <div class="num-tabular flex items-baseline gap-1 mt-1">
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
        <div class="card-flat p-3">
          <label for="ds-burned" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Calories Burned</label>
          <input
            id="ds-burned"
            type="number"
            min="0"
            bind:value={form.calories_burned}
            class="num-tabular w-full mt-1 text-sm font-bold text-ink-900 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="0"
          />
        </div>
        <div class="card-flat p-3">
          <label for="ds-eaten" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Calories Eaten</label>
          <input
            id="ds-eaten"
            type="number"
            min="0"
            bind:value={form.calories_eaten}
            class="num-tabular w-full mt-1 text-sm font-bold text-ink-900 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="0"
          />
        </div>
        <div class="card-flat p-3">
          <label for="ds-water" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Water (ml)</label>
          <input
            id="ds-water"
            type="number"
            min="0"
            step="50"
            bind:value={form.water_ml}
            class="num-tabular w-full mt-1 text-sm font-bold text-ink-900 bg-transparent border-b border-brand-300 focus:border-brand-500 focus:outline-none"
            placeholder="0"
          />
        </div>
        <div class="card-flat p-3 sm:col-span-3">
          <label for="ds-notes" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">Notes</label>
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
            class="btn-primary flex-1"
            disabled={loading}
          >
            Save Session
          </button>
          <button
            type="button"
            onclick={toggleEdit}
            class="btn-ghost flex-1"
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
