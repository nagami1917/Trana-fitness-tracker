<script>
  let { title = 'Nothing here yet', description = '', children } = $props();
</script>

<div class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-brand-200 bg-white/60 px-6 py-12 text-center">
  <img src="/mascot-cat.png" alt="" class="h-24 w-auto opacity-80 animate-float" />
  <h3 class="mt-4 text-base">{title}</h3>
  <p class="mt-1 max-w-xs text-sm font-medium text-ink-400">{description}</p>
  {#if children}<div class="mt-4">{@render children()}</div>{/if}
</div>
