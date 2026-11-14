<script>
  import { onMount } from 'svelte';
  import { route, navigate } from './lib/router.js';
  import { bootstrap, session, booting, bootError, ready, profile } from './stores/index.js';
  import AppShell from './components/common/AppShell.svelte';
  import PublicLayout from './components/common/PublicLayout.svelte';
  import Toaster from './components/common/Toaster.svelte';
  import {
    getCachedRouteComponent,
    getCachedViewComponent,
    loadRouteComponent,
    loadViewComponent,
  } from './routes/index.js';

  onMount(bootstrap);

  const isLoginRoute = $derived($route === '/login');
  const isRegisterRoute = $derived($route === '/register');
  // Sign-in pages: only meaningful while signed out.
  const isAuthRoute = $derived(isLoginRoute || isRegisterRoute);
  // Legal pages + calculator preview: viewable signed-in or signed-out, outside the shell.
  const GUEST_PAGES = ['/preview', '/privacy', '/terms'];
  const isGuestPage = $derived(GUEST_PAGES.includes($route));
  const isPublicRoute = $derived(isAuthRoute || isGuestPage);
  const isOnboardingRoute = $derived($route === '/onboarding');
  const needsOnboarding = $derived(Boolean($session && $profile && $profile.onboarded === false));
  const targetSpec = $derived.by(() => {
    if (!$session) {
      if (isRegisterRoute) return { kind: 'view', key: 'register' };
      if (isGuestPage) return { kind: 'route', key: $route };
      return { kind: 'view', key: 'login' };
    }
    if (isGuestPage) return { kind: 'route', key: $route };
    if (isOnboardingRoute) return { kind: 'view', key: 'onboarding' };
    return { kind: 'route', key: $route };
  });

  let ActiveComponent = $state(null);
  let loadError = $state(false);
  let loadSeq = 0;

  $effect(() => {
    const spec = targetSpec;
    loadError = false;
    const cached =
      spec.kind === 'route'
        ? getCachedRouteComponent(spec.key)
        : getCachedViewComponent(spec.key);
    if (cached) {
      ActiveComponent = cached;
      return;
    }
    ActiveComponent = null;
    const seq = ++loadSeq;
    const loader =
      spec.kind === 'route'
        ? loadRouteComponent(spec.key)
        : loadViewComponent(spec.key);
    loader
      .then((component) => {
        if (seq === loadSeq) ActiveComponent = component;
      })
      .catch(() => {
        if (seq === loadSeq) loadError = true;
      });
  });

  $effect(() => {
    if (!$ready || $bootError) return;
    if (!$session && !isPublicRoute) {
      navigate('/login', { replace: true });
      return;
    }
    if ($session && isAuthRoute) {
      navigate(needsOnboarding ? '/onboarding' : '/', { replace: true });
      return;
    }
    if (needsOnboarding && !isOnboardingRoute && !isGuestPage) navigate('/onboarding', { replace: true });
  });
</script>

{#snippet routePending()}
  <div class="grid min-h-[45vh] place-items-center px-6">
    {#if loadError}
      <div class="text-center">
        <p class="text-sm font-bold text-ink-600">Could not load this screen.</p>
        <button class="btn-primary mx-auto mt-3" onclick={() => window.location.reload()}>Reload</button>
      </div>
    {:else}
      <div class="flex flex-col items-center gap-3 text-center">
        <div class="h-2 w-28 overflow-hidden rounded-full bg-brand-100">
          <div class="h-full w-1/3 animate-[shimmer_1.2s_linear_infinite] rounded-full bg-brand-gradient"></div>
        </div>
        <p class="text-xs font-bold text-ink-400">Loading view…</p>
      </div>
    {/if}
  </div>
{/snippet}

{#if $booting}
  <div class="grid min-h-full place-items-center px-6">
    <div class="text-center">
      <img src="/mascot-cat.png" alt="" fetchpriority="high" decoding="async" class="mx-auto h-32 w-auto animate-float" />
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
      <img src="/mascot-cat.png" alt="" decoding="async" class="mx-auto h-24 w-auto" />
      <h1 class="mt-5 font-display text-2xl font-extrabold text-ink-900">TRANA is unavailable</h1>
      <p class="mt-3 text-sm font-semibold leading-relaxed text-ink-500">{$bootError}</p>
      <p class="mt-2 text-xs font-semibold leading-relaxed text-ink-400">
        Make sure the Laravel API is running and its database connection is configured, then try again.
      </p>
      <button class="btn-primary mx-auto mt-6" onclick={bootstrap}>Try again</button>
    </div>
  </div>
{:else if !$session}
  {#if isGuestPage}
    <PublicLayout>
      {#if ActiveComponent}
        <ActiveComponent />
      {:else}
        {@render routePending()}
      {/if}
    </PublicLayout>
  {:else if ActiveComponent}
    <ActiveComponent />
  {:else}
    {@render routePending()}
  {/if}
{:else if isGuestPage}
  <PublicLayout>
    {#if ActiveComponent}
      <ActiveComponent />
    {:else}
      {@render routePending()}
    {/if}
  </PublicLayout>
{:else if isOnboardingRoute}
  {#if ActiveComponent}
    <ActiveComponent />
  {:else}
    {@render routePending()}
  {/if}
{:else}
  <AppShell>
    {#if ActiveComponent}
      <ActiveComponent />
    {:else}
      {@render routePending()}
    {/if}
  </AppShell>
{/if}

<Toaster />
