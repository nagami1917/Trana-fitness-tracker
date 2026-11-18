<script>
  /**
   * Past sessions editor.
   *
   * Onboarding promises "you can change any of this later" — this is where.
   * It matters most for the reciprocal-unit mistake: a cyclist who typed speed
   * into a pace box has a wrong pace curve, and until now had no way back.
   *
   * Reads and writes the same /baseline-activities endpoints onboarding uses,
   * and shares its rules via lib/baselineSession.js so the two can't drift.
   */
  import { onMount } from 'svelte';
  import { LoaderCircle, Pencil, Plus, Trash2, Check, X, TriangleAlert } from 'lucide-svelte';
  import Card from '../common/Card.svelte';
  import { baselineSessions, notify, unitSystem } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { distanceUnit } from '../../lib/units.js';
  import {
    ACTIVITY_TYPES,
    MAX_ROWS_PER_SPORT,
    PERIODS,
    activityLabel,
    blankRow,
    derivedReadout,
    exampleFor,
    fromApiRow,
    hardError,
    modeOptions,
    rowUsable,
    sessionUsability,
    softWarning,
    toPayload,
    validRow,
  } from '../../lib/baselineSession.js';

  let loading = $state(true);
  let error = $state('');
  let saved = $state([]); // API rows
  let editing = $state(null); // { id | null, type, row }
  let saving = $state(false);

  const byType = $derived.by(() => {
    const map = {};
    for (const row of saved) {
      (map[row.activity_type] ??= []).push(row);
    }
    return map;
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api.baselineActivities.list();
      saved = res?.data ?? [];
      // Publish to the shared store so the plan preview recomputes from the
      // corrected sessions instead of keeping the generic pace.
      baselineSessions.set(saved);
    } catch (e) {
      error = e?.message || 'Could not load your past sessions.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  function startAdd(type) {
    editing = { id: null, type, row: blankRow(type) };
  }

  function startEdit(row) {
    editing = { id: row.id, type: row.activity_type, row: fromApiRow(row, $unitSystem) };
  }

  function cancel() {
    editing = null;
  }

  const editError = $derived(editing ? hardError(editing.row, $unitSystem) : '');
  const editWarning = $derived(editing ? softWarning(editing.row, $unitSystem) : '');
  const editValid = $derived(editing ? validRow(editing.row, $unitSystem) && !editError : false);

  async function save() {
    if (!editing || !editValid || saving) return;
    saving = true;
    try {
      if (editing.id) {
        await api.baselineActivities.update(editing.id, toPayload(editing.row, $unitSystem));
        notify('Past session updated', 'success');
      } else {
        await api.baselineActivities.create(toPayload(editing.row, $unitSystem));
        notify('Past session added', 'success');
      }
      editing = null;
      await load();
    } catch (e) {
      notify(e?.message || 'Could not save that session.', 'error');
    } finally {
      saving = false;
    }
  }

  async function remove(row) {
    try {
      await api.baselineActivities.remove(row.id);
      notify('Past session removed', 'success');
      await load();
    } catch (e) {
      notify(e?.message || 'Could not remove that session.', 'error');
    }
  }

  /** Why this sport's rows matter, in the athlete's terms. */
  /**
   * What the model actually does with this sport's saved rows.
   *
   * Counted with sessionUsability, not rows.length: a saved row whose pace
   * falls outside SPEED_BOUNDS_KMH is discarded before the curve is fitted,
   * so two unusable rows must never read as "your own pace is used".
   */
  function provenance(type) {
    const rows = byType[type] ?? [];
    const { usableCount, rejectedCount, note } = sessionUsability(rows, type);
    if (usableCount >= 2) return 'Your own pace is used for this sport.';
    if (usableCount === 1) return 'One more usable session and this sport gets your own pace.';
    if (rejectedCount > 0) return note;
    return 'Generic average — add a session to personalise this sport.';
  }

  /** Per-sport usable count, so the tick and the "x of 2" agree with the model. */
  function usableCount(type) {
    return sessionUsability(byType[type] ?? [], type).usableCount;
  }
</script>

<Card>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <Pencil size={17} class="text-brand-500" />
      <h2 class="text-lg">Past sessions</h2>
    </div>
    {#if loading}
      <LoaderCircle size={16} class="animate-spin text-brand-500" />
    {/if}
  </div>

  <p class="mt-1 text-xs font-semibold text-ink-400">
    TRANA fits one pace curve per sport from your two most recent sessions of that sport.
    Correct a mistyped number here and every future plan updates.
  </p>

  {#if error}
    <p class="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700" role="alert">{error}</p>
  {/if}

  <div class="mt-4 space-y-3">
    {#each ACTIVITY_TYPES as sport (sport.id)}
      {@const rows = byType[sport.id] ?? []}
      <div class="rounded-2xl border border-brand-100 bg-white p-3">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-sm font-bold text-ink-700">
            {sport.label}
            {#if usableCount(sport.id) >= MAX_ROWS_PER_SPORT}
              <Check size={14} class="text-emerald-600" />
            {/if}
          </span>
          <span class="text-[11px] font-semibold text-ink-400">{usableCount(sport.id)} of {MAX_ROWS_PER_SPORT} usable</span>
        </div>

        <p class="mb-2 text-[11px] font-semibold text-ink-400">{provenance(sport.id)}</p>

        {#if rows.length > 0}
          <div class="mb-2 space-y-1.5">
            {#each rows as row (row.id)}
              {@const rowUsableNow = rowUsable(
                { activity_type: row.activity_type, distance: row.distance_km, duration_min: row.duration_min, elevation_gain_m: row.elevation_gain_m, mode: 'time' },
                'metric',
              )}
              <div
                class="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 {rowUsableNow
                  ? 'border-brand-100 bg-brand-50/40'
                  : 'border-rose-200 bg-rose-50'}"
              >
                <span class="num-tabular text-[11px] font-bold text-ink-700">
                  {row.distance_km} {distanceUnit($unitSystem)} · {Math.round(row.duration_min)} min
                  <span class="font-semibold {rowUsableNow ? 'text-ink-400' : 'text-rose-600'}">
                    ({row.speed_kmh} km/h{row.elevation_gain_m ? ` · ${row.elevation_gain_m} m` : ''})
                  </span>
                  {#if !rowUsableNow}
                    <span class="ml-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-white">ignored by model</span>
                  {/if}
                </span>
                <span class="flex items-center gap-1">
                  <button type="button" class="btn-chip text-[11px]" onclick={() => startEdit(row)}>
                    <Pencil size={11} /> Edit
                  </button>
                  <button type="button" class="btn-chip text-[11px] text-rose-600" onclick={() => remove(row)}>
                    <Trash2 size={11} /> Remove
                  </button>
                </span>
              </div>
            {/each}
          </div>
        {/if}

        {#if editing && editing.type === sport.id}
          <div class="rounded-xl border border-brand-200 bg-brand-50/60 p-2.5">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label class="col-span-2 block">
                <span class="label">How do you remember it?</span>
                <select class="input" bind:value={editing.row.mode}>
                  {#each modeOptions(sport.id) as option (option.id)}
                    <option value={option.id}>{option.label}</option>
                  {/each}
                </select>
              </label>

              <label class="block">
                <span class="label">Distance ({distanceUnit($unitSystem)})</span>
                <input class="input num-tabular" type="number" min="0.1" step="0.1" placeholder={exampleFor(sport.id, 'distance')} bind:value={editing.row.distance} />
              </label>

              {#if editing.row.mode === 'pace'}
                <label class="block">
                  <span class="label">Minutes per {distanceUnit($unitSystem)}</span>
                  <input class="input num-tabular" type="number" min="0.5" step="0.1" placeholder={exampleFor(sport.id, 'pace')} bind:value={editing.row.pace} />
                </label>
              {:else if editing.row.mode === 'speed'}
                <label class="block">
                  <span class="label">Speed ({distanceUnit($unitSystem)}/h)</span>
                  <input class="input num-tabular" type="number" min="1" step="0.1" placeholder={exampleFor(sport.id, 'speed')} bind:value={editing.row.speed} />
                </label>
              {:else}
                <label class="block">
                  <span class="label">Time (minutes)</span>
                  <input class="input num-tabular" type="number" min="1" step="1" placeholder={exampleFor(sport.id, 'duration_min')} bind:value={editing.row.duration_min} />
                </label>
              {/if}

              <label class="block">
                <span class="label">Climb (m, optional)</span>
                <input class="input num-tabular" type="number" min="0" step="5" placeholder="0" bind:value={editing.row.elevation_gain_m} />
              </label>

              <label class="block">
                <span class="label">When</span>
                <select class="input" bind:value={editing.row.performed_period}>
                  {#each PERIODS as period (period.id)}
                    <option value={period.id}>{period.label}</option>
                  {/each}
                </select>
              </label>
            </div>

            {#if derivedReadout(editing.row, $unitSystem)}
              <p class="mt-1.5 text-[11px] font-bold text-ink-500">
                = {derivedReadout(editing.row, $unitSystem)}
              </p>
            {/if}

            {#if editError}
              <p class="mt-1.5 text-[11px] font-semibold text-rose-600" role="alert">{editError}</p>
            {:else if editWarning}
              <p class="mt-1.5 flex items-start gap-1 text-[11px] font-semibold text-amber-700" role="status">
                <TriangleAlert size={12} class="mt-0.5 shrink-0" /> {editWarning}
              </p>
            {/if}

            <div class="mt-2 flex items-center gap-2">
              <button type="button" class="btn-primary text-xs" disabled={!editValid || saving} onclick={save}>
                {#if saving}<LoaderCircle size={13} class="animate-spin" />{/if} Save session
              </button>
              <button type="button" class="btn-ghost text-xs" onclick={cancel}>
                <X size={13} /> Cancel
              </button>
            </div>
          </div>
        {:else if rows.length < MAX_ROWS_PER_SPORT}
          <button type="button" class="btn-chip text-[11px]" onclick={() => startAdd(sport.id)}>
            <Plus size={11} /> Add past {activityLabel(sport.id).toLowerCase()} session
          </button>
        {/if}
      </div>
    {/each}
  </div>

  <p class="mt-3 text-[11px] font-semibold leading-relaxed text-ink-400">
    Sessions you add here shape your pace estimate only. They are kept out of your
    activity log, daily totals and streak.
  </p>
</Card>
