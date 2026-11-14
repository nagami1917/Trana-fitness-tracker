<script>
  import { onDestroy, onMount } from 'svelte';
  import { LoaderCircle } from 'lucide-svelte';
  import { googleSignInAndContinue } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { GOOGLE_CLIENT_ID, loadGoogleIdentity } from '../../services/googleIdentity.js';

  let { text = 'signin_with', onSuccess } = $props();
  let buttonElement = $state(null);
  let preparing = $state(true);
  let signingIn = $state(false);
  let error = $state('');
  let canRetry = $state(true);
  let destroyed = false;
  let setupSequence = 0;

  function messageFor(error, fallback) {
    return error?.errors?.credential?.[0] || error?.message || fallback;
  }

  async function prepareButton({ keepError = false } = {}) {
    const sequence = ++setupSequence;
    preparing = true;
    canRetry = true;
    buttonElement?.replaceChildren();
    if (!keepError) error = '';

    if (!GOOGLE_CLIENT_ID) {
      error = 'Google sign-in is not configured for this deployment. Please contact the TRANA administrator.';
      canRetry = false;
      preparing = false;
      return;
    }

    try {
      const { nonce } = await api.auth.requestGoogleNonce();
      if (!nonce) throw new Error('The TRANA API returned an invalid Google sign-in challenge.');
      await loadGoogleIdentity();
      if (destroyed || sequence !== setupSequence) return;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        nonce,
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: handleCredentialResponse,
      });
      const width = Math.min(384, Math.max(220, Math.floor(buttonElement?.clientWidth || 320)));
      window.google.accounts.id.renderButton(buttonElement, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text,
        logo_alignment: 'left',
        width,
      });
      preparing = false;
    } catch (cause) {
      if (destroyed || sequence !== setupSequence) return;
      error = messageFor(cause, 'Could not prepare Google sign-in. Please try again.');
      preparing = false;
    }
  }

  async function handleCredentialResponse(response) {
    if (!response?.credential) {
      error = 'Google did not return a sign-in credential. Please try again.';
      await prepareButton({ keepError: true });
      return;
    }

    signingIn = true;
    error = '';
    try {
      const user = await googleSignInAndContinue(response.credential);
      if (typeof onSuccess === 'function') await onSuccess(user);
    } catch (cause) {
      error = messageFor(cause, 'Google sign-in failed. Please try again.');
      // The API consumes the nonce once it has verified Google's signature.
      // Prepare a fresh one so a retry never reuses an authentication attempt.
      await prepareButton({ keepError: true });
    } finally {
      signingIn = false;
    }
  }

  onMount(() => {
    void prepareButton();
  });

  onDestroy(() => {
    destroyed = true;
    setupSequence += 1;
  });
</script>

<div class="relative min-h-11 w-full" aria-busy={preparing || signingIn}>
  <div class:opacity-50={preparing || signingIn} bind:this={buttonElement} class="min-h-11 w-full"></div>
  {#if preparing || signingIn}
    <div class="absolute inset-0 z-10 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ink-100 bg-white text-xs font-bold text-ink-400" role="status">
      <LoaderCircle size={15} class="animate-spin" />
      {signingIn ? 'Signing in with Google…' : 'Preparing Google sign-in…'}
    </div>
  {/if}
  {#if error}
    <p class="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold leading-relaxed text-rose-600" role="alert">{error}</p>
    {#if canRetry}
      <button type="button" class="btn-ghost mt-2 w-full justify-center text-xs" onclick={() => prepareButton()} disabled={preparing || signingIn}>
        Try Google sign-in again
      </button>
    {/if}
  {/if}
</div>
