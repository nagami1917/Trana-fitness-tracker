<script>
  import { Lock, Mail, User, Sparkles, ArrowRight, LoaderCircle, Timer, Flame, Salad } from 'lucide-svelte';
  import { register, notify, apiMode } from '../../stores/index.js';
  import { navigate } from '../../lib/router.js';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');

  async function submit(event) {
    event.preventDefault();
    error = '';

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      error = 'Password must be at least 8 characters and include letters and numbers.';
      return;
    }

    loading = true;
    try {
      await register({ name: name.trim(), email: email.trim(), password });
      notify('Welcome to TRANA! Let’s set you up.');
      navigate('/onboarding', { replace: true });
    } catch (err) {
      error = err.message || 'Could not create your account';
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
        Train smarter,<br />
        <span class="bg-gradient-to-r from-brand-500 to-brand-700 bg-clip-text text-transparent">fuel better</span><br />
        from day one.
      </h1>
      <p class="mt-4 max-w-md text-[15px] font-semibold leading-relaxed text-ink-500">
        Create a free account and TRANA learns your pace from your own activities, predicts finish times, and tells you
        exactly what to eat, drink and carry.
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
      <h2 class="text-2xl">Create your account</h2>
      <p class="mt-1 text-sm font-semibold text-ink-400">Two minutes to your first prediction.</p>

      <form class="mt-7 space-y-4" onsubmit={submit}>
        <div>
          <label class="label" for="name">Name</label>
          <div class="relative">
            <User size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
            <input id="name" type="text" class="input pl-11" bind:value={name} placeholder="Alex Tan" autocomplete="name" required />
          </div>
        </div>

        <div>
          <label class="label" for="email">Email</label>
          <div class="relative">
            <Mail size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
            <input id="email" type="email" class="input pl-11" bind:value={email} placeholder="you@example.com" autocomplete="email" required />
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
              placeholder="8+ characters, letters and numbers"
              autocomplete="new-password"
              minlength="8"
              required
            />
          </div>
        </div>

        {#if error}
          <p class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p>
        {/if}

        <button type="submit" class="btn-primary w-full !py-3" disabled={loading}>
          {#if loading}
            <LoaderCircle size={17} class="animate-spin" /> Creating…
          {:else}
            Create account <ArrowRight size={17} />
          {/if}
        </button>
      </form>

      <p class="mt-5 text-center text-sm font-semibold text-ink-400">
        Already have an account?
        <button class="font-extrabold text-brand-600 transition hover:text-brand-700" onclick={() => navigate('/login')}>
          Sign in
        </button>
      </p>

      <p class="mt-4 text-center text-[11px] font-semibold leading-relaxed text-ink-400">
        {$apiMode === 'demo'
          ? 'Demo mode — your account stays in this browser. Connect the Laravel API to go live.'
          : 'Connected to the TRANA API. Your data lives in Supabase Postgres.'}
      </p>
    </div>
  </section>
</div>
