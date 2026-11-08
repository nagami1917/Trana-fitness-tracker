<script>
  import { onMount } from 'svelte';
  import { route, navigate } from './lib/router.js';
  import { bootstrap, session, booting, ready, profile } from './stores/index.js';
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
    if (!$ready) return;
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
