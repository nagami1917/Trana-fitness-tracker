<script>
  import { onMount } from 'svelte';
  import { Plus, Search, LoaderCircle, Trash2, MapPin, Flame, Timer, Gauge, Route as RouteIcon, Sparkles, TrendingUp, X, Download, Share2 } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import Modal from '../../components/common/Modal.svelte';
  import BusyOverlay from '../../components/common/BusyOverlay.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import { activities, profile, plans, gearList, loadGear, notify, upsertActivity, removeActivityById, unitSystem } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { activityApi } from '../../services/activityService.js';
  import { query } from '../../lib/router.js';
  import { loadModel, predictDuration } from '../../lib/ml/index.js';
  import { estimateMet } from '../../lib/ml/fueling.js';
  import { downloadShareCard } from '../../lib/shareCard.js';
  import { computeGpsSplits } from '../../lib/route/splits.js';
  import { detectNewPRs } from '../../lib/analytics/records.js';
  import {
    distanceUnit,
    elevationUnit,
    fromDisplayDistance,
    fromDisplayElevation,
    isImperial,
    KM_TO_MI,
    speedUnit,
    toDisplayDistance,
    toDisplayElevation,
  } from '../../lib/units.js';
  import { acquireLivePosition, releaseLivePosition, livePosition } from '../../lib/liveLocation.svelte.js';
  import { duration as fmtDuration, pace, speed, kcal, km, nf, fullDate, timeLabel, dayLabel, activityLabel, toDatetimeLocal } from '../../lib/format.js';

  const TYPES = [
    { id: 'all', label: 'All' },
    { id: 'run', label: 'Run' },
    { id: 'ride', label: 'Ride' },
    { id: 'walk', label: 'Walk' },
    { id: 'hike', label: 'Hike' },
  ];

  let filter = $state('all');
  let term = $state('');
  let addOpen = $state(false);
  let detail = $state(null);
  let editingDetail = $state(false);
  let editDraft = $state(null);
  let updatingDetail = $state(false);
  let saving = $state(false);
  let exporting = $state(false);

  async function exportCsv() {
    exporting = true;
    try {
      await api.activities.exportCsv();
      notify('Downloading your activity history…');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      exporting = false;
    }
  }
  let model = $state(null);
  let draft = $state(blankDraft());
  let confirmingDelete = $state(null);

  // Blue dot: join the shared follow-me watch; the returned cleanup releases
  // it (sync onMount → client-only; top-level onDestroy breaks this SSR
  // harness because ssr_context is already torn down at registration).
  onMount(() => {
    acquireLivePosition();
    void loadGear();
    void (async () => {
      model = await loadModel();
      const q = $query.get('q');
      if (q) term = q;
    })();
    return () => {
      releaseLivePosition();
    };
  });

  // Open ?id=<activityId> deep link cleanly (from Dashboard or Calendar).
  let lastOpenedIdParam = null;
  $effect(() => {
    const idParam = $query.get('id');
    if (!idParam || idParam === lastOpenedIdParam) return;
    const found = $activities.find((a) => String(a.id) === String(idParam));
    if (found) {
      lastOpenedIdParam = idParam;
      openDetail(found);
    }
  });

  function openDetail(activity) {
    editingDetail = false;
    editDraft = null;
    confirmingDelete = null;
    detail = activity;
    if (activity?.id && !activity.route_geojson && activity.source === 'gps') {
      void activityApi.get(activity.id).then((full) => {
        if (detail?.id === full?.id) detail = full;
      }).catch(() => {});
    }
  }

  function startEditDetail() {
    if (!detail) return;
    editingDetail = true;
    editDraft = {
      activity_type: detail.activity_type,
      distance_km: Number(detail.distance_km) || 0.5,
      duration_min: Number(detail.duration_min) || 10,
      elevation_gain_m: Number(detail.elevation_gain_m) || 0,
      calories: detail.calories != null ? String(detail.calories) : '',
      avg_heart_rate: detail.avg_heart_rate != null ? String(detail.avg_heart_rate) : '',
      gear_id: detail.gear_id != null ? String(detail.gear_id) : '',
      started_at: toDatetimeLocal(detail.started_at),
      notes: detail.notes || '',
    };
  }

  async function saveEditDetail() {
    if (!detail || !editDraft || updatingDetail) return;
    updatingDetail = true;
    try {
      const payload = {
        activity_type: editDraft.activity_type,
        distance_km: Math.max(0.05, Number(editDraft.distance_km) || 0.05),
        duration_min: Math.max(1, Number(editDraft.duration_min) || 1),
        elevation_gain_m: Math.max(0, Math.round(Number(editDraft.elevation_gain_m) || 0)),
        calories: editDraft.calories !== '' ? Math.max(0, Math.round(Number(editDraft.calories))) : null,
        avg_heart_rate: editDraft.avg_heart_rate !== '' ? Math.round(Number(editDraft.avg_heart_rate)) : null,
        gear_id: editDraft.gear_id !== '' ? Number(editDraft.gear_id) : null,
        started_at: new Date(editDraft.started_at).toISOString(),
        notes: editDraft.notes?.trim() || null,
      };
      const updated = await api.activities.update(detail.id, payload);
      upsertActivity(updated);
      void loadGear();
      detail = updated;
      editingDetail = false;
      editDraft = null;
      notify('Activity updated.');
    } catch (error) {
      notify(error.message || 'Could not update activity', 'error');
    } finally {
      updatingDetail = false;
    }
  }

  // Splits are derived from the distance and duration you logged. There is no
  // GPS track to segment any more, so every split gets the same average pace.
  const detailSplits = $derived(
    detail
      ? computeGpsSplits({
          points: [],
          totalDurationMin: Number(detail.duration_min) || 0,
          totalDistanceKm: Number(detail.distance_km) || 0,
          unit: $unitSystem,
        })
      : [],
  );

  function blankDraft() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return {
      activity_type: 'run',
      distance_km: 5,
      duration_min: 30,
      elevation_gain_m: 40,
      avg_heart_rate: '',
      gear_id: '',
      started_at: local,
      route: [],
      notes: '',
      calories_override: null,
    };
  }

  const filtered = $derived(
    $activities.filter((activity) => {
      if (filter !== 'all' && activity.activity_type !== filter) return false;
      if (!term) return true;
      const haystack = `${activity.activity_type} ${activity.notes ?? ''} ${new Date(activity.started_at).toDateString()}`.toLowerCase();
      return haystack.includes(term.toLowerCase());
    }),
  );

  const grouped = $derived.by(() => {
    const map = new Map();
    for (const activity of filtered) {
      const key = new Date(activity.started_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(activity);
    }
    return [...map.entries()];
  });

  const totals = $derived(
    filtered.reduce(
      (acc, a) => ({
        distance: acc.distance + (a.distance_km || 0),
        minutes: acc.minutes + (a.duration_min || 0),
        calories: acc.calories + (a.calories || 0),
      }),
      { distance: 0, minutes: 0, calories: 0 },
    ),
  );

  const draftCalories = $derived.by(() => {
    if (draft.calories_override) return Number(draft.calories_override);
    const kmValue = Number(draft.distance_km) || 0;
    const minutes = Number(draft.duration_min) || 0;
    if (!kmValue || !minutes) return 0;
    const speed = kmValue / (minutes / 60);
    const met = estimateMet(draft.activity_type, speed, (Number(draft.elevation_gain_m) || 0) / kmValue);
    const calFactor = Math.min(2, Math.max(0.5, Number($profile?.energy_calibration_factor) || 1));
    return Math.round(met * ($profile?.weight_kg ?? 60) * (minutes / 60) * calFactor);
  });

  /** What would the model have predicted for this session, knowing only the earlier history? */
  function predictedFor(activity) {
    if (!model) return null;
    const history = $activities
      .filter((a) => new Date(a.started_at) < new Date(activity.started_at))
      .map((a) => ({
        id: a.id,
        activity_type: a.activity_type,
        distance_km: Number(a.distance_km),
        duration_min: Number(a.duration_min),
        elevation_gain_m: Number(a.elevation_gain_m) || 0,
        started_at: a.started_at ?? null,
      }));
    if (!history.length) return null;
    return predictDuration({
      model,
      activityType: activity.activity_type,
      distanceKm: Number(activity.distance_km),
      elevationGainM: Number(activity.elevation_gain_m) || 0,
      weightKg: $profile?.weight_kg ?? 60,
      experienceLevel: $profile?.experience_level,
      history,
    });
  }

  function openAdd() {
    draft = blankDraft();
    draft.activity_type = filter === 'all' ? 'run' : filter;
    addOpen = true;
  }

  function setDraftType(id) {
    draft.activity_type = id;
  }

  async function submit() {
    saving = true;
    let written = false;
    try {
      const distance = Number(draft.distance_km);
      const priorActivities = [...$activities];
      const created = await api.activities.create({
        activity_type: draft.activity_type,
        distance_km: distance,
        duration_min: Number(draft.duration_min),
        elevation_gain_m: Number(draft.elevation_gain_m) || 0,
        calories: draftCalories,
        avg_heart_rate: draft.avg_heart_rate !== '' ? Math.round(Number(draft.avg_heart_rate)) : null,
        gear_id: draft.gear_id !== '' ? Number(draft.gear_id) : null,
        started_at: new Date(draft.started_at).toISOString(),
        route: null,
        route_geojson: null,
        source: 'manual',
        notes: draft.notes || null,
      });
      written = true;
      addOpen = false;
      upsertActivity(created);
      if (draft.gear_id) void loadGear();
      void api.profile.get().then((p) => p && profile.set(p)).catch(() => {});
      const brokenPRs = detectNewPRs(created, priorActivities);
      if (brokenPRs.length > 0) {
        notify(`New PR! ${brokenPRs.map((r) => r.label).join(', ')} saved.`);
      } else {
        notify('Activity logged — your model just got sharper.');
      }
    } catch (error) {
      notify(written ? 'Activity saved, but the view could not refresh. Reload when connected.' : (error.message || 'Could not save the activity'), 'error');
    } finally {
      saving = false;
    }
  }

  async function remove(id) {
    let written = false;
    try {
      await api.activities.remove(id);
      written = true;
      confirmingDelete = null;
      detail = null;
      removeActivityById(id);
      void loadGear();
      notify('Activity deleted.', 'info');
    } catch (error) {
      notify(written ? 'Activity deleted, but the view could not refresh. Reload when connected.' : (error.message || 'Could not delete'), 'error');
    }
  }

</script>

<div class="space-y-5">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between scroll-mt-20" data-tour="activities-header">
    <div>
      <span class="pill mb-2"><RouteIcon size={12} /> Your history</span>
      <h1 class="font-display text-2xl sm:text-3xl">Activities</h1>
      <p class="mt-1 text-sm font-semibold text-ink-400">
        Every session you log teaches TRANA your real pace.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2 self-start">
      <button class="btn-ghost" onclick={exportCsv} disabled={exporting} title="Download your full history as CSV">
        {#if exporting}<LoaderCircle size={15} class="animate-spin" /> Exporting…{:else}<Download size={15} /> Export CSV{/if}
      </button>
      <button class="btn-primary" onclick={openAdd}><Plus size={16} /> Log activity</button>
    </div>
  </div>

  <!-- filters -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
    <div class="flex flex-wrap gap-2">
      {#each TYPES as type (type.id)}
        <button class="btn-chip" class:btn-chip-active={filter === type.id} onclick={() => (filter = type.id)}>
          {#if type.id !== 'all'}<ActivityIcon type={type.id} size="xs" tone={filter === type.id ? 'solid' : 'brand'} />{/if}
          {type.label}
        </button>
      {/each}
    </div>
    <label class="flex flex-1 items-center gap-2 rounded-2xl border border-brand-100 bg-white/85 px-4 py-2.5 sm:ml-auto sm:max-w-xs">
      <Search size={15} class="text-ink-400" />
      <input class="w-full bg-transparent text-sm font-semibold outline-none placeholder:font-medium placeholder:text-ink-400" placeholder="Search activities…" bind:value={term} />
    </label>
  </div>

  <!-- totals strip -->
  <div class="grid grid-cols-3 gap-2 sm:gap-3">
    {#each [
      { label: 'Distance', value: `${nf(toDisplayDistance(totals.distance, $unitSystem), 1)} ${distanceUnit($unitSystem)}`, Icon: MapPin },
      { label: 'Time', value: fmtDuration(totals.minutes), Icon: Timer },
      { label: 'Energy', value: `${kcal(totals.calories)} kcal`, Icon: Flame },
    ] as item (item.label)}
      <div class="card flex flex-col items-start gap-1.5 p-2.5 sm:flex-row sm:items-center sm:gap-2.5 sm:p-3.5">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-100/80 text-brand-600 sm:h-9 sm:w-9"><item.Icon size={15} /></span>
        <div class="min-w-0 w-full">
          <p class="text-[10px] font-extrabold uppercase tracking-wide text-ink-400">{item.label}</p>
          <p class="truncate text-xs font-extrabold text-ink-900 sm:text-sm">{item.value}</p>
        </div>
      </div>
    {/each}
  </div>

  {#if !filtered.length}
    <EmptyState
      title="No activities match"
      description="Try a different filter, or log the session you just finished."
    >
      <button class="btn-primary" onclick={openAdd}><Plus size={16} /> Log activity</button>
    </EmptyState>
  {:else}
    {#each grouped as [month, rows] (month)}
      <div>
        <div class="mb-2 flex items-center gap-3">
          <h2 class="text-sm font-extrabold uppercase tracking-[0.1em] text-ink-400">{month}</h2>
          <span class="h-px flex-1 bg-brand-100"></span>
          <span class="text-[11px] font-bold text-ink-400">{rows.length} session{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div class="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {#each rows as activity (activity.id)}
            <button
              class="card group flex items-center gap-3 p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-card"
              onclick={() => openDetail(activity)}
            >
              <ActivityIcon type={activity.activity_type} size="md" />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2">
                  <p class="truncate text-sm font-extrabold text-ink-900">{activityLabel(activity.activity_type)}</p>
                  <span class="shrink-0 text-[10px] font-bold text-ink-400">
                    {dayLabel(activity.started_at)}, {timeLabel(activity.started_at)}
                  </span>
                </div>
                <p class="truncate text-[11px] font-semibold text-ink-400">
                  {km(activity.distance_km, $unitSystem)} {distanceUnit($unitSystem)} · {fmtDuration(activity.duration_min)} · {kcal(activity.calories)} kcal
                </p>
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>

<!-- busy overlay -->
<BusyOverlay open={saving} label="Logging your activity…" />

<!-- add modal -->
<Modal open={addOpen} title="Log an activity" subtitle="Real numbers make every future prediction better." onclose={() => (addOpen = false)} wide>
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="sm:col-span-2">
      <span class="label">Activity type</span>
      <div class="grid grid-cols-4 gap-2">
        {#each TYPES.filter((t) => t.id !== 'all') as type (type.id)}
          <button
            class="flex items-center justify-center gap-1.5 rounded-2xl border py-2.5 text-xs font-extrabold transition {draft.activity_type === type.id
              ? 'border-transparent bg-brand-gradient text-white shadow-glow'
              : 'border-brand-100 bg-white text-ink-500 hover:border-brand-200'}"
            onclick={() => setDraftType(type.id)}
          >
            {type.label}
          </button>
        {/each}
      </div>
    </div>

    <div>
      <span class="label">Distance ({distanceUnit($unitSystem)})</span>
      <input
        class="input"
        type="number"
        min="0.1"
        step="0.1"
        value={Number(toDisplayDistance(draft.distance_km, $unitSystem).toFixed(2))}
        oninput={(e) => {
          const val = Number(e.currentTarget.value);
          if (Number.isFinite(val)) draft.distance_km = fromDisplayDistance(val, $unitSystem);
        }}
      />
    </div>

    <div>
      <span class="label">Duration (minutes)</span>
      <input class="input" type="number" min="1" step="1" bind:value={draft.duration_min} />
    </div>

    <div>
      <span class="label">Elevation gain ({elevationUnit($unitSystem)})</span>
      <input
        class="input"
        type="number"
        min="0"
        step="10"
        value={Math.round(toDisplayElevation(draft.elevation_gain_m, $unitSystem))}
        oninput={(e) => {
          const val = Number(e.currentTarget.value);
          if (Number.isFinite(val)) draft.elevation_gain_m = Math.max(0, Math.round(fromDisplayElevation(val, $unitSystem)));
        }}
      />
    </div>

    <div>
      <span class="label">Started at</span>
      <input class="input" type="datetime-local" bind:value={draft.started_at} />
    </div>

    {#if $gearList.filter((g) => !g.retired).length > 0}
      <div>
        <span class="label">Gear / Shoes (optional)</span>
        <select class="input" bind:value={draft.gear_id}>
          <option value="">None</option>
          {#each $gearList.filter((g) => !g.retired) as g (g.id)}
            <option value={String(g.id)}>{g.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <div class="sm:col-span-2">
      <span class="label">Notes</span>
      <input class="input" placeholder="Optional — how did it feel?" bind:value={draft.notes} />
    </div>

    <div class="sm:col-span-2 rounded-2xl border border-brand-100 bg-brand-50/60 p-3">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-extrabold uppercase tracking-wide text-ink-400">Estimated burn</span>
        <span class="font-display text-lg font-extrabold text-brand-600">{kcal(draftCalories)} kcal</span>
      </div>
      <p class="text-[10px] font-semibold text-ink-400">Calculated from MET, your weight and the pace you entered.</p>
    </div>
  </div>

  <div class="mt-4 flex gap-2">
    <button class="btn-ghost flex-1" onclick={() => (addOpen = false)}>Cancel</button>
    <button class="btn-primary flex-1" onclick={submit} disabled={saving}>
      {#if saving}<LoaderCircle size={16} class="animate-spin" /> Saving…{:else}Save activity{/if}
    </button>
  </div>
</Modal>

<!-- detail modal -->
<Modal open={Boolean(detail)} title={detail ? `${activityLabel(detail.activity_type)} · ${km(detail.distance_km, $unitSystem)} ${distanceUnit($unitSystem)}` : ''} subtitle={detail ? `${fullDate(detail.started_at)} · ${timeLabel(detail.started_at)}` : ''} onclose={() => { detail = null; confirmingDelete = null; editingDetail = false; }} wide>
  {#if detail}
    {@const predicted = predictedFor(detail)}
    {#if editingDetail && editDraft}
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <span class="label">Activity type</span>
          <div class="grid grid-cols-4 gap-2">
            {#each TYPES.filter((t) => t.id !== 'all') as type (type.id)}
              <button
                type="button"
                class="flex items-center justify-center rounded-2xl border py-2 text-xs font-extrabold transition {editDraft.activity_type === type.id
                  ? 'border-transparent bg-brand-gradient text-white shadow-glow'
                  : 'border-brand-100 bg-white text-ink-500 hover:border-brand-200'}"
                onclick={() => (editDraft.activity_type = type.id)}
              >
                {type.label}
              </button>
            {/each}
          </div>
        </div>
        <div>
          <span class="label">Distance ({distanceUnit($unitSystem)})</span>
          <input
            class="input"
            type="number"
            min="0.05"
            step="0.05"
            value={Number(toDisplayDistance(editDraft.distance_km, $unitSystem).toFixed(2))}
            oninput={(e) => {
              const val = Number(e.currentTarget.value);
              if (Number.isFinite(val)) editDraft.distance_km = fromDisplayDistance(val, $unitSystem);
            }}
          />
        </div>
        <div>
          <span class="label">Duration (min)</span>
          <input class="input" type="number" min="1" step="0.5" bind:value={editDraft.duration_min} />
        </div>
        <div>
          <span class="label">Elevation gain ({elevationUnit($unitSystem)})</span>
          <input
            class="input"
            type="number"
            min="0"
            step="5"
            value={Math.round(toDisplayElevation(editDraft.elevation_gain_m, $unitSystem))}
            oninput={(e) => {
              const val = Number(e.currentTarget.value);
              if (Number.isFinite(val)) editDraft.elevation_gain_m = Math.max(0, Math.round(fromDisplayElevation(val, $unitSystem)));
            }}
          />
        </div>
        <div>
          <span class="label">Calories (optional override)</span>
          <input class="input" type="number" min="0" bind:value={editDraft.calories} />
        </div>
        <div>
          <span class="label">Avg Heart Rate (bpm)</span>
          <input class="input" type="number" min="30" max="240" placeholder="Optional" bind:value={editDraft.avg_heart_rate} />
        </div>
        <div>
          <span class="label">Started at</span>
          <input class="input" type="datetime-local" bind:value={editDraft.started_at} />
        </div>
        {#if $gearList.length > 0}
          <div>
            <span class="label">Gear / Shoes</span>
            <select class="input" bind:value={editDraft.gear_id}>
              <option value="">None</option>
              {#each $gearList as g (g.id)}
                <option value={String(g.id)}>{g.name}{g.retired ? ' (retired)' : ''}</option>
              {/each}
            </select>
          </div>
        {/if}
        <div class="sm:col-span-2">
          <span class="label">Notes</span>
          <input class="input" placeholder="How did this session go?" bind:value={editDraft.notes} />
        </div>
      </div>
      <div class="mt-4 flex gap-2">
        <button type="button" class="btn-ghost flex-1" onclick={() => { editingDetail = false; editDraft = null; }}>Cancel</button>
        <button type="button" class="btn-primary flex-1" disabled={updatingDetail} onclick={saveEditDetail}>
          {#if updatingDetail}<LoaderCircle size={15} class="animate-spin" /> Saving…{:else}Save changes{/if}
        </button>
      </div>
    {:else}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-4">
          {#each [
            { label: 'Distance', value: `${km(detail.distance_km, $unitSystem)} ${distanceUnit($unitSystem)}`, Icon: MapPin },
            { label: 'Duration', value: fmtDuration(detail.duration_min), Icon: Timer },
            { label: detail.activity_type === 'ride' ? 'Speed' : 'Pace', value: detail.activity_type === 'ride' ? speed(detail.distance_km / (detail.duration_min / 60), $unitSystem) : pace(detail.duration_min / detail.distance_km, $unitSystem), Icon: Gauge },
            { label: 'Energy', value: `${kcal(detail.calories)} kcal`, Icon: Flame },
          ] as item (item.label)}
            <div class="card-flat p-3">
              <item.Icon size={15} class="text-brand-500" />
              <p class="mt-1 text-[11px] font-extrabold uppercase tracking-wide text-ink-400">{item.label}</p>
              <p class="num-tabular text-sm font-extrabold text-ink-900">{item.value}</p>
            </div>
          {/each}
        </div>

        {#if detailSplits.length >= 2}
          <div class="sm:col-span-2 rounded-2xl border border-brand-100 bg-brand-50/40 p-3">
            <p class="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-400 mb-2">
              {`${distanceUnit($unitSystem)} splits`}
            </p>
            <div class="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {#each detailSplits as split (split.split)}
                {@const barPct = Math.min(100, Math.max(25, Math.round((detailSplits[0].paceMinPerKm / Math.max(0.5, split.paceMinPerKm)) * 80)))}
                <div class="flex items-center gap-2 text-xs">
                  <span class="num-tabular w-12 shrink-0 font-extrabold text-ink-500">{distanceUnit($unitSystem)} {split.split}</span>
                  <div class="flex-1 h-2 rounded-full bg-white overflow-hidden">
                    <div class="h-full rounded-full bg-brand-gradient" style="width: {barPct}%"></div>
                  </div>
                  <span class="w-20 shrink-0 text-right font-extrabold text-ink-900 tabular-nums">{pace(split.paceMinPerKm, $unitSystem)}</span>
                  {#if split.gapMinPerKm && detail.activity_type === 'run'}
                    <span class="hidden sm:inline w-24 shrink-0 text-right text-[11px] font-bold text-brand-700 tabular-nums">
                      GAP {pace(split.gapMinPerKm, $unitSystem)}
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        {#if predicted}
          {@const error = ((detail.duration_min - predicted.minutes) / predicted.minutes) * 100}
          <div class="sm:col-span-2 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 to-white p-3.5">
            <div class="flex items-center gap-2">
              <Sparkles size={14} class="text-brand-500" />
              <p class="text-[11px] font-extrabold uppercase tracking-wide text-brand-600">Model vs reality</p>
            </div>
            <div class="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p class="text-sm font-bold text-ink-700">
                Predicted <span class="text-brand-600">{fmtDuration(predicted.minutes)}</span>
              </p>
              <p class="text-sm font-bold text-ink-700">
                Actual <span class="text-ink-900">{fmtDuration(detail.duration_min)}</span>
              </p>
              <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold {Math.abs(error) < 10 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
                <TrendingUp size={11} /> {error > 0 ? '+' : ''}{Math.round(error)}% error
              </span>
            </div>
          </div>
        {/if}

        {#if detail.notes}
          <p class="sm:col-span-2 rounded-2xl bg-brand-50/70 p-3 text-[12px] font-semibold text-ink-500">“{detail.notes}”</p>
        {/if}
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        {#if confirmingDelete === detail.id}
          <span class="text-[11px] font-bold text-rose-600">Delete this activity?</span>
          <button class="btn-ghost !border-rose-200 !text-rose-600 ml-auto" onclick={() => remove(detail.id)}>Yes, delete</button>
          <button class="btn-ghost" onclick={() => (confirmingDelete = null)}>Cancel</button>
        {:else}
          <button class="btn-ghost !text-rose-500" onclick={() => (confirmingDelete = detail.id)}><Trash2 size={14} /> Delete</button>
          <button class="btn-ghost" onclick={startEditDetail}><Pencil size={14} /> Edit</button>
          <button
            class="btn-ghost"
            onclick={() => {
              const ok = downloadShareCard({
                activity: detail,
                unit: $unitSystem,
                athleteName: $profile?.name || 'TRANA Athlete',
              });
              if (ok) notify('Downloaded 1080×1080 share card');
            }}
          >
            <Share2 size={14} /> Share Card
          </button>
          <button class="btn-primary ml-auto" onclick={() => { detail = null; }}>Done</button>
        {/if}
      </div>
    {/if}
  {/if}
</Modal>
