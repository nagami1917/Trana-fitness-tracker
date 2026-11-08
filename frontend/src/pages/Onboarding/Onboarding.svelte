<script>
  import { User, Target, Droplets, ArrowRight, LoaderCircle, Check, MapPin, Sparkles } from 'lucide-svelte';
  import { profile, notify, refresh, session } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { navigate } from '../../lib/router.js';
  import Segmented from '../../components/common/Segmented.svelte';

  const STEPS = [
    { id: 0, label: 'You', Icon: User },
    { id: 1, label: 'Training', Icon: Target },
    { id: 2, label: 'Sweat', Icon: Droplets },
  ];

  let step = $state(0);
  let saving = $state(false);
  let form = $state({
    weight_kg: $profile?.weight_kg ?? 60,
    height_cm: $profile?.height_cm ?? 168,
    birth_year: $profile?.birth_year ?? 1998,
    sex: $profile?.sex ?? 'other',
    city: $profile?.city ?? '',
    experience_level: $profile?.experience_level ?? 2,
    typical_temperature_c: $profile?.typical_temperature_c ?? 26,
    sweat_profile: $profile?.sweat_profile ?? 'normal',
    daily_calorie_goal: $profile?.daily_calorie_goal ?? 2400,
    daily_distance_goal_km: $profile?.daily_distance_goal_km ?? 10,
    daily_active_min_goal: $profile?.daily_active_min_goal ?? 60,
  });

  const canContinue = $derived.by(() => {
    if (step === 0) return Number(form.weight_kg) >= 25 && Number(form.birth_year) > 1930;
    if (step === 1) return Number(form.experience_level) >= 1;
    return true;
  });

  async function finish(target = '/plan') {
    saving = true;
    let written = false;
    try {
      const updated = await api.profile.update({ ...form, onboarded: true });
      written = true;
      profile.set(updated);
      await refresh();
      if (target === '/plan') notify(`All set, ${$session?.name ?? 'athlete'}! Let’s plan your first session.`);
      navigate(target, { replace: true });
    } catch (error) {
      if (written) {
        notify('Profile saved, but the view could not refresh. Reload when connected.', 'error');
        navigate(target, { replace: true });
      } else {
        notify(error.message || 'Could not save your profile', 'error');
      }
    } finally {
      saving = false;
    }
  }
</script>

<div class="grid min-h-screen place-items-center px-4 py-8">
  <div class="w-full max-w-xl">
    <!-- header -->
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <span class="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl bg-white ring-1 ring-white shadow-soft">
          <img src="/mascot-cat.png" alt="" class="h-[86%] w-auto" />
        </span>
        <div class="leading-none">
          <p class="font-display text-lg font-extrabold tracking-tight text-brand-700">TRANA</p>
          <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">let’s set you up</p>
        </div>
      </div>
      <span class="pill">Step {step + 1} of {STEPS.length}</span>
    </div>

    <!-- progress -->
    <div class="mb-5 flex gap-1.5">
      {#each STEPS as item (item.id)}
        <div class="h-1.5 flex-1 rounded-full {item.id <= step ? 'bg-brand-gradient' : 'bg-brand-100'}"></div>
      {/each}
    </div>

    <div class="card p-6 animate-slide-up">
      {#if step === 0}
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-100 text-brand-600"><User size={20} /></span>
          <div>
            <h1 class="text-xl leading-tight">A little about you</h1>
            <p class="text-xs font-semibold text-ink-400">Body mass drives every energy and fluid estimate.</p>
          </div>
        </div>

        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <span class="label">Body mass (kg)</span>
            <input class="input" type="number" step="0.5" min="25" max="250" bind:value={form.weight_kg} />
          </div>
          <div>
            <span class="label">Height (cm)</span>
            <input class="input" type="number" step="1" min="100" max="250" bind:value={form.height_cm} />
          </div>
          <div>
            <span class="label">Birth year</span>
            <input class="input" type="number" min="1930" max="2020" bind:value={form.birth_year} />
          </div>
          <div>
            <span class="label">City / region</span>
            <input class="input" placeholder="Quezon City, PH" bind:value={form.city} />
          </div>
        </div>

        <div class="mt-3">
          <span class="label">Sex (fine-tunes sweat & energy estimates)</span>
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
      {:else if step === 1}
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-100 text-brand-600"><Target size={20} /></span>
          <div>
            <h1 class="text-xl leading-tight">How do you train?</h1>
            <p class="text-xs font-semibold text-ink-400">Experience and targets shape the recommendation.</p>
          </div>
        </div>

        <div class="mt-5">
          <span class="label">Experience level ({form.experience_level}/5)</span>
          <input class="w-full accent-brand-500" type="range" min="1" max="5" step="1" bind:value={form.experience_level} />
          <div class="flex justify-between text-[10px] font-bold text-ink-400">
            <span>Just starting</span><span>Seasoned</span>
          </div>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          {#each [
            { key: 'daily_calorie_goal', label: 'Daily kcal', step: 50 },
            { key: 'daily_distance_goal_km', label: 'Daily km', step: 1 },
            { key: 'daily_active_min_goal', label: 'Daily minutes', step: 5 },
          ] as field (field.key)}
            <div>
              <span class="label">{field.label}</span>
              <input class="input" type="number" step={field.step} bind:value={form[field.key]} />
            </div>
          {/each}
        </div>
      {:else}
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-100 text-brand-600"><Droplets size={20} /></span>
          <div>
            <h1 class="text-xl leading-tight">How much do you sweat?</h1>
            <p class="text-xs font-semibold text-ink-400">Sets your sodium and fluid baseline.</p>
          </div>
        </div>

        <div class="mt-5 space-y-3">
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
            <p class="mt-2 text-[11px] font-semibold text-ink-400">
              {form.sweat_profile === 'high'
                ? 'Heavy sweaters lose salt quickly — TRANA will push sodium and fluid up.'
                : form.sweat_profile === 'low'
                  ? 'Light sweaters need less sodium; fluid targets stay conservative.'
                  : 'Average needs: about 550 mg sodium and 650 ml per hour in mild conditions.'}
            </p>
          </div>

          <div>
            <span class="label"><MapPin size={11} class="mr-1 inline" /> Typical training temperature (°C)</span>
            <input class="input" type="number" min="0" max="45" bind:value={form.typical_temperature_c} />
          </div>

          <div class="rounded-2xl bg-brand-50/70 p-3 text-[11px] font-semibold leading-relaxed text-ink-500">
            <Check size={13} class="mr-1 inline text-emerald-500" />
            TRANA will refine all of this as you log sessions — the model learns your real pace.
          </div>
        </div>
      {/if}

      <div class="mt-6 flex items-center gap-2">
        {#if step > 0}
          <button class="btn-ghost" onclick={() => (step -= 1)}>Back</button>
        {:else}
          <button class="btn-ghost" onclick={() => finish('/')}>Skip for now</button>
        {/if}

        {#if step < STEPS.length - 1}
          <button class="btn-primary ml-auto" disabled={!canContinue} onclick={() => (step += 1)}>
            Continue <ArrowRight size={16} />
          </button>
        {:else}
          <button class="btn-primary ml-auto" disabled={saving} onclick={() => finish()}>
            {#if saving}
              <LoaderCircle size={16} class="animate-spin" /> Saving…
            {:else}
              <Sparkles size={16} /> Start planning
            {/if}
          </button>
        {/if}
      </div>
    </div>

    <p class="mt-4 text-center text-[11px] font-semibold text-ink-400">
      You can change any of this later in Settings.
    </p>
  </div>
</div>
