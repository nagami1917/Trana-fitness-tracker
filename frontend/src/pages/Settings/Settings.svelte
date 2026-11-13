<script>
  import {
    Settings as SettingsIcon,
    Save,
    LoaderCircle,
    LogOut,
    Info,
    Brain,
    Smartphone,
    ShieldCheck,
    User,
    HeartPulse,
    Flame,
    Upload,
    Trash2,
    TriangleAlert,
    Download,
    Sun,
    Moon,
    CircleUserRound,
    Footprints,
    Activity,
    SlidersHorizontal,
    BellRing,
    Plus,
  } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import CityRegionInput from '../../components/common/CityRegionInput.svelte';
  import ProgressBar from '../../components/common/ProgressBar.svelte';
  import { profile, session, logout, notify, modelCard, activities, gearList, loadGear, unitSystem } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { energyApi, importBatch, parseCsv, CSV_COLUMNS } from '../../services/energyService.js';
  import { buildHrZones } from '../../lib/analytics/heartRate.js';
  import { buildPushSubscriptionPayload, notificationSupport, showLocalFuelingNotification } from '../../lib/pushNotifications.js';
  import { theme, setTheme } from '../../lib/theme.js';
  import {
    distanceUnit,
    fromDisplayDistance,
    fromDisplayHeight,
    fromDisplayTemp,
    fromDisplayWeight,
    heightUnit,
    tempUnit,
    toDisplayDistance,
    toDisplayHeight,
    toDisplayTemp,
    toDisplayWeight,
    weightUnit,
  } from '../../lib/units.js';
  import { navigate } from '../../lib/router.js';
  import { nf } from '../../lib/format.js';
  import { onMount } from 'svelte';

  let activeTab = $state('bio'); // 'bio' | 'appearance' | 'devices'

  let form = $state({
    name: $profile?.name ?? '',
    email: $profile?.email ?? '',
    weight_kg: $profile?.weight_kg ?? 60,
    height_cm: $profile?.height_cm ?? '',
    birth_year: $profile?.birth_year ?? '',
    sex: $profile?.sex ?? 'female',
    city: $profile?.city ?? '',
    sweat_profile: $profile?.sweat_profile ?? 'normal',
    experience_level: $profile?.experience_level ?? 3,
    typical_temperature_c: $profile?.typical_temperature_c ?? 26,
    resting_hr: $profile?.resting_hr ?? '',
    max_hr: $profile?.max_hr ?? '',
    units: $profile?.units ?? 'metric',
  });
  let saving = $state(false);
  let locating = $state(false);

  // Gear locker state
  let addingGear = $state(false);
  let gearSaving = $state(false);
  let gearDraft = $state({ name: '', sport: 'run', brand: '', max_km: 700 });

  // Web Push notifications state
  let pushState = $state({
    subscribed: false,
    count: 0,
    preferences: { pre_workout_fueling: true, gear_wear_alerts: true, race_carb_loading: true },
  });
  let pushBusy = $state(false);
  const pushSupport = notificationSupport();

  const hrZonePreview = $derived(
    buildHrZones({
      maxHr: form.max_hr !== '' ? Number(form.max_hr) : null,
      restingHr: form.resting_hr !== '' ? Number(form.resting_hr) : null,
      birthYear: form.birth_year !== '' ? Number(form.birth_year) : null,
    }),
  );

  // Wearable energy-expenditure calibration (services/energyService.js).
  let calibration = $state(null);
  let csvText = $state('');
  let importing = $state(false);
  let importError = $state('');
  let importNote = $state('');

  onMount(() => {
    void loadCalibration();
    void loadGear();
    void loadPushStatus();
  });

  async function loadPushStatus() {
    try {
      const res = await api.push.status();
      if (res) pushState = res;
    } catch {
      // ignore if push endpoint unavailable
    }
  }

  async function enablePush() {
    if (pushBusy) return;
    pushBusy = true;
    try {
      const sub = await buildPushSubscriptionPayload();
      const res = await api.push.subscribe({ ...sub, preferences: pushState.preferences });
      pushState = {
        subscribed: true,
        count: Math.max(1, pushState.count),
        preferences: res?.preferences ?? pushState.preferences,
      };
      notify('Pre-workout fueling alerts enabled on this device.');
    } catch (err) {
      notify(err?.message || 'Could not enable push reminders', 'error');
    } finally {
      pushBusy = false;
    }
  }

  async function disablePush() {
    if (pushBusy) return;
    pushBusy = true;
    try {
      await api.push.unsubscribe();
      pushState = { ...pushState, subscribed: false, count: 0 };
      notify('Device push subscription removed.', 'info');
    } catch (err) {
      notify(err?.message || 'Could not unsubscribe', 'error');
    } finally {
      pushBusy = false;
    }
  }

  async function togglePushPref(key) {
    const next = { ...pushState.preferences, [key]: !pushState.preferences[key] };
    pushState = { ...pushState, preferences: next };
    try {
      await api.push.updatePreferences(next);
    } catch {
      // ignore
    }
  }

  async function saveNewGear(event) {
    event?.preventDefault?.();
    if (!gearDraft.name.trim() || gearSaving) return;
    gearSaving = true;
    try {
      const created = await api.gear.create({
        name: gearDraft.name.trim(),
        sport: gearDraft.sport,
        brand: gearDraft.brand.trim() || null,
        max_km: Math.max(50, Number(gearDraft.max_km) || 700),
      });
      gearList.update((rows) => [created, ...rows]);
      gearDraft = { name: '', sport: 'run', brand: '', max_km: 700 };
      addingGear = false;
      notify('Gear added to locker.');
    } catch (err) {
      notify(err?.message || 'Could not add gear', 'error');
    } finally {
      gearSaving = false;
    }
  }

  async function toggleGearRetire(item) {
    try {
      const updated = await api.gear.update(item.id, { retired: !item.retired });
      gearList.update((rows) => rows.map((r) => (r.id === item.id ? updated : r)));
    } catch (err) {
      notify(err?.message || 'Could not update gear', 'error');
    }
  }

  async function deleteGear(id) {
    try {
      await api.gear.remove(id);
      gearList.update((rows) => rows.filter((r) => r.id !== id));
      notify('Gear removed.', 'info');
    } catch (err) {
      notify(err?.message || 'Could not delete gear', 'error');
    }
  }

  async function loadCalibration() {
    try {
      calibration = await energyApi.calibration();
      if (calibration?.calibration_factor != null) {
        profile.update((p) => (p ? { ...p, energy_calibration_factor: Number(calibration.calibration_factor) } : p));
      }
    } catch {
      calibration = null;
    }
  }

  async function importMeasurements() {
    if (importing) return;
    importError = '';
    importNote = '';
    const entries = parseCsv(csvText);
    if (entries.length === 0) {
      importError = 'Paste at least one CSV row using the columns below.';
      return;
    }
    if (entries.length > 200) {
      importError = 'Import at most 200 rows at a time — each row is sent as its own request.';
      return;
    }
    importing = true;
    try {
      const results = await importBatch(entries);
      const saved = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success);
      importNote = `Imported ${saved} of ${results.length} ${results.length === 1 ? 'sample' : 'samples'}.`;
      if (failed.length > 0) {
        importError = `${failed.length} row(s) failed — first error: ${failed[0].error}`;
      }
      csvText = '';
      await loadCalibration();
      notify('Wearable samples imported.');
    } catch (error) {
      importError = error.message || 'Could not import the samples.';
    } finally {
      importing = false;
    }
  }

  $effect(() => {
    if ($profile && !form.name) {
      form = {
        name: $profile.name ?? '',
        email: $profile.email ?? '',
        weight_kg: $profile.weight_kg ?? 60,
        height_cm: $profile.height_cm ?? '',
        birth_year: $profile.birth_year ?? '',
        sex: $profile.sex ?? 'female',
        city: $profile.city ?? '',
        sweat_profile: $profile.sweat_profile ?? 'normal',
        experience_level: $profile.experience_level ?? 3,
        typical_temperature_c: $profile.typical_temperature_c ?? 26,
        resting_hr: $profile.resting_hr ?? '',
        max_hr: $profile.max_hr ?? '',
        units: $profile.units ?? 'metric',
      };
    }
  });

  async function save() {
    if (saving || locating) return;
    saving = true;
    let written = false;
    try {
      const resting = form.resting_hr == null || form.resting_hr === '' ? null : Number(form.resting_hr);
      const maxHr = form.max_hr == null || form.max_hr === '' ? null : Number(form.max_hr);
      const updated = await api.profile.update({
        name: form.name,
        weight_kg: Number(form.weight_kg),
        height_cm: form.height_cm == null || form.height_cm === '' ? null : Number(form.height_cm),
        birth_year: form.birth_year == null || form.birth_year === '' ? null : Number(form.birth_year),
        sex: form.sex,
        city: form.city.trim() || null,
        sweat_profile: form.sweat_profile,
        experience_level: Number(form.experience_level),
        typical_temperature_c: Number(form.typical_temperature_c),
        resting_hr: resting,
        max_hr: maxHr,
        hr_zones: buildHrZones({
          maxHr,
          restingHr: resting,
          birthYear: form.birth_year !== '' ? Number(form.birth_year) : null,
        }).map(({ zone, name, min, max }) => ({ zone, name, min, max })),
        units: form.units,
      });
      written = true;
      profile.set(updated);
      if (updated?.name) session.update((s) => (s ? { ...s, name: updated.name } : s));
      notify('Profile saved — predictions will use your new numbers.');
    } catch (error) {
      notify(written ? 'Profile saved, but the view could not refresh. Reload when connected.' : (error.message || 'Could not save profile'), 'error');
    } finally {
      saving = false;
    }
  }

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  // --- data rights: CSV export + account erasure --------------------------
  let exporting = $state(false);
  let deleteOpen = $state(false);
  let deleting = $state(false);
  let deletePassword = $state('');
  let deleteConfirm = $state('');

  async function exportActivities() {
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

  async function deleteAccount() {
    if (deleteConfirm.trim().toUpperCase() !== 'DELETE') {
      notify('Type DELETE to confirm.', 'error');
      return;
    }
    deleting = true;
    try {
      await api.account.delete(deletePassword);
      notify('Account and all data deleted.');
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      deleting = false;
    }
  }

  const initial = $derived((form.name || $session?.name || 'N').slice(0, 1).toUpperCase());
</script>

<div class="space-y-5">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <span class="pill mb-2"><SettingsIcon size={12} /> Settings & Profile</span>
      <h1 class="font-display text-2xl sm:text-3xl">Athlete preferences, display & data</h1>
      <p class="mt-1 text-sm font-semibold text-ink-400">Everything that powers your predictions, outdoor contrast, and device data in one place.</p>
    </div>
    <div class="flex flex-wrap items-center gap-2 self-start">
      <a href="/profile" class="btn-ghost text-xs"><CircleUserRound size={14} /> Full profile page</a>
      <button class="btn-primary" onclick={save} disabled={saving || locating}>
        {#if saving}<LoaderCircle size={15} class="animate-spin" /> Saving…{:else}<Save size={15} /> Save changes{/if}
      </button>
    </div>
  </div>

  <!-- Tab switcher: Athlete Bio active by default -->
  <div class="flex flex-wrap gap-2" role="tablist" aria-label="Settings sections">
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === 'bio'}
      class="btn-chip {activeTab === 'bio' ? 'btn-chip-active' : ''}"
      onclick={() => (activeTab = 'bio')}
    >
      <User size={14} /> Athlete Bio
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === 'appearance'}
      class="btn-chip {activeTab === 'appearance' ? 'btn-chip-active' : ''}"
      onclick={() => (activeTab = 'appearance')}
    >
      <SlidersHorizontal size={14} /> Units & Appearance
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === 'devices'}
      class="btn-chip {activeTab === 'devices' ? 'btn-chip-active' : ''}"
      onclick={() => (activeTab = 'devices')}
    >
      <ShieldCheck size={14} /> Devices & Data
    </button>
  </div>

  {#if activeTab === 'bio'}
    <div class="grid gap-5 xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
      <!-- Summary identity card (Tier 1 flat) -->
      <Card flat class="flex h-fit flex-col items-center gap-4 text-center">
        <div class="grid h-20 w-20 place-items-center rounded-full bg-brand-gradient font-display text-2xl font-extrabold text-white shadow-glow">
          {initial}
        </div>
        <div>
          <p class="text-lg font-extrabold text-ink-900">{form.name || $profile?.name || 'Athlete'}</p>
          <p class="text-xs font-semibold text-ink-400">{form.email || $session?.email || ''}</p>
          {#if form.city}<p class="mt-1 text-xs font-bold text-brand-600">{form.city}</p>{/if}
        </div>
        <div class="grid w-full grid-cols-3 gap-2">
          <div class="rounded-2xl border border-brand-100 bg-white/80 px-2 py-2.5">
            <Footprints size={14} class="mx-auto text-brand-500" />
            <p class="num-tabular mt-1 text-base font-extrabold leading-none text-ink-900">{$profile?.total_activities ?? 0}</p>
            <p class="mt-1 text-[11px] font-bold text-ink-400">sessions</p>
          </div>
          <div class="rounded-2xl border border-brand-100 bg-white/80 px-2 py-2.5">
            <Flame size={14} class="mx-auto text-brand-500" />
            <p class="num-tabular mt-1 text-base font-extrabold leading-none text-ink-900">{$profile?.daily_calorie_goal ?? '—'}</p>
            <p class="mt-1 text-[11px] font-bold text-ink-400">kcal/day</p>
          </div>
          <div class="rounded-2xl border border-brand-100 bg-white/80 px-2 py-2.5">
            <Activity size={14} class="mx-auto text-brand-500" />
            <p class="num-tabular mt-1 text-base font-extrabold leading-none text-ink-900">{form.experience_level}/5</p>
            <p class="mt-1 text-[11px] font-bold text-ink-400">level</p>
          </div>
        </div>
      </Card>

      <div class="space-y-4">
        <Card>
          <div class="flex items-center gap-2">
            <User size={17} class="text-brand-500" />
            <h2 class="text-lg">Athlete biometrics</h2>
          </div>

          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <span class="label">Name</span>
              <input class="input" bind:value={form.name} />
            </div>
            <div>
              <span class="label">Email</span>
              <input class="input" type="email" bind:value={form.email} disabled class:bg-brand-50={true} />
            </div>
            <div>
              <span class="label">Body mass ({weightUnit(form.units)})</span>
              <input
                class="input num-tabular"
                type="number"
                step="0.5"
                min="30"
                value={Math.round(toDisplayWeight(form.weight_kg, form.units) * 10) / 10}
                oninput={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v)) form.weight_kg = Math.round(fromDisplayWeight(v, form.units) * 10) / 10;
                }}
              />
            </div>
            <div>
              <span class="label">Height ({heightUnit(form.units)}, optional)</span>
              <input
                class="input num-tabular"
                type="number"
                step="1"
                min="36"
                value={form.height_cm === '' || form.height_cm == null ? '' : Math.round(toDisplayHeight(form.height_cm, form.units) * 10) / 10}
                oninput={(e) => {
                  const raw = e.currentTarget.value;
                  if (raw === '') {
                    form.height_cm = '';
                    return;
                  }
                  const v = Number(raw);
                  if (Number.isFinite(v)) form.height_cm = Math.round(fromDisplayHeight(v, form.units) * 10) / 10;
                }}
              />
            </div>
            <div>
              <span class="label">Birth year (optional)</span>
              <input class="input num-tabular" type="number" min="1930" max={new Date().getFullYear()} bind:value={form.birth_year} />
            </div>
            <CityRegionInput id="settings-city" bind:value={form.city} bind:busy={locating} disabled={saving} />
          </div>

          <div class="mt-3">
            <span class="label">Sex (affects sweat & energy estimates)</span>
            <Segmented
              options={[
                { id: 'female', label: 'Female' },
                { id: 'male', label: 'Male' },
                { id: 'other', label: 'Prefer not to say' },
              ]}
              value={form.sex}
              onSelect={(v) => (form.sex = v)}
            />
          </div>
        </Card>

        <Card>
          <div class="flex items-center gap-2">
            <HeartPulse size={17} class="text-brand-500" />
            <h2 class="text-lg">Training & sweat profile</h2>
          </div>

          <div class="mt-3 space-y-3">
            <div>
              <span class="label">Experience level ({form.experience_level}/5)</span>
              <input class="w-full accent-brand-500" type="range" min="1" max="5" step="1" bind:value={form.experience_level} />
              <div class="flex justify-between text-[11px] font-bold text-ink-400">
                <span>New to sport</span><span>Seasoned</span>
              </div>
            </div>

            <div>
              <span class="label">Sweat profile</span>
              <Segmented
                options={[
                  { id: 'low', label: 'Light sweater' },
                  { id: 'normal', label: 'Average' },
                  { id: 'high', label: 'Heavy sweater' },
                ]}
                value={form.sweat_profile}
                onSelect={(v) => (form.sweat_profile = v)}
              />
              <p class="mt-1 text-[11px] font-semibold text-ink-400">
                Heavy sweaters get more sodium per hour ({form.sweat_profile === 'high' ? '800' : form.sweat_profile === 'low' ? '350' : '550'} mg/h baseline).
              </p>
            </div>

            <div>
              <span class="label">Typical temperature ({tempUnit(form.units)})</span>
              <input
                class="input num-tabular"
                type="number"
                min="-20"
                max="130"
                value={Math.round(toDisplayTemp(form.typical_temperature_c, form.units))}
                oninput={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v)) form.typical_temperature_c = Math.round(fromDisplayTemp(v, form.units));
                }}
              />
            </div>

            <div class="border-t border-brand-100 pt-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <span class="label">Resting heart rate (bpm)</span>
                  <input class="input num-tabular" type="number" min="30" max="120" placeholder="e.g. 54" bind:value={form.resting_hr} />
                </div>
                <div>
                  <span class="label">Max heart rate (bpm)</span>
                  <input class="input num-tabular" type="number" min="110" max="230" placeholder="Auto from birth year" bind:value={form.max_hr} />
                </div>
              </div>
              <div class="mt-2.5 grid grid-cols-5 gap-1.5">
                {#each hrZonePreview as z (z.zone)}
                  <div class="rounded-xl border border-brand-100 bg-brand-50/40 p-1.5 text-center">
                    <span class="mx-auto block h-1 w-6 rounded-full" style="background:{z.color}"></span>
                    <p class="mt-1 text-[10px] font-extrabold text-ink-900">Z{z.zone}</p>
                    <p class="num-tabular text-[10px] font-bold text-ink-400">{z.min}–{z.max}</p>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  {:else if activeTab === 'appearance'}
    <div class="grid gap-5 lg:grid-cols-2">
      <Card>
        <div class="flex items-center gap-2">
          <SlidersHorizontal size={17} class="text-brand-500" />
          <h2 class="text-lg">Units & outdoor visibility</h2>
        </div>
        <div class="mt-4 space-y-4">
          <div>
            <span class="label">Measurement system</span>
            <Segmented
              options={[
                { id: 'metric', label: 'Metric (km, kg)' },
                { id: 'imperial', label: 'Imperial (mi, lb)' },
              ]}
              value={form.units}
              onSelect={(v) => (form.units = v)}
            />
            <p class="mt-1.5 text-xs font-semibold text-ink-400">
              Applies to route lengths, paces, elevation, hydration volumes, and weather across the whole app. Click Save changes above to persist.
            </p>
          </div>

          <div>
            <span class="label">Outdoor & display theme</span>
            <div class="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                class="flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-extrabold transition {$theme === 'light'
                  ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-soft'
                  : 'border-brand-100 bg-white text-ink-500 hover:border-brand-200'}"
                onclick={() => setTheme('light')}
              >
                <Sun size={15} /> Daylight (Blossom)
              </button>
              <button
                type="button"
                class="flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-extrabold transition {$theme === 'dark'
                  ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-soft'
                  : 'border-brand-100 bg-white text-ink-500 hover:border-brand-200'}"
                onclick={() => setTheme('dark')}
              >
                <Moon size={15} /> Dark Outdoor (OLED)
              </button>
            </div>
            <p class="mt-1.5 text-xs font-semibold text-ink-400">
              High-contrast OLED dark mode dims map tiles at night while keeping route lines and pace telemetry sharp.
            </p>
          </div>
        </div>
      </Card>

      <Card flat>
        <div class="flex items-center gap-2">
          <Smartphone size={17} class="text-brand-500" />
          <h2 class="text-lg">Install TRANA</h2>
        </div>
        <p class="mt-2 text-xs font-semibold leading-relaxed text-ink-500">
          TRANA is a progressive web app. Prediction previews and queued GPS saves work offline on your device, and sync back automatically once connected.
        </p>
        <p class="mt-3 text-[11px] font-bold uppercase tracking-wide text-ink-400">iOS: Share → Add to Home Screen · Android: menu → Install app</p>
        <div class="mt-4 flex items-start gap-2 rounded-2xl border border-brand-100 bg-white/70 p-3">
          <Info size={15} class="mt-0.5 shrink-0 text-ink-400" />
          <p class="text-[11px] font-semibold leading-relaxed text-ink-400">
            TRANA gives estimates for healthy adults training in normal conditions. It is not medical advice — check with
            a professional for clinical conditions, pregnancy or extreme environments.
          </p>
        </div>
      </Card>
    </div>
  {:else}
    <div class="grid gap-5 lg:grid-cols-2">
      <div class="space-y-4">
        <Card>
          <div class="flex items-center gap-2">
            <Flame size={17} class="text-brand-500" />
            <h2 class="text-lg">Wearable energy calibration</h2>
          </div>
          <p class="mt-2 text-xs font-semibold leading-relaxed text-ink-500">
            Import what your watch measured and TRANA scales its calorie estimates to match.
            {#if calibration && calibration.sample_count < calibration.min_samples}
              {calibration.min_samples - calibration.sample_count} more
              {calibration.min_samples - calibration.sample_count === 1 ? 'sample' : 'samples'} until calibration kicks in.
            {/if}
          </p>

          {#if calibration}
            {@const active = calibration.sample_count >= calibration.min_samples}
            <div class="num-tabular mt-3 space-y-1.5 text-xs font-semibold text-ink-600">
              <p class="flex justify-between"><span class="text-ink-400">Calibration factor</span><span>{active ? `${calibration.calibration_factor.toFixed(2)}×` : 'not active'}</span></p>
              <p class="flex justify-between"><span class="text-ink-400">Device samples</span><span>{calibration.sample_count} / {calibration.min_samples}</span></p>
            </div>
          {/if}

          <div class="mt-3">
            <span class="label">Paste CSV — {CSV_COLUMNS.join(', ')}</span>
            <textarea
              class="input h-24 font-mono text-[11px]"
              bind:value={csvText}
              placeholder="device_type,activity_type,distance_km,duration_min,avg_heart_rate,weight_kg,measured_calories,recorded_at
garmin,run,5.2,32.5,158,68,420,2026-11-09T08:00:00+08:00"
            ></textarea>
          </div>
          <button class="btn-primary mt-2 w-full justify-center" onclick={importMeasurements} disabled={importing}>
            {#if importing}<LoaderCircle size={15} class="animate-spin" /> Importing…{:else}<Upload size={15} /> Import samples{/if}
          </button>
          {#if importNote}<p class="mt-2 text-[11px] font-semibold text-emerald-600">{importNote}</p>{/if}
          {#if importError}<p class="mt-2 text-[11px] font-semibold text-rose-500">{importError}</p>{/if}
        </Card>

        <Card class="bg-gradient-to-br from-brand-600 to-brand-700 text-white">
          <div class="flex items-center gap-2">
            <Brain size={18} />
            <h2 class="text-lg text-white">Prediction engine</h2>
          </div>
          <div class="num-tabular mt-3 space-y-1.5 text-xs font-semibold text-white/85">
            <p class="flex justify-between"><span class="text-white/60">Model version</span><span>{$modelCard?.version ?? 'local'}</span></p>
            <p class="flex justify-between"><span class="text-white/60">Algorithm</span><span class="text-right">{($modelCard?.algorithm ?? 'Gradient boosting').replace('GradientBoostingRegressor', 'Gradient boosting')}</span></p>
            <p class="flex justify-between"><span class="text-white/60">Test error</span><span>{$modelCard?.metrics ? `±${Math.round($modelCard.metrics.mape_pct)}%` : '—'}</span></p>
            <p class="flex justify-between"><span class="text-white/60">Training rows</span><span>{nf($modelCard?.corpus_rows ?? 0)}</span></p>
            <p class="flex justify-between"><span class="text-white/60">Your sessions</span><span>{$activities.length}</span></p>
            <p class="flex justify-between"><span class="text-white/60">Storage</span><span>TRANA API</span></p>
          </div>
          <p class="mt-3 text-[11px] font-semibold leading-relaxed text-white/75">
            {#if $modelCard?.training_source === 'synthetic'}
              The bundled model was trained and tested on synthetic activities; its real-world accuracy is not validated.
            {:else}
              Prediction results are estimates and may differ from your actual performance.
            {/if}
          </p>
        </Card>
      </div>

      <div class="space-y-4">
        <Card>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <Footprints size={17} class="text-brand-500" />
              <h2 class="text-lg">Gear & Shoe Locker</h2>
            </div>
            <button type="button" class="btn-chip !py-1" onclick={() => (addingGear = !addingGear)}>
              <Plus size={12} /> {addingGear ? 'Close' : 'Add gear'}
            </button>
          </div>
          <p class="mt-1 text-xs font-semibold text-ink-500">
            Track shoe cushioning & bike mileage automatically — alerts fire at 85% wear.
          </p>

          {#if addingGear}
            <form class="mt-3 grid gap-2 rounded-2xl border border-brand-100 bg-brand-50/40 p-3 sm:grid-cols-4" onsubmit={saveNewGear}>
              <input class="input sm:col-span-2" placeholder="Name (e.g. Vaporfly 3)" bind:value={gearDraft.name} required />
              <select class="input" bind:value={gearDraft.sport}>
                <option value="run">Running Shoe</option>
                <option value="ride">Bike</option>
                <option value="hike">Trail / Hike</option>
                <option value="all">All Sports</option>
              </select>
              <input class="input num-tabular" type="number" min="50" max="50000" placeholder="Max km" bind:value={gearDraft.max_km} />
              <input class="input sm:col-span-3" placeholder="Brand (optional)" bind:value={gearDraft.brand} />
              <button type="submit" class="btn-primary !py-2" disabled={gearSaving}>Save</button>
            </form>
          {/if}

          <div class="mt-3 space-y-2.5">
            {#each $gearList as item (item.id)}
              <div class="rounded-2xl border border-brand-100 bg-white/80 p-3">
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <p class="text-xs font-extrabold text-ink-900">
                      {item.name}
                      {#if item.brand}<span class="font-semibold text-ink-400">· {item.brand}</span>{/if}
                      {#if item.retired}<span class="ml-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] text-ink-500">Retired</span>{/if}
                    </p>
                    <p class="num-tabular text-[11px] font-bold text-ink-500">
                      {Math.round(toDisplayDistance(item.total_km, $unitSystem))} / {Math.round(toDisplayDistance(item.max_km, $unitSystem))} {distanceUnit($unitSystem)} ({Math.round(item.wear_pct)}%)
                    </p>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <button type="button" class="btn-chip !py-1" onclick={() => toggleGearRetire(item)}>
                      {item.retired ? 'Reactivate' : 'Retire'}
                    </button>
                    <button type="button" class="text-ink-300 hover:text-rose-500 p-1" aria-label="Delete {item.name}" onclick={() => deleteGear(item.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div class="mt-2">
                  <ProgressBar value={item.total_km} max={item.max_km} tone={item.wear_pct >= 85 ? 'amber' : 'brand'} height="h-1.5" />
                </div>
              </div>
            {:else}
              <p class="text-xs font-semibold text-ink-400">No shoes or bikes added yet.</p>
            {/each}
          </div>
        </Card>

        <Card>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <BellRing size={17} class="text-brand-500" />
              <h2 class="text-lg">Pre-Workout Fueling Push</h2>
            </div>
            <span class="pill {pushState.subscribed ? 'bg-emerald-50 text-emerald-700' : ''}">
              {pushState.subscribed ? 'Subscribed' : 'Off'}
            </span>
          </div>
          <p class="mt-2 text-xs font-semibold leading-relaxed text-ink-500">
            Receive pre-session meal timing windows (3h and 45m prior), shoe wear alerts, and race-week carb-loading reminders.
          </p>

          <div class="mt-3 flex flex-wrap gap-2">
            {#if !pushState.subscribed}
              <button type="button" class="btn-primary" disabled={pushBusy || !pushSupport.supported} onclick={enablePush}>
                <BellRing size={14} /> Enable push reminders
              </button>
            {:else}
              <button type="button" class="btn-ghost" disabled={pushBusy} onclick={disablePush}>
                Disable push
              </button>
            {/if}
            <button
              type="button"
              class="btn-chip"
              onclick={async () => {
                const ok = await showLocalFuelingNotification();
                notify(ok ? 'Test reminder dispatched' : 'Grant notification permission first', ok ? 'success' : 'info');
              }}
            >
              Send test notification
            </button>
          </div>

          <div class="mt-3 space-y-1.5 text-xs font-bold text-ink-700">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={pushState.preferences.pre_workout_fueling} onchange={() => togglePushPref('pre_workout_fueling')} class="accent-brand-600 rounded" />
              <span>Pre-workout carb & meal window alerts</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={pushState.preferences.gear_wear_alerts} onchange={() => togglePushPref('gear_wear_alerts')} class="accent-brand-600 rounded" />
              <span>Gear wear warnings (≥85% mileage)</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={pushState.preferences.race_carb_loading} onchange={() => togglePushPref('race_carb_loading')} class="accent-brand-600 rounded" />
              <span>48h pre-race carb-loading reminders</span>
            </label>
          </div>
        </Card>

        <Card flat>
          <div class="flex items-center gap-2">
            <ShieldCheck size={17} class="text-brand-500" />
            <h2 class="text-lg">Account & data export</h2>
          </div>
          <div class="mt-3 space-y-2">
            <p class="text-xs font-semibold text-ink-400">
              Signed in as <span class="font-extrabold text-ink-700">{$session?.email ?? ''}</span>
            </p>
            <button class="btn-ghost w-full justify-start" onclick={exportActivities} disabled={exporting}>
              {#if exporting}<LoaderCircle size={15} class="animate-spin" /> Preparing…{:else}<Download size={15} /> Export activities (CSV){/if}
            </button>
            <button class="btn-ghost w-full justify-start !text-rose-500" onclick={signOut}><LogOut size={15} /> Sign out</button>
          </div>
        </Card>

        <Card>
          <div class="flex items-center gap-2">
            <TriangleAlert size={17} class="text-rose-500" />
            <h2 class="text-lg">Danger zone</h2>
          </div>
          <p class="mt-2 text-xs font-semibold leading-relaxed text-ink-500">
            Permanently delete your account and every row tied to it — activities, goals, achievements,
            plans, and sessions. This cannot be undone.
            <a href="/privacy" class="font-bold text-brand-600 hover:underline">Privacy policy</a>
          </p>

          {#if !deleteOpen}
            <button class="btn-ghost mt-3 w-full justify-center !border-rose-200 !text-rose-600" onclick={() => (deleteOpen = true)}>
              <Trash2 size={15} /> Delete account…
            </button>
          {:else}
            <div class="mt-3 space-y-2 rounded-2xl border border-rose-100 bg-rose-50/60 p-3">
              <div>
                <label class="label" for="delete-password">Confirm your password</label>
                <input
                  id="delete-password"
                  type="password"
                  class="input"
                  autocomplete="current-password"
                  bind:value={deletePassword}
                  placeholder="Password"
                />
              </div>
              <div>
                <label class="label" for="delete-confirm">Type DELETE to confirm</label>
                <input id="delete-confirm" class="input" bind:value={deleteConfirm} placeholder="DELETE" />
              </div>
              <div class="flex gap-2">
                <button class="btn-ghost flex-1" onclick={() => { deleteOpen = false; deletePassword = ''; deleteConfirm = ''; }} disabled={deleting}>Cancel</button>
                <button class="btn-primary flex-1 !bg-rose-500" onclick={deleteAccount} disabled={deleting || !deletePassword || !deleteConfirm}>
                  {#if deleting}<LoaderCircle size={15} class="animate-spin" /> Deleting…{:else}Delete forever{/if}
                </button>
              </div>
            </div>
          {/if}
        </Card>
      </div>
    </div>
  {/if}
</div>
