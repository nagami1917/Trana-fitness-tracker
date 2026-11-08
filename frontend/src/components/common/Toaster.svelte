<script>
  import { Check, Info, TriangleAlert } from 'lucide-svelte';
  import { toast } from '../stores.js';

  const TONES = {
    success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: Check },
    error: { cls: 'border-rose-200 bg-rose-50 text-rose-800', Icon: TriangleAlert },
    info: { cls: 'border-sky-200 bg-sky-50 text-sky-800', Icon: Info },
  };
</script>

{#if $toast}
  {@const tone = TONES[$toast.tone] ?? TONES.info}
  <div class="pointer-events-none fixed inset-x-0 bottom-24 z-[1300] flex justify-center px-4 sm:bottom-8">
    <div class="pointer-events-auto flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-bold shadow-card animate-slide-up {tone.cls}">
      <tone.Icon size={17} />
      {$toast.message}
    </div>
  </div>
{/if}
