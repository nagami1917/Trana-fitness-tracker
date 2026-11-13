<script>
  import { onMount, tick } from 'svelte';
  import { X } from 'lucide-svelte';

  let { open = false, title = '', subtitle = '', onclose = () => {}, wide = false, children } = $props();

  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  let dialogEl = $state(null);
  let openerEl = null;

  const FOCUSABLE =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  $effect(() => {
    if (open) {
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        openerEl = document.activeElement;
      }
      void tick().then(() => {
        if (!dialogEl) return;
        const first = dialogEl.querySelector(FOCUSABLE);
        if (first && typeof first.focus === 'function') first.focus();
        else dialogEl.focus();
      });
    } else if (openerEl) {
      const target = openerEl;
      openerEl = null;
      if (target.isConnected && typeof target.focus === 'function') target.focus();
    }
  });

  function onKeydown(event) {
    if (!open) return;
    if (event.key === 'Escape') {
      onclose();
      return;
    }
    if (event.key === 'Tab' && dialogEl) {
      const nodes = [...dialogEl.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!nodes.length) {
        event.preventDefault();
        dialogEl.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogEl)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  onMount(() => {
    return () => {
      if (openerEl?.isConnected && typeof openerEl.focus === 'function') openerEl.focus();
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="fixed inset-0 z-[1200] flex items-end justify-center p-0 sm:items-center sm:p-6">
    <button type="button" class="absolute inset-0 bg-ink-900/35 backdrop-blur-sm" aria-label="Close" onclick={onclose}></button>
    <div
      bind:this={dialogEl}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      tabindex="-1"
      class="relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-4xl border border-white/70 bg-white p-6 shadow-card outline-none animate-slide-up sm:rounded-4xl {wide
        ? 'sm:max-w-3xl'
        : 'sm:max-w-lg'}"
    >
      <div class="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 id={titleId} class="text-xl">{title}</h3>
          {#if subtitle}<p class="mt-1 text-sm font-medium text-ink-400">{subtitle}</p>{/if}
        </div>
        <button type="button" class="btn-ghost !p-2" onclick={onclose} aria-label="Close dialog">
          <X size={18} />
        </button>
      </div>
      {@render children?.()}
    </div>
  </div>
{/if}
