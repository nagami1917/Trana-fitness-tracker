<script>
  let { options = [], value, onSelect = () => {}, size = 'sm' } = $props();
</script>

<div class="inline-flex items-center gap-1 rounded-full border border-brand-100 bg-white/70 p-1">
  {#each options as option (option.id)}
    <button
      type="button"
      class="rounded-full font-bold transition {size === 'sm' ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2 text-xs'}"
      class:bg-brand-gradient={value === option.id}
      class:text-white={value === option.id}
      class:shadow-glow={value === option.id}
      class:text-ink-500={value !== option.id}
      onclick={() => onSelect(option.id)}
    >
      {option.label}
    </button>
  {/each}
</div>
