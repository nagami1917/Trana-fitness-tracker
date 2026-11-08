<script>
  import { ArrowUpRight, ArrowDownRight } from 'lucide-svelte';
  import Sparkline from './Sparkline.svelte';

  let { label, value, unit = '', delta = null, icon: Icon = null, spark = [], tone = 'brand', hint = '' } = $props();

  const TONES = {
    brand: 'from-brand-100 to-brand-200/60 text-brand-600',
    rose: 'from-rose-100 to-rose-200/60 text-rose-500',
    amber: 'from-amber-100 to-amber-200/60 text-amber-600',
    sky: 'from-sky-100 to-sky-200/60 text-sky-600',
    mint: 'from-emerald-100 to-emerald-200/60 text-emerald-600',
  };
  const STROKES = { brand: '#f9569b', rose: '#fb7185', amber: '#f59e0b', sky: '#0ea5e9', mint: '#10b981' };
  let up = $derived((delta ?? 0) >= 0);
</script>

<div class="card flex items-center gap-4 p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-card sm:p-5">
  {#if Icon}
    <span class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br shadow-inset {TONES[tone] ?? TONES.brand}">
      <Icon size={26} strokeWidth={2.1} />
    </span>
  {/if}
  <div class="min-w-0 flex-1">
    <p class="truncate text-[13px] font-bold text-ink-500">{label}</p>
    <p class="mt-0.5 flex items-baseline gap-1">
      <span class="stat-value">{value}</span>
      {#if unit}<span class="text-xs font-bold text-ink-400">{unit}</span>{/if}
    </p>
    <div class="mt-1 flex items-center gap-2">
      {#if delta !== null && Number.isFinite(delta)}
        <span class="inline-flex items-center gap-0.5 text-[11px] font-extrabold {up ? 'text-emerald-500' : 'text-rose-500'}">
          {#if up}<ArrowUpRight size={12} strokeWidth={3} />{:else}<ArrowDownRight size={12} strokeWidth={3} />{/if}
          {up ? '+' : ''}{Math.round(delta)}%
        </span>
      {:else if hint}
        <span class="text-[11px] font-semibold text-ink-400">{hint}</span>
      {/if}
    </div>
  </div>
  {#if spark?.length}
    <Sparkline values={spark} width={72} height={34} stroke={STROKES[tone] ?? STROKES.brand} class="hidden shrink-0 sm:block" />
  {/if}
</div>
