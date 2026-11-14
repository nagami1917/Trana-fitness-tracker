<script>
  import { onDestroy } from 'svelte';
  import { Mail, User, Sparkles, ArrowRight, ArrowLeft, LoaderCircle, Timer, Flame, Salad, KeyRound, Inbox } from 'lucide-svelte';
  import { requestRegistrationCode, verifyOtpAndSignIn, notify } from '../../stores/index.js';
  import { navigate, link } from '../../lib/router.js';

  let name = $state('');
  let email = $state('');
  let code = $state('');
  let stage = $state('details');
  let loading = $state(false);
  let error = $state('');
  let resendSeconds = $state(0);
  let resendTimer;

  function startResendCooldown() {
    clearInterval(resendTimer);
    resendSeconds = 60;
    resendTimer = setInterval(() => {
      if (resendSeconds <= 1) {
        clearInterval(resendTimer);
        resendSeconds = 0;
      } else {
        resendSeconds -= 1;
      }
    }, 1000);
  }

  function changeDetails() {
    clearInterval(resendTimer);
    resendSeconds = 0;
    code = '';
    error = '';
    stage = 'details';
  }

  async function sendCode(event) {
    event?.preventDefault();
    error = '';
    const normalizedEmail = email.trim().toLowerCase();
    if (!/@gmail\.com$/i.test(normalizedEmail)) {
      error = 'Sign-up is limited to Gmail addresses — please use your @gmail.com address.';
      return;
    }
    if (!name.trim()) {
      error = 'Enter your name to create your TRANA account.';
      return;
    }

    loading = true;
    try {
      const data = await requestRegistrationCode({ name: name.trim(), email: normalizedEmail });
      email = normalizedEmail;
      code = '';
      stage = 'code';
      startResendCooldown();
      notify(data?.message || 'A six-digit code was sent to your email.');
    } catch (err) {
      error = err.errors?.email?.[0] || err.errors?.name?.[0] || err.message || 'Could not send a sign-up code.';
    } finally {
      loading = false;
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    error = '';
    loading = true;
    try {
      await verifyOtpAndSignIn({ email: email.trim().toLowerCase(), code: code.trim() });
      notify('Email confirmed. Welcome to TRANA!');
      navigate('/');
    } catch (err) {
      error = err.message || 'That code could not be verified.';
    } finally {
      loading = false;
    }
  }

  onDestroy(() => clearInterval(resendTimer));
</script>

<svelte:head><title>Create account — TRANA</title></svelte:head>

<div class="relative grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
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
        Create an account and TRANA uses your activities to estimate finish times and suggest what to eat, drink and carry.
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

  <section class="flex items-center justify-center px-6 py-10 sm:px-12">
    <div class="w-full max-w-sm">
      {#if stage === 'details'}
        <h2 class="text-2xl">Create your account</h2>
        <p class="mt-1 text-sm font-semibold text-ink-400">Verify your Gmail with a six-digit code. No password to create.</p>

        <form class="mt-7 space-y-4" onsubmit={sendCode}>
          <div>
            <label class="label" for="name">Name</label>
            <div class="relative">
              <User size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
              <input id="name" type="text" class="input pl-11" bind:value={name} placeholder="Alex Tan" autocomplete="name" maxlength="80" required />
            </div>
          </div>

          <div>
            <label class="label" for="email">Gmail address</label>
            <div class="relative">
              <Mail size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
              <input id="email" type="email" class="input pl-11" bind:value={email} placeholder="you@gmail.com" autocomplete="email" maxlength="255" required />
            </div>
            <p class="mt-1.5 text-[11px] font-semibold leading-snug text-ink-400">
              New accounts currently require an @gmail.com address. TRANA never asks for your Google password.
            </p>
          </div>

          {#if error}
            <p class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600" role="alert">{error}</p>
          {/if}

          <button type="submit" class="btn-primary w-full !py-3" disabled={loading || !name.trim() || !email.trim()}>
            {#if loading}<LoaderCircle size={17} class="animate-spin" /> Sending…{:else}Email me a sign-up code <ArrowRight size={17} />{/if}
          </button>
        </form>
      {:else}
        <span class="pill"><Inbox size={12} /> Check your email</span>
        <h2 class="mt-3 text-2xl">Enter your sign-up code</h2>
        <p class="mt-1 text-sm font-semibold leading-relaxed text-ink-400">
          We sent a six-digit code to <span class="font-extrabold text-ink-700">{email}</span>.
          Check Spam or Promotions too. The code expires in 10 minutes.
        </p>

        <form class="mt-5 space-y-4" onsubmit={verifyCode}>
          <div>
            <label class="label" for="otp-code">Six-digit code</label>
            <div class="relative">
              <KeyRound size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                id="otp-code"
                type="text"
                class="input pl-11 text-center text-lg font-extrabold tracking-[0.35em]"
                bind:value={code}
                placeholder="000000"
                inputmode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9][0-9][0-9][0-9][0-9][0-9]"
                minlength="6"
                maxlength="6"
                required
              />
            </div>
            <p class="mt-1.5 text-[11px] font-semibold text-ink-400">Use the newest code you received. Each code works once.</p>
          </div>

          {#if error}
            <p class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600" role="alert">{error}</p>
          {/if}

          <button type="submit" class="btn-primary w-full !py-3" disabled={loading || code.trim().length !== 6}>
            {#if loading}<LoaderCircle size={17} class="animate-spin" /> Verifying…{:else}Verify & continue <ArrowRight size={17} />{/if}
          </button>
        </form>

        <button type="button" class="btn-ghost mt-3 w-full justify-center" onclick={changeDetails} disabled={loading}>
          <ArrowLeft size={15} /> Change name or email
        </button>
        <button type="button" class="mt-3 w-full text-center text-xs font-extrabold text-brand-600 disabled:text-ink-300" onclick={sendCode} disabled={loading || resendSeconds > 0}>
          {#if resendSeconds > 0}<Timer size={13} class="mr-1 inline" /> Send another code in {resendSeconds}s{:else}Send another code <ArrowRight size={13} class="inline" />{/if}
        </button>
      {/if}

      <p class="mt-5 text-center text-sm font-semibold text-ink-400">
        Already have an account?
        <button class="font-extrabold text-brand-600 transition hover:text-brand-700" onclick={() => navigate('/login')}>
          Sign in
        </button>
      </p>

      <p class="mt-2.5 text-center text-xs font-semibold text-ink-400">
        <a href="/preview" use:link class="font-extrabold text-brand-600 transition hover:text-brand-700">
          Preview duration & fueling calculator
        </a>
      </p>

      <p class="mt-4 text-center text-[11px] font-semibold leading-relaxed text-ink-400">
        Your account data is stored through the TRANA API.
      </p>
    </div>
  </section>
</div>
