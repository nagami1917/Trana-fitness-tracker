<script>
  import { onMount } from 'svelte';
  import { api } from '../../services/client.js';
  import { loginAndContinue } from '../../stores/index.js';
  import { navigate as routerNavigate } from '../../lib/router.js';

  export let navigate = routerNavigate;
  export let initialMode = 'login';
  export let asModal = false;

  let mode = initialMode;
  let identifier = '';
  let password = '';
  let showPassword = false;
  let busy = false;
  let error = '';
  let fieldErrors = {};
  let email = '';
  let fullName = '';
  let username = '';
  let confirmPassword = '';
  let code = '';
  let expiresIn = 300;
  let resendIn = 60;
  let timer;
  let otpInputs = [];

  $: if (mode !== 'verify' && mode !== 'reset') clearInterval(timer);

  /**
   * Errors that have an obvious next step attach it here, e.g. "log in
   * instead". A list, because a failed password login has more than one
   * equally good route out: try Google, reset the password, or sign up.
   */
  let errorActions = [];

  /** Optional scannable detail under the message — long paragraphs are not. */
  let errorPoints = [];

  /** Reset everything the message box renders. Called on every fresh attempt
   *  and on every mode change, so no stale button survives into a new screen. */
  function clearMessages() {
    error = '';
    errorActions = [];
    errorPoints = [];
    fieldErrors = {};
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const status = url.searchParams.get('google');
      // Each backend outcome gets its own sentence. One catch-all message made
      // "wrong button", "expired session" and "Google is down" look identical.
      //
      // Rule for every line here: say which step failed and what to do next.
      // None of these codes can report on a password account's existence, so
      // none of them may hint that the athlete has or hasn't registered.
      const messages = {
        account_exists: 'You already have a TRANA account for this Google address — it was not created a second time. Use Log in instead, or sign in with your username or Gmail and password.',
        // This is the OAuth handshake failing, NOT an emailed sign-in link.
        // The old wording ("that sign-in link expired or was altered") sent
        // people hunting for a link that was never sent, and read like a
        // verdict on their account when it says nothing about it.
        session_expired: 'Google sign-in was interrupted before it finished, so nothing was changed on your account. This usually means the Google redirect took longer than 30 minutes or was opened in a different browser. Try "Log in with Google" again above — or just use your username or Gmail and password.',
        provider_error: 'Google could not confirm the sign-in just now. Google itself is usually back within a minute — try again, or use your password if you have one.',
        identity_conflict: 'That Google account is already linked to a different TRANA account. Sign in with the account you used before.',
        failed: 'Google sign-in could not be completed. Nothing was changed on your account — try again, or use your password.',
        cancelled: 'Google sign-in was cancelled. Nothing was changed on your account.',
        not_configured: 'Google sign-in is not configured on this deployment yet. Please use your password.',
        unverified_email: 'Google did not confirm that this address belongs to you, so TRANA did not use it. Choose a Google account whose email is verified, or use your password.',
        account_unavailable: 'This account cannot sign in right now. Please contact TRANA support.',
        account_not_found: 'This Google address is not linked to any TRANA account, so nothing was signed in. If you have not registered yet, use Create account. If you did register, log in with the username or Gmail and password you chose — a Google account is not created automatically.',
      };
      if (status) {
        error = messages[status] || messages.failed;
        // "Already exists" is not a failure: offer the way in rather than
        // leaving the athlete to work out which tab they needed.
        if (status === 'account_exists') errorActions = ['login'];
        url.searchParams.delete('google');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }
    return () => clearInterval(timer);
  });

  function startCountdown(seconds = 300, resendSeconds = 60) {
    clearInterval(timer);
    expiresIn = Math.max(0, Number(seconds) || 0);
    resendIn = Math.max(0, Number(resendSeconds) || 0);
    timer = setInterval(() => {
      if (expiresIn > 0) expiresIn -= 1;
      if (resendIn > 0) resendIn -= 1;
    }, 1000);
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function fieldError(key) {
    return fieldErrors?.[key]?.[0] || '';
  }

  function clearOtpInputs() {
    code = '';
    otpInputs.forEach((input) => {
      if (input) input.value = '';
    });
  }

  function applyApiError(err) {
    // Any fresh failure replaces the previous message's next steps; a stale
    // "Log in instead" button under a different error reads like a non-sequitur.
    errorActions = [];
    errorPoints = [];
    if (err?.status === 422) {
      fieldErrors = err.errors || {};
      error = Object.values(fieldErrors).flat()[0] || err.message;
    } else {
      error = err?.message || 'Something went wrong. Please try again.';
    }
  }

  /**
   * Unverified password login. Google sign-in is a complete substitute here:
   * the callback links the Google identity onto the existing password account
   * and marks the address verified, so the user keeps their password and data.
   * When delivery already failed we lead with that instead of the code screen.
   */
  function offerVerificationRoute(apiError) {
    // The login response is the only place that can say whether delivery
    // worked: it carries expires_in = 0 when the code could not be sent.
    // /auth/email/resend deliberately answers 202 either way so it cannot be
    // used to probe for accounts, so it must not be asked to settle this.
    if (Number(apiError?.expires_in ?? 0) === 0) {
      // No mail is going to arrive. Stay on the login screen, where the Google
      // button already is, rather than sending the user to a code screen that
      // cannot work.
      error = 'We could not email a verification code to that address. Use "Log in with Google" instead — it verifies the same email and keeps your account and password.';
      return;
    }

    mode = 'verify';
    startCountdown(apiError.expires_in ?? 300, apiError.resend_after ?? 0);
    error = 'Please verify your Gmail address before logging in. No code arrived? Signing in with Google verifies the same address.';
  }

  async function submitLogin() {
    clearMessages();
    busy = true;
    try {
      await loginAndContinue(identifier, password);
      navigate('/');
    } catch (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED') {
        email = err.email || identifier;
        // A verification code may be genuinely on its way, or this deployment
        // may have no working mailer at all — in which case the code screen is
        // a dead end and the only way in is Google, which proves the address
        // without TRANA sending anything. Offer both instead of guessing.
        // expires_in === 0 is the API's own signal that delivery failed.
        offerVerificationRoute(err);
        return;
      }
      // 401 is deliberately one sentence for every cause — unknown address,
      // wrong password, suspended account — because splitting them would let
      // anyone test which Gmail addresses are registered. The athlete is not
      // left stuck though: this is where "did I actually sign up?" gets
      // answered, by naming the three states an account can be in and the
      // route out of each. A registered-and-verified account signs in above,
      // so anyone reading this is in one of the other three.
      if (err?.status === 401) {
        // Deliberately not "those details did not match": a suspended account
        // also answers 401, and the details may have matched perfectly.
        error = 'That login did not go through. TRANA gives the same answer for every cause, so it cannot tell you which one this is — but you can:';
        errorPoints = [
          'You have not finished creating it — check your Gmail for a six-digit TRANA code, or use Create account.',
          'It was created with Google sign-in, so it has no password to type — use Log in with Google.',
          'It exists but the password is different — use Forgot password.',
        ];
        errorActions = ['google', 'forgot', 'signup'];
        return;
      }
      applyApiError(err);
    } finally {
      busy = false;
    }
  }

  async function submitSignup() {
    clearMessages();
    busy = true;
    try {
      const result = await api.auth.register({
        name: fullName,
        username,
        email,
        password,
        password_confirmation: confirmPassword,
      });
      email = result.email || email;
      mode = 'verify';
      startCountdown(result.expires_in ?? 300, result.resend_after ?? 60);
      setTimeout(() => otpInputs[0]?.focus(), 0);
    } catch (err) {
      if (err.code === 'EMAIL_VERIFICATION_UNAVAILABLE') {
        email = err.email || email;
        mode = 'verify';
        startCountdown(err.expires_in ?? 300, err.resend_after ?? 60);
        error = err.message;
      } else if (err.signupDisabled) {
        // The operator closed password signup (no working mailer yet).
        // Point at the paths that still work instead of a raw 403.
        error = err.message || 'Account creation is closed on this deployment. Continue with Google, or ask the TRANA operator.';
      } else {
        applyApiError(err);
      }
    } finally {
      busy = false;
    }
  }

  async function submitCode() {
    clearMessages();
    busy = true;
    try {
      await api.auth.verifyEmail({ email, code });
      mode = 'login';
      password = '';
      code = '';
      error = '';
      alert('Your account is verified. Log in with your username or Gmail and password.');
    } catch (err) {
      applyApiError(err);
      clearOtpInputs();
      otpInputs[0]?.focus();
    } finally {
      busy = false;
    }
  }

  async function resendCode() {
    clearMessages();
    busy = true;
    try {
      const result = await api.auth.resendVerification(email);
      startCountdown(result.expires_in ?? 300, result.resend_after ?? 60);
      clearOtpInputs();
      otpInputs[0]?.focus();
      error = result.message || 'If a resend was available, a fresh code has been sent.';
    } catch (err) {
      applyApiError(err);
      if (err.status === 429) resendIn = 60;
    } finally {
      busy = false;
    }
  }

  function onOtpInput(event, index) {
    const digit = event.currentTarget.value.replace(/\D/g, '').slice(-1);
    event.currentTarget.value = digit;
    const digits = otpInputs.map((input) => input?.value || '');
    digits[index] = digit;
    code = digits.join('');
    if (digit && index < 5) otpInputs[index + 1]?.focus();
    if (code.length === 6 && mode === 'verify') submitCode();
  }

  function onOtpKeydown(event, index) {
    if (event.key === 'Backspace' && !event.currentTarget.value && index > 0) otpInputs[index - 1]?.focus();
    if (event.key === 'ArrowLeft' && index > 0) otpInputs[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < 5) otpInputs[index + 1]?.focus();
  }

  function onOtpPaste(event) {
    const pasted = event.clipboardData?.getData('text')?.replace(/\D/g, '').slice(0, 6) || '';
    if (!pasted) return;
    event.preventDefault();
    otpInputs.forEach((input, index) => {
      if (input) input.value = pasted[index] || '';
    });
    code = pasted;
    otpInputs[Math.min(pasted.length, 5)]?.focus();
    if (pasted.length === 6 && mode === 'verify') submitCode();
  }

  async function requestPasswordReset() {
    clearMessages();
    busy = true;
    try {
      const result = await api.auth.forgotPassword(email);
      mode = 'reset';
      startCountdown(result.expires_in ?? 300, result.resend_after ?? 60);
      otpInputs[0]?.focus();
      error = result.message || 'If a verified account uses this Gmail address, a reset code has been sent.';
    } catch (err) {
      applyApiError(err);
    } finally {
      busy = false;
    }
  }

  async function submitPasswordReset() {
    clearMessages();
    busy = true;
    try {
      await api.auth.resetPassword({
        email,
        code,
        password,
        password_confirmation: confirmPassword,
      });
      mode = 'login';
      identifier = email;
      password = '';
      confirmPassword = '';
      code = '';
      alert('Password reset. You can now log in with your new password.');
    } catch (err) {
      applyApiError(err);
      clearOtpInputs();
      otpInputs[0]?.focus();
    } finally {
      busy = false;
    }
  }

  async function resendResetCode() {
    busy = true;
    clearMessages();
    try {
      const result = await api.auth.forgotPassword(email);
      startCountdown(result.expires_in ?? 300, result.resend_after ?? 60);
      clearOtpInputs();
      error = result.message || 'If a verified account uses this Gmail address and a resend was available, a fresh reset code has been sent.';
    } catch (err) {
      applyApiError(err);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{mode === 'signup' ? 'Create account' : mode === 'verify' ? 'Verify email' : mode === 'forgot' ? 'Reset password' : mode === 'reset' ? 'Choose new password' : 'Log in'} | TRANA</title>
  <meta name="description" content="Sign in or create a TRANA fitness account." />
</svelte:head>

<section class="auth-page" class:modal-auth-page={asModal}>
  <div class="auth-card">
    <a class="brand" href="/" on:click|preventDefault={() => navigate('/')}>TRANA<span>.</span></a>
    {#if mode === 'verify'}
      <div class="eyebrow">EMAIL VERIFICATION</div>
      <h1>Check your inbox</h1>
      <p class="subtitle">Enter the six-digit code sent to <strong>{email}</strong>. After verifying, sign in to set up your training profile.</p>
      <div class="code-meta"><span>Code expires in <strong>{formatTime(expiresIn)}</strong></span><span>5 attempts maximum</span></div>
      <form on:submit|preventDefault={submitCode}>
        <div class="otp-row" role="group" aria-label="Six-digit verification code">
          {#each Array(6) as _, index}
            <input
              bind:this={otpInputs[index]}
              type="text"
              inputmode="numeric"
              autocomplete={index === 0 ? 'one-time-code' : 'off'}
              maxlength="1"
              aria-label={`Digit ${index + 1}`}
              on:paste={onOtpPaste}
              on:input={(event) => onOtpInput(event, index)}
              on:keydown={(event) => onOtpKeydown(event, index)}
            />
          {/each}
        </div>
        <button class="primary-button" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify email'}</button>
      </form>
      <div class="resend-row">
        {#if resendIn > 0}<span>Resend code in {formatTime(resendIn)}</span>
        {:else}<button class="text-button" type="button" disabled={busy} on:click={resendCode}>Resend code</button>{/if}
        <button class="text-button" type="button" on:click={() => { mode = 'login'; clearMessages(); }}>Back to log in</button>
      </div>
      <div class="google-signin verify-google">
        <span class="verify-google-hint">No code arrived? Signing in with Google verifies <strong>{email}</strong> instead.</span>
        <a class="google-button" href={api.auth.googleRedirectUrl('login')}>
          <svg aria-hidden="true" viewBox="0 0 48 48" focusable="false">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.61 17.74 9.5 24 9.5Z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.25 5.48-4.73 7.18l7.63 5.92c4.45-4.11 7.18-10.17 7.18-17.57Z" />
            <path fill="#FBBC05" d="M10.54 28.59a14.4 14.4 0 0 1-.76-4.59c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.8 23.8 0 0 0 0 24c0 3.89.93 7.57 2.56 10.78l7.98-6.19Z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.78l-7.63-5.92c-2.12 1.42-4.84 2.25-8.27 2.25-6.27 0-11.58-4.11-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
          </svg>
          <span>Verify with Google instead</span>
        </a>
      </div>
    {:else if mode === 'forgot'}
      <div class="eyebrow">ACCOUNT RECOVERY</div>
      <h1>Forgot password?</h1>
      <p class="subtitle">We’ll email a one-time reset code to your verified Gmail address.</p>
      <form on:submit|preventDefault={requestPasswordReset}>
        <label for="reset-email">Gmail address</label>
        <input id="reset-email" bind:value={email} type="email" placeholder="you@gmail.com" autocomplete="email" required />
        {#if fieldError('email')}<small class="field-error">{fieldError('email')}</small>{/if}
        <button class="primary-button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}</button>
      </form>
      <button class="text-button back-link" type="button" on:click={() => { mode = 'login'; clearMessages(); }}>Back to log in</button>
    {:else if mode === 'reset'}
      <div class="eyebrow">ACCOUNT RECOVERY</div>
      <h1>Choose a new password</h1>
      <p class="subtitle">Enter the reset code sent to <strong>{email}</strong>.</p>
      <div class="code-meta"><span>Code expires in <strong>{formatTime(expiresIn)}</strong></span><span>5 attempts maximum</span></div>
      <form on:submit|preventDefault={submitPasswordReset}>
        <div class="otp-row" role="group" aria-label="Six-digit password reset code">
          {#each Array(6) as _, index}
            <input
              bind:this={otpInputs[index]}
              type="text"
              inputmode="numeric"
              autocomplete={index === 0 ? 'one-time-code' : 'off'}
              maxlength="1"
              aria-label={`Digit ${index + 1}`}
              on:paste={onOtpPaste}
              on:input={(event) => onOtpInput(event, index)}
              on:keydown={(event) => onOtpKeydown(event, index)}
            />
          {/each}
        </div>
        <label for="new-password">New password</label>
        <div class="password-wrap"><input id="new-password" bind:value={password} type={showPassword ? 'text' : 'password'} maxlength="72" autocomplete="new-password" required /><button type="button" aria-pressed={showPassword} on:click={() => showPassword = !showPassword}>{showPassword ? 'Hide' : 'Show'}</button></div>
        <label for="confirm-password">Confirm new password</label>
        <input id="confirm-password" bind:value={confirmPassword} type="password" maxlength="72" autocomplete="new-password" required />
        <p class="hint">At least 8 characters with one letter and one number; maximum 72 bytes.</p>
        {#if fieldError('code')}<small class="field-error">{fieldError('code')}</small>{/if}
        {#if fieldError('password')}<small class="field-error">{fieldError('password')}</small>{/if}
        <button class="primary-button" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Updating…' : 'Reset password'}</button>
      </form>
      <div class="resend-row">
        {#if resendIn > 0}<span>Resend code in {formatTime(resendIn)}</span>
        {:else}<button class="text-button" type="button" disabled={busy} on:click={resendResetCode}>Resend code</button>{/if}
      </div>
    {:else}
      <div class="eyebrow">YOUR TRAINING, IN FOCUS</div>
      <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
      <p class="subtitle">{mode === 'signup' ? 'Use Google for verified sign-in, or create an account with email and verify it by code. No payment details required.' : 'Sign in to continue your training journey.'}</p>
      <div class="tabs" role="tablist" aria-label="Account access">
        <button type="button" role="tab" aria-selected={mode === 'login'} class:active={mode === 'login'} on:click={() => { mode = 'login'; clearMessages(); }}>Log in</button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} class:active={mode === 'signup'} on:click={() => { mode = 'signup'; clearMessages(); }}>Create account</button>
      </div>
      <div class="google-signin">
        <a class="google-button" href={api.auth.googleRedirectUrl(mode)}>
          <svg aria-hidden="true" viewBox="0 0 48 48" focusable="false">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.61 17.74 9.5 24 9.5Z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.25 5.48-4.73 7.18l7.63 5.92c4.45-4.11 7.18-10.17 7.18-17.57Z" />
            <path fill="#FBBC05" d="M10.54 28.59a14.4 14.4 0 0 1-.76-4.59c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.8 23.8 0 0 0 0 24c0 3.89.93 7.57 2.56 10.78l7.98-6.19Z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.78l-7.63-5.92c-2.12 1.42-4.84 2.25-8.27 2.25-6.27 0-11.58-4.11-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
          </svg>
          <span>{mode === 'signup' ? 'Sign in with Google' : 'Log in with Google'}</span>
        </a>
        <p>Google verifies your email — no TRANA code needed.</p>
      </div>
      <div class="auth-divider"><span>{mode === 'signup' ? 'or create an account with email' : 'or sign in with email and password'}</span></div>
      {#if mode === 'signup'}
        <form on:submit|preventDefault={submitSignup}>
          <label for="full-name">Full name</label>
          <input id="full-name" bind:value={fullName} type="text" maxlength="80" autocomplete="name" required />
          {#if fieldError('name')}<small class="field-error">{fieldError('name')}</small>{/if}
          <label for="username">Username</label>
          <input id="username" bind:value={username} type="text" minlength="3" maxlength="20" autocomplete="username" required />
          <p class="hint">3–20 letters, numbers, or underscores.</p>
          {#if fieldError('username')}<small class="field-error">{fieldError('username')}</small>{/if}
          <label for="signup-email">Gmail address</label>
          <input id="signup-email" bind:value={email} type="email" placeholder="you@gmail.com" autocomplete="email" required />
          {#if fieldError('email')}<small class="field-error">{fieldError('email')}</small>{/if}
          <label for="signup-password">Password</label>
          <div class="password-wrap"><input id="signup-password" bind:value={password} type={showPassword ? 'text' : 'password'} maxlength="72" autocomplete="new-password" required /><button type="button" aria-pressed={showPassword} on:click={() => showPassword = !showPassword}>{showPassword ? 'Hide' : 'Show'}</button></div>
          <p class="hint">At least 8 characters with one letter and one number; maximum 72 bytes.</p>
          {#if fieldError('password')}<small class="field-error">{fieldError('password')}</small>{/if}
          <label for="signup-confirm">Confirm password</label>
          <input id="signup-confirm" bind:value={confirmPassword} type="password" maxlength="72" autocomplete="new-password" required />
          {#if fieldError('password_confirmation')}<small class="field-error">{fieldError('password_confirmation')}</small>{/if}
          <button class="primary-button" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        </form>
      {:else}
        <form on:submit|preventDefault={submitLogin}>
          <label for="identifier">Username or Gmail</label>
          <input id="identifier" bind:value={identifier} type="text" autocomplete="username" required />
          <label for="login-password">Password</label>
          <div class="password-wrap"><input id="login-password" bind:value={password} type={showPassword ? 'text' : 'password'} maxlength="72" autocomplete="current-password" required /><button type="button" aria-pressed={showPassword} on:click={() => showPassword = !showPassword}>{showPassword ? 'Hide' : 'Show'}</button></div>
          <button class="primary-button" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        </form>
        <button class="text-button forgot" type="button" on:click={() => { mode = 'forgot'; email = identifier.includes('@') ? identifier : ''; clearMessages(); }}>Forgot password?</button>
      {/if}
    {/if}
    {#if error}
      <div class:success-message={error.startsWith('If ')} class="form-message" role="alert">
        {error}
        {#if errorPoints.length}
          <ul class="message-points">
            {#each errorPoints as point}<li>{point}</li>{/each}
          </ul>
        {/if}
        {#each errorActions as action (action)}
          {#if action === 'login'}
            <button
              type="button"
              class="message-action"
              on:click={() => { mode = 'login'; clearMessages(); }}
            >Log in instead</button>
          {:else if action === 'google'}
            <a class="message-action" href={api.auth.googleRedirectUrl('login')}>Log in with Google</a>
          {:else if action === 'forgot'}
            <button
              type="button"
              class="message-action"
              on:click={() => { email = identifier.includes('@') ? identifier : ''; mode = 'forgot'; clearMessages(); }}
            >Forgot password?</button>
          {:else if action === 'signup'}
            <button
              type="button"
              class="message-action"
              on:click={() => { if (identifier.includes('@')) email = identifier; mode = 'signup'; clearMessages(); }}
            >Create account</button>
          {/if}
        {/each}
      </div>
    {/if}
    <p class="terms">By continuing, you agree to use TRANA responsibly and keep your account secure.</p>
  </div>
</section>

<style>
  /* Login is a standalone route, so it renders its own surface rather than
   * inheriting the app shell. These values mirror the token layer in app.css:
   * midnight-navy canvas, card-surface panels, electric-lime actions. */
  :global(body){margin:0;background:#101b2d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#ffffff}
  .auth-page{box-sizing:border-box;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:32px 16px;background:radial-gradient(ellipse at top left,rgba(183,243,74,.12) 0,transparent 45%),radial-gradient(ellipse at bottom right,rgba(95,212,232,.10) 0,transparent 50%),#101b2d}
  .auth-page.modal-auth-page{min-height:0;width:100%;padding:0;background:transparent;display:block}
  .auth-page.modal-auth-page .auth-card{width:100%;border:0;border-radius:22px;box-shadow:none}
  .auth-card{box-sizing:border-box;width:min(100%,470px);padding:38px 42px;background:#1a2940;border:1px solid #26374f;border-radius:22px;box-shadow:0 18px 60px rgba(0,0,0,.45)}
  .brand{display:inline-block;margin-bottom:32px;color:#ffffff;text-decoration:none;font-weight:900;font-size:24px;letter-spacing:.08em;font-family:"Space Grotesk",Inter,sans-serif}.brand span{color:#b7f34a}
  .eyebrow{color:#b7f34a;font-size:11px;font-weight:800;letter-spacing:.14em}h1{margin:8px 0;font-size:30px;letter-spacing:-.04em;color:#ffffff;font-family:"Space Grotesk",Inter,sans-serif}.subtitle{margin:0 0 24px;color:#a6b3c2;font-size:14px;line-height:1.55}.subtitle strong{color:#eaf2fb;overflow-wrap:anywhere}
  .tabs{display:grid;grid-template-columns:1fr 1fr;padding:4px;margin:0 0 18px;background:#16233a;border:1px solid #26374f;border-radius:12px}.tabs button{min-height:44px;border:0;background:transparent;padding:11px;color:#a6b3c2;font-weight:700;border-radius:9px;cursor:pointer}.tabs button.active{background:#1f3049;color:#b7f34a;box-shadow:0 2px 8px rgba(0,0,0,.35)}
  .form-message .message-action{margin-left:6px;padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:800;text-decoration:underline;cursor:pointer;display:inline}.form-message .message-points{margin:7px 0 2px;padding-left:17px;display:grid;gap:5px}.form-message .message-points li{padding-left:1px}
.google-signin{display:grid;gap:8px}.google-button{display:flex;align-items:center;justify-content:center;gap:12px;min-height:48px;box-sizing:border-box;padding:10px 16px;border:1px solid #2a3d57;border-radius:10px;background:#1f3049;color:#ffffff;text-decoration:none;font-size:14px;font-weight:750;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:background .15s,border-color .15s,box-shadow .15s}.google-button:hover{background:#26374f;border-color:#3a5175;box-shadow:0 2px 7px rgba(0,0,0,.4)}.google-button:focus-visible{outline:3px solid rgba(183,243,74,.55);outline-offset:2px}.google-button svg{width:20px;height:20px;flex:none}.google-signin p{margin:0;color:#8b9bb0;font-size:11px;text-align:center}.auth-divider{display:flex;align-items:center;gap:12px;margin:18px 0 10px;color:#8b9bb0;font-size:10px}.auth-divider::before,.auth-divider::after{content:"";height:1px;flex:1;background:#26374f}.verify-google{margin-top:18px;padding-top:16px;border-top:1px solid #26374f}.verify-google-hint{max-width:34ch;justify-self:center;color:#8b9bb0;font-size:11px;line-height:1.5;text-align:center}
  form{display:flex;flex-direction:column;gap:9px}label{font-size:13px;font-weight:700;color:#d3deea;margin-top:6px}input{width:100%;min-height:44px;box-sizing:border-box;padding:12px 13px;border:1px solid #2a3d57;border-radius:10px;background:#1f3049;color:#ffffff;font:inherit;outline:none}input::placeholder{color:#6b7c93}input:focus{border-color:#b7f34a;box-shadow:0 0 0 3px rgba(183,243,74,.18)}.hint{margin:-4px 0 3px;color:#8b9bb0;font-size:11px}.field-error{display:block;color:#ffb7c1;font-size:12px;margin-top:-4px}
  .password-wrap{position:relative}.password-wrap input{padding-right:62px}.password-wrap button{position:absolute;right:9px;top:50%;min-width:44px;min-height:44px;transform:translateY(-50%);border:0;background:transparent;color:#b7f34a;font-size:12px;font-weight:700;cursor:pointer}
  .primary-button{width:100%;min-height:44px;margin-top:14px;padding:13px 16px;border:0;border-radius:10px;background:#b7f34a;color:#101b2d;font-size:14px;font-weight:800;cursor:pointer;transition:background .15s,transform .15s}.primary-button:hover:not(:disabled){background:#c9f96f;transform:translateY(-1px)}.primary-button:disabled{opacity:.58;cursor:wait}
  .text-button{border:0;background:transparent;color:#b7f34a;font-weight:700;font-size:12px;cursor:pointer;padding:4px}.text-button:disabled{opacity:.5;cursor:wait}.forgot{display:block;margin:13px 0 0 auto}.back-link{margin-top:12px}
  .form-message{margin-top:15px;padding:11px 12px;border:1px solid rgba(244,63,94,.34);background:rgba(244,63,94,.12);border-radius:9px;color:#ffb7c1;font-size:12px;line-height:1.45}.form-message.success-message{border-color:rgba(69,199,138,.38);background:rgba(69,199,138,.12);color:#45c78a}
  .terms{margin:22px 0 0;color:#8b9bb0;font-size:10px;line-height:1.5;text-align:center}.code-meta{display:flex;justify-content:space-between;gap:12px;color:#8b9bb0;font-size:11px;margin:-10px 0 16px}.code-meta strong{color:#b7f34a}.otp-row{display:flex;gap:8px;justify-content:space-between;margin:2px 0 10px}.otp-row input{width:calc((100% - 40px)/6);height:54px;padding:0;text-align:center;font-size:22px;font-weight:800}.resend-row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:13px;color:#8b9bb0;font-size:11px}.resend-row button:disabled{opacity:.5}
  @media(max-width:520px){.auth-card{padding:28px 22px}.auth-page{padding:18px 12px}h1{font-size:27px}.otp-row{gap:6px}.otp-row input{height:48px;font-size:19px}.code-meta{font-size:10px}.forgot{min-height:44px;padding:10px 8px;margin-top:6px}}

</style>
