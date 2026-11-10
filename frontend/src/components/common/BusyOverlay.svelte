<script>
  import { LoaderCircle } from 'lucide-svelte';

  /**
   * Full-screen blocking overlay for in-flight saves/updates so the user
   * always knows an action is running. Sits above modals (z-[1200]+).
   */
  let { open = false, label = 'Working…' } = $props();
</script>

{#if open}
  <div class="fixed inset-0 z-[1300] grid place-items-center bg-black/40 backdrop-blur-[2px]">
    <div class="flex flex-col items-center gap-3 rounded-3xl bg-white px-8 py-7 shadow-card">
      <LoaderCircle size={28} class="animate-spin text-brand-500" />
      <p class="text-sm font-extrabold text-ink-500">{label}</p>
      <p class="text-[11px] font-semibold text-ink-400">Hang tight — don't close this screen</p>
    </div>
  </div>
{/if}
