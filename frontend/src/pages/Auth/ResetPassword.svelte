<script>
  import { Lock, LoaderCircle, ArrowRight, ShieldCheck, TriangleAlert } from 'lucide-svelte';
  import { api } from '../../services/client.js';
  import { query, link, navigate } from '../../lib/router.js';

  let token = $state($query.get('token') ?? '');
  let email = $state($query.get('email') ?? '');
  let password = $state('');
  let confirm = $state('');
  let saving = $state(false);
  let error = $state('');
  let done = $state(false);

  const hasParams = Boolean(token && email);

  async function submit(event) {
    event.preventDefault();
    error = '';
    if (password !== confirm) {
      error = 'Passwords do not match.';
      return;
    }
    saving = true;
    try {
      await api.auth.resetPassword({ token, email, password, password_confirmation: confirm });
      done = true;
    } catch (err) {
      error = err.message || 'Could not reset the password.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Reset password — TRANA</title></svelte:head>

<div class="mx-auto w-full max-w-md rounded-3xl border border-brand-100 bg-white p-6 shadow-card sm:p-8">
  <span class="pill"><ShieldCheck size={12} /> Password reset</span>

  {#if done}
    <h1 class="mt-3 font-display text-2xl font-extrabold text-ink-900">Password updated</h1>
    <p class="mt-2 text-sm font-semibold leading-relaxed text-ink-500">
      Your password has been changed and all previous sessions were signed out.
      You can sign in with your new password.
    </p>
    <button class="btn-primary mt-5 w-full justify-center" onclick={() => navigate('/login')}>
      Sign in <ArrowRight size={16} />
    </button>
  {:else if !hasParams}
    <h1 class="mt-3 font-display text-2xl font-extrabold text-ink-900">Link problem</h1>
    <p class="mt-2 flex items-start gap-2 text-sm font-semibold leading-relaxed text-ink-500">
      <TriangleAlert size={16} class="mt-0.5 shrink-0 text-amber-500" />
      This reset link is incomplete. Request a fresh one — links expire after 60 minutes.
    </p>
    <button class="btn-primary mt-5 w-full justify-center" onclick={() => navigate('/forgot-password')}>
      Request a new link
    </button>
  {:else}
    <h1 class="mt-3 font-display text-2xl font-extrabold text-ink-900">Choose a new password</h1>
    <p class="mt-1 text-sm font-semibold text-ink-400">
      Resetting for <span class="font-extrabold text-ink-700">{email}</span>
    </p>

    <form class="mt-5 space-y-4" onsubmit={submit}>
      <div>
        <label class="label" for="new-password">New password</label>
        <div class="relative">
          <Lock size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            id="new-password"
            type="password"
            class="input pl-11"
            bind:value={password}
            placeholder="At least 8 characters"
            autocomplete="new-password"
            minlength="8"
            required
          />
        </div>
      </div>
      <div>
        <label class="label" for="confirm-password">Confirm password</label>
        <div class="relative">
          <Lock size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            id="confirm-password"
            type="password"
            class="input pl-11"
            bind:value={confirm}
            placeholder="Repeat it"
            autocomplete="new-password"
            minlength="8"
            required
          />
        </div>
      </div>

      {#if error}
        <p class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p>
      {/if}

      <button type="submit" class="btn-primary w-full !py-3" disabled={saving || !password}>
        {#if saving}
          <LoaderCircle size={17} class="animate-spin" /> Updating…
        {:else}
          Save new password <ArrowRight size={17} />
        {/if}
      </button>
    </form>

    <p class="mt-4 text-center text-sm font-semibold text-ink-400">
      <a href="/forgot-password" use:link class="font-extrabold text-brand-600 hover:text-brand-700">
        Send a fresh link instead
      </a>
    </p>
  {/if}
</div>
