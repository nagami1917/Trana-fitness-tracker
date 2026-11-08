<script>
  import { onMount } from 'svelte';
  import { CircleUserRound, Save, LoaderCircle, Flame, Footprints, CalendarDays } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import { api } from '../../services/client.js';
  import { profile, session, refresh, notify } from '../../stores/index.js';

  let form = $state({
    name: '',
    city: '',
    weight_kg: 60,
    height_cm: '',
    sex: 'other',
    sweat_profile: 'normal',
    experience_level: 3,
    typical_temperature_c: 26,
    units: 'metric',
  });
  let loading = $state(false);

  onMount(() => {
    const p = $profile;
    if (!p) return;
    form = {
      name: p.name ?? '',
      city: p.city ?? '',
      weight_kg: p.weight_kg ?? 60,
      height_cm: p.height_cm ?? '',
      sex: p.sex ?? 'other',
      sweat_profile: p.sweat_profile ?? 'normal',
      experience_level: p.experience_level ?? 3,
      typical_temperature_c: p.typical_temperature_c ?? 26,
      units: p.units ?? 'metric',
    };
  });

  const initial = $derived((form.name || $session?.name || 'N').slice(0, 1).toUpperCase());

  async function save(event) {
    event.preventDefault();
    loading = true;
    let written = false;
    try {
      await api.profile.update({
        name: form.name.trim() || undefined,
        city: form.city.trim() || null,
        weight_kg: Number(form.weight_kg),
        height_cm: form.height_cm === '' ? null : Number(form.height_cm),
        sex: form.sex,
        sweat_profile: form.sweat_profile,
        experience_level: Number(form.experience_level),
        typical_temperature_c: Number(form.typical_temperature_c),
        units: form.units,
      });
      written = true;
      await refresh();
      notify('Profile saved');
    } catch (err) {
      notify(written ? 'Profile saved, but the view could not refresh. Reload when connected.' : (err.message || 'Could not save your profile'), 'error');
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>TRANA — Profile</title>
</svelte:head>

<header class="mb-6 flex flex-col gap-1">
  <span class="pill w-fit bg-brand-50 text-brand-600"><CircleUserRound size={12} /> Profile</span>
  <h1 class="font-display text-2xl font-extrabold tracking-tight text-ink-900">Your athlete profile</h1>
  <p class="max-w-lg text-sm font-semibold text-ink-400">
    Everything on this page feeds the prediction model and the fueling math — keep it current.
  </p>
</header>

<div class="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
  <!-- identity card -->
  <Card class="flex h-fit flex-col items-center gap-4 p-6 text-center">
    <div class="grid h-24 w-24 place-items-center rounded-full bg-brand-gradient font-display text-3xl font-extrabold text-white shadow-glow">
      {initial}
    </div>
    <div>
      <p class="text-lg font-extrabold text-ink-900">{$profile?.name ?? 'Athlete'}</p>
      <p class="text-xs font-semibold text-ink-400">{$session?.email ?? ''}</p>
      {#if $profile?.city}<p class="mt-1 text-xs font-bold text-brand-600">{$profile.city}</p>{/if}
    </div>
    <div class="grid w-full grid-cols-2 gap-3">
      <div class="rounded-2xl bg-brand-50/70 px-3 py-3">
        <Footprints size={16} class="mx-auto text-brand-500" />
        <p class="mt-1 text-lg font-extrabold leading-none text-ink-900">{$profile?.total_activities ?? 0}</p>
        <p class="mt-1 text-[10px] font-bold uppercase tracking-wider text-ink-400">activities</p>
      </div>
      <div class="rounded-2xl bg-brand-50/70 px-3 py-3">
        <Flame size={16} class="mx-auto text-brand-500" />
        <p class="mt-1 text-lg font-extrabold leading-none text-ink-900">{$profile?.daily_calorie_goal ?? '—'}</p>
        <p class="mt-1 text-[10px] font-bold uppercase tracking-wider text-ink-400">kcal / day goal</p>
      </div>
    </div>
    {#if $profile?.age}
      <p class="flex items-center gap-1.5 text-[11px] font-semibold text-ink-400">
        <CalendarDays size={12} /> {$profile.age} years · experience level {$profile.experience_level ?? 3}/5
      </p>
    {/if}
  </Card>

  <!-- edit form -->
  <Card class="p-6">
    <form class="grid gap-5 sm:grid-cols-2" onsubmit={save}>
      <div>
        <label class="label" for="name">Name</label>
        <input id="name" class="input" bind:value={form.name} maxlength="80" required />
      </div>
      <div>
        <label class="label" for="city">City</label>
        <input id="city" class="input" bind:value={form.city} maxlength="120" placeholder="Lusacan" />
      </div>

      <div>
        <label class="label" for="weight">Weight (kg)</label>
        <input id="weight" type="number" min="25" max="250" step="0.5" class="input" bind:value={form.weight_kg} required />
      </div>
      <div>
        <label class="label" for="height">Height (cm)</label>
        <input id="height" type="number" min="100" max="250" step="0.5" class="input" bind:value={form.height_cm} placeholder="optional" />
      </div>

      <div class="sm:col-span-2">
        <p class="label">Sex</p>
        <Segmented
          value={form.sex}
          onSelect={(id) => (form.sex = id)}
          options={[
            { id: 'female', label: 'Female' },
            { id: 'male', label: 'Male' },
            { id: 'other', label: 'Other' },
          ]}
        />
      </div>

      <div class="sm:col-span-2">
        <p class="label">Sweat profile</p>
        <Segmented
          value={form.sweat_profile}
          onSelect={(id) => (form.sweat_profile = id)}
          options={[
            { id: 'low', label: 'Light sweater' },
            { id: 'normal', label: 'Average' },
            { id: 'high', label: 'Salty sweater' },
          ]}
        />
      </div>

      <div class="sm:col-span-2">
        <p class="label">Experience</p>
        <Segmented
          value={String(form.experience_level)}
          onSelect={(id) => (form.experience_level = Number(id))}
          options={[
            { id: '1', label: '1 · New' },
            { id: '2', label: '2' },
            { id: '3', label: '3 · Regular' },
            { id: '4', label: '4' },
            { id: '5', label: '5 · Elite' },
          ]}
        />
      </div>

      <div class="sm:col-span-2">
        <div class="flex items-baseline justify-between">
          <label class="label" for="temp">Typical training temperature</label>
          <p class="text-sm font-extrabold text-brand-700">{form.typical_temperature_c}°C</p>
        </div>
        <input id="temp" type="range" min="-10" max="50" step="1" bind:value={form.typical_temperature_c} class="mt-2 w-full accent-brand-500" />
      </div>

      <div class="sm:col-span-2">
        <p class="label">Units</p>
        <Segmented
          value={form.units}
          onSelect={(id) => (form.units = id)}
          options={[
            { id: 'metric', label: 'Metric (km, kg)' },
            { id: 'imperial', label: 'Imperial (mi, lb)' },
          ]}
        />
      </div>

      <div class="sm:col-span-2">
        <button type="submit" class="btn-primary w-full !py-3" disabled={loading}>
          {#if loading}
            <LoaderCircle size={17} class="animate-spin" /> Saving…
          {:else}
            <Save size={17} /> Save profile
          {/if}
        </button>
      </div>
    </form>
  </Card>
</div>
