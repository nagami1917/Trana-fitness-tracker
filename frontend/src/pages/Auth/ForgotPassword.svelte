<script>
  import { Mail, LoaderCircle, ArrowRight, KeyRound } from 'lucide-svelte';
  import { api } from '../../services/client.js';
  import { link, navigate } from '../../lib/router.js';

  let email = $state('');
  let sending = $state(false);
  let sent = $state(false);
  let error = $state('');

  async function submit(event) {
    event.preventDefault();
    error = '';
    sending = true;
    try {
      await api.auth.forgotPassword(email.trim());
      sent = true;
    } catch (err) {
      error = err.message || 'Could not send the reset link.';
    } finally {
      sending = false;
    }
  }
</script>

<svelte:head><title>Forgot password — TRANA</title></svelte:head>

<div class="mx-auto w-full max-w-md rounded-3xl border border-brand-100 bg-white p-6 shadow-card sm:p-8">
  <span class="pill"><KeyRound size={12} /> Account recovery</span>

  {#if sent}
    <h1 class="mt-3 font-display text-2xl font-extrabold text-ink-900">Check your inbox</h1>
    <p class="mt-2 text-sm font-semibold leading-relaxed text-ink-500">
      If <span class="font-extrabold text-ink-700">{email}</span> has a TRANA account, a reset link is on its
      way. It expires in 60 minutes — check spam if you don't see it.
    </p>
    <button class="btn-primary mt-5 w-full justify-center" onclick={() => navigate('/login')}>
      Back to sign in
    </button>
  {:else}
    <h1 class="mt-3 font-display text-2xl font-extrabold text-ink-900">Forgot your password?</h1>
    <p class="mt-1 text-sm font-semibold text-ink-400">
      Enter your account email and we'll send you a link to choose a new one.
    </p>

    <form class="mt-5 space-y-4" onsubmit={submit}>
      <div>
        <label class="label" for="forgot-email">Email</label>
        <div class="relative">
          <Mail size={16} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            id="forgot-email"
            type="email"
            class="input pl-11"
            bind:value={email}
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
        </div>
      </div>

      {#if error}
        <p class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p>
      {/if}

      <button type="submit" class="btn-primary w-full !py-3" disabled={sending || !email.trim()}>
        {#if sending}
          <LoaderCircle size={17} class="animate-spin" /> Sending…
        {:else}
          Send reset link <ArrowRight size={17} />
        {/if}
      </button>
    </form>

    <p class="mt-4 text-center text-sm font-semibold text-ink-400">
      Remembered it?
      <a href="/login" use:link class="font-extrabold text-brand-600 hover:text-brand-700">Sign in</a>
    </p>
  {/if}
</div>
