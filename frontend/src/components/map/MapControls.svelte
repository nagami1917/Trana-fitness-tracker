<script>
  import { Target } from 'lucide-svelte';

  let { map } = $props();

  let following = $state(true);

  function zoomIn() {
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + 1, duration: 250 });
  }

  function zoomOut() {
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() - 1, duration: 250 });
  }

  function toggleFollow() {
    following = !following;
  }
</script>

<div class="flex flex-col gap-1.5">
  <button
    class="rounded-xl p-3 border border-brand-100 bg-white shadow-soft text-ink-700 hover:bg-brand-50 hover:text-brand-700 transition"
    aria-label="Zoom in"
    onclick={zoomIn}
  >
    <span class="text-sm font-bold">+</span>
  </button>
  <button
    class="rounded-xl p-3 border border-brand-100 bg-white shadow-soft text-ink-700 hover:bg-brand-50 hover:text-brand-700 transition"
    aria-label="Zoom out"
    onclick={zoomOut}
  >
    <span class="text-sm font-bold">−</span>
  </button>
  <button
    class={`
      rounded-xl p-3 border shadow-soft text-ink-700 transition
      ${following ? 'border-brand-100 bg-white' : 'border-brand-200 bg-brand-50 text-brand-700'}
    `}
    aria-label={following ? 'Following location' : 'Follow location off'}
    aria-pressed={following}
    onclick={toggleFollow}
  >
    <Target size={18} strokeWidth={2} />
  </button>
</div>