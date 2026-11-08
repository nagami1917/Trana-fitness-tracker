<script>
  import {
    House,
    Footprints,
    ChartColumn,
    Target,
    Settings,
    Bell,
    Search,
    Plus,
    Sparkles,
    LogOut,
    User,
    ChevronDown,
  } from 'lucide-svelte';
  import { route, navigate, link, isActive } from '../router.js';
  import { profile, session, logout, plans } from '../stores.js';
  import Logo from './Logo.svelte';

  let { children } = $props();

  const NAV = [
    { href: '/', label: 'Dashboard', Icon: House },
    { href: '/plan', label: 'Plan Activity', Icon: Sparkles },
    { href: '/activities', label: 'Activities', Icon: Footprints },
    { href: '/analytics', label: 'Analytics', Icon: ChartColumn },
    { href: '/goals', label: 'Goals', Icon: Target },
    { href: '/settings', label: 'Settings', Icon: Settings },
  ];

  const MOBILE = [
    { href: '/', label: 'Home', Icon: House },
    { href: '/activities', label: 'Activities', Icon: Footprints },
    { href: '/plan', label: 'Plan', Icon: Plus, fab: true },
    { href: '/analytics', label: 'Analytics', Icon: ChartColumn },
    { href: '/goals', label: 'Goals', Icon: Target },
  ];

  let menuOpen = $state(false);
  let searchOpen = $state(false);
  let searchTerm = $state('');

  function submitSearch(event) {
    event.preventDefault();
    const term = searchTerm.trim();
    navigate(term ? `/activities?q=${encodeURIComponent(term)}` : '/activities');
    searchOpen = false;
  }

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  const upcoming = $derived($plans?.[0] ?? null);
  const initial = $derived(($profile?.name || $session?.name || 'N').slice(0, 1).toUpperCase());
</script>

<div class="relative min-h-full">
  <!-- decorative background -->
  <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
    <div class="absolute -left-24 top-24 h-72 w-72 rounded-full bg-brand-200/40 blur-3xl"></div>
    <div class="absolute right-0 top-0 h-96 w-96 rounded-full bg-fuchsia-200/30 blur-3xl"></div>
    <div class="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-rose-200/30 blur-3xl"></div>
    <svg class="absolute right-10 top-40 h-24 w-24 text-brand-300/50" viewBox="0 0 64 64" fill="currentColor">
      <ellipse cx="20" cy="42" rx="9" ry="11" />
      <ellipse cx="40" cy="44" rx="8" ry="10" />
      <ellipse cx="15" cy="22" rx="6" ry="8" />
      <ellipse cx="31" cy="15" rx="6.5" ry="8.5" />
      <ellipse cx="47" cy="22" rx="6" ry="8" />
    </svg>
  </div>

  <div class="mx-auto flex w-full max-w-[1500px]">
    <!-- sidebar (desktop) -->
    <aside class="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col gap-6 border-r border-white/60 bg-white/45 px-5 py-6 backdrop-blur-xl lg:flex">
      <Logo />

      <nav class="flex flex-col gap-1">
        {#each NAV as item (item.href)}
          <a
            href={item.href}
            use:link
            class="nav-link"
            class:nav-link-active={isActive($route, item.href, item.href === '/')}
          >
            <item.Icon size={19} strokeWidth={2.2} />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>

      <div class="mt-2 rounded-3xl border border-white/70 bg-gradient-to-br from-white/90 to-brand-100/70 p-4 shadow-soft">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-500">Next up</p>
        {#if upcoming}
          <p class="mt-1.5 text-sm font-bold leading-snug text-ink-900">
            {upcoming.distance_km} km {upcoming.activity_type}
          </p>
          <p class="mt-1 text-xs font-semibold text-ink-400">
            ~{Math.round(upcoming.duration.minutes)} min · {upcoming.fueling.carbs.perHourG} g carbs/h
          </p>
          <button class="btn-primary mt-3 w-full !py-2 !text-xs" onclick={() => navigate('/plan')}>
            View fueling plan
          </button>
        {:else}
          <p class="mt-1.5 text-sm font-bold leading-snug text-ink-900">Plan your next session</p>
          <p class="mt-1 text-xs font-semibold text-ink-400">Get duration + fueling in one tap.</p>
          <button class="btn-primary mt-3 w-full !py-2 !text-xs" onclick={() => navigate('/plan')}>Plan now</button>
        {/if}
      </div>

      <div class="mt-auto flex items-center gap-3 rounded-3xl bg-white/70 p-3 shadow-soft">
        <div class="grid h-10 w-10 place-items-center rounded-full bg-brand-gradient font-display text-sm font-extrabold text-white">
          {initial}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-bold leading-tight">{$profile?.name ?? 'Athlete'}</p>
          <p class="truncate text-[11px] font-semibold text-ink-400">{$profile?.city ?? 'TRANA member'}</p>
        </div>
        <button class="rounded-xl p-2 text-ink-400 transition hover:bg-brand-100 hover:text-brand-700" onclick={signOut} title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </aside>

    <!-- main -->
    <div class="min-w-0 flex-1">
      <!-- top bar -->
      <header class="sticky top-0 z-30 border-b border-white/50 bg-white/60 backdrop-blur-xl">
        <div class="flex items-center gap-3 px-4 py-3 sm:px-6">
          <div class="lg:hidden"><Logo size={38} /></div>

          <form class="hidden flex-1 lg:block" onsubmit={submitSearch}>
            <label class="flex max-w-md items-center gap-2 rounded-2xl border border-brand-100 bg-white/90 px-4 py-2.5 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100">
              <Search size={16} class="text-ink-400" />
              <input
                class="w-full bg-transparent text-sm font-semibold text-ink-900 outline-none placeholder:font-medium placeholder:text-ink-400"
                placeholder="Search activities, routes, cities…"
                bind:value={searchTerm}
              />
            </label>
          </form>

          <div class="ml-auto flex items-center gap-1.5">
            <button
              class="grid h-10 w-10 place-items-center rounded-2xl text-ink-500 transition hover:bg-white hover:text-brand-700 lg:hidden"
              onclick={() => (searchOpen = !searchOpen)}
              aria-label="Search"
            >
              <Search size={18} />
            </button>
            <button
              class="relative grid h-10 w-10 place-items-center rounded-2xl text-ink-500 transition hover:bg-white hover:text-brand-700"
              onclick={() => navigate('/goals')}
              aria-label="Notifications"
            >
              <Bell size={18} />
              <span class="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white"></span>
            </button>

            <div class="relative">
              <button
                class="flex items-center gap-1.5 rounded-2xl border border-white/80 bg-white/80 py-1 pl-1 pr-2 transition hover:border-brand-200"
                onclick={() => (menuOpen = !menuOpen)}
                aria-label="Account menu"
              >
                <span class="grid h-8 w-8 place-items-center rounded-full bg-brand-gradient font-display text-xs font-extrabold text-white">
                  {initial}
                </span>
                <ChevronDown size={14} class="text-ink-400" />
              </button>

              {#if menuOpen}
                <div class="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-2xl border border-brand-100 bg-white p-1.5 shadow-card animate-pop">
                  <div class="px-3 py-2">
                    <p class="truncate text-sm font-bold">{$profile?.name ?? 'Athlete'}</p>
                    <p class="truncate text-[11px] font-semibold text-ink-400">{$session?.email ?? 'demo@trana.app'}</p>
                  </div>
                  <div class="divider my-1"></div>
                  <a href="/settings" use:link class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700">
                    <User size={15} /> Profile & settings
                  </a>
                  <a href="/plan" use:link class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700">
                    <Sparkles size={15} /> New prediction
                  </a>
                  <button class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-rose-500 hover:bg-rose-50" onclick={signOut}>
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
                <button class="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
              {/if}
            </div>
          </div>
        </div>

        {#if searchOpen}
          <form class="px-4 pb-3 lg:hidden" onsubmit={submitSearch}>
            <label class="flex items-center gap-2 rounded-2xl border border-brand-100 bg-white px-4 py-2.5">
              <Search size={16} class="text-ink-400" />
              <input class="w-full bg-transparent text-sm font-semibold outline-none" placeholder="Search activities…" bind:value={searchTerm} />
            </label>
          </form>
        {/if}
      </header>

      <main class="px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
        {@render children?.()}
      </main>
    </div>
  </div>

  <!-- bottom nav (mobile) -->
  <nav class="fixed inset-x-0 bottom-0 z-40 border-t border-white/70 bg-white/85 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
    <div class="mx-auto flex max-w-lg items-end justify-between px-3">
      {#each MOBILE as item (item.href)}
        {@const active = isActive($route, item.href, item.href === '/')}
        {#if item.fab}
          <button
            class="-mt-6 grid h-14 w-14 place-items-center rounded-full bg-brand-gradient text-white shadow-glow transition active:scale-95"
            onclick={() => navigate(item.href)}
            aria-label="Plan an activity"
          >
            <Plus size={26} strokeWidth={2.6} />
          </button>
        {:else}
          <a href={item.href} use:link class="flex w-16 flex-col items-center gap-1 rounded-xl py-1.5 {active ? 'text-brand-600' : 'text-ink-400'}">
            <item.Icon size={21} strokeWidth={active ? 2.6 : 2.1} />
            <span class="text-[10px] font-bold">{item.label}</span>
            <span class="h-1 w-6 rounded-full {active ? 'bg-brand-500' : 'bg-transparent'}"></span>
          </a>
        {/if}
      {/each}
    </div>
  </nav>
</div>
