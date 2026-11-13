<script>
  import { Play, Pause, Square, RotateCcw } from 'lucide-svelte';

  let {
    tracking = false,
    paused = false,
    saving = false,
    onStart = () => {},
    onPause = () => {},
    onResume = () => {},
    onStop = () => {},
    onDiscard = () => {},
  } = $props();
</script>

<div class="w-full {tracking ? 'grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-3' : 'flex flex-wrap items-center justify-center gap-3'}">
  {#if !tracking}
    <button
      type="button"
      class="inline-flex w-full min-h-[46px] touch-manipulation items-center justify-center gap-2 rounded-2xl px-7 py-3.5 border border-transparent bg-brand-gradient text-white text-sm font-bold shadow-glow hover:scale-[1.01] transition active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer sm:w-auto"
      onclick={onStart}
      disabled={saving}
    >
      <Play size={18} strokeWidth={2.4} />
      <span>Start activity</span>
    </button>
  {:else}
    {#if paused}
      <button
        type="button"
        class="inline-flex min-h-[44px] touch-manipulation items-center justify-center gap-2 rounded-2xl px-5 py-3 border border-transparent bg-brand-gradient text-white text-sm font-bold shadow-glow hover:scale-[1.01] transition active:scale-95 disabled:opacity-60 cursor-pointer"
        onclick={onResume}
        disabled={saving}
      >
        <Play size={17} strokeWidth={2.4} />
        <span>Resume</span>
      </button>
    {:else}
      <button
        type="button"
        class="btn-ghost min-h-[44px] px-5 py-3 shadow-sm cursor-pointer"
        onclick={onPause}
        disabled={saving}
      >
        <Pause size={17} strokeWidth={2.4} />
        <span>Pause</span>
      </button>
    {/if}

    <button
      type="button"
      class="inline-flex min-h-[44px] touch-manipulation items-center justify-center gap-2 rounded-2xl px-5 py-3 border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-bold shadow-sm hover:bg-emerald-100 transition disabled:opacity-60 cursor-pointer"
      onclick={onStop}
      disabled={saving}
    >
      <Square size={16} strokeWidth={2.4} />
      <span>{saving ? 'Saving…' : 'End & save'}</span>
    </button>

    <button
      type="button"
      class="col-span-2 inline-flex min-h-[44px] touch-manipulation items-center justify-center gap-1.5 rounded-2xl px-4 py-3 border border-red-200 bg-white text-red-700 text-sm font-bold hover:bg-red-50 transition disabled:opacity-60 cursor-pointer sm:col-span-1"
      onclick={onDiscard}
      disabled={saving}
      aria-label="Discard tracking session"
    >
      <RotateCcw size={16} strokeWidth={2.2} />
      <span>Discard</span>
    </button>
  {/if}
</div>
