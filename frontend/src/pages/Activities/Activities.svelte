<script>
  import { onMount } from 'svelte';
  import { Plus, Search, LoaderCircle, Trash2, MapPin, Flame, Timer, Gauge, Route as RouteIcon, Sparkles, TrendingUp, X } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import RouteMap from '../../components/route/RouteMap.svelte';
  import Modal from '../../components/common/Modal.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import { activities, profile, notify, refresh } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { query } from '../../lib/router.js';
  import { loadModel, predictDuration, routeLengthKm } from '../../lib/ml/index.js';
  import { estimateMet } from '../../lib/ml/fueling.js';
  import { routeThroughRoads, routingEnabled } from '../../services/roadRoutingService.js';
  import { duration as fmtDuration, pace, kcal, km, nf, fullDate, timeLabel, dayLabel, activityLabel } from '../../lib/format.js';

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
  let saving = $state(false);
  let model = $state(null);
  let draft = $state(blankDraft());
  let draftRouteOpen = $state(false);
  let confirmingDelete = $state(null);
  // Road-snapped geometry for the draft's waypoints (null/[] → straight lines).
  let routePath = $state([]);
  let routing = $state(false);
  let snapTimer;
  let snapSeq = 0;

  onMount(async () => {
    model = await loadModel();
    const q = $query.get('q');
    if (q) term = q;
  });

  function blankDraft() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return {
      activity_type: 'run',
      distance_km: 5,
      duration_min: 30,
      elevation_gain_m: 40,
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

  const draftRouteKm = $derived(
    routePath.length > 1
      ? routeLengthKm(routePath)
      : draft.route.length > 1
        ? routeLengthKm(draft.route)
        : 0,
  );

  // Navigation-app behaviour: while a route exists, the distance field itself
  // shows the measured (road-snapped) route length — not the typed value.
  $effect(() => {
    if (draftRouteKm > 0.05) draft.distance_km = Number(draftRouteKm.toFixed(2));
  });

  const draftCalories = $derived.by(() => {
    if (draft.calories_override) return Number(draft.calories_override);
    const kmValue = draftRouteKm > 0 ? draftRouteKm : Number(draft.distance_km) || 0;
    const minutes = Number(draft.duration_min) || 0;
    if (!kmValue || !minutes) return 0;
    const speed = kmValue / (minutes / 60);
    const met = estimateMet(draft.activity_type, speed, (Number(draft.elevation_gain_m) || 0) / kmValue);
    return Math.round(met * ($profile?.weight_kg ?? 60) * (minutes / 60));
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
    draftRouteOpen = false;
    resetSnap();
    addOpen = true;
  }

  function resetSnap() {
    clearTimeout(snapTimer);
    snapSeq += 1;
    routePath = [];
    routing = false;
  }

  /** Re-route the draft's waypoints along roads (debounced, stale-safe). */
  function scheduleSnap() {
    clearTimeout(snapTimer);
    if (!routingEnabled() || draft.route.length < 2) {
      snapSeq += 1;
      routePath = [];
      routing = false;
      return;
    }
    routing = true;
    snapTimer = setTimeout(runSnap, 450);
  }

  async function runSnap() {
    const seq = ++snapSeq;
    const waypoints = [...draft.route];
    const activityType = draft.activity_type;
    const result = await routeThroughRoads(waypoints, activityType);
    if (seq !== snapSeq) return; // a newer edit superseded this request
    routePath = result?.path ?? [];
    routing = false;
  }

  function clearRoute() {
    draft.route = [];
    resetSnap();
  }

  function setDraftType(id) {
    draft.activity_type = id;
    scheduleSnap(); // routing profile follows the activity type
  }

  async function submit() {
    saving = true;
    let written = false;
    try {
      const distance = draftRouteKm > 0 ? Number(draftRouteKm.toFixed(2)) : Number(draft.distance_km);
      await api.activities.create({
        activity_type: draft.activity_type,
        distance_km: distance,
        duration_min: Number(draft.duration_min),
        elevation_gain_m: Number(draft.elevation_gain_m) || 0,
        calories: draftCalories,
        avg_heart_rate: null,
        started_at: new Date(draft.started_at).toISOString(),
        route: routePath.length > 1 ? routePath : draft.route.length > 1 ? draft.route : null,
        notes: draft.notes || null,
      });
      written = true;
      addOpen = false;
      await refresh();
      notify('Activity logged — your model just got sharper.');
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
      await refresh();
      notify('Activity deleted.', 'info');
    } catch (error) {
      notify(written ? 'Activity deleted, but the view could not refresh. Reload when connected.' : (error.message || 'Could not delete'), 'error');
    }
  }

  function onPick(mode, index, latlng) {
    if (!latlng) return;
    const point = [Number(latlng.lat.toFixed(5)), Number(latlng.lng.toFixed(5))];
    draft.route = mode === 'move'
      ? draft.route.map((existing, i) => (i === index ? point : existing))
      : [...draft.route, point];
    scheduleSnap();
  }
</script>

<div class="space-y-5">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <span class="pill mb-2"><RouteIcon size={12} /> Your history</span>
      <h1 class="font-display text-2xl sm:text-3xl">Activities</h1>
      <p class="mt-1 text-sm font-semibold text-ink-400">
        Every session you log teaches TRANA your real pace.
      </p>
    </div>
    <button class="btn-primary self-start" onclick={openAdd}><Plus size={16} /> Log activity</button>
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
  <div class="grid grid-cols-3 gap-3">
    {#each [
      { label: 'Distance', value: `${nf(totals.distance, 1)} km`, Icon: MapPin },
      { label: 'Time', value: fmtDuration(totals.minutes), Icon: Timer },
      { label: 'Energy', value: `${kcal(totals.calories)} kcal`, Icon: Flame },
    ] as item (item.label)}
      <div class="card flex items-center gap-2.5 p-3.5">
        <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-100/80 text-brand-600"><item.Icon size={16} /></span>
        <div class="min-w-0">
          <p class="text-[10px] font-extrabold uppercase tracking-wide text-ink-400">{item.label}</p>
          <p class="truncate text-sm font-extrabold text-ink-900">{item.value}</p>
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
              onclick={() => (detail = activity)}
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
                  {km(activity.distance_km)} km · {fmtDuration(activity.duration_min)} · {kcal(activity.calories)} kcal
                </p>
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>

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
      <span class="label">Distance (km) {draftRouteKm > 0 ? '(from route)' : ''}</span>
      <input
        class="input"
        type="number"
        min="0.1"
        step="0.1"
        bind:value={draft.distance_km}
        disabled={draftRouteKm > 0}
        class:bg-brand-50={draftRouteKm > 0}
      />
      {#if draftRouteKm > 0}
        <p class="mt-1 text-[10px] font-bold text-brand-600">Measured from your drawn route</p>
      {/if}
    </div>

    <div>
      <span class="label">Duration (minutes)</span>
      <input class="input" type="number" min="1" step="1" bind:value={draft.duration_min} />
    </div>

    <div>
      <span class="label">Elevation gain (m)</span>
      <input class="input" type="number" min="0" step="10" bind:value={draft.elevation_gain_m} />
    </div>

    <div>
      <span class="label">Started at</span>
      <input class="input" type="datetime-local" bind:value={draft.started_at} />
    </div>

    <div class="sm:col-span-2">
      <span class="label">Notes</span>
      <input class="input" placeholder="Optional — how did it feel?" bind:value={draft.notes} />
    </div>

    <div class="sm:col-span-2">
      <div class="flex items-center justify-between">
        <span class="label !mb-0">Route (optional)</span>
        <button class="btn-chip" onclick={() => (draftRouteOpen = !draftRouteOpen)}>
          {draftRouteOpen ? 'Hide map' : 'Draw route'}
        </button>
      </div>
      {#if draftRouteOpen}
        <div class="mt-2">
          <RouteMap points={draft.route} path={routePath} height={220} interactive onPick={onPick} />
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          {#if draft.route.length}
            <button class="btn-chip" onclick={clearRoute}><Trash2 size={12} /> Clear route</button>
          {/if}
          {#if routing}
            <span class="pill"><LoaderCircle size={12} class="animate-spin" /> Snapping to roads…</span>
          {/if}
        </div>
      {/if}
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
<Modal open={Boolean(detail)} title={detail ? `${detail.activity_type === 'ride' ? 'Bike ride' : detail.activity_type} · ${km(detail.distance_km)} km` : ''} subtitle={detail ? `${fullDate(detail.started_at)} · ${timeLabel(detail.started_at)}` : ''} onclose={() => { detail = null; confirmingDelete = null; }} wide>
  {#if detail}
    {@const predicted = predictedFor(detail)}
    <div class="grid gap-4 sm:grid-cols-2">
      {#if detail.route?.length}
        <div class="sm:col-span-2">
          <RouteMap points={detail.route} height={230} />
        </div>
      {/if}

      <div class="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-4">
        {#each [
          { label: 'Distance', value: `${km(detail.distance_km)} km`, Icon: MapPin },
          { label: 'Duration', value: fmtDuration(detail.duration_min), Icon: Timer },
          { label: 'Pace', value: detail.activity_type === 'ride' ? `${nf(detail.distance_km / (detail.duration_min / 60), 1)} km/h` : pace(detail.duration_min / detail.distance_km), Icon: Gauge },
          { label: 'Energy', value: `${kcal(detail.calories)} kcal`, Icon: Flame },
        ] as item (item.label)}
          <div class="rounded-2xl border border-brand-100 bg-white p-3">
            <item.Icon size={15} class="text-brand-500" />
            <p class="mt-1 text-[10px] font-extrabold uppercase tracking-wide text-ink-400">{item.label}</p>
            <p class="text-sm font-extrabold text-ink-900">{item.value}</p>
          </div>
        {/each}
      </div>

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

    <div class="mt-4 flex items-center gap-2">
      {#if confirmingDelete === detail.id}
        <span class="text-[11px] font-bold text-rose-600">Delete this activity?</span>
        <button class="btn-ghost !border-rose-200 !text-rose-600 ml-auto" onclick={() => remove(detail.id)}>Yes, delete</button>
        <button class="btn-ghost" onclick={() => (confirmingDelete = null)}>Cancel</button>
      {:else}
        <button class="btn-ghost !text-rose-500" onclick={() => (confirmingDelete = detail.id)}><Trash2 size={14} /> Delete</button>
        <button class="btn-primary ml-auto" onclick={() => { detail = null; }}>Done</button>
      {/if}
    </div>
  {/if}
</Modal>
