<script>
  import { ChartColumn, Brain, TrendingDown, Flame, Trophy, Gauge, Sparkles, Info, ArrowRight } from 'lucide-svelte';
  import Card from '../components/Card.svelte';
  import BarChart from '../components/charts/BarChart.svelte';
  import LineChart from '../components/charts/LineChart.svelte';
  import DoughnutChart from '../components/charts/DoughnutChart.svelte';
  import ActivityIcon from '../components/ActivityIcon.svelte';
  import { activities, modelCard, typeBreakdown, paceTrend, weekdayLoad, chartSeries, personalBests, streak } from '../stores.js';
  import { navigate } from '../router.js';
  import { nf, pace, kcal, km, duration as fmtDuration, shortDate } from '../format.js';

  const FEATURE_LABELS = {
    elevation_per_km: 'Climbing per km',
    elevation_gain_m: 'Total elevation',
    distance_km: 'Planned distance',
    weight_kg: 'Body mass',
    experience_level: 'Experience',
    is_ride: 'Cycling',
    is_hike: 'Hiking',
    is_run: 'Running',
    is_walk: 'Walking',
  };

  const TYPE_COLORS = { run: '#f9569b', ride: '#c084fc', walk: '#fdba74', hike: '#38bdf8' };

  const weeklyCalories = $derived($chartSeries['3M'].map((w) => Math.round(w.calories)));
  const weeklyLabels = $derived($chartSeries['3M'].map((w) => w.label));
  const mixed = $derived($typeBreakdown.filter((t) => t.count > 0));

  const importance = $derived(
    Object.entries($modelCard?.feature_importance ?? {})
      .slice(0, 6)
      .map(([key, value]) => ({ key, label: FEATURE_LABELS[key] ?? key, value: Math.round(value * 100) })),
  );

  const averages = $derived.by(() => {
    const runs = $activities.filter((a) => a.activity_type === 'run' && a.distance_km > 0 && a.duration_min > 0);
    const total = $activities.reduce((acc, a) => acc + a.distance_km, 0);
    return {
      weeklyDistance: $chartSeries['7D'].reduce((s, d) => s + d.distance, 0),
      avgPace: runs.length ? runs.reduce((s, r) => s + r.duration_min / r.distance_km, 0) / runs.length : null,
      totalDistance: total,
      avgCalories: $activities.length ? $activities.reduce((s, a) => s + a.calories, 0) / $activities.length : 0,
    };
  });
</script>

<div class="space-y-5">
  <div>
    <span class="pill mb-2"><ChartColumn size={12} /> Analytics</span>
    <h1 class="font-display text-2xl sm:text-3xl">Your training, decoded</h1>
    <p class="mt-1 text-sm font-semibold text-ink-400">
      What TRANA has learned from {$activities.length} sessions — and what it does with it.
    </p>
  </div>

  <!-- model summary -->
  <Card class="!p-0 overflow-hidden">
    <div class="grid gap-0 sm:grid-cols-[1.2fr_1fr]">
      <div class="p-5">
        <div class="flex items-center gap-2">
          <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-100 text-brand-600"><Brain size={17} /></span>
          <div>
            <p class="text-sm font-extrabold text-ink-900">Duration model</p>
            <p class="text-[10px] font-bold uppercase tracking-wide text-ink-400">
              v{$modelCard?.version ?? 'local'} · {($modelCard?.corpus_rows ?? 0).toLocaleString()} training sessions
            </p>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {#each [
            { label: 'R²', value: $modelCard?.metrics?.r2 ?? '—' },
            { label: 'Mean error', value: $modelCard?.metrics ? `±${Math.round($modelCard.metrics.mape_pct)}%` : '—' },
            { label: 'MAE', value: $modelCard?.metrics ? `${$modelCard.metrics.mae_min} min` : '—' },
            { label: '80% band', value: $modelCard?.metrics ? `${$modelCard.metrics.interval_coverage_pct}%` : '—' },
          ] as metric (metric.label)}
            <div class="rounded-2xl bg-brand-50/80 p-2.5 text-center">
              <p class="text-[10px] font-extrabold uppercase tracking-wide text-ink-400">{metric.label}</p>
              <p class="font-display text-base font-extrabold text-brand-700">{metric.value}</p>
            </div>
          {/each}
        </div>

        <button class="mt-4 inline-flex items-center gap-1.5 text-[11px] font-extrabold text-brand-600" onclick={() => navigate('/plan')}>
          Run a prediction <ArrowRight size={13} />
        </button>
      </div>

      <div class="border-t border-brand-100 bg-gradient-to-br from-brand-50 to-white p-5 sm:border-l sm:border-t-0">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-600">What matters most</p>
        <div class="mt-3 space-y-2">
          {#each importance as item (item.key)}
            <div>
              <div class="flex items-baseline justify-between text-[11px] font-bold text-ink-500">
                <span>{item.label}</span>
                <span class="text-ink-400">{item.value}%</span>
              </div>
              <div class="mt-0.5 h-1.5 overflow-hidden rounded-full bg-brand-100">
                <div class="h-full rounded-full bg-brand-gradient" style="width:{Math.min(100, item.value * 1.35)}%"></div>
              </div>
            </div>
          {/each}
          {#if !importance.length}
            <p class="text-[11px] font-semibold text-ink-400">Model metadata unavailable in this build.</p>
          {/if}
        </div>
      </div>
    </div>
  </Card>

  <div class="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
    <!-- energy per week -->
    <Card>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Flame size={17} class="text-brand-500" />
          <h2 class="text-lg">Weekly energy</h2>
      </div>
        <span class="pill">last 13 weeks</span>
      </div>
      <div class="mt-3">
        <BarChart
          labels={weeklyLabels}
          series={[{ label: 'kcal', data: weeklyCalories, colors: weeklyCalories.map(() => '#ffb3d1') }]}
          height={220}
          tooltipLabel={(ctx) => `${nf(ctx.parsed.y)} kcal`}
          yTicks={(v) => (v >= 1000 ? `${nf(v / 1000, 1)}k` : v)}
        />
      </div>
      <p class="mt-2 text-[11px] font-semibold text-ink-400">
        Average {$chartSeries['3M'].length ? nf(weeklyCalories.reduce((a, b) => a + b, 0) / weeklyCalories.length) : 0} kcal per week.
      </p>
    </Card>

    <!-- mix -->
    <Card>
      <div class="flex items-center gap-2">
        <Sparkles size={17} class="text-brand-500" />
        <h2 class="text-lg">Activity mix</h2>
      </div>
      <div class="mt-2">
        <DoughnutChart
          labels={mixed.map((t) => t.type)}
          values={mixed.map((t) => Math.round(t.distance * 10) / 10)}
          colors={mixed.map((t) => TYPE_COLORS[t.type] ?? '#ffc2d9')}
          height={172}
        />
      </div>
      <div class="mt-3 space-y-1.5">
        {#each mixed as item (item.type)}
          <div class="flex items-center gap-2 text-[11px] font-bold">
            <span class="h-2.5 w-2.5 rounded-full" style="background:{TYPE_COLORS[item.type]}"></span>
            <span class="capitalize text-ink-500">{item.type}</span>
            <span class="ml-auto text-ink-400">{nf(item.distance, 1)} km · {Math.round(item.share)}%</span>
          </div>
        {/each}
      </div>
    </Card>
  </div>

  <div class="grid gap-5 xl:grid-cols-2">
    <!-- pace trend -->
    <Card>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <TrendingDown size={17} class="text-brand-500" />
          <h2 class="text-lg">Run pace trend</h2>
        </div>
        <span class="pill">lower is faster</span>
      </div>
      {#if $paceTrend.length > 2}
        <div class="mt-3">
          <LineChart
            labels={$paceTrend.map((p) => p.label)}
            series={[{ label: 'pace', data: $paceTrend.map((p) => Number(p.pace.toFixed(2))), color: '#c084fc' }]}
            height={210}
            tooltipLabel={(ctx) => pace(ctx.parsed.y)}
            yTicks={(v) => pace(v).replace(' /km', '')}
          />
        </div>
        <p class="mt-2 text-[11px] font-semibold text-ink-400">
          Average run pace {pace(averages.avgPace)} across {$paceTrend.length} recent runs.
        </p>
      {:else}
        <p class="mt-6 text-sm font-semibold text-ink-400">Log at least three runs to see your pace trend.</p>
      {/if}
    </Card>

    <!-- weekday load -->
    <Card>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Gauge size={17} class="text-brand-500" />
          <h2 class="text-lg">When you train</h2>
        </div>
        <span class="pill">{$streak} day streak</span>
      </div>
      <div class="mt-3">
        <BarChart
          labels={$weekdayLoad.map((d) => d.label)}
          series={[{ label: 'sessions', data: $weekdayLoad.map((d) => d.count), colors: $weekdayLoad.map(() => '#ff9ec4') }]}
          height={210}
          tooltipLabel={(ctx) => `${ctx.parsed.y} session${ctx.parsed.y === 1 ? '' : 's'}`}
        />
      </div>
    </Card>
  </div>

  <!-- personal bests -->
  <Card>
    <div class="flex items-center gap-2">
      <Trophy size={17} class="text-brand-500" />
      <h2 class="text-lg">Personal bests</h2>
    </div>
    <div class="mt-3 grid gap-3 sm:grid-cols-3">
      {#each [
        {
          label: 'Longest distance',
          value: $personalBests.longest ? `${km($personalBests.longest.distance_km)} km` : '—',
          sub: $personalBests.longest ? `${$personalBests.longest.activity_type} · ${shortDate($personalBests.longest.started_at)}` : 'No data yet',
          Icon: ActivityIcon,
          type: $personalBests.longest?.activity_type,
        },
        {
          label: 'Fastest run',
          value: $personalBests.fastestPace ? pace($personalBests.fastestPace) : '—',
          sub: $personalBests.fastestRun ? `${km($personalBests.fastestRun.distance_km)} km · ${shortDate($personalBests.fastestRun.started_at)}` : 'No data yet',
          Icon: Gauge,
        },
        {
          label: 'Biggest burn',
          value: $personalBests.biggest ? `${kcal($personalBests.biggest.calories)} kcal` : '—',
          sub: $personalBests.biggest ? `${fmtDuration($personalBests.biggest.duration_min)} · ${shortDate($personalBests.biggest.started_at)}` : 'No data yet',
          Icon: Flame,
        },
      ] as best (best.label)}
        <div class="rounded-2xl border border-brand-100 bg-gradient-to-br from-white to-brand-50/60 p-4">
          <div class="flex items-center justify-between">
            <p class="text-[10px] font-extrabold uppercase tracking-wide text-ink-400">{best.label}</p>
            {#if best.type}
              <ActivityIcon type={best.type} size="sm" />
            {:else}
              <best.Icon size={15} class="text-brand-400" />
            {/if}
          </div>
          <p class="mt-1.5 font-display text-xl font-extrabold text-ink-900">{best.value}</p>
          <p class="text-[11px] font-semibold capitalize text-ink-400">{best.sub}</p>
        </div>
      {/each}
    </div>
  </Card>

  <!-- how it works -->
  <Card class="bg-gradient-to-br from-white to-brand-50">
    <div class="flex items-center gap-2">
      <Info size={17} class="text-brand-500" />
      <h2 class="text-lg">How the prediction works</h2>
    </div>
    <ol class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {#each [
        'TRANA fits your own distance→time curve for each sport from your logged sessions.',
        'A gradient-boosted model adjusts that baseline for climbing, body mass and experience.',
        'Three quantile models give an honest best-case / likely / worst-case range.',
        'Fueling is derived from MET energy cost and sports-nutrition intake guidelines.',
      ] as step, index (step)}
        <li class="rounded-2xl bg-white/80 p-3.5">
          <span class="grid h-7 w-7 place-items-center rounded-full bg-brand-gradient text-[11px] font-extrabold text-white">{index + 1}</span>
          <p class="mt-2 text-[12px] font-semibold leading-relaxed text-ink-500">{step}</p>
        </li>
      {/each}
    </ol>
  </Card>
</div>
