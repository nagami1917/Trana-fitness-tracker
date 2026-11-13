<script>
  /**
   * Shape-matched shimmer skeleton placeholder so loading regions keep layout
   * stable instead of flashing plain "Loading..." text.
   */
  let {
    variant = 'lines', // 'lines' | 'rows' | 'chart' | 'cards'
    count = 3,
    height = 180,
    class: cls = '',
  } = $props();
</script>

{#if variant === 'chart'}
  <div class="skeleton-bar w-full {cls}" style="height: {height}px" aria-hidden="true"></div>
{:else if variant === 'cards'}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 {cls}" aria-hidden="true">
    {#each Array.from({ length: count }) as _, i (i)}
      <div class="skeleton-bar h-20 rounded-2xl"></div>
    {/each}
  </div>
{:else if variant === 'rows'}
  <div class="space-y-2.5 {cls}" aria-hidden="true">
    {#each Array.from({ length: count }) as _, i (i)}
      <div class="flex items-center gap-3 rounded-2xl p-2">
        <div class="skeleton-bar h-9 w-9 shrink-0 rounded-xl"></div>
        <div class="min-w-0 flex-1 space-y-2">
          <div class="skeleton-bar h-3.5 w-2/3"></div>
          <div class="skeleton-bar h-2.5 w-1/2"></div>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="space-y-2.5 {cls}" aria-hidden="true">
    {#each Array.from({ length: count }) as _, i (i)}
      <div class="skeleton-bar h-3.5 {i === count - 1 ? 'w-3/5' : 'w-full'}"></div>
    {/each}
  </div>
{/if}
