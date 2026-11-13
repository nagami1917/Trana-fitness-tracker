<script>
  import {
    House,
    Footprints,
    ChartColumn,
    Target,
    Settings,
    Bell,
    Search,
    Sparkles,
    Salad,
    LogOut,
    CircleUserRound,
    ChevronDown,
    MapPin,
    CalendarDays,
    ShieldCheck,
    Compass,
    Moon,
    Sun,
    CloudUpload,
    LayoutGrid,
    X,
  } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { route, navigate, link, isActive } from '../../lib/router.js';
  import { profile, session, logout, plans, activities, todayStats, unitSystem } from '../../stores/index.js';
  import { liveTracker } from '../../lib/liveTracker.svelte.js';
  import { mascotTour } from '../../lib/mascotTour.svelte.js';
  import { api } from '../../services/client.js';
  import { nf, km } from '../../lib/format.js';
  import { distanceUnit } from '../../lib/units.js';
  import {
    pendingActivities,
    syncingOfflineQueue,
    bindOfflineSyncListener,
    flushPendingActivities,
  } from '../../lib/offlineQueue.js';
  import { theme, toggleTheme } from '../../lib/theme.js';
  import Logo from './Logo.svelte';
  import Footer from './Footer.svelte';
  import MascotGuide from './MascotGuide.svelte';
  import Skeleton from './Skeleton.svelte';

  let { children } = $props();

  // Desktop nav grouped by athlete workflow (Train, Progress, Account).
  const NAV_GROUPS = $derived([
    {
      heading: 'Train',
      items: [
        { href: '/', label: 'Dashboard', Icon: House, exact: true },
        { href: '/plan', label: 'Plan Activity', Icon: Sparkles },
        { href: '/track', label: 'Track Activity', Icon: MapPin },
        { href: '/calendar', label: 'Week Calendar', Icon: CalendarDays },
        { href: '/fueling', label: 'Fueling', Icon: Salad },
      ],
    },
    {
      heading: 'Progress',
      items: [
        { href: '/activities', label: 'Activities', Icon: Footprints },
        { href: '/analytics', label: 'Analytics', Icon: ChartColumn },
        { href: '/goals', label: 'Goals', Icon: Target },
      ],
    },
    {
      heading: 'Account',
      items: [
        { href: '/settings', label: 'Settings', Icon: Settings, matchExtra: ['/profile'] },
        ...($session?.role === 'admin' ? [{ href: '/admin', label: 'Admin', Icon: ShieldCheck }] : []),
      ],
    },
  ]);

  const MORE_DRAWER_ITEMS = $derived([
    { href: '/calendar', label: 'Week Calendar', Icon: CalendarDays },
    { href: '/analytics', label: 'Analytics', Icon: ChartColumn },
    { href: '/fueling', label: 'Fueling guide', Icon: Salad },
    { href: '/goals', label: 'Goals', Icon: Target },
    { href: '/profile', label: 'Athlete Profile', Icon: CircleUserRound },
    { href: '/settings', label: 'Settings & Theme', Icon: Settings },
    ...($session?.role === 'admin' ? [{ href: '/admin', label: 'Admin console', Icon: ShieldCheck }] : []),
  ]);

  let menuOpen = $state(false);
  let moreOpen = $state(false);
  let searchOpen = $state(false);
  let searchTerm = $state('');

  // --- notification center -------------------------------------------------
  let notifOpen = $state(false);
  let notifItems = $state([]);
  let notifUnread = $state(0);
  let notifLoading = $state(false);
  let notifLoaded = $state(false);

  async function loadNotifications() {
    notifLoading = true;
    try {
      const { items, unread } = await api.notifications.list();
      notifItems = items;
      notifUnread = unread;
      notifLoaded = true;
    } catch {
      // Non-blocking: badge stays hidden if the feed can't load.
    } finally {
      notifLoading = false;
    }
  }

  function toggleNotif() {
    notifOpen = !notifOpen;
    if (notifOpen) void loadNotifications(); // fresh feed on every open
  }

  async function markRead(id) {
    const item = notifItems.find((n) => n.id === id);
    if (!item || item.read_at) return;
    item.read_at = new Date().toISOString();
    notifUnread = Math.max(0, notifUnread - 1);
    try {
      await api.notifications.read(id);
    } catch {
      void loadNotifications(); // resync on failure
    }
  }

  async function markAllRead() {
    const nowIso = new Date().toISOString();
    notifItems = notifItems.map((n) => (n.read_at ? n : { ...n, read_at: nowIso }));
    notifUnread = 0;
    try {
      await api.notifications.readAll();
    } catch {
      void loadNotifications();
    }
  }

  function ago(iso) {
    if (!iso) return '';
    const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'now';
    if (min < 60) return `${min}m`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  onMount(() => {
    void loadNotifications(); // badge value as soon as the shell mounts
    bindOfflineSyncListener();
    void flushPendingActivities({ silent: true });
  });

  $effect(() => {
    if (!$session?.id || !$profile) return;
    mascotTour.maybeAutoStart({
      userId: $session.id,
      onboarded: $profile.onboarded,
      activitiesCount: $activities.length,
      totalActivities: $profile.total_activities,
      plansCount: $plans.length,
    });
  });

  $effect(() => {
    // Close mobile drawer automatically on route navigation
    if ($route) moreOpen = false;
  });

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

  function isNavItemActive(item) {
    if (isActive($route, item.href, Boolean(item.exact))) return true;
    return Array.isArray(item.matchExtra) && item.matchExtra.some((p) => isActive($route, p, false));
  }

  const upcoming = $derived($plans?.[0] ?? null);
  const initial = $derived(($profile?.name || $session?.name || 'N').slice(0, 1).toUpperCase());
  const moreActive = $derived(['/calendar', '/analytics', '/fueling', '/goals', '/profile', '/settings', '/admin'].some((p) => isActive($route, p, false)));
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

  <!-- full-width shell: fills the screen at any zoom/monitor size -->
  <div class="flex w-full">
    <!-- sidebar (desktop) -->
    <aside class="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/60 bg-white/45 px-5 py-6 backdrop-blur-xl lg:flex">
      <Logo />

      <nav class="flex flex-col gap-4" aria-label="Primary navigation">
        {#each NAV_GROUPS as group (group.heading)}
          <div class="flex flex-col gap-1">
            <p class="px-3.5 pb-0.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-400">
              {group.heading}
            </p>
            {#each group.items as item (item.href)}
              <a
                href={item.href}
                use:link
                class="nav-link"
                class:nav-link-active={isNavItemActive(item)}
              >
                <item.Icon size={19} strokeWidth={2.2} />
                <span>{item.label}</span>
                {#if item.href === '/track' && liveTracker.tracking}
                  <span class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide {liveTracker.paused ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}">
                    {liveTracker.paused ? 'Paused' : 'Live'}
                  </span>
                {/if}
              </a>
            {/each}
          </div>
        {/each}
      </nav>

      <!-- Tier 1 flat summary widget -->
      <div class="card-flat p-4">
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-700">Today</p>
          <button
            class="text-[11px] font-bold text-ink-400 transition hover:text-brand-700"
            onclick={() => navigate('/')}
          >
            Dashboard →
          </button>
        </div>
        <div class="mt-2 grid grid-cols-3 gap-1 text-center">
          <div class="min-w-0">
            <p class="num-tabular truncate text-sm font-extrabold text-ink-900">{km($todayStats.distance, $unitSystem)}</p>
            <p class="text-[11px] font-bold uppercase tracking-wide text-ink-400">{distanceUnit($unitSystem)}</p>
          </div>
          <div class="min-w-0">
            <p class="num-tabular truncate text-sm font-extrabold text-ink-900">{Math.round($todayStats.minutes)}</p>
            <p class="text-[11px] font-bold uppercase tracking-wide text-ink-400">min</p>
          </div>
          <div class="min-w-0">
            <p class="num-tabular truncate text-sm font-extrabold text-ink-900">{Math.round($todayStats.calories)}</p>
            <p class="text-[11px] font-bold uppercase tracking-wide text-ink-400">kcal</p>
          </div>
        </div>
      </div>

      <div class="card-flat bg-gradient-to-br from-white/80 to-brand-100/60 p-4">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-700">Next up</p>
        {#if upcoming}
          <p class="num-tabular mt-1.5 text-sm font-bold leading-snug text-ink-900">
            {km(upcoming.distance_km, $unitSystem)} {distanceUnit($unitSystem)} {upcoming.activity_type}
          </p>
          <p class="num-tabular mt-1 text-xs font-semibold text-ink-400">
            ~{Math.round(upcoming.duration.minutes)} min · {upcoming.fueling.carbs.perHourG} g carbs/h
          </p>
          <button class="btn-ghost mt-3 w-full !py-2 !text-xs font-extrabold text-brand-700" onclick={() => navigate(`/plan?plan=${upcoming.id}`)}>
            View fueling plan
          </button>
        {:else}
          <p class="mt-1.5 text-sm font-bold leading-snug text-ink-900">Plan your next session</p>
          <p class="mt-1 text-xs font-semibold text-ink-400">Get duration + fueling in one tap.</p>
          <button class="btn-ghost mt-3 w-full !py-2 !text-xs font-extrabold text-brand-700" onclick={() => navigate('/plan')}>Plan now</button>
        {/if}
      </div>

      <div class="mt-auto flex items-center gap-3 rounded-3xl border border-brand-100/70 bg-white/70 p-3">
        <div class="grid h-10 w-10 place-items-center rounded-full bg-brand-gradient font-display text-sm font-extrabold text-white">
          {initial}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-bold leading-tight">{$profile?.name ?? 'Athlete'}</p>
          <p class="truncate text-[11px] font-semibold text-ink-400">{$profile?.city?.trim() || 'TRANA member'}</p>
        </div>
        <button class="rounded-xl p-2 text-ink-400 transition hover:bg-brand-100 hover:text-brand-700" onclick={signOut} title="Sign out" aria-label="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </aside>

    <!-- main -->
    <div class="min-w-0 flex-1">
      <!-- top bar -->
      <header class="sticky top-0 z-30 border-b border-white/50 bg-white/60 backdrop-blur-xl">
        <div class="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
          <div class="min-w-0 shrink-0 lg:hidden"><Logo size={36} /></div>

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

          <div class="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              data-tour="tour-replay"
              class="inline-flex h-9 items-center gap-1.5 rounded-2xl border border-brand-100/80 bg-white/80 px-2 text-xs font-extrabold text-brand-600 shadow-soft transition hover:border-brand-200 hover:bg-white hover:text-brand-700 sm:h-10 sm:px-2.5"
              onclick={() => mascotTour.start({ reset: true, userId: $session?.id })}
              aria-label="Open cat mascot guide"
              title="Show me around"
            >
              <img src="/mascot-cat.png" alt="" class="h-5 w-auto sm:h-6" />
              <span class="hidden sm:inline">Guide</span>
            </button>
            <button
              class="grid h-9 w-9 place-items-center rounded-2xl text-ink-500 transition hover:bg-white hover:text-brand-700 sm:h-10 sm:w-10 lg:hidden"
              onclick={() => (searchOpen = !searchOpen)}
              aria-label="Search"
            >
              <Search size={18} />
            </button>
            <div class="relative">
              <button
                class="relative grid h-9 w-9 place-items-center rounded-2xl text-ink-500 transition hover:bg-white hover:text-brand-700 sm:h-10 sm:w-10"
                onclick={toggleNotif}
                aria-label="Notifications"
                aria-expanded={notifOpen}
              >
                <Bell size={18} />
                {#if notifUnread > 0}
                  <span class="num-tabular absolute right-1 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-extrabold leading-none text-white ring-2 ring-white">
                    {notifUnread > 9 ? '9+' : notifUnread}
                  </span>
                {/if}
              </button>

              {#if notifOpen}
                <div class="absolute right-0 top-12 z-40 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-card animate-pop">
                  <div class="flex items-center justify-between px-4 pb-2 pt-3">
                    <p class="text-sm font-extrabold text-ink-900">Notifications</p>
                    {#if notifUnread > 0}
                      <button class="text-[11px] font-bold text-brand-600 transition hover:text-brand-700" onclick={markAllRead}>
                        Mark all read
                      </button>
                    {/if}
                  </div>
                  <div class="divider mx-3"></div>
                  <div class="max-h-80 overflow-y-auto p-2">
                    {#if notifLoading && !notifLoaded}
                      <div class="p-2"><Skeleton variant="rows" count={3} /></div>
                    {:else if !notifItems.length}
                      <p class="px-3 py-6 text-center text-xs font-semibold text-ink-400">You're all caught up</p>
                    {:else}
                      {#each notifItems as item (item.id)}
                        <button
                          class="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-brand-50 {item.read_at ? '' : 'bg-brand-50/60'}"
                          onclick={() => markRead(item.id)}
                        >
                          <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full {item.read_at ? 'bg-transparent' : 'bg-brand-500'}"></span>
                          <span class="min-w-0 flex-1">
                            <span class="flex items-baseline justify-between gap-2">
                              <span class="truncate text-xs font-extrabold text-ink-900">{item.title}</span>
                              <span class="num-tabular shrink-0 text-[11px] font-semibold text-ink-400">{ago(item.created_at)}</span>
                            </span>
                            <span class="mt-0.5 block text-[11px] font-semibold leading-snug text-ink-500">{item.body}</span>
                          </span>
                        </button>
                      {/each}
                    {/if}
                  </div>
                </div>
                <button class="fixed inset-0 z-30 cursor-default" aria-label="Close notifications" onclick={() => (notifOpen = false)}></button>
              {/if}
            </div>

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
                <div class="absolute right-0 top-12 z-40 w-56 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-brand-100 bg-white p-1.5 shadow-card animate-pop">
                  <div class="px-3 py-2">
                    <p class="truncate text-sm font-bold">{$profile?.name ?? 'Athlete'}</p>
                    <p class="truncate text-[11px] font-semibold text-ink-400">{$session?.email ?? ''}</p>
                  </div>
                  <div class="divider my-1"></div>
                  <a href="/profile" use:link class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700">
                    <CircleUserRound size={15} /> Your profile
                  </a>
                  {#if $session?.role === 'admin'}
                    <a href="/admin" use:link class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700">
                      <ShieldCheck size={15} /> Admin console
                    </a>
                  {/if}
                  <a href="/plan" use:link class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700">
                    <Sparkles size={15} /> Plan Activity
                  </a>
                  <a href="/fueling" use:link class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700">
                    <Salad size={15} /> Fueling guide
                  </a>
                  <a href="/settings" use:link class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700">
                    <Settings size={15} /> Settings
                  </a>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700"
                    onclick={() => { toggleTheme(); menuOpen = false; }}
                  >
                    {#if $theme === 'dark'}
                      <Sun size={15} /> Light mode
                    {:else}
                      <Moon size={15} /> Outdoor dark mode
                    {/if}
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-500 hover:bg-brand-50 hover:text-brand-700"
                    onclick={() => { menuOpen = false; mascotTour.start({ reset: true, userId: $session?.id }); }}
                  >
                    <Compass size={15} /> Tour with mascot
                  </button>
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
          <form class="px-3 pb-3 sm:px-4 lg:hidden" onsubmit={submitSearch}>
            <label class="flex items-center gap-2 rounded-2xl border border-brand-100 bg-white px-4 py-2.5">
              <Search size={16} class="text-ink-400" />
              <input class="w-full min-w-0 bg-transparent text-base font-semibold outline-none sm:text-sm" placeholder="Search activities…" bind:value={searchTerm} />
            </label>
          </form>
        {/if}
      </header>

      <main class="px-3 pb-4 pt-4 sm:px-6 sm:pt-5">
        {#if $pendingActivities.length > 0}
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-900">
            <span class="flex items-center gap-2">
              <CloudUpload size={15} class="text-amber-600" />
              {$pendingActivities.length} offline workout{$pendingActivities.length > 1 ? 's' : ''} waiting to sync
            </span>
            <button
              type="button"
              class="rounded-xl bg-white px-3 py-1 text-[11px] font-extrabold text-amber-800 border border-amber-200 transition hover:bg-amber-100 disabled:opacity-60"
              disabled={$syncingOfflineQueue}
              onclick={() => flushPendingActivities()}
            >
              {$syncingOfflineQueue ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        {/if}
        {@render children?.()}
      </main>
      <div class="px-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] sm:px-6 lg:pb-6">
        <Footer />
      </div>
    </div>
  </div>

  <!-- Mobile More Drawer -->
  {#if moreOpen}
    <div class="fixed inset-0 z-50 flex items-end justify-center lg:hidden">
      <button type="button" class="absolute inset-0 bg-ink-900/35 backdrop-blur-sm" aria-label="Close navigation drawer" onclick={() => (moreOpen = false)}></button>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More navigation"
        class="relative z-10 w-full max-w-lg rounded-t-4xl border border-brand-100 bg-white px-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 shadow-card animate-slide-up"
      >
        <div class="mb-3 flex items-center justify-between">
          <p class="font-display text-base font-extrabold text-ink-900">Insights & Account</p>
          <button type="button" class="btn-ghost !p-2" aria-label="Close drawer" onclick={() => (moreOpen = false)}>
            <X size={16} />
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2.5">
          {#each MORE_DRAWER_ITEMS as item (item.href)}
            <a
              href={item.href}
              use:link
              class="flex items-center gap-2.5 rounded-2xl border border-brand-100 bg-brand-50/50 px-3.5 py-3 text-sm font-bold transition {isActive($route, item.href, false) ? 'border-brand-300 bg-brand-gradient text-white shadow-glow' : 'text-ink-700 hover:border-brand-200'}"
            >
              <item.Icon size={17} />
              <span class="truncate">{item.label}</span>
            </a>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- bottom nav (mobile): Home · Plan · Track (center CTA) · Log · More -->
  <nav class="fixed inset-x-0 bottom-0 z-40 border-t border-white/70 bg-white/90 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden" aria-label="Mobile navigation">
    <div class="mx-auto grid max-w-lg grid-cols-5 items-end gap-1 px-2">
      <a href="/" use:link class="flex min-w-0 flex-col items-center gap-1 rounded-xl py-1.5 {isActive($route, '/', true) ? 'text-brand-700' : 'text-ink-400'}">
        <House size={20} strokeWidth={isActive($route, '/', true) ? 2.6 : 2.1} />
        <span class="max-w-full truncate text-[11px] font-bold">Home</span>
      </a>

      <a href="/plan" use:link class="flex min-w-0 flex-col items-center gap-1 rounded-xl py-1.5 {isActive($route, '/plan', false) ? 'text-brand-700' : 'text-ink-400'}">
        <Sparkles size={20} strokeWidth={isActive($route, '/plan', false) ? 2.6 : 2.1} />
        <span class="max-w-full truncate text-[11px] font-bold">Plan</span>
      </a>

      <a href="/track" use:link class="relative -mt-3 flex min-w-0 flex-col items-center gap-1 rounded-2xl py-1">
        <span class="relative grid h-11 w-14 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow transition active:scale-95 {isActive($route, '/track', false) ? 'ring-4 ring-brand-200' : ''}">
          <MapPin size={21} strokeWidth={2.5} />
          {#if liveTracker.tracking}
            <span
              class="absolute -right-1 -top-1 h-3 w-3 rounded-full ring-2 ring-white {liveTracker.paused ? 'bg-amber-400' : 'bg-emerald-500 animate-pulse'}"
              aria-label={liveTracker.paused ? 'Tracking paused' : 'Tracking live'}
            ></span>
          {/if}
        </span>
        <span class="max-w-full truncate text-[11px] font-extrabold {isActive($route, '/track', false) ? 'text-brand-700' : 'text-ink-700'}">Track</span>
      </a>

      <a href="/activities" use:link class="flex min-w-0 flex-col items-center gap-1 rounded-xl py-1.5 {isActive($route, '/activities', false) ? 'text-brand-700' : 'text-ink-400'}">
        <Footprints size={20} strokeWidth={isActive($route, '/activities', false) ? 2.6 : 2.1} />
        <span class="max-w-full truncate text-[11px] font-bold">Log</span>
      </a>

      <button
        type="button"
        class="flex min-w-0 flex-col items-center gap-1 rounded-xl py-1.5 {moreOpen || moreActive ? 'text-brand-700' : 'text-ink-400'}"
        aria-expanded={moreOpen}
        onclick={() => (moreOpen = !moreOpen)}
      >
        <LayoutGrid size={20} strokeWidth={moreOpen || moreActive ? 2.6 : 2.1} />
        <span class="max-w-full truncate text-[11px] font-bold">More</span>
      </button>
    </div>
  </nav>

  <MascotGuide />
</div>
