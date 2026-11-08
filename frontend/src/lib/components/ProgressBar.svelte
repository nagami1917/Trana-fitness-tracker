<script>
  let { value = 0, max = 100, tone = 'brand', height = 'h-2.5', showCap = false } = $props();

  const TONES = {
    brand: 'bg-brand-gradient',
    pink: 'bg-gradient-to-r from-brand-300 to-brand-500',
    mint: 'bg-gradient-to-r from-emerald-300 to-emerald-500',
    sky: 'bg-gradient-to-r from-sky-300 to-sky-500',
    amber: 'bg-gradient-to-r from-amber-300 to-amber-500',
  };
  let percent = $derived(Math.min(100, Math.max(0, (value / (max || 1)) * 100)));
</script>

<div class="w-full overflow-hidden rounded-full bg-brand-100/80 {height}">
  <div class="{TONES[tone] ?? TONES.brand} h-full rounded-full transition-all duration-700 ease-out" style="width:{percent}%"></div>
</div>
