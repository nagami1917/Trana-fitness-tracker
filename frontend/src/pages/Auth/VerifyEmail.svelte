<script>
  import { MailCheck, MailWarning, LoaderCircle, Send, LogOut, ArrowRight, Inbox } from 'lucide-svelte';
  import { api } from '../../services/client.js';
  import { session, logout, notify } from '../../stores/index.js';
  import { query, link, navigate } from '../../lib/router.js';

  const status = $derived($query.get('status'));
  const email = $derived($session?.email ?? '');

  let resending = $state(false);

  async function resend() {
    resending = true;
    try {
      const data = await api.auth.resendVerification();
      notify(data?.message || 'Verification link sent — check your inbox.');
    } catch (error) {
      notify(error.message || 'Could not send the verification email.', 'error');
    } finally {
      resending = false;
    }
  }

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }
</script>

<svelte:head><title>Verify email — TRANA</title></svelte:head>

<div class="mx-auto w-full max-w-md rounded-3xl border border-brand-100 bg-white p-6 text-center shadow-card sm:p-8">
  {#if status === 'verified'}
    <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50">
      <MailCheck size={26} class="text-emerald-500" />
    </div>
    <h1 class="mt-4 font-display text-2xl font-extrabold text-ink-900">Email verified</h1>
    <p class="mt-2 text-sm font-semibold leading-relaxed text-ink-500">
      Your address is confirmed — your TRANA account is fully secured.
    </p>
    <button class="btn-primary mt-5 w-full justify-center" onclick={() => navigate($session ? '/' : '/login')}>
      {#if $session}Continue to TRANA{:else}Sign in <ArrowRight size={16} />{/if}
    </button>
  {:else if status === 'invalid'}
    <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-50">
      <MailWarning size={26} class="text-rose-500" />
    </div>
    <h1 class="mt-4 font-display text-2xl font-extrabold text-ink-900">Link expired</h1>
    <p class="mt-2 text-sm font-semibold leading-relaxed text-ink-500">
      That verification link is invalid or older than 2 hours. Request a fresh one.
    </p>
    {#if $session}
      <button class="btn-primary mt-5 w-full justify-center" onclick={resend} disabled={resending}>
        {#if resending}<LoaderCircle size={16} class="animate-spin" /> Sending…{:else}<Send size={16} /> Send a new link{/if}
      </button>
    {:else}
      <button class="btn-primary mt-5 w-full justify-center" onclick={() => navigate('/login')}>
        Back to sign in
      </button>
    {/if}
  {:else if $session}
    <!-- verification gate: signed in, address not yet verified -->
    <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50">
      <Inbox size={26} class="text-brand-500" />
    </div>
    <h1 class="mt-4 font-display text-2xl font-extrabold text-ink-900">Verify your email</h1>
    <p class="mt-2 text-sm font-semibold leading-relaxed text-ink-500">
      We sent a verification link to
      <span class="font-extrabold text-ink-700">{email}</span>.
      Open it to secure your account and unlock TRANA.
    </p>
    <p class="mt-2 text-[11px] font-semibold leading-relaxed text-ink-400">
      Didn't get it? Check spam, or resend below. The link expires in 2 hours.
    </p>

    <button class="btn-primary mt-5 w-full justify-center" onclick={resend} disabled={resending}>
      {#if resending}<LoaderCircle size={16} class="animate-spin" /> Sending…{:else}<Send size={16} /> Resend verification email{/if}
    </button>
    <button class="btn-ghost mt-2 w-full justify-center" onclick={signOut}>
      <LogOut size={15} /> Use a different account
    </button>
  {:else}
    <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50">
      <Inbox size={26} class="text-brand-500" />
    </div>
    <h1 class="mt-4 font-display text-2xl font-extrabold text-ink-900">Check your inbox</h1>
    <p class="mt-2 text-sm font-semibold leading-relaxed text-ink-500">
      Open the verification link we emailed you, then sign in to continue.
    </p>
    <button class="btn-primary mt-5 w-full justify-center" onclick={() => navigate('/login')}>
      Back to sign in
    </button>
  {/if}
</div>
