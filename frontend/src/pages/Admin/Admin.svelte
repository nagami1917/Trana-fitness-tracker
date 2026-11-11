<script>
  import { onMount } from 'svelte';
  import { ShieldCheck, Users as UsersIcon, TriangleAlert, Brain, Search, Ban, RotateCcw, LoaderCircle, Activity } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import { session, notify } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { link } from '../../lib/router.js';

  // Cosmetic gate only — the API answers 403 to non-admins regardless.
  const isAdmin = $derived($session?.role === 'admin');

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'errors', label: 'Errors' },
    { id: 'model', label: 'Model' },
  ];

  let tab = $state('overview');
  let kpis = $state(null);
  let userRows = $state([]);
  let userMeta = $state(null);
  let userQuery = $state('');
  let userStatus = $state('all');
  let errorRows = $state([]);
  let errorStatus = $state('open');
  let model = $state(null);
  let busy = $state('');
  let actingId = $state(0);

  const dash = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString());
  const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

  async function guarded(key, fn) {
    busy = key;
    try {
      await fn();
    } catch (error) {
      notify(error.message || 'The admin API is unavailable.', 'error');
    } finally {
      busy = '';
    }
  }

  function loadOverview() {
    return guarded('overview', async () => {
      kpis = await api.admin.dashboard();
    });
  }

  function loadUsers() {
    return guarded('users', async () => {
      const res = await api.admin.users({ q: userQuery.trim(), status: userStatus === 'all' ? '' : userStatus });
      userRows = Array.isArray(res?.data) ? res.data : [];
      userMeta = res?.meta ?? null;
    });
  }

  function loadErrors() {
    return guarded('errors', async () => {
      const res = await api.admin.errors({ status: errorStatus });
      errorRows = Array.isArray(res?.data) ? res.data : [];
    });
  }

  function loadModel() {
    return guarded('model', async () => {
      model = await api.admin.model();
    });
  }

  function selectTab(id) {
    tab = id;
    if (id === 'overview') loadOverview();
    else if (id === 'users') loadUsers();
    else if (id === 'errors') loadErrors();
    else if (id === 'model') loadModel();
  }

  async function toggleSuspend(user) {
    actingId = user.id;
    try {
      if (user.suspended_at) {
        await api.admin.reactivate(user.id);
        notify(`${user.name} can sign in again.`);
      } else {
        await api.admin.suspend(user.id);
        notify(`${user.name} was suspended.`, 'error');
      }
      await loadUsers();
    } catch (error) {
      notify(error.message || 'Could not update this account.', 'error');
    } finally {
      actingId = 0;
    }
  }

  async function triage(log, status) {
    actingId = log.id;
    try {
      await api.admin.triage(log.id, status);
      await loadErrors();
    } catch (error) {
      notify(error.message || 'Could not update this error group.', 'error');
    } finally {
      actingId = 0;
    }
  }

  const featureEntries = $derived(
    Object.entries(model?.feature_importance ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
  );
  const featureMax = $derived(featureEntries.length ? featureEntries[0][1] : 0);

  onMount(() => {
    if (isAdmin) loadOverview();
  });
</script>

{#if !isAdmin}
  <div class="grid min-h-[50vh] place-items-center px-6 text-center">
    <div>
      <ShieldCheck size={44} class="mx-auto text-ink-300" strokeWidth={1.8} />
      <h1 class="mt-4 font-display text-2xl font-extrabold text-ink-500">Admin access required</h1>
      <p class="mt-2 text-sm font-semibold text-ink-400">This console is limited to operator accounts.</p>
      <a href="/" use:link class="mt-5 inline-flex rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-extrabold text-white shadow-glow">
        Back to dashboard
      </a>
    </div>
  </div>
{:else}
  <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <span class="grid h-11 w-11 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
        <ShieldCheck size={22} strokeWidth={2.4} />
      </span>
      <div>
        <h1 class="font-display text-2xl font-extrabold text-ink-500">Admin console</h1>
        <p class="text-xs font-bold text-ink-400">Operational health · accounts · error triage · model ops</p>
      </div>
    </div>
    <Segmented options={TABS} value={tab} onSelect={(o) => selectTab(o.id)} />
  </header>

  {#if tab === 'overview'}
    {#if !kpis}
      <p class="flex items-center gap-2 text-sm font-bold text-ink-400"><LoaderCircle size={16} class="animate-spin" /> Loading metrics…</p>
    {:else}
      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-500">Accounts</p>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div><p class="font-display text-2xl font-extrabold text-ink-500">{dash(kpis.users?.total)}</p><p class="text-[11px] font-bold text-ink-400">total</p></div>
            <div><p class="font-display text-2xl font-extrabold text-ink-500">{dash(kpis.users?.new_7d)}</p><p class="text-[11px] font-bold text-ink-400">new 7 d</p></div>
            <div><p class="font-display text-2xl font-extrabold text-ink-500">{dash(kpis.users?.admins)}</p><p class="text-[11px] font-bold text-ink-400">admins</p></div>
            <div><p class="font-display text-2xl font-extrabold {kpis.users?.suspended ? 'text-rose-500' : 'text-ink-500'}">{dash(kpis.users?.suspended)}</p><p class="text-[11px] font-bold text-ink-400">suspended</p></div>
          </div>
        </Card>
        <Card>
          <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-500">Content</p>
          <div class="mt-3 grid grid-cols-3 gap-3">
            <div><p class="font-display text-2xl font-extrabold text-ink-500">{dash(kpis.content?.activities)}</p><p class="text-[11px] font-bold text-ink-400">activities</p></div>
            <div><p class="font-display text-2xl font-extrabold text-ink-500">{dash(kpis.content?.predictions)}</p><p class="text-[11px] font-bold text-ink-400">predictions</p></div>
            <div><p class="font-display text-2xl font-extrabold text-ink-500">{dash(kpis.content?.goals)}</p><p class="text-[11px] font-bold text-ink-400">goals</p></div>
          </div>
        </Card>
        <Card>
          <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-500">Error groups</p>
          <div class="mt-3 grid grid-cols-3 gap-3">
            <div><p class="font-display text-2xl font-extrabold {kpis.errors?.open_groups ? 'text-rose-500' : 'text-ink-500'}">{dash(kpis.errors?.open_groups)}</p><p class="text-[11px] font-bold text-ink-400">open</p></div>
            <div><p class="font-display text-2xl font-extrabold text-ink-500">{dash(kpis.errors?.groups_24h)}</p><p class="text-[11px] font-bold text-ink-400">24 h</p></div>
            <div><p class="font-display text-2xl font-extrabold text-ink-500">{dash(kpis.errors?.total_groups)}</p><p class="text-[11px] font-bold text-ink-400">all time</p></div>
          </div>
        </Card>
      </section>
      <p class="mt-4 text-[11px] font-bold text-ink-400">Counts only — the console never shows other athletes' activity content.</p>
    {/if}
  {:else if tab === 'users'}
    <form class="mb-4 flex flex-wrap items-center gap-3" onsubmit={(e) => { e.preventDefault(); loadUsers(); }}>
      <label class="flex items-center gap-2 rounded-full border border-brand-100 bg-white/80 px-4 py-2">
        <Search size={15} class="text-ink-400" />
        <input
          class="w-44 bg-transparent text-sm font-bold text-ink-500 outline-none placeholder:text-ink-300"
          placeholder="Search name or email"
          bind:value={userQuery}
        />
      </label>
      <Segmented
        options={[{ id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'suspended', label: 'Suspended' }]}
        value={userStatus}
        onSelect={(o) => { userStatus = o.id; loadUsers(); }}
      />
      <button type="submit" class="rounded-full bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-glow">Search</button>
      {#if busy === 'users'}<LoaderCircle size={16} class="animate-spin text-ink-400" />{/if}
    </form>

    <Card padded={false}>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr class="border-b border-brand-100 text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-400">
              <th class="px-5 py-3">Athlete</th>
              <th class="px-5 py-3">Role</th>
              <th class="px-5 py-3">Joined</th>
              <th class="px-5 py-3 text-right">Activities</th>
              <th class="px-5 py-3">State</th>
              <th class="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {#each userRows as user (user.id)}
              <tr class="border-b border-brand-100/60 last:border-0">
                <td class="px-5 py-3">
                  <p class="font-bold text-ink-500">{user.name}</p>
                  <p class="text-xs font-semibold text-ink-400">{user.email}</p>
                </td>
                <td class="px-5 py-3">
                  <span class="rounded-full px-2.5 py-1 text-[11px] font-extrabold {user.role === 'admin' ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500'}">
                    {user.role}
                  </span>
                </td>
                <td class="px-5 py-3 text-xs font-semibold text-ink-400">{when(user.created_at)}</td>
                <td class="px-5 py-3 text-right font-bold text-ink-500">{dash(user.activities_count)}</td>
                <td class="px-5 py-3">
                  {#if user.suspended_at}
                    <span class="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-extrabold text-rose-600">suspended</span>
                  {:else}
                    <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700">active</span>
                  {/if}
                </td>
                <td class="px-5 py-3 text-right">
                  <button
                    class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold transition disabled:opacity-50 {user.suspended_at
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : 'bg-rose-100 text-rose-600 hover:bg-rose-200'}"
                    disabled={actingId === user.id}
                    onclick={() => toggleSuspend(user)}
                  >
                    {#if actingId === user.id}
                      <LoaderCircle size={13} class="animate-spin" />
                    {:else if user.suspended_at}
                      <RotateCcw size={13} /> Reactivate
                    {:else}
                      <Ban size={13} /> Suspend
                    {/if}
                  </button>
                </td>
              </tr>
            {:else}
              <tr><td colspan="6" class="px-5 py-8 text-center text-sm font-bold text-ink-400">No accounts match.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Card>
    {#if userMeta}
      <p class="mt-3 text-[11px] font-bold text-ink-400">
        {userMeta.total} account(s) · page {userMeta.current_page} of {userMeta.last_page}
      </p>
    {/if}
  {:else if tab === 'errors'}
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <Segmented
        options={[{ id: 'open', label: 'Open' }, { id: 'acknowledged', label: 'Acknowledged' }, { id: 'resolved', label: 'Resolved' }, { id: 'all', label: 'All' }]}
        value={errorStatus}
        onSelect={(o) => { errorStatus = o.id; loadErrors(); }}
      />
      {#if busy === 'errors'}<LoaderCircle size={16} class="animate-spin text-ink-400" />{/if}
    </div>

    <div class="space-y-3">
      {#each errorRows as log (log.id)}
        <Card>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase {log.kind === 'api'
                  ? 'bg-rose-100 text-rose-600'
                  : log.kind === 'ml'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-sky-100 text-sky-700'}">
                  {log.kind}
                </span>
                <span class="rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-extrabold text-ink-500">{log.status}</span>
                <span class="text-[11px] font-bold text-ink-400">×{dash(log.occurrences)}</span>
                <span class="text-[11px] font-bold text-ink-400">{when(log.last_seen_at)}</span>
              </div>
              <p class="mt-2 break-words text-sm font-bold text-ink-500">{log.message}</p>
              <p class="mt-1 text-xs font-semibold text-ink-400">
                {log.method ?? '—'} {log.route ?? '—'}{log.exception_class ? ` · ${log.exception_class}` : ''}
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              {#if log.status === 'open'}
                <button
                  class="rounded-full bg-amber-100 px-3 py-1.5 text-[11px] font-extrabold text-amber-700 hover:bg-amber-200 disabled:opacity-50"
                  disabled={actingId === log.id}
                  onclick={() => triage(log, 'acknowledged')}
                >Acknowledge</button>
              {/if}
              {#if log.status !== 'resolved'}
                <button
                  class="rounded-full bg-emerald-100 px-3 py-1.5 text-[11px] font-extrabold text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
                  disabled={actingId === log.id}
                  onclick={() => triage(log, 'resolved')}
                >Resolve</button>
              {:else}
                <button
                  class="rounded-full bg-ink-100 px-3 py-1.5 text-[11px] font-extrabold text-ink-500 hover:bg-ink-200 disabled:opacity-50"
                  disabled={actingId === log.id}
                  onclick={() => triage(log, 'open')}
                >Reopen</button>
              {/if}
            </div>
          </div>
          {#if log.trace}
            <details class="mt-3">
              <summary class="cursor-pointer text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Stack trace</summary>
              <pre class="mt-2 max-h-56 overflow-auto rounded-2xl bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-500">{log.trace}</pre>
            </details>
          {/if}
        </Card>
      {:else}
        <Card><p class="text-center text-sm font-bold text-ink-400">No {errorStatus === 'all' ? '' : errorStatus} error groups. {busy === 'errors' ? 'Loading…' : ''}</p></Card>
      {/each}
    </div>
  {:else}
    {#if !model}
      <p class="flex items-center gap-2 text-sm font-bold text-ink-400"><LoaderCircle size={16} class="animate-spin" /> Loading model info…</p>
    {:else}
      <section class="grid gap-4 lg:grid-cols-2">
        <Card>
          <div class="flex items-center gap-2">
            <Brain size={18} class="text-brand-500" />
            <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-500">Deployed artifact</p>
          </div>
          <p class="mt-3 font-display text-xl font-extrabold text-ink-500">{model.version ?? 'unknown'}</p>
          <p class="text-xs font-bold text-ink-400">
            {model.training_source ?? '—'} · {dash(model.corpus_rows)} training rows
          </p>
          <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p class="font-display text-lg font-extrabold text-ink-500">{model.metrics?.r2 ?? '—'}</p><p class="text-[11px] font-bold text-ink-400">R²</p></div>
            <div><p class="font-display text-lg font-extrabold text-ink-500">{model.metrics?.mae_min ?? '—'}</p><p class="text-[11px] font-bold text-ink-400">MAE (min)</p></div>
            <div><p class="font-display text-lg font-extrabold text-ink-500">{model.metrics?.mape_pct ? `${Math.round(model.metrics.mape_pct)}%` : '—'}</p><p class="text-[11px] font-bold text-ink-400">test error</p></div>
            <div><p class="font-display text-lg font-extrabold text-ink-500">{model.metrics?.interval_coverage_pct ? `${Math.round(model.metrics.interval_coverage_pct)}%` : '—'}</p><p class="text-[11px] font-bold text-ink-400">80% band</p></div>
          </div>
          <p class="mt-4 text-[11px] font-bold text-ink-400">Read-only viewer — retraining runs from the CLI, never from this console.</p>
        </Card>
        <Card>
          <div class="flex items-center gap-2">
            <Activity size={18} class="text-brand-500" />
            <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-500">Feature importances</p>
          </div>
          <div class="mt-3 space-y-2.5">
            {#each featureEntries as [name, weight] (name)}
              <div>
                <div class="flex items-center justify-between text-[11px] font-bold text-ink-400">
                  <span class="truncate pr-2">{name}</span>
                  <span>{Number(weight).toFixed(3)}</span>
                </div>
                <div class="mt-1 h-2 rounded-full bg-ink-100">
                  <div class="h-2 rounded-full bg-brand-gradient" style="width: {featureMax ? Math.max(4, (weight / featureMax) * 100) : 0}%"></div>
                </div>
              </div>
            {:else}
              <p class="text-sm font-bold text-ink-400">No importance data in this artifact.</p>
            {/each}
          </div>
        </Card>
      </section>
    {/if}
  {/if}
{/if}
