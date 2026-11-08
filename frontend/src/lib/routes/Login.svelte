<script>
  import { Lock, Mail, Sparkles, ArrowRight, LoaderCircle, Flame, Timer, Salad } from 'lucide-svelte';
  import { login, continueAsGuest, notify, apiMode, profile } from '../stores.js';
  import { navigate } from '../router.js';

  let email = $state('nagami@trana.app');
  let password = $state('password');
  let loading = $state(false);
  let error = $state('');

  async function submit(event) {
    event.preventDefault();
    error = '';
    loading = true;
    try {
      await login({ email, password });
      notify('Welcome back! Let’s fuel your next move.');
      const needsSetup = $profile?.onboarded === false;
      navigate(needsSetup ? '/onboarding' : '/');
    } catch (err) {
      error = err.message || 'Could not sign in';
    } finally {
      loading = false;
    }
  }

  async function demo() {
    loading = true;
    try {
      await continueAsGuest();
      navigate('/');
    } catch (err) {
      error = err.message || 'Could not start the demo';
    } finally {
      loading = false;
    }
  }
</script>

<div class="relative grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
  <!-- brand panel -->
  <section class="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-100 via-brand-50 to-white px-6 py-8 sm:px-12 lg:py-14">
    <div class="pointer-events-none absolute inset-0">
      <div class="absolute -right-20 top-10 h-80 w-80 rounded-full bg-brand-200/50 blur-3xl"></div>
      <div class="absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-rose-200/40 blur-3xl"></div>
    </div>

    <div class="relative flex items-center gap-2.5">
      <span class="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl bg-white ring-1 ring-white shadow-soft">
        <img src="/mascot-cat.png" alt="" class="h-[86%] w-auto" />
      </span>
      <div class="leading-none">
        <p class="font-display text-lg font-extrabold tracking-tight text-brand-700">TRANA</p>
        <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">fuel your next move</p>
      </div>
    </div>

    <div class="relative mt-10 max-w-lg">
      <span class="pill mb-4 bg-white/80 text-brand-600">
        <Sparkles size={12} /> Predictive fueling, not just counting
      </span>
      <h1 class="font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-ink-900 sm:text-5xl">
        Know your<br />
        <span class="bg-gradient-to-r from-brand-500 to-brand-700 bg-clip-text text-transparent">next effort</span><br />
        before you start.
      </h1>
      <p class="mt-4 max-w-md text-[15px] font-semibold leading-relaxed text-ink-500">
        TRANA reads your past activities, learns your true pace, and predicts how long your planned route will take —
        then tells you exactly how much carbohydrate, sodium and fluid to carry.
      </p>

      <div class="mt-8 grid gap-3 sm:grid-cols-3">
        {#each [
          { Icon: Timer, title: 'Duration', copy: 'Personal pace model' },
          { Icon: Flame, title: 'Energy', copy: 'kcal from MET science' },
          { Icon: Salad, title: 'Fueling', copy: 'Carbs, sodium, fluid' },
        ] as item (item.title)}
          <div class="rounded-2xl border border-white/70 bg-white/70 p-3.5 shadow-soft backdrop-blur-sm">
            <item.Icon size={18} class="text-brand-600" />
            <p class="mt-2 text-sm font-extrabold text-ink-900">{item.title}</p>
            <p class="text-[11px] font-semibold text-ink-400">{item.copy}</p>
          </div>
        {/each}
      </div>
    </div>

    <img
      src="/mascot-cat.png"
      alt="TRANA mascot"
      class="pointer-events-none absolute -bottom-8 right-2 hidden h-64 w-auto animate-float drop-shadow-xl sm:block lg:right-8 lg:h-80"
    />
  </section>

  <!-- form panel -->
  <section class="flex items-center justify-center px-6 py-10 sm:px-12">
    <div class="w-full max-w-sm">
      <h2 class="text-2xl">Welcome back</h2>
      <p class="mt-1 text-sm font-semibold text-ink-400">Sign in to see today’s plan.</p>

      <form class="mt-7 space-y-4" onsubmit={submit}>
        <div>
          <label class="label" for="email">Email</label>
          <div class="relative">
            <Mail size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
            <input id="email" type="email" class="input pl-11" bind:value={email} placeholder="you@example.com" autocomplete="email" />
          </div>
        </div>

        <div>
          <label class="label" for="password">Password</label>
          <div class="relative">
            <Lock size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              id="password"
              type="password"
              class="input pl-11"
              bind:value={password}
              placeholder="••••••••"
              autocomplete="current-password"
            />
          </div>
        </div>

        {#if error}
          <p class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p>
        {/if}

        <button type="submit" class="btn-primary w-full !py-3" disabled={loading}>
          {#if loading}
            <LoaderCircle size={17} class="animate-spin" /> Signing in…
          {:else}
            Sign in <ArrowRight size={17} />
          {/if}
        </button>
      </form>

      <div class="my-5 flex items-center gap-3">
        <span class="h-px flex-1 bg-brand-100"></span>
        <span class="text-[11px] font-bold uppercase tracking-widest text-ink-400">or</span>
        <span class="h-px flex-1 bg-brand-100"></span>
      </div>

      <button class="btn-ghost w-full !py-3" onclick={demo} disabled={loading}>
        <Sparkles size={16} class="text-brand-500" /> Explore with demo data
      </button>

      <p class="mt-6 text-center text-[11px] font-semibold leading-relaxed text-ink-400">
        {$apiMode === 'demo'
          ? 'Demo mode — everything you do stays in this browser. Connect the Laravel API to go live.'
          : 'Connected to the TRANA API. Your data lives in Supabase Postgres.'}
      </p>
    </div>
  </section>
</div>
