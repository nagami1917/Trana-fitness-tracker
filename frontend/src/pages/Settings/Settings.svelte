<script>
  import { Settings as SettingsIcon, Save, LoaderCircle, LogOut, Info, Brain, Smartphone, ShieldCheck, User, HeartPulse } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import { profile, session, logout, notify, refresh, modelCard, activities } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { navigate } from '../../lib/router.js';
  import { nf } from '../../lib/format.js';

  let form = $state({
    name: $profile?.name ?? '',
    email: $profile?.email ?? '',
    weight_kg: $profile?.weight_kg ?? 60,
    height_cm: $profile?.height_cm ?? 165,
    birth_year: $profile?.birth_year ?? 1998,
    sex: $profile?.sex ?? 'female',
    city: $profile?.city ?? '',
    sweat_profile: $profile?.sweat_profile ?? 'normal',
    experience_level: $profile?.experience_level ?? 3,
    typical_temperature_c: $profile?.typical_temperature_c ?? 26,
    units: $profile?.units ?? 'metric',
  });
  let saving = $state(false);

  $effect(() => {
    if ($profile && !form.name) {
      form = {
        name: $profile.name ?? '',
        email: $profile.email ?? '',
        weight_kg: $profile.weight_kg ?? 60,
        height_cm: $profile.height_cm ?? 165,
        birth_year: $profile.birth_year ?? 1998,
        sex: $profile.sex ?? 'female',
        city: $profile.city ?? '',
        sweat_profile: $profile.sweat_profile ?? 'normal',
        experience_level: $profile.experience_level ?? 3,
        typical_temperature_c: $profile.typical_temperature_c ?? 26,
        units: $profile.units ?? 'metric',
      };
    }
  });

  async function save() {
    saving = true;
    let written = false;
    try {
      await api.profile.update({
        name: form.name,
        weight_kg: Number(form.weight_kg),
        height_cm: Number(form.height_cm),
        birth_year: Number(form.birth_year),
        sex: form.sex,
        city: form.city,
        sweat_profile: form.sweat_profile,
        experience_level: Number(form.experience_level),
        typical_temperature_c: Number(form.typical_temperature_c),
        units: form.units,
      });
      written = true;
      await refresh();
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
</script>

<div class="space-y-5">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <span class="pill mb-2"><SettingsIcon size={12} /> Settings</span>
      <h1 class="font-display text-2xl sm:text-3xl">Profile & preferences</h1>
      <p class="mt-1 text-sm font-semibold text-ink-400">Body mass, sweat profile and experience all feed the model.</p>
    </div>
    <button class="btn-primary self-start" onclick={save} disabled={saving}>
      {#if saving}<LoaderCircle size={15} class="animate-spin" /> Saving…{:else}<Save size={15} /> Save changes{/if}
    </button>
  </div>

  <div class="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
    <div class="space-y-4">
      <Card>
        <div class="flex items-center gap-2">
          <User size={17} class="text-brand-500" />
          <h2 class="text-lg">Athlete</h2>
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
            <span class="label">Body mass (kg)</span>
            <input class="input" type="number" step="0.5" min="30" bind:value={form.weight_kg} />
          </div>
          <div>
            <span class="label">Height (cm)</span>
            <input class="input" type="number" step="1" min="120" bind:value={form.height_cm} />
          </div>
          <div>
            <span class="label">Birth year</span>
            <input class="input" type="number" min="1930" max="2015" bind:value={form.birth_year} />
          </div>
          <div>
            <span class="label">City / region</span>
            <input class="input" bind:value={form.city} placeholder="Quezon City, PH" />
          </div>
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
          <h2 class="text-lg">Training & sweat</h2>
        </div>

        <div class="mt-3 space-y-3">
          <div>
            <span class="label">Experience level ({form.experience_level}/5)</span>
            <input class="w-full accent-brand-500" type="range" min="1" max="5" step="1" bind:value={form.experience_level} />
            <div class="flex justify-between text-[10px] font-bold text-ink-400">
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
            <p class="mt-1 text-[10px] font-semibold text-ink-400">
              Heavy sweaters get more sodium per hour ({form.sweat_profile === 'high' ? '800' : form.sweat_profile === 'low' ? '350' : '550'} mg/h baseline).
            </p>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <span class="label">Typical temperature (°C)</span>
              <input class="input" type="number" min="0" max="45" bind:value={form.typical_temperature_c} />
            </div>
            <div>
              <span class="label">Units</span>
              <Segmented
                options={[
                  { id: 'metric', label: 'Metric' },
                  { id: 'imperial', label: 'Imperial' },
                ]}
                value={form.units}
                onSelect={(v) => (form.units = v)}
              />
            </div>
          </div>
        </div>
      </Card>
    </div>

    <div class="space-y-4">
      <Card class="bg-gradient-to-br from-brand-600 to-brand-700 text-white">
        <div class="flex items-center gap-2">
          <Brain size={18} />
          <h2 class="text-lg text-white">Prediction engine</h2>
        </div>
        <div class="mt-3 space-y-1.5 text-[12px] font-semibold text-white/85">
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

      <Card>
        <div class="flex items-center gap-2">
          <ShieldCheck size={17} class="text-brand-500" />
          <h2 class="text-lg">Account</h2>
        </div>
        <div class="mt-3 space-y-2">
          <p class="text-[11px] font-semibold text-ink-400">
            Signed in as <span class="font-extrabold text-ink-700">{$session?.email ?? ''}</span>
          </p>
          <button class="btn-ghost w-full justify-start !text-rose-500" onclick={signOut}><LogOut size={15} /> Sign out</button>
        </div>
      </Card>

      <Card>
        <div class="flex items-center gap-2">
          <Smartphone size={17} class="text-brand-500" />
          <h2 class="text-lg">Install TRANA</h2>
        </div>
        <p class="mt-2 text-[12px] font-semibold leading-relaxed text-ink-500">
          TRANA is a progressive web app. Prediction previews run on your device, but signing in, loading your data,
          and saving changes require the server connection.
        </p>
        <p class="mt-2 text-[10px] font-bold uppercase tracking-wide text-ink-400">iOS: Share → Add to Home Screen · Android: menu → Install app</p>
      </Card>

      <Card soft>
        <div class="flex items-start gap-2">
          <Info size={15} class="mt-0.5 shrink-0 text-ink-400" />
          <p class="text-[11px] font-semibold leading-relaxed text-ink-400">
            TRANA gives estimates for healthy adults training in normal conditions. It is not medical advice — check with
            a professional for clinical conditions, pregnancy or extreme environments.
          </p>
        </div>
      </Card>
    </div>
  </div>
</div>
