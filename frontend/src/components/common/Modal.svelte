<script>
  import { X } from 'lucide-svelte';

  let { open = false, title = '', subtitle = '', onclose = () => {}, wide = false, children } = $props();

  function onKeydown(event) {
    if (event.key === 'Escape') onclose();
  }
</script>

<svelte:window on:keydown={onKeydown} />

{#if open}
  <div class="fixed inset-0 z-[1200] flex items-end justify-center p-0 sm:items-center sm:p-6">
    <button class="absolute inset-0 bg-ink-900/30 backdrop-blur-sm" aria-label="Close" onclick={onclose}></button>
    <div
      class="relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-4xl border border-white/70 bg-white p-6 shadow-card animate-slide-up sm:rounded-4xl {wide
        ? 'sm:max-w-3xl'
        : 'sm:max-w-lg'}"
    >
      <div class="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 class="text-xl">{title}</h3>
          {#if subtitle}<p class="mt-1 text-sm font-medium text-ink-400">{subtitle}</p>{/if}
        </div>
        <button class="btn-ghost !p-2" onclick={onclose} aria-label="Close dialog">
          <X size={18} />
        </button>
      </div>
      {@render children?.()}
    </div>
  </div>
{/if}
