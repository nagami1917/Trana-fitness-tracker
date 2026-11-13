<script>
  import { tick } from 'svelte';
  import { ArrowLeft, ArrowRight, Check, Sparkles, X } from 'lucide-svelte';
  import { mascotTour, TOUR_STEPS } from '../../lib/mascotTour.svelte.js';
  import { profile, session } from '../../stores/index.js';
  import { route } from '../../lib/router.js';
  import { prefetchRoute } from '../../routes/index.js';

  let spotRect = $state(null);

  const firstName = $derived.by(() => {
    const raw = ($profile?.name || $session?.name || 'athlete').trim();
    return raw.split(/\s+/)[0] || 'athlete';
  });

  const step = $derived(mascotTour.currentStep);
  const titleText = $derived(
    typeof step?.title === 'function' ? step.title(firstName) : (step?.title ?? ''),
  );
  const dockTop = $derived.by(() => {
    if (!spotRect || step?.centered || typeof window === 'undefined') return false;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    const isNarrow = vw < 640;
    const spotBottom = spotRect.top + spotRect.height;
    if (spotRect.top > vh * 0.42 && spotRect.top > 200) return true;
    if (isNarrow && spotBottom > vh - 270 && spotRect.top > 180) return true;
    return false;
  });

  function measureTarget({ scroll = false } = {}) {
    if (!mascotTour.open || typeof document === 'undefined') {
      spotRect = null;
      return;
    }
    const sel = step?.selector;
    if (!sel) {
      spotRect = null;
      return;
    }
    const el = document.querySelector(sel);
    if (!el) {
      spotRect = null;
      return;
    }
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    if (scroll && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: vw < 640 ? 'start' : 'center', inline: 'nearest' });
      } catch {
        // Ignore in headless/minimal DOMs.
      }
    }
    const r = el.getBoundingClientRect?.();
    if (!r || r.width <= 0 || r.height <= 0) {
      spotRect = null;
      return;
    }
    const pad = 8;
    const top = Math.max(4, r.top - pad);
    const left = Math.max(4, r.left - pad);
    const right = Math.min(vw - 4, r.right + pad);
    const bottom = Math.min(vh - 4, r.bottom + pad);
    spotRect = {
      top,
      left,
      width: Math.max(24, right - left),
      height: Math.max(24, bottom - top),
    };
  }

  $effect(() => {
    const isOpen = mascotTour.open;
    const idx = mascotTour.stepIndex;
    const activeRoute = $route;
    void idx;
    void activeRoute;

    if (!isOpen || typeof window === 'undefined') {
      spotRect = null;
      return;
    }

    let cancelled = false;
    let firstTimer = null;
    let settleTimer = null;
    let rafId = null;
    let observer = null;

    const nextRoute = TOUR_STEPS[idx + 1]?.route;
    if (nextRoute && !globalThis.navigator?.connection?.saveData) {
      prefetchRoute(nextRoute);
    }

    const handleViewport = () => {
      if (!cancelled) measureTarget({ scroll: false });
    };

    window.addEventListener('resize', handleViewport);
    window.addEventListener('scroll', handleViewport, { passive: true });

    void tick().then(() => {
      if (cancelled) return;
      measureTarget({ scroll: false });
      if (!spotRect && step?.selector && typeof MutationObserver === 'function' && document.body) {
        observer = new MutationObserver(() => {
          if (cancelled) return;
          if (document.querySelector(step.selector)) {
            measureTarget({ scroll: true });
            observer?.disconnect();
            observer = null;
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(() => {
          if (!cancelled) measureTarget({ scroll: true });
        });
      }
      firstTimer = setTimeout(() => {
        if (!cancelled) measureTarget({ scroll: true });
      }, 90);
      settleTimer = setTimeout(() => {
        if (!cancelled) measureTarget({ scroll: false });
      }, 360);
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      clearTimeout(firstTimer);
      clearTimeout(settleTimer);
      if (rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewport);
      window.removeEventListener('scroll', handleViewport);
    };
  });

  function onKeydown(event) {
    if (!mascotTour.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      mascotTour.skip();
    } else if (event.key === 'ArrowRight' && !mascotTour.isLast) {
      event.preventDefault();
      mascotTour.next();
    } else if (event.key === 'ArrowLeft' && !mascotTour.isFirst) {
      event.preventDefault();
      mascotTour.prev();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if mascotTour.open}
  <div class="fixed inset-0 z-50" role="presentation">
    <!-- Dimmed backdrop (spotlight cutout when a visible target element is measured) -->
    {#if spotRect}
      <div
        class="pointer-events-none fixed rounded-3xl border-2 border-brand-400 transition-all duration-300"
        style="top:{spotRect.top}px;left:{spotRect.left}px;width:{spotRect.width}px;height:{spotRect.height}px;box-shadow:0 0 0 9999px rgba(63,35,51,0.48), 0 0 28px rgba(249,86,155,0.5);"
        aria-hidden="true"
      ></div>
    {:else}
      <div class="fixed inset-0 bg-ink-900/45 backdrop-blur-[2px]" aria-hidden="true"></div>
    {/if}

    <!-- Mascot dialogue card -->
    {#if step?.centered}
      <div class="fixed inset-0 flex overflow-y-auto p-3 pt-16 pb-6 sm:items-center sm:justify-center sm:p-4 sm:pt-20">
        <div
          class="relative m-auto w-full max-w-md rounded-4xl border border-brand-200 bg-white/95 p-5 pt-14 text-center shadow-card backdrop-blur-md animate-pop sm:p-6 sm:pt-16"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mascot-tour-title"
          aria-describedby="mascot-tour-body"
        >
          <button
            type="button"
            class="absolute right-3.5 top-3.5 grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-ink-400 transition hover:bg-brand-100 hover:text-brand-700 sm:right-4 sm:top-4"
            onclick={() => mascotTour.skip()}
            aria-label="Close guide"
          >
            <X size={16} />
          </button>

          <!-- Peeking cat mascot -->
          <div class="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 sm:-top-14">
            <div class="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-b from-brand-100 via-brand-50 to-white p-2 ring-4 ring-white shadow-card sm:h-28 sm:w-28">
              <img src="/mascot-cat.png" alt="TRANA cat mascot" class="h-20 w-auto animate-float drop-shadow-sm sm:h-24" />
            </div>
          </div>

          <span class="pill">
            <Sparkles size={11} />
            {step.badge} · {mascotTour.stepIndex + 1}/{mascotTour.totalSteps}
          </span>

          <h2 id="mascot-tour-title" class="mt-3 font-display text-xl font-extrabold leading-snug text-ink-900 sm:text-2xl">
            {titleText}
          </h2>
          <p id="mascot-tour-body" class="mt-2 text-[13px] font-semibold leading-relaxed text-ink-500 sm:mt-2.5 sm:text-sm">
            {step.body}
          </p>

          {#if step.tip}
            <div class="mt-3.5 rounded-2xl border border-brand-100 bg-brand-50/75 px-3.5 py-2.5 text-xs font-semibold leading-relaxed text-brand-800 sm:mt-4">
              🐾 {step.tip}
            </div>
          {/if}

          <!-- Step dots -->
          <div class="mt-4 flex items-center justify-center gap-1.5 sm:mt-5" role="group" aria-label="Tour steps">
            {#each TOUR_STEPS as s, i (s.id)}
              <button
                type="button"
                aria-label="Go to step {i + 1}: {s.badge}"
                aria-current={i === mascotTour.stepIndex ? 'step' : undefined}
                class="h-2 rounded-full transition-all {i === mascotTour.stepIndex
                  ? 'w-6 bg-brand-gradient'
                  : 'w-2 bg-brand-200 hover:bg-brand-300'}"
                onclick={() => mascotTour.goTo(i)}
              ></button>
            {/each}
          </div>

          <div class="mt-4 flex flex-col-reverse gap-2 sm:mt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
            {#if mascotTour.isFirst}
              <button type="button" class="btn-ghost w-full sm:w-auto" onclick={() => mascotTour.skip()}>
                Skip tour
              </button>
              <button type="button" class="btn-primary w-full sm:w-auto" onclick={() => mascotTour.next()}>
                {step.cta} <ArrowRight size={16} />
              </button>
            {:else}
              <button type="button" class="btn-ghost w-full sm:w-auto" onclick={() => mascotTour.prev()}>
                <ArrowLeft size={15} /> Back
              </button>
              <button type="button" class="btn-ghost w-full sm:w-auto" onclick={() => mascotTour.finish('/plan')}>
                Plan first workout
              </button>
              <button type="button" class="btn-primary w-full sm:w-auto" onclick={() => mascotTour.finish()}>
                <Check size={16} /> {step.cta}
              </button>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <div
        class="fixed left-3 right-3 z-[51] sm:left-auto sm:right-6 sm:w-[26rem] transition-all duration-300 {dockTop
          ? 'top-[4.25rem] sm:top-20'
          : 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-6'}"
      >
        <div
          class="relative max-h-[calc(100dvh-9.5rem)] overflow-y-auto rounded-3xl border border-brand-200 bg-white/95 p-4 shadow-card backdrop-blur-md animate-pop sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mascot-tour-title"
          aria-describedby="mascot-tour-body"
        >
          <div class="flex items-start gap-3">
            <div class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 p-1.5 ring-2 ring-white shadow-soft sm:h-16 sm:w-16">
              <img src="/mascot-cat.png" alt="TRANA cat mascot" class="h-10 w-auto animate-wiggle sm:h-12" />
            </div>

            <div class="min-w-0 flex-1 pr-7">
              <span class="pill">
                <Sparkles size={10} />
                {mascotTour.stepIndex + 1}/{mascotTour.totalSteps} · {step.badge}
              </span>
              <h2 id="mascot-tour-title" class="mt-1.5 font-display text-base font-extrabold leading-snug text-ink-900 sm:text-lg">
                {titleText}
              </h2>
            </div>

            <button
              type="button"
              class="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-ink-400 transition hover:bg-brand-100 hover:text-brand-700 sm:right-3.5 sm:top-3.5"
              onclick={() => mascotTour.skip()}
              aria-label="Close guide"
            >
              <X size={15} />
            </button>
          </div>

          <p id="mascot-tour-body" class="mt-2.5 text-[13px] font-semibold leading-relaxed text-ink-500 sm:mt-3">
            {step.body}
          </p>

          {#if step.tip}
            <div class="mt-2.5 rounded-2xl border border-brand-100 bg-brand-50/75 px-3 py-2 text-[11px] font-semibold leading-relaxed text-brand-800 sm:mt-3">
              🐾 {step.tip}
            </div>
          {/if}

          <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <div class="flex items-center justify-center gap-1.5 sm:justify-start" role="group" aria-label="Tour steps">
              {#each TOUR_STEPS as s, i (s.id)}
                <button
                  type="button"
                  aria-label="Go to step {i + 1}: {s.badge}"
                  aria-current={i === mascotTour.stepIndex ? 'step' : undefined}
                  class="h-1.5 rounded-full transition-all {i === mascotTour.stepIndex
                    ? 'w-5 bg-brand-gradient'
                    : 'w-1.5 bg-brand-200 hover:bg-brand-300'}"
                  onclick={() => mascotTour.goTo(i)}
                ></button>
              {/each}
            </div>

            <div class="flex flex-wrap items-center justify-end gap-1.5">
              <button type="button" class="btn-ghost !px-3 !py-2 !text-xs" onclick={() => mascotTour.skip()}>
                Skip
              </button>
              {#if !mascotTour.isFirst}
                <button type="button" class="btn-ghost !px-3 !py-2 !text-xs" onclick={() => mascotTour.prev()}>
                  <ArrowLeft size={14} /> Back
                </button>
              {/if}
              <button type="button" class="btn-primary flex-1 !px-3.5 !py-2 !text-xs sm:flex-initial" onclick={() => mascotTour.next()}>
                {step.cta} <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
