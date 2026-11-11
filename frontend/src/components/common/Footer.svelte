<script>
  import { link } from '../../lib/router.js';
</script>

<footer class="mt-10 border-t border-brand-100 bg-white/70 px-1 pb-6 pt-5 text-center">
  <p class="font-display text-sm font-extrabold text-brand-700">TRANA</p>
  <p class="mt-0.5 text-[11px] font-semibold text-ink-400">AI fitness trainer — plan, track, improve.</p>

  <nav class="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-bold text-ink-500">
    <a href="/privacy" use:link class="hover:text-brand-600">Privacy</a>
    <a href="/terms" use:link class="hover:text-brand-600">Terms</a>
    <span class="text-ink-300">·</span>
    <span class="text-ink-400">Predictions are ML estimates (±22% typical error)</span>
  </nav>

  <p class="mx-auto mt-2 max-w-xl text-[10px] font-semibold leading-relaxed text-ink-300">
    Map data © OpenStreetMap contributors · Routing by OpenRouteService ·
    Research validated on FitRec (Ni et al., WWW 2019) and GeoLife (Zheng et al., WWW 2008) — academic use.
  </p>
</footer>
