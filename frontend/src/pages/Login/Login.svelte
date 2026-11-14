<script>
  import { Flame, Salad, Sparkles, Timer } from 'lucide-svelte';
  import GoogleSignInButton from '../../components/auth/GoogleSignInButton.svelte';
  import { notify, profile } from '../../stores/index.js';
  import { navigate, link } from '../../lib/router.js';

  async function onGoogleSuccess() {
    notify('Google sign-in successful. Let’s fuel your next move.');
    navigate($profile?.onboarded === false ? '/onboarding' : '/');
  }
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
      <h2 class="text-2xl">Welcome back</h2>
      <p class="mt-1 text-sm font-semibold text-ink-400">Sign in securely with your Google account.</p>

      <div class="mt-7">
        <GoogleSignInButton text="signin_with" onSuccess={onGoogleSuccess} />
      </div>

      <p class="mt-4 text-center text-[11px] font-semibold leading-relaxed text-ink-400">
        Google handles your password. TRANA never asks for or stores it; we receive only the verified account details needed to sign you in.
      </p>

      <p class="mt-7 text-center text-sm font-semibold text-ink-400">
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
        Your account data is stored securely through the TRANA API.
      </p>
    </div>
  </section>
</div>
