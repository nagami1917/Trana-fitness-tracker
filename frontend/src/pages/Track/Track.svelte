<script>
  import { onMount } from 'svelte';
  import {
    Droplets,
    Flame,
    Volume2,
    VolumeX,
    ShieldCheck,
    Footprints,
  } from 'lucide-svelte';
  import GPSStatus from '../../components/activity/GPSStatus.svelte';
  import ActivityStats from '../../components/activity/ActivityStats.svelte';
  import ActivityControls from '../../components/activity/ActivityControls.svelte';
  import DailyProgress from '../../components/activity/DailyProgress.svelte';
  import FoodLogger from '../../components/activity/FoodLogger.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import { link } from '../../lib/router.js';
  import { notify, unitSystem, gearList, fuelItems, loadGear, loadFuelItems } from '../../stores/index.js';
  import { distanceUnit, toDisplayDistance } from '../../lib/units.js';
  import { dailySessionApi } from '../../services/dailySessionService.js';
  import { readCachedPlace } from '../../lib/location.js';
  import { acquireLivePosition, releaseLivePosition, seedLivePosition, livePosition } from '../../lib/liveLocation.svelte.js';
  import { liveTracker } from '../../lib/liveTracker.svelte.js';
  import { clock, ml } from '../../lib/format.js';

  const SPORTS = [
    { id: 'run', label: 'Run' },
    { id: 'ride', label: 'Ride' },
    { id: 'walk', label: 'Walk' },
    { id: 'hike', label: 'Hike' },
  ];

  // ── activity tracking state (backed by app-wide liveTracker) ─────────
  const activityType = $derived(liveTracker.activityType);
  const tracking = $derived(liveTracker.tracking);
  const paused = $derived(liveTracker.paused);
  const saving = $derived(liveTracker.saving);
  const gpsStatus = $derived(liveTracker.gpsStatus);
  const gpsMessage = $derived(liveTracker.gpsMessage);

  let cachedPlace = readCachedPlace();
  const lastKnownPosition = $derived.by(() => {
    const pos = livePosition.current;
    return pos && Number.isFinite(pos.latitude) && Number.isFinite(pos.longitude) ? pos : null;
  });
  const livePositionFix = $derived(
    livePosition.status === 'active' && lastKnownPosition?.source === 'gps'
      ? lastKnownPosition
      : null,
  );
  const displayGpsStatus = $derived.by(() => {
    if (tracking) return gpsStatus;
    if (livePosition.status === 'active') return 'tracking';
    if (livePosition.status === 'locating') return 'requesting';
    if (livePosition.status === 'denied') return 'denied';
    if (livePosition.status === 'error') {
      return livePosition.error?.code === 'timeout' || livePosition.error?.code === 'unavailable'
        ? 'no-signal'
        : 'error';
    }
    return 'idle';
  });
  const displayGpsMessage = $derived.by(() => {
    if (tracking) return gpsMessage;
    if (livePositionFix) {
      return Number.isFinite(livePositionFix.accuracy)
        ? `±${Math.round(livePositionFix.accuracy)} m horizontal accuracy`
        : 'Current GPS fix';
    }
    if (livePosition.status === 'locating') return 'Waiting for a fresh GPS fix';
    if (livePosition.error?.message) return livePosition.error.message;
    return livePosition.status === 'idle' ? 'Waiting for location access' : 'No current GPS fix';
  });

  // Today's daily session (shared between DailyProgress and FoodLogger)
  let todaySession = $state(null);
  let loadingSession = $state(true);

  // ── derived statistics (live from shared liveTracker) ────────────────
  const durationSec = $derived(liveTracker.durationSec);
  const durationMin = $derived(liveTracker.durationMin);
  const distanceKm = $derived(liveTracker.distanceKm);
  const avgSpeedKmh = $derived(liveTracker.avgSpeedKmh);
  const avgPaceMinKm = $derived(liveTracker.avgPaceMinKm);
  const elevationM = $derived(liveTracker.elevationM);
  const estimatedCalories = $derived(liveTracker.estimatedCalories);

  const activeGearOptions = $derived($gearList.filter((g) => !g.retired));
  const activeCustomFuelItems = $derived($fuelItems.filter((item) => item.is_active !== false));

  $effect(() => {
    if (liveTracker.lastDailySession) {
      todaySession = liveTracker.lastDailySession;
    }
  });

  // ── activity controls (delegated to shared liveTracker) ──────────────
  function selectSport(sportId) {
    liveTracker.setActivityType(sportId);
  }

  function startActivity() {
    liveTracker.startActivity({ activityType });
  }

  function pauseActivity() {
    liveTracker.pauseActivity();
  }

  function resumeActivity() {
    liveTracker.resumeActivity();
  }

  function discardActivity() {
    liveTracker.discardActivity();
  }

  async function stopActivity() {
    const result = await liveTracker.stopActivity({ currentTodaySession: todaySession });
    if (result?.dailySession) {
      todaySession = result.dailySession;
    }
  }

  async function saveStationary() {
    const result = await liveTracker.stopActivity({ currentTodaySession: todaySession, allowStationary: true });
    if (result?.dailySession) {
      todaySession = result.dailySession;
    }
  }

  // ── load today's session & seed city view ────────────────────────────
  async function loadTodaySession() {
    try {
      const res = await dailySessionApi.today();
      todaySession = res?.data ?? null;
    } catch {
      todaySession = null;
    } finally {
      loadingSession = false;
    }
  }

  onMount(() => {
    if (cachedPlace) seedLivePosition(cachedPlace);
    acquireLivePosition();
    loadTodaySession();
    void loadGear();
    void loadFuelItems();

    return () => {
      // Do NOT stop liveTracker ticker/GPS here — tracking continues across pages
      // so Dashboard stays synced until Pause / End & save / Discard.
      releaseLivePosition();
    };
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <span class="pill-brand">Live tracking</span>
      <h1 class="mt-2 font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-900">
        Track Activity
      </h1>
      <p class="text-sm text-ink-500 mt-1">
        Record live GPS distance, pace, and calories — synced straight into today’s nutrition session.
      </p>
    </div>
    <a href="/track/history" use:link class="btn-ghost text-xs">
      View History →
    </a>
  </div>

  <!-- Primary outdoor card -->
  <div class="card p-4 sm:p-6 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3 scroll-mt-20" data-tour="track-controls-header">
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Activity type">
        {#each SPORTS as sport (sport.id)}
          <button
            type="button"
            disabled={tracking}
            onclick={() => selectSport(sport.id)}
            class="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed {activityType === sport.id
              ? 'bg-brand-gradient text-white shadow-glow'
              : 'bg-brand-50 text-ink-700 hover:bg-brand-100'}"
          >
            <ActivityIcon type={sport.id} size="xs" tone={activityType === sport.id ? 'solid' : 'brand'} />
            <span>{sport.label}</span>
          </button>
        {/each}
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <GPSStatus status={displayGpsStatus} message={displayGpsMessage} />
      </div>
    </div>

    <!-- Live Metrics -->
    <ActivityStats
      {distanceKm}
      {durationMin}
      durationSec={tracking ? durationSec : null}
      {avgSpeedKmh}
      {avgPaceMinKm}
      elevationGainM={elevationM}
      calories={estimatedCalories}
    />

    {#if !tracking && activeGearOptions.length > 0}
      <div class="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-100 bg-brand-50/40 px-3.5 py-2">
        <span class="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-ink-500">
          <Footprints size={13} class="text-brand-600" /> Gear
        </span>
        <select
          aria-label="Select shoe or bike for this session"
          class="input !w-auto !py-1.5 !text-xs flex-1 sm:max-w-xs"
          value={liveTracker.gearId ?? ''}
          onchange={(e) => liveTracker.setGearId(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
        >
          <option value="">No gear selected</option>
          {#each activeGearOptions as item (item.id)}
            <option value={item.id}>
              {item.name} ({Math.round(toDisplayDistance(item.total_km, $unitSystem))} {distanceUnit($unitSystem)})
            </option>
          {/each}
        </select>
      </div>
    {/if}

    {#if tracking}
      <!-- Live Fueling & Voice Coaching Bar -->
      <div class="rounded-2xl border p-3.5 transition {liveTracker.hydrateDue || liveTracker.fuelDue
        ? 'border-amber-300 bg-amber-50/70'
        : 'border-brand-100 bg-brand-50/40'}">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="num-tabular flex flex-wrap items-center gap-2 text-xs">
            <span class="pill !bg-white text-brand-700 border border-brand-100">
              <Droplets size={12} />
              Target {ml(liveTracker.activeFuelTargets.fluidPerHourMl, $unitSystem)}/h · Logged {ml(liveTracker.fluidLoggedMl, $unitSystem)}
            </span>
            {#if liveTracker.activeFuelTargets.carbsPerHourG > 0 || durationMin >= 45}
              <span class="pill !bg-white text-amber-700 border border-amber-200">
                <Flame size={12} />
                Target {liveTracker.activeFuelTargets.carbsPerHourG || 30} g/h · Logged {liveTracker.carbsLoggedG} g
              </span>
            {/if}
            {#if liveTracker.wakeLockActive}
              <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700">
                <ShieldCheck size={11} /> Screen awake
              </span>
            {/if}
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="btn-chip !py-1.5 {liveTracker.hydrateDue ? '!border-amber-300 !bg-amber-100 !text-amber-900' : ''}"
              onclick={() => liveTracker.logHydration(200)}
            >
              <Droplets size={12} />
              <span class="num-tabular">{liveTracker.hydrateDue ? 'Drink now (+200ml)' : `Sip +200ml · ${clock(liveTracker.nextHydrateInSec).slice(3)}`}</span>
            </button>
            <button
              type="button"
              class="btn-chip !py-1.5 {liveTracker.fuelDue ? '!border-amber-300 !bg-amber-100 !text-amber-900' : ''}"
              onclick={() => liveTracker.logFuel(25)}
            >
              <Flame size={12} />
              {liveTracker.fuelDue ? 'Fuel now (+25g)' : '+25g carbs'}
            </button>
            {#each activeCustomFuelItems.slice(0, 3) as item (item.id)}
              <button
                type="button"
                class="btn-chip !py-1.5"
                onclick={() => {
                  liveTracker.logFuelItem(item);
                  notify(`Logged ${item.name}`);
                }}
              >
                + {item.name} ({item.carbs_g}g)
              </button>
            {/each}
            <button
              type="button"
              class="btn-chip !py-1.5"
              class:btn-chip-active={liveTracker.voiceCues}
              onclick={() => liveTracker.toggleVoiceCues()}
              aria-label="Toggle voice pace and hydration cues"
            >
              {#if liveTracker.voiceCues}
                <Volume2 size={12} /> Voice ON
              {:else}
                <VolumeX size={12} /> Voice OFF
              {/if}
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if liveTracker.statusNote}
      <div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-bold text-amber-800 space-y-2">
        <p>{liveTracker.statusNote}</p>
        {#if liveTracker.canSaveStationary}
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-extrabold text-amber-900 hover:bg-amber-100 transition cursor-pointer"
            onclick={saveStationary}
          >
            Save as indoor / stationary session ({Math.round(durationMin)} min)
          </button>
        {/if}
      </div>
    {/if}

    <!-- Action Buttons -->
    <ActivityControls
      {tracking}
      {paused}
      {saving}
      onStart={startActivity}
      onPause={pauseActivity}
      onResume={resumeActivity}
      onStop={stopActivity}
      onDiscard={discardActivity}
    />

  </div>

  <!-- Daily Session & Food Log -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div class="lg:col-span-2">
      <DailyProgress
        session={todaySession}
        onSessionChange={(updated) => (todaySession = updated)}
      />
    </div>
    <div class="lg:col-span-1">
      <FoodLogger
        session={todaySession}
        onSessionChange={(updated) => (todaySession = updated)}
      />
    </div>
  </div>
</div>
