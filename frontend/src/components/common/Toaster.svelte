<script>
  import { Check, Info, TriangleAlert, RotateCcw, X } from 'lucide-svelte';
  import { toast, dismissToast } from '../../stores/index.js';

  const TONES = {
    success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: Check },
    error: { cls: 'border-rose-200 bg-rose-50 text-rose-800', Icon: TriangleAlert },
    info: { cls: 'border-sky-200 bg-sky-50 text-sky-800', Icon: Info },
  };

  let undoing = $state(false);

  async function handleUndo() {
    if (!$toast?.onUndo || undoing) return;
    undoing = true;
    const fn = $toast.onUndo;
    dismissToast();
    try {
      await fn();
    } finally {
      undoing = false;
    }
  }
</script>

{#if $toast}
  {@const tone = TONES[$toast.tone] ?? TONES.info}
  <div class="pointer-events-none fixed inset-x-0 bottom-24 z-[1300] flex justify-center px-4 sm:bottom-8">
    <div
      role="status"
      aria-live="polite"
      class="pointer-events-auto flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-bold shadow-card animate-slide-up {tone.cls}"
    >
      <tone.Icon size={17} class="shrink-0" />
      <span class="min-w-0">{$toast.message}</span>
      {#if $toast.onUndo}
        <button
          type="button"
          class="ml-1 inline-flex shrink-0 items-center gap-1 rounded-xl border border-current/25 bg-white/80 px-2.5 py-1 text-xs font-extrabold transition hover:bg-white"
          disabled={undoing}
          onclick={handleUndo}
        >
          <RotateCcw size={12} /> {$toast.undoLabel}
        </button>
      {/if}
      <button
        type="button"
        class="ml-0.5 rounded-lg p-1 opacity-70 transition hover:opacity-100"
        aria-label="Dismiss notification"
        onclick={dismissToast}
      >
        <X size={14} />
      </button>
    </div>
  </div>
{/if}
