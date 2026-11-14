<script>
  import { onDestroy } from 'svelte';
  import { Mail, Sparkles, ArrowRight, ArrowLeft, LoaderCircle, Flame, Timer, Salad, KeyRound, Inbox } from 'lucide-svelte';
  import { requestLoginCode, verifyOtpAndSignIn, notify, profile } from '../../stores/index.js';
  import { navigate, link } from '../../lib/router.js';

  let email = $state('');
  let code = $state('');
  let stage = $state('email');
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

  function useDifferentEmail() {
    clearInterval(resendTimer);
    resendSeconds = 0;
    code = '';
    error = '';
    stage = 'email';
  }

  async function sendCode(event) {
    event?.preventDefault();
    error = '';
    loading = true;
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const data = await requestLoginCode(normalizedEmail);
      email = normalizedEmail;
      code = '';
      stage = 'code';
      startResendCooldown();
      notify(data?.message || 'If that email has a TRANA account, a six-digit sign-in code is on its way.');
    } catch (err) {
      error = err.message || 'Could not request a sign-in code.';
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
      notify('Welcome back! Let’s fuel your next move.');
      navigate($profile?.onboarded === false ? '/onboarding' : '/');
    } catch (err) {
      error = err.message || 'That code could not be verified.';
    } finally {
      loading = false;
    }
  }

  onDestroy(() => clearInterval(resendTimer));
</script>

<svelte:head><title>Sign in — TRANA</title></svelte:head>

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

  <section class="flex items-center justify-center px-6 py-10 sm:px-12">
    <div class="w-full max-w-sm">
      {#if stage === 'email'}
        <h2 class="text-2xl">Welcome back</h2>
        <p class="mt-1 text-sm font-semibold text-ink-400">Sign in securely with a one-time email code.</p>

        <form class="mt-7 space-y-4" onsubmit={sendCode}>
          <div>
            <label class="label" for="email">Email</label>
            <div class="relative">
              <Mail size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
              <input id="email" type="email" class="input pl-11" bind:value={email} placeholder="you@gmail.com" autocomplete="email" maxlength="255" required />
            </div>
            <p class="mt-1.5 text-[11px] font-semibold leading-snug text-ink-400">
              If this address has a TRANA account, we’ll email a six-digit code. No password needed.
            </p>
          </div>

          {#if error}
            <p class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600" role="alert">{error}</p>
          {/if}

          <button type="submit" class="btn-primary w-full !py-3" disabled={loading || !email.trim()}>
            {#if loading}<LoaderCircle size={17} class="animate-spin" /> Sending…{:else}Email me a sign-in code <ArrowRight size={17} />{/if}
          </button>
        </form>

        <p class="mt-4 text-center text-[11px] font-semibold leading-relaxed text-ink-400">
          TRANA never asks for your Google password.
        </p>
      {:else}
        <span class="pill"><Inbox size={12} /> Check your email</span>
        <h2 class="mt-3 text-2xl">Enter your sign-in code</h2>
        <p class="mt-1 text-sm font-semibold leading-relaxed text-ink-400">
          If <span class="font-extrabold text-ink-700">{email}</span> has a TRANA account, a six-digit code is on its way.
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
                aria-describedby="otp-help"
                required
              />
            </div>
            <p id="otp-help" class="mt-1.5 text-[11px] font-semibold text-ink-400">Use the newest code you received. Each code works once.</p>
          </div>

          {#if error}
            <p class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600" role="alert">{error}</p>
          {/if}

          <button type="submit" class="btn-primary w-full !py-3" disabled={loading || code.trim().length !== 6}>
            {#if loading}<LoaderCircle size={17} class="animate-spin" /> Verifying…{:else}Verify & sign in <ArrowRight size={17} />{/if}
          </button>
        </form>

        <button type="button" class="btn-ghost mt-3 w-full justify-center" onclick={useDifferentEmail} disabled={loading}>
          <ArrowLeft size={15} /> Use a different email
        </button>
        <button type="button" class="mt-3 w-full text-center text-xs font-extrabold text-brand-600 disabled:text-ink-300" onclick={sendCode} disabled={loading || resendSeconds > 0}>
          {#if resendSeconds > 0}<Timer size={13} class="mr-1 inline" /> Send another code in {resendSeconds}s{:else}Send another code <ArrowRight size={13} class="inline" />{/if}
        </button>
      {/if}

      <p class="mt-6 text-center text-sm font-semibold text-ink-400">
        New to TRANA?
        <button class="font-extrabold text-brand-600 transition hover:text-brand-700" onclick={() => navigate('/register')}>
          Create an account
        </button>
      </p>

      <p class="mt-2.5 text-center text-xs font-semibold text-ink-400">
        Curious first?
        <a href="/preview" use:link class="font-extrabold text-brand-600 transition hover:text-brand-700">
          Preview duration & fueling calculator
        </a>
      </p>

      <p class="mt-6 text-center text-[11px] font-semibold leading-relaxed text-ink-400">
        Your account data is stored through the TRANA API.
      </p>
    </div>
  </section>
</div>
