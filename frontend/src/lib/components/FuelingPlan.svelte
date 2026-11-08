<script>
  import { Flame, Salad, Droplets, Waves, Clock, Gauge, Utensils, Candy, CupSoda, Check, Sparkles, Info } from 'lucide-svelte';
  import { duration as fmtDuration, pace, kcal, nf, ml } from '../format.js';
  import { INTENSITY_COPY } from '../ml/fueling.js';

  let { plan, compact = false } = $props();

  const TIMELINE_ICONS = { meal: Utensils, snack: Candy, during: CupSoda, recovery: Salad };

  const d = $derived(plan.duration);
  const f = $derived(plan.fueling);

  const tiles = $derived([
    {
      label: 'Calories',
      value: kcal(f.calories.total),
      unit: 'kcal',
      sub: `${f.calories.perHour} /h`,
      Icon: Flame,
      tone: 'from-rose-100 to-rose-200/60 text-rose-500',
    },
    {
      label: 'Carbs',
      value: `${nf(f.carbs.totalG)}`,
      unit: 'g',
      sub: `${f.carbs.perHourG} g/h`,
      Icon: Salad,
      tone: 'from-amber-100 to-amber-200/60 text-amber-600',
    },
    {
      label: 'Sodium',
      value: nf(f.sodium.totalMg),
      unit: 'mg',
      sub: `${nf(f.sodium.perHourMg)} /h`,
      Icon: Waves,
      tone: 'from-sky-100 to-sky-200/60 text-sky-600',
    },
    {
      label: 'Fluid',
      value: ml(f.fluid.totalMl),
      unit: '',
      sub: `${nf(f.fluid.perHourMl)} ml/h`,
      Icon: Droplets,
      tone: 'from-cyan-100 to-cyan-200/60 text-cyan-600',
    },
  ]);
</script>

<div class="space-y-4">
  <!-- hero -->
  <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700 p-5 text-white shadow-card">
    <div class="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10"></div>
    <div class="absolute -bottom-12 left-1/4 h-32 w-32 rounded-full bg-white/5"></div>
    <div class="relative">
      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/80">Predicted duration</p>
        <span class="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide backdrop-blur">
          {INTENSITY_COPY[f.intensity]?.label ?? f.intensity}
        </span>
      </div>
      <div class="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
        <p class="font-display text-[40px] font-extrabold leading-none">{fmtDuration(d.minutes)}</p>
        <p class="pb-1 text-sm font-bold text-white/80">{Math.round(d.low)}–{Math.round(d.high)} min range</p>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-white/85">
        <span class="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1">
          <Gauge size={12} /> {d.paceMinPerKm ? pace(d.paceMinPerKm) : `${nf(d.speedKmh, 1)} km/h`}
        </span>
        <span class="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1">
          <Clock size={12} /> {Math.round(d.confidence * 100)}% confidence
        </span>
        <span class="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1">
          <Sparkles size={12} /> MET {f.met}
        </span>
      </div>
    </div>
  </div>

  <!-- numbers -->
  <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
    {#each tiles as tile (tile.label)}
      <div class="rounded-2xl border border-brand-100/80 bg-white p-3 shadow-soft">
        <span class="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br shadow-inset {tile.tone}">
          <tile.Icon size={17} />
        </span>
        <p class="mt-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-ink-400">{tile.label}</p>
        <p class="font-display text-lg font-extrabold leading-tight text-ink-900">
          {tile.value}<span class="ml-0.5 text-[11px] font-bold text-ink-400">{tile.unit}</span>
        </p>
        <p class="text-[10px] font-bold text-brand-500">{tile.sub}</p>
      </div>
    {/each}
  </div>

  {#if !compact}
    <!-- timeline -->
    <div class="rounded-3xl border border-brand-100 bg-white p-4 shadow-soft">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm">Fueling timeline</h3>
        <span class="pill">{f.carbs.dailyTargetG} g carbs today</span>
      </div>
      <ol class="mt-3 space-y-0">
        {#each f.timeline as step, index (step.label + step.window)}
          {@const Icon = TIMELINE_ICONS[step.icon] ?? Utensils}
          <li class="relative flex gap-3 pb-4 last:pb-0">
            {#if index < f.timeline.length - 1}
              <span class="absolute left-[15px] top-9 h-[calc(100%-1.6rem)] w-0.5 rounded-full bg-brand-100"></span>
            {/if}
            <span class="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              <Icon size={15} />
            </span>
            <div class="min-w-0 flex-1 pt-0.5">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <p class="text-xs font-extrabold text-ink-900">{step.label}</p>
                <span class="text-[10px] font-bold uppercase tracking-wide text-brand-500">{step.window}</span>
              </div>
              <p class="text-[11px] font-semibold text-ink-400">{step.detail}</p>
            </div>
            {#if step.carbsG > 0}
              <span class="shrink-0 self-start rounded-lg bg-brand-50 px-2 py-1 text-[10px] font-extrabold text-brand-600">+{step.carbsG} g</span>
            {/if}
          </li>
        {/each}
      </ol>
    </div>

    <!-- coach notes -->
    <div class="rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-4">
      <div class="flex items-center gap-2">
        <Info size={15} class="text-brand-500" />
        <h3 class="text-sm">Coach notes</h3>
      </div>
      <ul class="mt-2 space-y-1.5">
        {#each f.notes as note (note)}
          <li class="flex gap-2 text-[11.5px] font-semibold leading-relaxed text-ink-500">
            <Check size={13} class="mt-0.5 shrink-0 text-emerald-500" /> {note}
          </li>
        {/each}
      </ul>
      {#if plan.history_used !== undefined}
        <p class="mt-3 border-t border-brand-100 pt-2 text-[10px] font-bold uppercase tracking-wide text-ink-400">
          Personalised from {plan.history_used} past {plan.activity_type} session{plan.history_used === 1 ? '' : 's'}
          {#if d.referenceSpeedKmh}· base pace {nf(d.referenceSpeedKmh, 1)} km/h{/if}
        </p>
      {/if}
    </div>
  {/if}
</div>
