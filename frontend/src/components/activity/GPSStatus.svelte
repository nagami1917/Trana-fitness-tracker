<script>
  let { status = 'idle', message = '' } = $props();

  const LABELS = {
    idle: 'Location off',
    requesting: 'Finding location…',
    tracking: 'GPS active',
    denied: 'Location denied',
    error: 'GPS error',
    'no-signal': 'No signal',
  };

  const DOTS = {
    idle: '○',
    requesting: '↻',
    tracking: '●',
    denied: '!',
    error: '!',
    'no-signal': '▲',
  };

  const COLORS = {
    idle: 'text-ink-400',
    requesting: 'text-brand-500 animate-spin',
    tracking: 'text-emerald-500',
    denied: 'text-rose-500',
    error: 'text-rose-500',
    'no-signal': 'text-amber-500',
  };
</script>

<div class="flex items-center gap-2 rounded-lg border border-brand-100 bg-white px-3 py-1.5 text-xs font-bold shadow-sm">
  <span class={COLORS[status] ?? 'text-ink-400'}>{DOTS[status] ?? '○'}</span>
  <span class="text-ink-700">{LABELS[status] ?? message}</span>
  {#if message}
    <span class="text-ink-400">· {message}</span>
  {/if}
</div>