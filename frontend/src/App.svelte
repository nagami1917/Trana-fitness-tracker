<script>
  import { onMount } from 'svelte';
  import { route, navigate } from './lib/router.js';
  import { bootstrap, session, booting, bootError, ready, profile } from './stores/index.js';
  import AppShell from './components/common/AppShell.svelte';
  import Toaster from './components/common/Toaster.svelte';
  import Login from './pages/Login/Login.svelte';
  import Register from './pages/Register/Register.svelte';
  import Onboarding from './pages/Onboarding/Onboarding.svelte';
  import NotFound from './pages/NotFound/NotFound.svelte';
  import { ROUTES } from './routes/index.js';

  onMount(bootstrap);

  const isLoginRoute = $derived($route === '/login');
  const isRegisterRoute = $derived($route === '/register');
  const isPublicRoute = $derived(isLoginRoute || isRegisterRoute);
  const isOnboardingRoute = $derived($route === '/onboarding');
  const needsOnboarding = $derived(Boolean($session && $profile && $profile.onboarded === false));
  const Page = $derived(ROUTES[$route] ?? NotFound);

  $effect(() => {
    if (!$ready || $bootError) return;
    if (!$session && !isPublicRoute) {
      navigate('/login', { replace: true });
      return;
    }
    if ($session && isPublicRoute) {
      navigate(needsOnboarding ? '/onboarding' : '/', { replace: true });
      return;
    }
    if (needsOnboarding && !isOnboardingRoute) navigate('/onboarding', { replace: true });
  });
</script>

{#if $booting}
  <div class="grid min-h-full place-items-center px-6">
    <div class="text-center">
      <img src="/mascot-cat.png" alt="" class="mx-auto h-32 w-auto animate-float" />
      <p class="mt-6 font-display text-lg font-extrabold text-brand-700">TRANA</p>
      <p class="mt-1 text-sm font-semibold text-ink-400">Waking up your trainer…</p>
      <div class="mx-auto mt-5 h-1.5 w-40 overflow-hidden rounded-full bg-brand-100">
        <div class="h-full w-1/3 animate-[shimmer_1.4s_linear_infinite] rounded-full bg-brand-gradient"></div>
      </div>
    </div>
  </div>
{:else if $bootError}
  <div class="grid min-h-screen place-items-center px-6 py-12">
    <div class="w-full max-w-md rounded-3xl border border-brand-100 bg-white p-8 text-center shadow-card" role="alert">
      <img src="/mascot-cat.png" alt="" class="mx-auto h-24 w-auto" />
      <h1 class="mt-5 font-display text-2xl font-extrabold text-ink-900">TRANA is unavailable</h1>
      <p class="mt-3 text-sm font-semibold leading-relaxed text-ink-500">{$bootError}</p>
      <p class="mt-2 text-xs font-semibold leading-relaxed text-ink-400">
        Make sure the Laravel API is running and its database connection is configured, then try again.
      </p>
      <button class="btn-primary mx-auto mt-6" onclick={bootstrap}>Try again</button>
    </div>
  </div>
{:else if !$session}
  {#if isRegisterRoute}
    <Register />
  {:else}
    <Login />
  {/if}
{:else if isOnboardingRoute}
  <Onboarding />
{:else}
  <AppShell>
    <Page />
  </AppShell>
{/if}

<Toaster />
