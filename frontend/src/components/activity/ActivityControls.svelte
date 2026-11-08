<script>
  import { Play, StopCircle, Timer } from 'lucide-svelte';

  let {
    tracking = false,
    saving = false,
    onStart = () => {},
    onStop = () => {},
    onResume = () => {},
  } = $props();
</script>

<div class="flex flex-col sm:flex-row gap-3 w-full max-w-sm mx-auto">
  {#if tracking}
    <button
      class="flex-1 rounded-xl py-4 border border-rose-200 bg-rose-50 text-rose-700 font-bold shadow-sm hover:bg-rose-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
      onclick={onStop}
      disabled={saving}
    >
      <StopCircle size={20} strokeWidth={2.5} />
      <span class="ml-1.5">End activity</span>
    </button>
  {:else}
    <button
      class="flex-1 rounded-xl py-4 border border-transparent bg-brand-gradient text-white font-bold shadow-glow hover:scale-[1.02] transition active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
      onclick={onStart}
      disabled={saving}
    >
      <Play size={20} />
      <span class="ml-1.5">Start activity</span>
    </button>
  {/if}

  {#if tracking}
    <button
      class="rounded-xl p-3 border border-brand-100 bg-white text-ink-700 hover:bg-brand-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
      onclick={onResume}
      disabled={saving}
      aria-label="Resume tracking"
    >
      <Timer size={18} strokeWidth={2.2} />
    </button>
  {/if}
</div>