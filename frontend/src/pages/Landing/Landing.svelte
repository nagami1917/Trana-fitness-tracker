<script>
  import {
    Activity,
    ArrowRight,
    ArrowUpRight,
    Compass,
    Droplets,
    Menu,
    Route,
    Sparkles,
    Timer,
    TrendingUp,
    Wheat,
    X,
  } from 'lucide-svelte';
  import Footer from '../../components/common/Footer.svelte';
  import Logo from '../../components/common/Logo.svelte';
  import { getCachedViewComponent, loadViewComponent } from '../../routes/index.js';
  import { link, navigate as routerNavigate } from '../../lib/router.js';

  let menuOpen = $state(false);
  let authModalOpen = $state(false);
  let authModalMode = $state('login');
  let AuthComponent = $state(null);
  let authLoadError = $state(false);
  let authLoadSequence = 0;
  let authCloseButton = $state(null);
  let focusBeforeAuthModal = null;

  function closeMenu() {
    menuOpen = false;
  }

  function openAuthModal(mode, event) {
    event?.preventDefault();
    closeMenu();
    focusBeforeAuthModal = document.activeElement;
    authModalMode = mode;
    authModalOpen = true;
    authLoadError = false;

    const cached = getCachedViewComponent('login');
    if (cached) {
      AuthComponent = cached;
      return;
    }

    AuthComponent = null;
    const sequence = ++authLoadSequence;
    loadViewComponent('login')
      .then((component) => {
        if (sequence === authLoadSequence && authModalOpen) AuthComponent = component;
      })
      .catch(() => {
        if (sequence === authLoadSequence && authModalOpen) authLoadError = true;
      });
  }

  function closeAuthModal() {
    authModalOpen = false;
    authLoadSequence += 1;
  }

  function navigateFromAuth(path) {
    closeAuthModal();
    routerNavigate(path);
  }

  function handleAuthKeydown(event) {
    if (!authModalOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAuthModal();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = document.getElementById('landing-auth-dialog');
    const focusable = dialog?.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (!authModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleAuthKeydown);
    const focusTimer = window.setTimeout(() => authCloseButton?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleAuthKeydown);
      window.clearTimeout(focusTimer);
      const target = focusBeforeAuthModal;
      if (target?.isConnected && typeof target.focus === 'function') {
        window.setTimeout(() => target.focus(), 0);
      }
    };
  });
</script>

<svelte:head>
  <title>TRANA — Train smarter. Feel stronger.</title>
  <meta
    name="description"
    content="Plan routes, track workouts, and get personalized fueling guidance with TRANA — your training, all in one place."
  />
  <meta name="theme-color" content="#fffaf8" />
</svelte:head>

<div class="landing-page">
  <header class="landing-header">
    <div class="landing-nav">
      <Logo size={42} />

      <nav class="desktop-links" aria-label="Main navigation">
        <a href="#features">Features</a>
        <a href="#how-it-works">How it works</a>
        <a href="/preview" use:link>Interactive preview</a>
      </nav>

      <div class="nav-actions">
        <a href="/login" class="sign-in-link" onclick={(event) => openAuthModal('login', event)}>Sign in</a>
        <a href="/register" class="nav-cta" onclick={(event) => openAuthModal('signup', event)}>
          Get started <ArrowRight size={15} aria-hidden="true" />
        </a>
        <button
          type="button"
          class="menu-toggle"
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-nav"
          onclick={() => (menuOpen = !menuOpen)}
        >
          {#if menuOpen}<X size={21} aria-hidden="true" />{:else}<Menu size={21} aria-hidden="true" />{/if}
        </button>
      </div>
    </div>

    {#if menuOpen}
      <nav id="landing-mobile-nav" class="mobile-links" aria-label="Mobile navigation">
        <a href="#features" onclick={closeMenu}>Features</a>
        <a href="#how-it-works" onclick={closeMenu}>How it works</a>
        <a href="/preview" use:link onclick={closeMenu}>Interactive preview</a>
        <a href="/login" onclick={(event) => openAuthModal('login', event)}>Sign in</a>
      </nav>
    {/if}
  </header>

  <main>
    <section class="hero" aria-labelledby="landing-title">
      <img
        class="hero-photo"
        src="/images/trana-landing-hero.jpg"
        alt="Two runners sharing a morning trail through green hills"
        fetchpriority="high"
        decoding="async"
      />
      <div class="hero-shade" aria-hidden="true"></div>

      <div class="hero-content">
        <div class="hero-copy">
          <p class="hero-kicker"><span></span> YOUR TRAINING, IN TUNE WITH YOU</p>
          <h1 id="landing-title">Train smarter.<br /><em>Feel stronger.</em></h1>
          <p class="hero-description">
            Plan a route, track the effort, and know what to fuel with. TRANA brings your whole training session together in one simple place.
          </p>

          <div class="hero-actions">
            <a href="/register" class="hero-primary" onclick={(event) => openAuthModal('signup', event)}>
              Start for free <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a href="/preview" use:link class="hero-secondary">
              <span><ArrowRight size={14} aria-hidden="true" /></span>
              <span class="hero-secondary-copy">
                <strong>Try the interactive preview</strong>
                <small>No account required</small>
              </span>
            </a>
          </div>

          <div class="hero-points" aria-label="TRANA highlights">
            <span><Activity size={15} aria-hidden="true" /> Run, ride, walk, hike</span>
            <span><Sparkles size={15} aria-hidden="true" /> Smart fueling estimates</span>
          </div>
        </div>

        <aside class="session-card" aria-label="Example TRANA session forecast">
          <div class="session-card-top">
            <div>
              <p class="card-eyebrow">A SAMPLE SESSION</p>
              <h2>Ridge loop</h2>
            </div>
            <span class="sample-tag">EXAMPLE</span>
          </div>

          <div class="mini-map" aria-hidden="true">
            <svg viewBox="0 0 420 132" role="presentation" preserveAspectRatio="none">
              <path class="map-line" d="M-8 100 C36 84 53 35 91 48 S143 113 187 82 237 26 275 43 320 102 356 76 389 41 430 52" />
              <path class="route-line" d="M-8 100 C36 84 53 35 91 48 S143 113 187 82 237 26 275 43 320 102 356 76 389 41 430 52" />
              <circle cx="91" cy="48" r="5" class="route-pin" />
              <circle cx="356" cy="76" r="5" class="route-pin route-pin-end" />
            </svg>
            <span class="map-label map-start">START</span>
            <span class="map-label map-end">10 KM LOOP</span>
          </div>

          <div class="session-stats">
            <div>
              <span><Timer size={13} aria-hidden="true" /> Finish window</span>
              <strong>58–64 <small>min</small></strong>
            </div>
            <div>
              <span><Route size={13} aria-hidden="true" /> Distance</span>
              <strong>10.0 <small>km</small></strong>
            </div>
          </div>

          <div class="fuel-note">
            <span class="fuel-icon"><Wheat size={17} aria-hidden="true" /></span>
            <div>
              <span>Fueling guide</span>
              <strong>Carbs, fluids &amp; sodium</strong>
            </div>
            <ArrowUpRight size={16} aria-hidden="true" />
          </div>
          <a href="/preview" use:link class="preview-link">
            Try the interactive preview <ArrowRight size={14} aria-hidden="true" />
          </a>
        </aside>
      </div>

      <div class="hero-caption"><span></span> Made for the miles that matter.</div>
    </section>

    <section class="training-loop" aria-label="The TRANA training loop">
      <div><span class="loop-icon"><Compass size={19} aria-hidden="true" /></span><span><strong>Plan</strong><small>Map your next move</small></span></div>
      <span class="loop-arrow" aria-hidden="true">→</span>
      <div><span class="loop-icon"><Activity size={19} aria-hidden="true" /></span><span><strong>Track</strong><small>Capture the effort</small></span></div>
      <span class="loop-arrow" aria-hidden="true">→</span>
      <div><span class="loop-icon"><Wheat size={19} aria-hidden="true" /></span><span><strong>Fuel</strong><small>Support your session</small></span></div>
      <span class="loop-arrow" aria-hidden="true">→</span>
      <div><span class="loop-icon"><TrendingUp size={19} aria-hidden="true" /></span><span><strong>Improve</strong><small>See your progress</small></span></div>
    </section>

    <section id="features" class="features-section" aria-labelledby="features-title">
      <div class="section-heading">
        <p class="section-kicker">LESS GUESSWORK. MORE GOOD MILES.</p>
        <h2 id="features-title">Everything your next session needs.</h2>
        <p>From the first route idea to the progress you make over time, your tools work together.</p>
      </div>

      <div class="feature-grid">
        <article class="feature-card feature-route">
          <div class="feature-heading">
            <span class="feature-icon icon-pink"><Compass size={19} aria-hidden="true" /></span>
            <span class="feature-number">01 / PLAN</span>
          </div>
          <h3>Find a route worth taking.</h3>
          <p>Plan a run, ride, walk, or hike. See a finish-time estimate and save the route for later.</p>
          <div class="feature-map" aria-hidden="true">
            <div class="map-street street-a"></div>
            <div class="map-street street-b"></div>
            <div class="map-street street-c"></div>
            <svg viewBox="0 0 320 130" preserveAspectRatio="none">
              <path d="M18 105 C60 101 56 38 109 48 S151 95 190 77 217 27 253 43 276 104 310 65" />
              <circle cx="18" cy="105" r="5" /><circle cx="310" cy="65" r="5" />
            </svg>
            <span class="map-chip">10.0 km · 180 m climb</span>
          </div>
        </article>

        <article class="feature-card feature-track">
          <div class="feature-heading">
            <span class="feature-icon icon-orange"><Activity size={19} aria-hidden="true" /></span>
            <span class="feature-number">02 / TRACK</span>
          </div>
          <h3>Stay in the moment.</h3>
          <p>Record GPS workouts live, watch your stats update, and keep your activity history together.</p>
          <div class="tracker-visual" aria-label="Example live workout stats">
            <div class="tracker-top"><span><i></i> GPS RECORDING</span><span>00:32:18</span></div>
            <div class="tracker-value">5.42 <small>km</small></div>
            <div class="tracker-bottom"><span><strong>5:58</strong><small> /km pace</small></span><span><strong>143</strong><small> bpm</small></span><span><strong>312</strong><small> kcal</small></span></div>
            <svg viewBox="0 0 320 48" aria-hidden="true"><path d="M0 34 C22 33 18 17 42 21 S69 40 91 26 117 5 140 18 167 39 190 24 216 8 238 19 270 40 290 19 309 10 320 14" /></svg>
          </div>
        </article>

        <article class="feature-card feature-fuel">
          <div class="feature-heading">
            <span class="feature-icon icon-green"><Droplets size={19} aria-hidden="true" /></span>
            <span class="feature-number">03 / FUEL</span>
          </div>
          <h3>Know what to bring.</h3>
          <p>Get personalized carbohydrate, hydration, and sodium guidance shaped around your workout.</p>
          <div class="fuel-visual" aria-label="Example fueling recommendations">
            <div><span><Wheat size={15} aria-hidden="true" /> Carbs</span><strong>30 <small>g / hour</small></strong><i><b style="width: 62%"></b></i></div>
            <div><span><Droplets size={15} aria-hidden="true" /> Fluids</span><strong>600 <small>ml / hour</small></strong><i><b style="width: 76%"></b></i></div>
            <div><span><Sparkles size={15} aria-hidden="true" /> Sodium</span><strong>550 <small>mg / hour</small></strong><i><b style="width: 49%"></b></i></div>
            <p>Example estimate · Adjust to your own needs</p>
          </div>
        </article>

        <article class="feature-card feature-progress">
          <div class="progress-copy">
            <div class="feature-heading">
              <span class="feature-icon icon-lilac"><TrendingUp size={19} aria-hidden="true" /></span>
              <span class="feature-number">04 / IMPROVE</span>
            </div>
            <h3>Make progress visible.</h3>
            <p>See activity trends, keep an eye on your goals, and understand how your training is adding up.</p>
            <a href="/register" class="text-link" onclick={(event) => openAuthModal('signup', event)}>Build your training history <ArrowRight size={15} aria-hidden="true" /></a>
          </div>
          <div class="progress-visual" aria-label="Illustrative weekly training progress">
            <div class="progress-visual-top"><span>THIS WEEK</span><strong>Training minutes <small>↗</small></strong></div>
            <div class="chart-labels"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
            <svg viewBox="0 0 430 150" preserveAspectRatio="none" aria-hidden="true">
              <defs><linearGradient id="landing-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ec4899" stop-opacity=".24" /><stop offset="1" stop-color="#ec4899" stop-opacity="0" /></linearGradient></defs>
              <path class="chart-area" d="M0 122 C38 115 45 95 86 101 S130 124 173 81 218 90 256 67 298 88 342 49 386 61 430 20 V150 H0 Z" />
              <path class="chart-line" d="M0 122 C38 115 45 95 86 101 S130 124 173 81 218 90 256 67 298 88 342 49 386 61 430 20" />
              <circle cx="430" cy="20" r="5" />
            </svg>
            <div class="goal-row"><span>Weekly goal</span><strong>4 of 5 sessions</strong></div>
          </div>
        </article>
      </div>
    </section>

    <section id="how-it-works" class="how-section" aria-labelledby="how-title">
      <div class="how-heading">
        <p class="section-kicker">A SIMPLE RHYTHM</p>
        <h2 id="how-title">Plan. Move. Learn.</h2>
        <p>TRANA connects the pieces, so you can spend less time juggling apps and more time doing what you love.</p>
      </div>
      <div class="steps-grid">
        <article><span class="step-index">01</span><div><h3>Start with a plan</h3><p>Choose your activity and route. Get a realistic time window and a useful fueling estimate.</p></div></article>
        <article><span class="step-index">02</span><div><h3>Move your way</h3><p>Track live with GPS or add a workout after. Your sessions stay organized in one logbook.</p></div></article>
        <article><span class="step-index">03</span><div><h3>See what’s changing</h3><p>Review your training trends, check your goals, and use the insights to shape what comes next.</p></div></article>
      </div>
    </section>

    <section class="closing-section" aria-labelledby="closing-title">
      <div class="closing-card">
        <div class="closing-copy">
          <p class="section-kicker">YOUR NEXT MOVE STARTS HERE</p>
          <h2 id="closing-title">Make the miles<br />feel like they’re going somewhere.</h2>
          <p>Create your free account and bring your routes, workouts, fueling, and progress together.</p>
          <div class="closing-actions">
            <a href="/register" class="hero-primary" onclick={(event) => openAuthModal('signup', event)}>Create your account <ArrowRight size={16} aria-hidden="true" /></a>
            <a href="/preview" use:link class="closing-preview">Try the interactive preview</a>
          </div>
        </div>
        <div class="closing-mascot" aria-hidden="true">
          <div class="mascot-glow"></div>
          <img src="/mascot-cat.png" alt="" loading="lazy" />
          <span><Sparkles size={16} aria-hidden="true" /> Let’s go!</span>
        </div>
      </div>
    </section>
  </main>

  <Footer />
</div>

{#if authModalOpen}
  <div class="auth-overlay">
    <button type="button" class="auth-backdrop" aria-label="Close authentication dialog" onclick={closeAuthModal}></button>
    <div id="landing-auth-dialog" class="auth-dialog" role="dialog" aria-modal="true" aria-label="TRANA sign in or create account">
      <button bind:this={authCloseButton} type="button" class="auth-dialog-close" aria-label="Close dialog" onclick={closeAuthModal}>
        <X size={19} aria-hidden="true" />
      </button>
      {#if AuthComponent}
        <AuthComponent navigate={navigateFromAuth} initialMode={authModalMode} asModal={true} />
      {:else if authLoadError}
        <div class="auth-load-message" role="alert">
          <strong>Could not open account access.</strong>
          <p>Please try again.</p>
          <button type="button" onclick={(event) => openAuthModal(authModalMode, event)}>Retry</button>
        </div>
      {:else}
        <div class="auth-load-message" role="status" aria-live="polite">
          <span class="auth-loading-bar" aria-hidden="true"></span>
          <p>Opening your TRANA account…</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .auth-overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px; overflow-y: auto; background: rgba(18, 30, 24, .62); backdrop-filter: blur(6px); animation: auth-overlay-in .18s ease-out both; }
  .auth-backdrop { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; cursor: default; }
  .auth-dialog { position: relative; z-index: 1; width: min(100%, 470px); max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; border-radius: 22px; background: white; box-shadow: 0 30px 100px rgba(10, 25, 18, .34); }
  .auth-dialog-close { position: absolute; top: 9px; right: 9px; z-index: 2; display: grid; width: 36px; height: 36px; place-items: center; border: 1px solid #e7ede9; border-radius: 12px; background: rgba(255,255,255,.96); color: #576a5f; cursor: pointer; transition: background .15s ease, color .15s ease; }
  .auth-dialog-close:hover { background: #f0f7f3; color: #14754e; }
  .auth-load-message { display: grid; min-height: 270px; align-content: center; justify-items: center; gap: 9px; padding: 28px; color: #34483d; text-align: center; }
  .auth-load-message p { margin: 0; color: #718077; font-size: 13px; }
  .auth-load-message button { margin-top: 5px; padding: 9px 16px; border: 0; border-radius: 999px; background: #16845a; color: white; font-size: 12px; font-weight: 800; cursor: pointer; }
  .auth-loading-bar { width: 76px; height: 5px; overflow: hidden; border-radius: 999px; background: #d9eee3; }
  .auth-loading-bar::after { display: block; width: 42%; height: 100%; border-radius: inherit; background: #16845a; content: ''; animation: auth-loading 1s ease-in-out infinite alternate; }
  @keyframes auth-overlay-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes auth-loading { from { transform: translateX(0); } to { transform: translateX(140%); } }
  @media (prefers-reduced-motion: reduce) { .auth-overlay, .auth-loading-bar::after { animation: none; } }

  .landing-page { min-height: 100vh; overflow: hidden; background: #fffaf8; color: #3f2333; }
  .landing-header { position: sticky; top: 0; z-index: 40; border-bottom: 1px solid rgba(231, 211, 221, .72); background: rgba(255, 255, 255, .9); backdrop-filter: blur(16px); }
  .landing-nav { display: flex; align-items: center; justify-content: space-between; gap: 24px; width: min(100% - 40px, 1280px); min-height: 76px; margin: 0 auto; }
  .desktop-links { display: flex; align-items: center; gap: clamp(18px, 3vw, 38px); margin-left: auto; margin-right: clamp(12px, 3vw, 40px); }
  .desktop-links a, .sign-in-link { color: #684b5d; font-size: 13px; font-weight: 800; text-decoration: none; transition: color .18s ease; }
  .desktop-links a:hover, .sign-in-link:hover { color: #db2777; }
  .nav-actions { display: flex; align-items: center; gap: 16px; }
  .nav-cta, .hero-primary { display: inline-flex; align-items: center; justify-content: center; gap: 9px; border-radius: 999px; background: linear-gradient(135deg, #ec4899, #be185d); color: white; font-weight: 900; text-decoration: none; box-shadow: 0 12px 28px -10px rgba(219, 39, 119, .48); transition: transform .18s ease, box-shadow .18s ease, filter .18s ease; }
  .nav-cta { padding: 12px 19px; font-size: 12px; }
  .nav-cta:hover, .hero-primary:hover { transform: translateY(-2px); box-shadow: 0 15px 30px -10px rgba(219, 39, 119, .58); filter: saturate(1.08); }
  .menu-toggle, .mobile-links { display: none; }

  .hero { position: relative; display: flex; min-height: min(690px, calc(100svh - 92px)); align-items: center; margin: 18px auto 0; width: min(calc(100% - 36px), 1480px); overflow: hidden; border-radius: 32px; background: #382b36; isolation: isolate; }
  .hero-photo, .hero-shade { position: absolute; inset: 0; width: 100%; height: 100%; }
  .hero-photo { z-index: -2; object-fit: cover; object-position: center 48%; }
  .hero-shade { z-index: -1; background: linear-gradient(90deg, rgba(30, 20, 29, .86) 0%, rgba(30, 20, 29, .68) 38%, rgba(30, 20, 29, .34) 69%, rgba(30, 20, 29, .18) 100%); }
  .hero-content { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(305px, .72fr); align-items: center; gap: clamp(28px, 5vw, 72px); width: min(100%, 1280px); margin: 0 auto; padding: clamp(42px, 7vw, 92px) clamp(28px, 6vw, 84px); }
  .hero-copy { max-width: 610px; color: white; }
  .hero-kicker, .section-kicker { display: flex; align-items: center; gap: 9px; margin: 0; color: #ffe1ef; font-size: 10px; font-weight: 900; letter-spacing: .17em; }
  .hero-kicker span, .hero-caption span { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%; background: #ff86bd; box-shadow: 0 0 0 5px rgba(249, 86, 155, .18); }
  .hero h1 { max-width: 650px; margin: 23px 0 17px; color: white; font-family: Poppins, Quicksand, ui-sans-serif, system-ui, sans-serif; font-size: clamp(3.2rem, 6.7vw, 6.1rem); font-weight: 900; letter-spacing: -.075em; line-height: .98; }
  .hero h1 em { color: #ffb3d4; font-style: normal; }
  .hero-description { max-width: 525px; margin: 0; color: rgba(255, 255, 255, .82); font-size: clamp(14px, 1.35vw, 17px); font-weight: 600; line-height: 1.72; }
  .hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 13px 20px; margin-top: 29px; }
  .hero-primary { min-height: 52px; padding: 0 23px; font-size: 13px; }
  .hero-secondary { display: inline-flex; align-items: center; gap: 10px; color: white; font-size: 12px; font-weight: 800; text-decoration: none; }
  .hero-secondary > span:first-child { display: grid; width: 30px; height: 30px; flex: 0 0 30px; place-items: center; border: 1px solid rgba(255,255,255,.42); border-radius: 50%; transition: background .18s ease; }
  .hero-secondary-copy { display: grid; gap: 2px; }
  .hero-secondary-copy strong { font-size: 12px; font-weight: 800; }
  .hero-secondary-copy small { color: rgba(255,255,255,.74); font-size: 10px; font-weight: 600; }
  .hero-secondary:hover > span:first-child { background: rgba(255,255,255,.18); }
  .hero-points { display: flex; flex-wrap: wrap; gap: 14px 22px; margin-top: 27px; color: rgba(255,255,255,.8); font-size: 11px; font-weight: 800; }
  .hero-points span { display: inline-flex; align-items: center; gap: 7px; }
  .hero-points :global(svg) { color: #ffb3d4; }

  .session-card { width: 100%; max-width: 392px; justify-self: end; padding: 22px; border: 1px solid rgba(255,255,255,.8); border-radius: 25px; background: rgba(255, 255, 255, .94); box-shadow: 0 24px 65px rgba(26, 12, 23, .25); backdrop-filter: blur(18px); }
  .session-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .card-eyebrow { margin: 0; color: #9a7788; font-size: 9px; font-weight: 900; letter-spacing: .16em; }
  .session-card h2 { margin: 6px 0 0; color: #3f2333; font-family: Poppins, Quicksand, ui-sans-serif, system-ui, sans-serif; font-size: 20px; font-weight: 900; letter-spacing: -.04em; }
  .sample-tag { padding: 6px 8px; border: 1px solid #f5d7e5; border-radius: 999px; background: #fff5f9; color: #a92b68; font-size: 8px; font-weight: 900; letter-spacing: .1em; }
  .mini-map { position: relative; height: 112px; margin-top: 15px; overflow: hidden; border: 1px solid #e9e3e6; border-radius: 15px; background-color: #f4f5ec; background-image: linear-gradient(rgba(255,255,255,.38) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.38) 1px, transparent 1px), radial-gradient(ellipse at 18% 28%, #dbe8d2 0 10%, transparent 38%), radial-gradient(ellipse at 80% 75%, #dce9d4 0 14%, transparent 42%); background-size: 26px 26px, 26px 26px, auto, auto; }
  .mini-map svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .map-line { fill: none; stroke: rgba(255,255,255,.9); stroke-width: 11; stroke-linecap: round; }
  .route-line { fill: none; stroke: #e83e91; stroke-width: 5; stroke-linecap: round; stroke-dasharray: 500; animation: draw-route 1.2s ease-out both; }
  .route-pin { fill: #fff; stroke: #db2777; stroke-width: 4; }
  .route-pin-end { fill: #db2777; }
  .map-label { position: absolute; bottom: 10px; color: #684b5d; font-size: 8px; font-weight: 900; letter-spacing: .1em; }
  .map-start { left: 12px; }
  .map-end { right: 12px; }
  .session-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 14px; }
  .session-stats > div { padding: 11px 12px; border: 1px solid #f1e8ed; border-radius: 13px; background: #fff; }
  .session-stats span { display: flex; align-items: center; gap: 5px; color: #8b7080; font-size: 9px; font-weight: 800; }
  .session-stats span :global(svg) { color: #db2777; }
  .session-stats strong { display: block; margin-top: 5px; color: #3f2333; font-family: Poppins, Quicksand, ui-sans-serif, system-ui, sans-serif; font-size: 19px; font-weight: 900; letter-spacing: -.05em; }
  .session-stats small { color: #8b7080; font-family: inherit; font-size: 10px; font-weight: 800; letter-spacing: 0; }
  .fuel-note { display: flex; align-items: center; gap: 10px; margin-top: 11px; padding: 11px 12px; border-radius: 14px; background: #fff5f9; }
  .fuel-icon { display: grid; width: 34px; height: 34px; flex: 0 0 34px; place-items: center; border-radius: 11px; background: white; color: #db2777; }
  .fuel-note div { display: grid; gap: 3px; flex: 1; }
  .fuel-note div span { color: #97798a; font-size: 9px; font-weight: 800; }
  .fuel-note div strong { color: #4d2e40; font-size: 11px; font-weight: 900; }
  .fuel-note > :global(svg) { color: #db2777; }
  .preview-link { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 13px; color: #b52068; font-size: 10px; font-weight: 900; text-decoration: none; }
  .preview-link:hover { color: #7e1648; }
  .hero-caption { position: absolute; right: clamp(24px, 5vw, 70px); bottom: 19px; display: flex; align-items: center; gap: 9px; color: rgba(255,255,255,.74); font-size: 9px; font-weight: 800; letter-spacing: .06em; }
  .hero-caption span { width: 5px; height: 5px; flex-basis: 5px; }

  .training-loop { display: flex; align-items: center; justify-content: center; gap: clamp(12px, 3vw, 38px); width: min(calc(100% - 44px), 1100px); margin: 0 auto; padding: 30px 12px 21px; border-bottom: 1px solid #f0e5eb; }
  .training-loop > div { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .loop-icon { display: grid; width: 41px; height: 41px; flex: 0 0 41px; place-items: center; border: 1px solid #f6dce8; border-radius: 14px; background: white; color: #cf2879; box-shadow: 0 8px 20px -16px rgba(190,24,93,.6); }
  .training-loop strong, .training-loop small { display: block; }
  .training-loop strong { color: #4b3041; font-size: 12px; font-weight: 900; }
  .training-loop small { margin-top: 2px; color: #91788a; font-size: 9px; font-weight: 700; }
  .loop-arrow { color: #c8aaba; font-size: 19px; }

  .features-section, .how-section, .closing-section { width: min(calc(100% - 44px), 1180px); margin: 0 auto; }
  .features-section { padding: 93px 0 80px; }
  .section-heading { max-width: 650px; margin: 0 auto 38px; text-align: center; }
  .section-kicker { justify-content: center; color: #be2873; font-size: 9px; }
  .section-heading h2, .how-heading h2 { margin: 12px 0 10px; color: #3f2333; font-family: Poppins, Quicksand, ui-sans-serif, system-ui, sans-serif; font-size: clamp(2rem, 4vw, 3.1rem); font-weight: 900; letter-spacing: -.06em; line-height: 1.1; }
  .section-heading > p:last-child, .how-heading > p:last-child { margin: 0; color: #755263; font-size: 14px; font-weight: 600; line-height: 1.7; }
  .feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 17px; }
  .feature-card { min-width: 0; overflow: hidden; padding: 21px; border: 1px solid #f1e5eb; border-radius: 23px; background: white; box-shadow: 0 14px 36px -29px rgba(91, 38, 67, .45); transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
  .feature-card:hover { transform: translateY(-4px); border-color: #f0c8dc; box-shadow: 0 22px 45px -32px rgba(91, 38, 67, .55); }
  .feature-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .feature-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 14px; }
  .icon-pink { background: #fff0f7; color: #c02b75; }
  .icon-orange { background: #fff4e9; color: #c76b1d; }
  .icon-green { background: #eef8f0; color: #378756; }
  .icon-lilac { background: #f3f0ff; color: #7561c7; }
  .feature-number { color: #a88c9d; font-size: 8px; font-weight: 900; letter-spacing: .15em; }
  .feature-card h3 { margin: 20px 0 8px; color: #492f40; font-family: Poppins, Quicksand, ui-sans-serif, system-ui, sans-serif; font-size: 18px; font-weight: 900; letter-spacing: -.04em; line-height: 1.25; }
  .feature-card > p, .progress-copy > p { min-height: 61px; margin: 0; color: #806779; font-size: 11px; font-weight: 600; line-height: 1.7; }
  .feature-map { position: relative; height: 150px; margin: 20px -5px -4px; overflow: hidden; border: 1px solid #edf0e7; border-radius: 17px; background-color: #f4f5ec; background-image: linear-gradient(rgba(255,255,255,.65) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.65) 1px, transparent 1px), radial-gradient(ellipse at 25% 50%, #dce9d6 0 14%, transparent 35%), radial-gradient(ellipse at 80% 25%, #e6ecd9 0 12%, transparent 34%); background-size: 25px 25px, 25px 25px, auto, auto; }
  .feature-map::before, .feature-map::after { position: absolute; content: ''; border: 2px solid rgba(255,255,255,.75); border-radius: 50%; transform: rotate(-25deg); }
  .feature-map::before { width: 210px; height: 80px; top: 15px; left: -55px; }
  .feature-map::after { width: 240px; height: 100px; top: 41px; right: -85px; }
  .map-street { position: absolute; z-index: 1; width: 130%; height: 2px; background: rgba(255,255,255,.85); transform: rotate(-28deg); }
  .street-a { top: 46px; left: -10%; }
  .street-b { top: 93px; left: -8%; transform: rotate(21deg); }
  .street-c { top: 110px; left: 5%; transform: rotate(-8deg); }
  .feature-map svg { position: absolute; z-index: 2; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .feature-map svg path { fill: none; stroke: #ed4599; stroke-width: 5; stroke-linecap: round; }
  .feature-map svg circle { fill: white; stroke: #d5297c; stroke-width: 4; }
  .map-chip { position: absolute; z-index: 3; right: 9px; bottom: 9px; padding: 6px 9px; border: 1px solid rgba(255,255,255,.85); border-radius: 999px; background: rgba(255,255,255,.9); color: #6c5262; font-size: 8px; font-weight: 900; }
  .tracker-visual { margin-top: 20px; padding: 15px; border-radius: 17px; background: linear-gradient(145deg, #fff4f9, #f7eff4); }
  .tracker-top { display: flex; align-items: center; justify-content: space-between; color: #8e7182; font-size: 8px; font-weight: 900; letter-spacing: .07em; }
  .tracker-top span:first-child { display: flex; align-items: center; gap: 6px; }
  .tracker-top i { width: 6px; height: 6px; border-radius: 50%; background: #ee4b7b; box-shadow: 0 0 0 4px rgba(238,75,123,.13); }
  .tracker-value { margin-top: 10px; color: #492f40; font-family: Poppins, Quicksand, ui-sans-serif, system-ui, sans-serif; font-size: 39px; font-weight: 900; letter-spacing: -.07em; line-height: 1; }
  .tracker-value small { color: #9b7b8e; font-size: 14px; letter-spacing: 0; }
  .tracker-bottom { display: flex; justify-content: space-between; gap: 7px; margin-top: 12px; }
  .tracker-bottom span { display: flex; align-items: baseline; gap: 2px; }
  .tracker-bottom strong { color: #6a4c5d; font-size: 10px; font-weight: 900; }
  .tracker-bottom small { color: #a18a98; font-size: 8px; font-weight: 700; }
  .tracker-visual > svg { display: block; width: 100%; height: 35px; margin-top: 12px; overflow: visible; }
  .tracker-visual > svg path { fill: none; stroke: #db2777; stroke-width: 3; stroke-linecap: round; }
  .fuel-visual { display: grid; gap: 12px; margin-top: 20px; padding: 15px; border: 1px solid #edf0e9; border-radius: 17px; background: #fbfcf8; }
  .fuel-visual > div { display: grid; grid-template-columns: 1fr auto; gap: 5px 9px; }
  .fuel-visual span { display: flex; align-items: center; gap: 6px; color: #7b6675; font-size: 9px; font-weight: 800; }
  .fuel-visual span :global(svg) { color: #6eae78; }
  .fuel-visual strong { color: #46554a; font-size: 10px; font-weight: 900; }
  .fuel-visual strong small { color: #8b9b8f; font-size: 8px; }
  .fuel-visual i { grid-column: 1 / -1; height: 5px; overflow: hidden; border-radius: 999px; background: #e6eee4; }
  .fuel-visual i b { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #8cc895, #55a86b); }
  .fuel-visual > p { margin: -3px 0 0; color: #a1afa2; font-size: 8px; font-weight: 700; }
  .feature-progress { display: grid; grid-column: 1 / -1; grid-template-columns: minmax(0, .85fr) minmax(300px, 1.15fr); align-items: center; gap: 28px; padding: 24px; }
  .feature-progress h3 { margin-top: 19px; }
  .feature-progress .progress-copy > p { max-width: 390px; min-height: unset; }
  .text-link { display: inline-flex; align-items: center; gap: 7px; margin-top: 17px; color: #b52269; font-size: 10px; font-weight: 900; text-decoration: none; }
  .text-link:hover { color: #7e1648; }
  .progress-visual { min-width: 0; padding: 17px 17px 12px; border: 1px solid #f0e7ee; border-radius: 18px; background: linear-gradient(145deg, #fffafe, #fbf7fa); }
  .progress-visual-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .progress-visual-top span { color: #a38b9b; font-size: 8px; font-weight: 900; letter-spacing: .13em; }
  .progress-visual-top strong { color: #624b5b; font-size: 10px; font-weight: 900; }
  .progress-visual-top small { color: #57a86a; font-size: 12px; }
  .chart-labels { display: flex; justify-content: space-between; margin-top: 19px; color: #b19daa; font-size: 7px; font-weight: 800; }
  .progress-visual > svg { display: block; width: 100%; height: 115px; margin-top: 4px; overflow: visible; }
  .chart-area { fill: url(#landing-chart-fill); }
  .chart-line { fill: none; stroke: #dc398b; stroke-width: 3; stroke-linecap: round; }
  .progress-visual > svg circle { fill: white; stroke: #db2777; stroke-width: 3; }
  .goal-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 10px; border-top: 1px solid #f0e7ee; color: #9a8292; font-size: 8px; font-weight: 800; }
  .goal-row strong { color: #5f4658; font-size: 9px; font-weight: 900; }

  .how-section { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 55px; align-items: start; padding: 30px 0 88px; }
  .how-heading .section-kicker { justify-content: flex-start; }
  .how-heading h2 { margin-top: 11px; }
  .how-heading > p:last-child { max-width: 370px; }
  .steps-grid { display: grid; gap: 0; }
  .steps-grid article { display: grid; grid-template-columns: 44px 1fr; gap: 15px; padding: 17px 0; border-bottom: 1px solid #efe2e9; }
  .steps-grid article:first-child { padding-top: 4px; }
  .steps-grid article:last-child { border-bottom: 0; }
  .step-index { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 12px; background: white; color: #c12b73; font-family: Poppins, Quicksand, ui-sans-serif, system-ui, sans-serif; font-size: 11px; font-weight: 900; box-shadow: 0 6px 16px -12px rgba(190,24,93,.6); }
  .steps-grid h3 { margin: 0; color: #4a3041; font-family: Poppins, Quicksand, ui-sans-serif, system-ui, sans-serif; font-size: 13px; font-weight: 900; }
  .steps-grid p { margin: 5px 0 0; color: #816879; font-size: 10px; font-weight: 600; line-height: 1.7; }

  .closing-section { padding: 0 0 86px; }
  .closing-card { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 30px; min-height: 300px; overflow: hidden; padding: 42px clamp(26px, 6vw, 72px); border-radius: 28px; background: linear-gradient(115deg, #40283a, #66334f 67%, #8b3d69); color: white; }
  .closing-card::after { position: absolute; top: -130px; right: 20%; width: 460px; height: 460px; border: 1px solid rgba(255,255,255,.09); border-radius: 50%; box-shadow: 0 0 0 42px rgba(255,255,255,.035), 0 0 0 85px rgba(255,255,255,.025); content: ''; }
  .closing-copy { position: relative; z-index: 1; max-width: 650px; }
  .closing-copy .section-kicker { justify-content: flex-start; color: #ffc7df; }
  .closing-copy h2 { margin: 15px 0 12px; color: white; font-family: Poppins, Quicksand, ui-sans-serif, system-ui, sans-serif; font-size: clamp(2rem, 4vw, 3.2rem); font-weight: 900; letter-spacing: -.065em; line-height: 1.06; }
  .closing-copy > p:not(.section-kicker) { max-width: 510px; margin: 0; color: rgba(255,255,255,.75); font-size: 12px; font-weight: 600; line-height: 1.7; }
  .closing-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 22px; }
  .closing-actions .hero-primary { min-height: 47px; padding: 0 20px; font-size: 11px; }
  .closing-preview { color: white; font-size: 10px; font-weight: 800; text-decoration: underline; text-decoration-color: rgba(255,255,255,.45); text-underline-offset: 4px; }
  .closing-preview:hover { text-decoration-color: white; }
  .closing-mascot { position: relative; z-index: 1; display: grid; width: 210px; flex: 0 0 210px; justify-items: center; align-self: end; margin-bottom: -60px; }
  .mascot-glow { position: absolute; top: 29px; width: 170px; height: 170px; border-radius: 50%; background: rgba(255,255,255,.12); filter: blur(2px); }
  .closing-mascot img { position: relative; width: 170px; height: 170px; object-fit: contain; animation: gentle-float 4s ease-in-out infinite; }
  .closing-mascot > span { position: absolute; top: 12px; right: -12px; display: flex; align-items: center; gap: 5px; padding: 8px 11px; border-radius: 999px; background: white; color: #8b2458; font-size: 9px; font-weight: 900; box-shadow: 0 10px 24px rgba(26,12,23,.15); }

  @keyframes draw-route { from { stroke-dashoffset: 500; } to { stroke-dashoffset: 0; } }
  @keyframes gentle-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }

  @media (max-width: 900px) {
    .hero { min-height: unset; }
    .hero-content { grid-template-columns: minmax(0, 1fr) minmax(280px, .8fr); gap: 24px; padding: 62px 34px; }
    .hero h1 { font-size: clamp(3rem, 6vw, 4.7rem); }
    .hero-shade { background: linear-gradient(90deg, rgba(30, 20, 29, .85) 0%, rgba(30, 20, 29, .69) 50%, rgba(30, 20, 29, .36) 100%); }
    .feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .feature-progress { grid-column: 1 / -1; }
    .how-section { gap: 35px; }
  }
  @media (max-width: 700px) {
    .landing-nav { width: calc(100% - 28px); min-height: 68px; gap: 12px; }
    .desktop-links { display: none; }
    .nav-actions { gap: 10px; margin-left: auto; }
    .menu-toggle { display: grid; width: 40px; height: 40px; place-items: center; border: 1px solid #f0e2ea; border-radius: 13px; background: white; color: #593a4e; }
    .mobile-links { display: grid; gap: 2px; padding: 8px 14px 15px; border-top: 1px solid #f4e9ef; background: white; }
    .mobile-links a { padding: 11px 9px; border-radius: 10px; color: #684b5d; font-size: 12px; font-weight: 800; text-decoration: none; }
    .mobile-links a:hover { background: #fff3f8; color: #b52269; }
    .hero { width: calc(100% - 20px); margin-top: 10px; min-height: unset; border-radius: 24px; }
    .hero-photo { object-position: 67% center; }
    .hero-shade { background: linear-gradient(180deg, rgba(30, 20, 29, .7) 0%, rgba(30,20,29,.75) 45%, rgba(30,20,29,.87) 100%); }
    .hero-content { grid-template-columns: 1fr; gap: 28px; padding: 46px 22px 56px; }
    .hero h1 { margin-top: 18px; font-size: clamp(3rem, 13vw, 4.5rem); }
    .hero-description { font-size: 13px; }
    .session-card { max-width: 430px; justify-self: stretch; margin-left: auto; }
    .hero-caption { right: 23px; bottom: 16px; font-size: 8px; }
    .training-loop { width: calc(100% - 24px); justify-content: flex-start; gap: 13px; overflow-x: auto; padding: 21px 4px 17px; scrollbar-width: none; }
    .training-loop::-webkit-scrollbar { display: none; }
    .training-loop > div { min-width: max-content; gap: 7px; }
    .loop-icon { width: 34px; height: 34px; flex-basis: 34px; border-radius: 11px; }
    .training-loop strong { font-size: 10px; }
    .training-loop small { font-size: 8px; }
    .loop-arrow { font-size: 14px; }
    .features-section, .how-section, .closing-section { width: calc(100% - 30px); }
    .features-section { padding: 66px 0 58px; }
    .section-heading { margin-bottom: 26px; text-align: left; }
    .section-heading .section-kicker { justify-content: flex-start; }
    .section-heading h2, .how-heading h2 { font-size: clamp(1.9rem, 9vw, 2.6rem); }
    .feature-grid { grid-template-columns: 1fr; gap: 12px; }
    .feature-card { padding: 19px; }
    .feature-progress { grid-column: auto; grid-template-columns: 1fr; gap: 20px; padding: 20px; }
    .feature-progress > .progress-copy > p { min-height: unset; }
    .feature-map { height: 138px; }
    .how-section { grid-template-columns: 1fr; gap: 22px; padding: 10px 0 62px; }
    .closing-section { padding-bottom: 60px; }
    .closing-card { min-height: 0; padding: 31px 23px; border-radius: 23px; }
    .closing-mascot { position: absolute; right: -20px; bottom: -70px; width: 145px; margin: 0; opacity: .2; }
    .closing-mascot img { width: 145px; height: 145px; }
    .closing-mascot > span { display: none; }
    .closing-copy { max-width: 100%; }
    .closing-copy h2 { font-size: clamp(1.85rem, 8vw, 2.4rem); }
    .closing-copy > p:not(.section-kicker) { max-width: 420px; }
    .closing-actions { position: relative; z-index: 2; }
  }
  @media (max-width: 420px) {
    .sign-in-link { font-size: 11px; }
    .nav-cta { padding: 10px 12px; font-size: 10px; }
    .nav-cta :global(svg) { width: 13px; }
    .hero-content { padding-right: 17px; padding-left: 17px; }
    .hero-points { gap: 9px 14px; font-size: 9px; }
    .session-card { padding: 17px; border-radius: 21px; }
    .session-card h2 { font-size: 18px; }
    .session-stats strong { font-size: 17px; }
    .closing-actions { align-items: flex-start; flex-direction: column; }
  }
</style>
