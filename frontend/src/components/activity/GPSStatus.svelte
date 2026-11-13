<script>
  let { status = 'idle', message = '' } = $props();

  const LABELS = {
    idle: 'Location off',
    requesting: 'Finding location…',
    tracking: 'GPS active',
    paused: 'Paused',
    denied: 'Location denied',
    error: 'GPS error',
    'no-signal': 'No signal',
  };

  const DOTS = {
    idle: '○',
    requesting: '↻',
    tracking: '●',
    paused: '❚❚',
    denied: '!',
    error: '!',
    'no-signal': '▲',
  };

  const COLORS = {
    idle: 'text-ink-400',
    requesting: 'text-brand-500 animate-spin inline-block',
    tracking: 'text-emerald-500',
    paused: 'text-amber-500',
    denied: 'text-rose-500',
    error: 'text-rose-500',
    'no-signal': 'text-amber-500',
  };
</script>

<div class="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border border-brand-100 bg-white px-3 py-1.5 text-xs font-bold shadow-sm sm:px-3.5">
  <span class={COLORS[status] ?? 'text-ink-400'} aria-hidden="true">{DOTS[status] ?? '○'}</span>
  <span class="text-ink-700">{LABELS[status] ?? message}</span>
  {#if message}
    <span class="min-w-0 break-words font-semibold text-ink-400">· {message}</span>
  {/if}
</div>
