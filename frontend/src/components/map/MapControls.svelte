<script>
  import { Plus, Minus, Crosshair } from 'lucide-svelte';

  let { map = null, following = true, onToggleFollow = () => {} } = $props();

  function zoomIn() {
    if (!map) return;
    map.zoomIn({ animate: true, duration: 250 });
  }

  function zoomOut() {
    if (!map) return;
    map.zoomOut({ animate: true, duration: 250 });
  }
</script>

<div
  class="flex flex-col gap-1 rounded-xl border border-slate-200/80 bg-white/95 backdrop-blur-md p-1.5 shadow-lg"
  role="group"
  aria-label="Map controls"
>
  <button
    type="button"
    onclick={zoomIn}
    class="grid h-8 w-8 place-items-center rounded-lg text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition cursor-pointer"
    aria-label="Zoom in"
    title="Zoom in"
  >
    <Plus size={15} />
  </button>

  <button
    type="button"
    onclick={zoomOut}
    class="grid h-8 w-8 place-items-center rounded-lg text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition cursor-pointer"
    aria-label="Zoom out"
    title="Zoom out"
  >
    <Minus size={15} />
  </button>

  <button
    type="button"
    onclick={onToggleFollow}
    class="grid h-8 w-8 place-items-center rounded-lg transition cursor-pointer {following
      ? 'bg-brand-600 text-white hover:bg-brand-700'
      : 'text-slate-700 hover:bg-brand-50 hover:text-brand-700'}"
    aria-label={following ? 'Following your location' : 'Center on location'}
    title={following ? 'Following your location' : 'Center on location'}
    aria-pressed={following}
  >
    <Crosshair size={15} />
  </button>
</div>
