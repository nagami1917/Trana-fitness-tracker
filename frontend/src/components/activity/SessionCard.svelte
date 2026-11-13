<script>
  import { link } from '../../lib/router.js';
  import { formatSessionDate } from '../../services/dailySessionService.js';
  import { unitSystem } from '../../stores/index.js';
  import { ml } from '../../lib/format.js';

  let { session = null } = $props();
</script>

<a
  href={`/track/session?id=${session.id}`}
  use:link
  class="card-flat block p-4 transition hover:border-brand-300"
>
  <div class="flex items-center justify-between mb-2">
    <span class="text-xs font-extrabold uppercase tracking-[0.1em] text-ink-400">
      {formatSessionDate(session.session_date)}
    </span>
    <span class="num-tabular text-xs font-bold {session.net_calories > 0 ? 'text-rose-500' : session.net_calories < 0 ? 'text-emerald-600' : 'text-ink-500'}">
      {session.net_calories > 0 ? `+${session.net_calories}` : session.net_calories} kcal
    </span>
  </div>

  <div class="num-tabular grid grid-cols-2 gap-4 mb-3">
    <div>
      <div class="flex items-baseline gap-1">
        <span class="text-lg font-extrabold text-ink-900">{session.calories_burned}</span>
        <span class="text-xs font-bold text-ink-400">burned</span>
      </div>
      <div class="w-full bg-brand-100 rounded-full h-1.5 mt-1">
        <div class="bg-emerald-500 h-1.5 rounded-full" style="width:{Math.min(100, (session.calories_burned / 1000) * 100)}%"></div>
      </div>
    </div>
    <div>
      <div class="flex items-baseline gap-1">
        <span class="text-lg font-extrabold text-ink-900">{session.calories_eaten}</span>
        <span class="text-xs font-bold text-ink-400">eaten</span>
      </div>
      <div class="w-full bg-brand-100 rounded-full h-1.5 mt-1">
        <div class="bg-rose-500 h-1.5 rounded-full" style="width:{Math.min(100, (session.calories_eaten / 2500) * 100)}%"></div>
      </div>
    </div>
  </div>

  <div class="num-tabular flex items-center gap-2 text-xs">
    <span class="px-2 py-0.5 rounded-full bg-white text-brand-700 text-[11px] font-bold">
      {session.foods_count ?? session.foods?.length ?? 0} foods
    </span>
    <span class="px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold">
      {ml(session.water_ml, $unitSystem)} water
    </span>
  </div>
</a>
