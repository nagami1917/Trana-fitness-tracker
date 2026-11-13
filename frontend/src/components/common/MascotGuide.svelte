<script>
  import { tick } from 'svelte';
  import { ArrowLeft, ArrowRight, Check, Sparkles, X } from 'lucide-svelte';
  import { mascotTour, TOUR_STEPS } from '../../lib/mascotTour.svelte.js';
  import { profile, session } from '../../stores/index.js';
  import { route } from '../../lib/router.js';

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
    const vh = window.innerHeight || 800;
    return spotRect.top > vh * 0.45 && spotRect.top > 240;
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
    if (scroll && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
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
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
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

    const handleViewport = () => {
      if (!cancelled) measureTarget({ scroll: false });
    };

    window.addEventListener('resize', handleViewport);
    window.addEventListener('scroll', handleViewport, { passive: true });

    void tick().then(() => {
      if (cancelled) return;
      measureTarget({ scroll: false });
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
      <div class="fixed inset-0 flex items-center justify-center p-4">
        <div
          class="relative w-full max-w-md rounded-4xl border border-brand-200 bg-white/95 p-6 pt-16 text-center shadow-card backdrop-blur-md animate-pop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mascot-tour-title"
          aria-describedby="mascot-tour-body"
        >
          <button
            type="button"
            class="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-ink-400 transition hover:bg-brand-100 hover:text-brand-700"
            onclick={() => mascotTour.skip()}
            aria-label="Close guide"
          >
            <X size={16} />
          </button>

          <!-- Peeking cat mascot -->
          <div class="pointer-events-none absolute -top-14 left-1/2 -translate-x-1/2">
            <div class="grid h-28 w-28 place-items-center rounded-full bg-gradient-to-b from-brand-100 via-brand-50 to-white p-2 ring-4 ring-white shadow-card">
              <img src="/mascot-cat.png" alt="TRANA cat mascot" class="h-24 w-auto animate-float drop-shadow-sm" />
            </div>
          </div>

          <span class="pill">
            <Sparkles size={11} />
            {step.badge} · {mascotTour.stepIndex + 1}/{mascotTour.totalSteps}
          </span>

          <h2 id="mascot-tour-title" class="mt-3 font-display text-2xl font-extrabold leading-snug text-ink-900">
            {titleText}
          </h2>
          <p id="mascot-tour-body" class="mt-2.5 text-sm font-semibold leading-relaxed text-ink-500">
            {step.body}
          </p>

          {#if step.tip}
            <div class="mt-4 rounded-2xl border border-brand-100 bg-brand-50/75 px-3.5 py-2.5 text-xs font-semibold leading-relaxed text-brand-800">
              🐾 {step.tip}
            </div>
          {/if}

          <!-- Step dots -->
          <div class="mt-5 flex items-center justify-center gap-1.5" role="group" aria-label="Tour steps">
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

          <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
            {#if mascotTour.isFirst}
              <button type="button" class="btn-ghost" onclick={() => mascotTour.skip()}>
                Skip tour
              </button>
              <button type="button" class="btn-primary" onclick={() => mascotTour.next()}>
                {step.cta} <ArrowRight size={16} />
              </button>
            {:else}
              <button type="button" class="btn-ghost" onclick={() => mascotTour.prev()}>
                <ArrowLeft size={15} /> Back
              </button>
              <button type="button" class="btn-ghost" onclick={() => mascotTour.finish('/plan')}>
                Plan first workout
              </button>
              <button type="button" class="btn-primary" onclick={() => mascotTour.finish()}>
                <Check size={16} /> {step.cta}
              </button>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <div
        class="fixed left-4 right-4 z-[51] sm:left-auto sm:right-6 sm:w-[26rem] transition-all duration-300 {dockTop
          ? 'top-16 sm:top-20'
          : 'bottom-20 lg:bottom-6'}"
      >
        <div
          class="relative rounded-3xl border border-brand-200 bg-white/95 p-5 shadow-card backdrop-blur-md animate-pop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mascot-tour-title"
          aria-describedby="mascot-tour-body"
        >
          <div class="flex items-start gap-3.5">
            <div class="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 p-1.5 ring-2 ring-white shadow-soft">
              <img src="/mascot-cat.png" alt="TRANA cat mascot" class="h-12 w-auto animate-wiggle" />
            </div>

            <div class="min-w-0 flex-1 pr-7">
              <span class="pill">
                <Sparkles size={10} />
                {mascotTour.stepIndex + 1}/{mascotTour.totalSteps} · {step.badge}
              </span>
              <h2 id="mascot-tour-title" class="mt-1.5 font-display text-lg font-extrabold leading-snug text-ink-900">
                {titleText}
              </h2>
            </div>

            <button
              type="button"
              class="absolute right-3.5 top-3.5 grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-ink-400 transition hover:bg-brand-100 hover:text-brand-700"
              onclick={() => mascotTour.skip()}
              aria-label="Close guide"
            >
              <X size={15} />
            </button>
          </div>

          <p id="mascot-tour-body" class="mt-3 text-[13px] font-semibold leading-relaxed text-ink-500">
            {step.body}
          </p>

          {#if step.tip}
            <div class="mt-3 rounded-2xl border border-brand-100 bg-brand-50/75 px-3 py-2 text-[11px] font-semibold leading-relaxed text-brand-800">
              🐾 {step.tip}
            </div>
          {/if}

          <div class="mt-4 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1" role="group" aria-label="Tour steps">
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

            <div class="flex items-center gap-1.5">
              <button type="button" class="btn-ghost !px-3 !py-2 !text-xs" onclick={() => mascotTour.skip()}>
                Skip
              </button>
              {#if !mascotTour.isFirst}
                <button type="button" class="btn-ghost !px-3 !py-2 !text-xs" onclick={() => mascotTour.prev()}>
                  <ArrowLeft size={14} /> Back
                </button>
              {/if}
              <button type="button" class="btn-primary !px-3.5 !py-2 !text-xs" onclick={() => mascotTour.next()}>
                {step.cta} <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
