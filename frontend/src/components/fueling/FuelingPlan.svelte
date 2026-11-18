<script>
  import { Flame, Salad, Droplets, Waves, Clock, Gauge, Utensils, Candy, CupSoda, Check, Sparkles, Info, Package, User, TriangleAlert, History } from 'lucide-svelte';
  import { duration as fmtDuration, pace, speed, kcal, nf, ml } from '../../lib/format.js';
  import { INTENSITY_COPY } from '../../lib/ml/fueling.js';
  import { unitSystem } from '../../stores/index.js';
  import { fluidUnit, toDisplayFluid } from '../../lib/units.js';

  let { plan, compact = false } = $props();

  const TIMELINE_ICONS = { meal: Utensils, snack: Candy, during: CupSoda, recovery: Salad };

  const d = $derived(plan.duration);
  const f = $derived(plan.fueling);

  const SPORT_LABEL = { run: 'run', ride: 'ride', walk: 'walk', hike: 'hike' };

  /**
   * Where this estimate comes from. historyCount is the model's own count of
   * past sessions *of this activity type* — the only honest source for the
   * claim. Never say "your sessions" when the model used none.
   */
  const basisLine = $derived.by(() => {
    const sport = SPORT_LABEL[plan.activity_type] ?? 'session';
    const count = Number(d.historyCount ?? 0);
    if (count >= 2) return `Based on your ${count} past ${sport} sessions`;
    if (count === 1) return `Based on 1 past ${sport} session`;
    return `Generic ${sport} pace — add past sessions to personalise`;
  });

  /**
   * The same fact, but as a badge the athlete cannot miss.
   *
   * The old version put this in 11px translucent text under the duration,
   * where "Generic ride pace" was easy to read as decoration. The source of an
   * estimate is the single most decision-relevant thing on this card, so it
   * gets a solid pill: personal (white on brand) vs generic (amber warning).
   */
  const basisTone = $derived(Number(d.historyCount ?? 0) >= 2 ? 'personal' : 'generic');

  /**
   * The range to display.
   *
   * The model's own q10-q90 band is calibrated against the synthetic corpus and
   * covers real durations only ~17% of the time, so it is shown only when no
   * validated figure is available. `validatedLow`/`High` come from the GeoLife
   * external validation and reflect the error the model has actually
   * demonstrated for this sport and history depth.
   */
  const displayLow = $derived(Number(d.validatedLow ?? d.low));
  const displayHigh = $derived(Number(d.validatedHigh ?? d.high));

  const rangeTitle = $derived(
    d.validatedErrorPct
      ? `Median estimate ±${d.validatedErrorPct}% — the error measured on real GPS activities (GeoLife validation), not the narrower synthetic-data band`
      : 'Model quantile range',
  );

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
      // The model computes sodium only — it does not model potassium or
      // magnesium, so the headline says "Electrolytes" but the unit line
      // names what the number actually is.
      label: 'Electrolytes',
      value: nf(f.sodium.totalMg),
      unit: 'mg sodium',
      sub: `${nf(f.sodium.perHourMg)} mg/h`,
      Icon: Waves,
      tone: 'from-sky-100 to-sky-200/60 text-sky-600',
    },
    {
      label: 'Fluid',
      value: ml(f.fluid.totalMl, $unitSystem),
      unit: '',
      sub: $unitSystem === 'imperial'
        ? `${nf(Math.round(toDisplayFluid(f.fluid.perHourMl, 'imperial')))} ${fluidUnit('imperial')}/h`
        : `${nf(f.fluid.perHourMl)} ml/h`,
      Icon: Droplets,
      tone: 'from-cyan-100 to-cyan-200/60 text-cyan-600',
    },
  ]);
</script>

<div class="space-y-4">
  <!-- hero -->
  <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 p-5 text-white shadow-card">
    <div class="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10"></div>
    <div class="absolute -bottom-12 left-1/4 h-32 w-32 rounded-full bg-white/5"></div>
    <div class="relative">
      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/90">Predicted duration</p>
        <span class="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide backdrop-blur">
          {INTENSITY_COPY[f.intensity]?.label ?? f.intensity}
        </span>
      </div>
      <div class="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
        <p class="num-tabular font-display text-[40px] font-extrabold leading-none">{fmtDuration(d.minutes)}</p>
        <p
          class="num-tabular pb-1 text-sm font-bold text-white/90"
          title={rangeTitle}
        >
          typically {Math.round(displayLow)}–{Math.round(displayHigh)} min
        </p>
      </div>
      {#if basisTone === 'personal'}
        <p class="num-tabular mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/25 px-2.5 py-1 text-[11px] font-extrabold text-white backdrop-blur">
          <User size={11} /> {basisLine}
        </p>
      {:else}
        <p
          class="num-tabular mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-extrabold text-amber-950"
          title="This sport has no usable past sessions yet, so TRANA falls back to a typical pace for your fitness level"
        >
          <TriangleAlert size={11} /> {basisLine}
        </p>
      {/if}
      <div class="num-tabular mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-white/95">
        <span class="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1">
          <Gauge size={12} /> {d.paceMinPerKm ? pace(d.paceMinPerKm, $unitSystem) : speed(d.speedKmh, $unitSystem)}
        </span>
        <!-- Labeled "model" confidence, not confidence: the score weights the
             band width against how much history this sport has, so it says how
             much the model trusts itself, not how often it was right. Real-world
             accuracy is the validated ± figure shown next to the range. -->
        <span
          class="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1"
          title={d.validatedErrorPct
            ? `Model self-confidence (${Math.round(Number(d.confidence ?? 0) * 100)}%). Measured real-world error for this sport is ±${d.validatedErrorPct}%.`
            : 'Model self-confidence based on how much history this sport has'}
        >
          <Clock size={12} /> ±{d.validatedErrorPct ?? Math.round((1 - Number(d.confidence ?? 0)) * 100)}% typical error
        </span>
        {#if Number(plan.elevation_gain_m) > 0}
          {@const perKm = Math.round(Number(plan.elevation_gain_m) / Math.max(0.1, Number(plan.distance_km)))}
          <span class="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1" title="This activity's climb and how steep that is per km">
            ↑ {nf(plan.elevation_gain_m)} m · {perKm} m/km
          </span>
        {/if}
        <span class="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1">
          <Sparkles size={12} /> MET {f.met}
        </span>
      </div>
    </div>
  </div>

  <!-- numbers -->
  <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
    {#each tiles as tile (tile.label)}
      <div class="card-flat p-3">
        <span class="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br shadow-inset {tile.tone}">
          <tile.Icon size={17} />
        </span>
        <p class="mt-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400">{tile.label}</p>
        <p class="num-tabular font-display text-lg font-extrabold leading-tight text-ink-900">
          {tile.value}<span class="ml-0.5 text-[11px] font-bold text-ink-400">{tile.unit}</span>
        </p>
        <p class="num-tabular text-[11px] font-bold text-brand-700">{tile.sub}</p>
      </div>
    {/each}
  </div>

  {#if !compact}
    {#if f.kit?.items?.length}
      <!-- race-day packing list -->
      <div class="rounded-3xl border border-brand-100 bg-white p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="flex items-center gap-1.5 text-sm">
            <Package size={15} class="text-brand-600" />
            Packing kit
          </h3>
          {#if f.kit.cadence?.feedEveryMin}
            <span class="pill num-tabular">Feed every ~{f.kit.cadence.feedEveryMin} min</span>
          {/if}
        </div>
        <div class="mt-2.5 flex flex-wrap gap-2">
          {#each f.kit.items as entry (entry.id || entry.name)}
            <span class="inline-flex items-center gap-1.5 rounded-2xl border border-brand-100 bg-brand-50/70 px-3 py-1.5 text-xs font-extrabold text-ink-900">
              <span class="num-tabular text-brand-700">{entry.quantity}×</span>
              <span>{entry.name}</span>
              <span class="text-[11px] font-bold text-ink-400">
                ({entry.carbsG}g{#if entry.fluidMl > 0}, {entry.fluidMl}ml{/if})
              </span>
            </span>
          {/each}
        </div>
        {#if f.kit.cadence?.sipEveryMin}
          <p class="mt-2.5 text-[11px] font-bold text-ink-500 num-tabular">
            Cadence: sip ~{f.kit.cadence.sipMl} ml every {f.kit.cadence.sipEveryMin} min · totals {f.kit.totals?.carbsG ?? 0}g carbs, {f.kit.totals?.sodiumMg ?? 0}mg Na
          </p>
        {/if}
      </div>
    {/if}

    <!-- timeline -->
    <div class="rounded-3xl border border-brand-100 bg-white p-4">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm">Fueling timeline</h3>
        <span class="pill num-tabular">{f.carbs.dailyTargetG} g carbs today</span>
      </div>
      <ol class="mt-3 space-y-0">
        {#each f.timeline as step, index (step.label + step.window)}
          {@const Icon = TIMELINE_ICONS[step.icon] ?? Utensils}
          <li class="relative flex gap-3 pb-4 last:pb-0">
            {#if index < f.timeline.length - 1}
              <span class="absolute left-[15px] top-9 h-[calc(100%-1.6rem)] w-0.5 rounded-full bg-brand-100"></span>
            {/if}
            <span class="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-100">
              <Icon size={15} />
            </span>
            <div class="min-w-0 flex-1 pt-0.5">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <p class="text-xs font-extrabold text-ink-900">{step.label}</p>
                <span class="text-[11px] font-bold uppercase tracking-wide text-brand-700">{step.window}</span>
              </div>
              <p class="text-[11px] font-semibold text-ink-400">{step.detail}</p>
            </div>
            {#if step.carbsG > 0}
              <span class="num-tabular shrink-0 self-start rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-extrabold text-brand-700">+{step.carbsG} g</span>
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
        {#if plan.intake_note}
          <!-- Measured from what the athlete actually logged on past sessions
               of this sport, not from a formula. Rendered apart from the generic
               notes because it is the only line that is about them. -->
          <li class="flex gap-2 rounded-xl bg-brand-50 px-2 py-1.5 text-[11.5px] font-semibold leading-relaxed text-brand-900">
            <History size={13} class="mt-0.5 shrink-0 text-brand-600" /> {plan.intake_note}
          </li>
        {/if}
      </ul>
      {#if d.referenceSpeedKmh}
        <!-- The source of the estimate is stated once, in the hero badge. This
             line only carries the number that badge cannot fit. It no longer
             repeats a count, so it cannot disagree with the badge above. -->
        <p class="mt-3 border-t border-brand-100 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink-400">
          Base pace {speed(d.referenceSpeedKmh, $unitSystem)} · {Number(d.historyCount ?? 0) > 0 ? 'your own' : 'typical for your level'}
        </p>
      {/if}
    </div>
  {/if}
</div>
