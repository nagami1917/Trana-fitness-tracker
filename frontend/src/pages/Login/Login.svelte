<script>
  import { onMount } from 'svelte';
  import { api } from '../../services/client.js';
  import { loginAndContinue } from '../../stores/index.js';
  import { navigate as routerNavigate } from '../../lib/router.js';

  export let navigate = routerNavigate;
  export let initialMode = 'login';

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

  onMount(() => {
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
    if (err?.status === 422) {
      fieldErrors = err.errors || {};
      error = Object.values(fieldErrors).flat()[0] || err.message;
    } else {
      error = err?.message || 'Something went wrong. Please try again.';
    }
  }

  async function submitLogin() {
    error = '';
    fieldErrors = {};
    busy = true;
    try {
      await loginAndContinue(identifier, password);
      navigate('/');
    } catch (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED') {
        email = err.email || identifier;
        mode = 'verify';
        startCountdown(err.expires_in ?? 300, err.resend_after ?? 0);
        error = 'Please verify your Gmail address before logging in.';
        return;
      }
      applyApiError(err);
    } finally {
      busy = false;
    }
  }

  async function submitSignup() {
    error = '';
    fieldErrors = {};
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
      } else {
        applyApiError(err);
      }
    } finally {
      busy = false;
    }
  }

  async function submitCode() {
    error = '';
    fieldErrors = {};
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
    error = '';
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
    error = '';
    fieldErrors = {};
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
    error = '';
    fieldErrors = {};
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
    error = '';
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

<section class="auth-page">
  <div class="auth-card">
    <a class="brand" href="/" on:click|preventDefault={() => navigate('/')}>TRANA<span>.</span></a>
    {#if mode === 'verify'}
      <div class="eyebrow">EMAIL VERIFICATION</div>
      <h1>Check your inbox</h1>
      <p class="subtitle">Enter the six-digit code sent to <strong>{email}</strong>.</p>
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
        <button class="text-button" type="button" on:click={() => { mode = 'login'; error = ''; }}>Back to log in</button>
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
      <button class="text-button back-link" type="button" on:click={() => { mode = 'login'; error = ''; }}>Back to log in</button>
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
      <p class="subtitle">{mode === 'signup' ? 'Build a training plan that moves with you.' : 'Sign in to continue your training journey.'}</p>
      <div class="tabs" role="tablist" aria-label="Account access">
        <button type="button" role="tab" aria-selected={mode === 'login'} class:active={mode === 'login'} on:click={() => { mode = 'login'; error = ''; fieldErrors = {}; }}>Log in</button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} class:active={mode === 'signup'} on:click={() => { mode = 'signup'; error = ''; fieldErrors = {}; }}>Create account</button>
      </div>
      {#if mode === 'signup'}
        <form on:submit|preventDefault={submitSignup}>
          <label for="full-name">Full name</label>
          <input id="full-name" bind:value={fullName} type="text" maxlength="80" autocomplete="name" required />
          {#if fieldError('name')}<small class="field-error">{fieldError('name')}</small>{/if}
          <label for="username">Username</label>
          <input id="username" bind:value={username} type="text" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autocomplete="username" required />
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
        <button class="text-button forgot" type="button" on:click={() => { mode = 'forgot'; email = identifier.includes('@') ? identifier : ''; error = ''; }}>Forgot password?</button>
      {/if}
    {/if}
    {#if error}<div class:success-message={error.startsWith('If ')} class="form-message" role="alert">{error}</div>{/if}
    <p class="terms">By continuing, you agree to use TRANA responsibly and keep your account secure.</p>
  </div>
</section>

<style>
  :global(body){margin:0;background:#f5f7f4;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17251f}
  .auth-page{min-height:100vh;display:grid;place-items:center;padding:32px 16px;background:radial-gradient(ellipse at top left,#dff3e9 0,transparent 45%),#f5f7f4}
  .auth-card{box-sizing:border-box;width:min(100%,470px);padding:38px 42px;background:#fff;border:1px solid #e7ede9;border-radius:22px;box-shadow:0 18px 60px #193b2b12}
  .brand{display:inline-block;margin-bottom:32px;color:#14251e;text-decoration:none;font-weight:900;font-size:24px;letter-spacing:.08em}.brand span{color:#23a26d}
  .eyebrow{color:#16845a;font-size:11px;font-weight:800;letter-spacing:.14em}h1{margin:8px 0;font-size:30px;letter-spacing:-.04em}.subtitle{margin:0 0 24px;color:#68766f;font-size:14px;line-height:1.55}.subtitle strong{color:#24382e;overflow-wrap:anywhere}
  .tabs{display:grid;grid-template-columns:1fr 1fr;padding:4px;margin:0 0 22px;background:#f0f4f1;border-radius:12px}.tabs button{border:0;background:transparent;padding:11px;color:#65736b;font-weight:700;border-radius:9px;cursor:pointer}.tabs button.active{background:#fff;color:#14754e;box-shadow:0 2px 8px #193b2b12}
  form{display:flex;flex-direction:column;gap:9px}label{font-size:13px;font-weight:700;color:#34483d;margin-top:6px}input{width:100%;box-sizing:border-box;padding:12px 13px;border:1px solid #dbe4de;border-radius:10px;background:#fff;color:#17251f;font:inherit;outline:none}input:focus{border-color:#27a572;box-shadow:0 0 0 3px #27a5721f}.hint{margin:-4px 0 3px;color:#7a8880;font-size:11px}.field-error{display:block;color:#bb3939;font-size:12px;margin-top:-4px}
  .password-wrap{position:relative}.password-wrap input{padding-right:62px}.password-wrap button{position:absolute;right:9px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#19805a;font-size:12px;font-weight:700;cursor:pointer}
  .primary-button{width:100%;margin-top:14px;padding:13px 16px;border:0;border-radius:10px;background:#16845a;color:#fff;font-size:14px;font-weight:800;cursor:pointer;transition:background .15s,transform .15s}.primary-button:hover:not(:disabled){background:#106c49;transform:translateY(-1px)}.primary-button:disabled{opacity:.58;cursor:wait}
  .text-button{border:0;background:transparent;color:#16845a;font-weight:700;font-size:12px;cursor:pointer;padding:4px}.text-button:disabled{opacity:.5;cursor:wait}.forgot{display:block;margin:13px 0 0 auto}.back-link{margin-top:12px}
  .form-message{margin-top:15px;padding:11px 12px;border:1px solid #f1cccc;background:#fff5f5;border-radius:9px;color:#a63a3a;font-size:12px;line-height:1.45}.form-message.success-message{border-color:#cce9d9;background:#f2fbf6;color:#23724b}
  .terms{margin:22px 0 0;color:#89958d;font-size:10px;line-height:1.5;text-align:center}.code-meta{display:flex;justify-content:space-between;gap:12px;color:#718077;font-size:11px;margin:-10px 0 16px}.code-meta strong{color:#208057}.otp-row{display:flex;gap:8px;justify-content:space-between;margin:2px 0 10px}.otp-row input{width:calc((100% - 40px)/6);height:54px;padding:0;text-align:center;font-size:22px;font-weight:800}.resend-row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:13px;color:#7a8880;font-size:11px}.resend-row button:disabled{opacity:.5}
  @media(max-width:520px){.auth-card{padding:28px 22px}.auth-page{padding:18px 12px}h1{font-size:27px}.otp-row{gap:6px}.otp-row input{height:48px;font-size:19px}.code-meta{font-size:10px}}
</style>
