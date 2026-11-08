<script>
  import { onMount } from 'svelte';
  import { route, navigate } from './lib/router.js';
  import { bootstrap, session, booting, ready } from './lib/stores.js';
  import AppShell from './lib/components/AppShell.svelte';
  import Toaster from './lib/components/Toaster.svelte';
  import Login from './lib/routes/Login.svelte';
  import Dashboard from './lib/routes/Dashboard.svelte';
  import Plan from './lib/routes/Plan.svelte';
  import Activities from './lib/routes/Activities.svelte';
  import Analytics from './lib/routes/Analytics.svelte';
  import Goals from './lib/routes/Goals.svelte';
  import Settings from './lib/routes/Settings.svelte';
  import NotFound from './lib/routes/NotFound.svelte';

  const PAGES = {
    '/': Dashboard,
    '/plan': Plan,
    '/activities': Activities,
    '/analytics': Analytics,
    '/goals': Goals,
    '/settings': Settings,
  };

  onMount(bootstrap);

  const isLoginRoute = $derived($route === '/login');
  const Page = $derived(PAGES[$route] ?? NotFound);

  $effect(() => {
    if (!$ready) return;
    if (!$session && !isLoginRoute) navigate('/login', { replace: true });
    if ($session && isLoginRoute) navigate('/', { replace: true });
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
  <Login />
{:else}
  <AppShell>
    <Page />
  </AppShell>
{/if}

<Toaster />
