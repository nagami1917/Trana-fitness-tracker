<script>
  import { link } from '../../lib/router.js';

  let { compact = false, size = 44 } = $props();
</script>

<a href="/" class="flex items-center gap-2.5" use:link>
  <span
    class="grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-white to-brand-100 ring-1 ring-white/80 shadow-soft"
    style="width:{size}px;height:{size}px"
  >
    <img src="/mascot-cat.png" alt="TRANA mascot" class="h-[86%] w-auto object-contain" />
  </span>
  {#if !compact}
    <span class="leading-none">
      <span class="block font-display text-lg font-extrabold tracking-tight text-brand-700">TRANA</span>
      <span class="block text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">fuel your next move</span>
    </span>
  {/if}
</a>
