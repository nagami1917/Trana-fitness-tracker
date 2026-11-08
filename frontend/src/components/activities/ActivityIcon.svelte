<script>
  import { Footprints, Bike, PersonStanding, Mountain } from 'lucide-svelte';

  let { type = 'run', size = 'md', tone = 'brand' } = $props();

  const ICONS = { run: Footprints, ride: Bike, walk: PersonStanding, hike: Mountain };
  const SIZES = {
    xs: { box: 'h-6 w-6 rounded-lg', icon: 13 },
    sm: { box: 'h-9 w-9 rounded-xl', icon: 17 },
    md: { box: 'h-11 w-11 rounded-2xl', icon: 21 },
    lg: { box: 'h-16 w-16 rounded-3xl', icon: 30 },
    xl: { box: 'h-20 w-20 rounded-[26px]', icon: 38 },
  };

  let Icon = $derived(ICONS[type] ?? Footprints);
  let s = $derived(SIZES[size] ?? SIZES.md);
</script>

<span
  class="grid shrink-0 place-items-center {s.box} shadow-inset {tone === 'solid'
    ? 'bg-brand-gradient text-white'
    : 'bg-gradient-to-br from-brand-100 to-brand-200/70 text-brand-600'}"
>
  <Icon size={s.icon} strokeWidth={2.2} />
</span>
