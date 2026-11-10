<script>
  let { session = null, onSelect = () => {} } = $props();
</script>

<a
  href={`/track/session/${session.id}`}
  class="block rounded-xl border border-brand-100 bg-white shadow-sm hover:border-brand-300 hover:shadow-soft transition p-4"
>
  <div class="flex items-center justify-between mb-2">
    <span class="text-xs font-extrabold uppercase tracking-[0.1em] text-ink-400">
      {new Date(session.session_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
    </span>
    <span class="text-xs font-bold {session.net_calories > 0 ? 'text-rose-500' : session.net_calories < 0 ? 'text-emerald-500' : 'text-ink-500'}">
      {session.net_calories > 0 ? `+${session.net_calories}` : session.net_calories} kcal
    </span>
  </div>

  <div class="flex items-center justify-between mb-3">
    <div class="flex-1">
      <div class="flex items-baseline gap-1">
        <span class="text-lg font-extrabold text-ink-900">{session.calories_burned}</span>
        <span class="text-xs font-bold text-ink-400">burned</span>
      </div>
      <div class="w-full bg-brand-100 rounded-full h-1.5 mt-1">
        <div class="bg-emerald-500 h-1.5 rounded-full" style="width:{Math.min(100, (session.calories_burned / 1000) * 100)}%"></div>
      </div>
    </div>
    <div class="flex-1">
      <div class="flex items-baseline gap-1">
        <span class="text-lg font-extrabold text-ink-900">{session.calories_eaten}</span>
        <span class="text-xs font-bold text-ink-400">eaten</span>
      </div>
      <div class="w-full bg-brand-100 rounded-full h-1.5 mt-1">
        <div class="bg-rose-500 h-1.5 rounded-full" style="width:{Math.min(100, (session.calories_eaten / 1000) * 100)}%"></div>
      </div>
    </div>
  </div>

  <div class="flex items-center gap-2 text-xs">
    <span class="px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 text-[10px] font-bold">
      {session.foods_count ?? 0} foods
    </span>
    <span class="px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold">
      {session.water_ml}ml water
    </span>
  </div>
</a>