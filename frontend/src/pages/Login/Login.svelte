<script>
  import { Lock, Mail, Eye, EyeOff, Sparkles, ArrowRight, LoaderCircle, Flame, Timer, Salad } from 'lucide-svelte';
  import { login, notify, profile } from '../../stores/index.js';
  import { navigate, link } from '../../lib/router.js';

  let email = $state('');
  let password = $state('');
  let showPassword = $state(false);
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
        TRANA uses your past activities to estimate how long your planned route will take —
        then estimates how much carbohydrate, sodium and fluid to carry.
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
              type={showPassword ? 'text' : 'password'}
              class="input pl-11 pr-24"
              bind:value={password}
              placeholder="••••••••"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-1 inline-flex items-center justify-center gap-1 rounded-xl px-3 text-xs font-bold text-ink-500 transition hover:text-brand-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-controls="password"
              onclick={() => (showPassword = !showPassword)}
            >
              {#if showPassword}<EyeOff size={16} aria-hidden="true" /> Hide{:else}<Eye size={16} aria-hidden="true" /> Show{/if}
            </button>
          </div>
        </div>

        <div class="-mt-1 text-right">
          <a href="/forgot-password" use:link class="text-xs font-extrabold text-brand-600 transition hover:text-brand-700">
            Forgot password?
          </a>
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

      <p class="mt-4 text-center text-sm font-semibold text-ink-400">
        New to TRANA?
        <button class="font-extrabold text-brand-600 transition hover:text-brand-700" onclick={() => navigate('/register')}>
          Create an account
        </button>
      </p>

      <p class="mt-6 text-center text-[11px] font-semibold leading-relaxed text-ink-400">
        Your account data is stored through the TRANA API.
      </p>
    </div>
  </section>
</div>
