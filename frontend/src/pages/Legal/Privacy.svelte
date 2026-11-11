<script>
  import { ShieldCheck, Database, Download, Trash2, MapPin, Brain } from 'lucide-svelte';
</script>

<svelte:head><title>Privacy Policy — TRANA</title></svelte:head>

<article class="mx-auto max-w-2xl rounded-3xl border border-brand-100 bg-white p-6 shadow-card sm:p-8">
  <span class="pill"><ShieldCheck size={12} /> Privacy Policy</span>
  <h1 class="mt-3 font-display text-2xl font-extrabold text-ink-900">Your data, your rights</h1>
  <p class="mt-1 text-xs font-semibold text-ink-400">Last updated: November 11, 2026</p>

  <div class="prose-trana mt-5 space-y-5 text-sm font-medium leading-relaxed text-ink-600">
    <section>
      <h2 class="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-ink-900"><Database size={14} class="text-brand-500" /> What TRANA collects</h2>
      <ul class="list-disc space-y-1 pl-5">
        <li><b>Account</b> — your name and email address.</li>
        <li><b>Fitness profile</b> — weight, height, age, sex, fitness level, city (used for calorie and pace estimates).</li>
        <li><b>Activities</b> — workouts you log or track, including GPS routes, distance, duration, and calories.</li>
        <li><b>Goals, plans, and nutrition logs</b> — the targets you set and the food you record.</li>
        <li><b>Device samples you import</b> — e.g. wearable measurements pasted into Settings for calorie calibration.</li>
      </ul>
    </section>

    <section>
      <h2 class="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-ink-900"><Brain size={14} class="text-brand-500" /> How it is used</h2>
      <p>
        Solely to run TRANA: show your progress, estimate calories and duration, plan fueling, and
        personalize predictions. <b>We do not sell your data, run ads, or share it with marketers.</b>
        ML predictions are computed for your account only and are never used to identify you.
      </p>
    </section>

    <section>
      <h2 class="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-ink-900"><MapPin size={14} class="text-brand-500" /> Third-party services</h2>
      <ul class="list-disc space-y-1 pl-5">
        <li><b>Map tiles</b> — © OpenStreetMap contributors (your map viewport is requested from their servers).</li>
        <li><b>Route snapping</b> — OpenRouteService receives the points you place when building a route.</li>
        <li><b>Hosting</b> — data is stored in a cloud database (Supabase) and served via Vercel.</li>
      </ul>
    </section>

    <section>
      <h2 class="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-ink-900"><Download size={14} class="text-brand-500" /> Your rights</h2>
      <p>
        TRANA is built to comply with the Philippine <b>Data Privacy Act of 2012 (RA 10173)</b>.
        You may at any time:
      </p>
      <ul class="list-disc space-y-1 pl-5">
        <li><b>Access &amp; export</b> — download your full activity history as CSV from the Activities page.</li>
        <li><b>Correct</b> — edit your profile and goals in Settings.</li>
        <li><b>Delete</b> — Settings → Danger zone permanently deletes your account and every row tied to it
          (activities, goals, achievements, plans, sessions). Deletion is immediate and irreversible.</li>
      </ul>
    </section>

    <section>
      <h2 class="mb-1 text-sm font-extrabold text-ink-900">Retention &amp; security</h2>
      <p>
        Data is kept only while your account exists. Access requires a bearer token; passwords are
        stored hashed; mutating endpoints are rate-limited. No system is 100% secure — use a strong,
        unique password.
      </p>
    </section>

    <section>
      <h2 class="mb-1 text-sm font-extrabold text-ink-900">Contact</h2>
      <p>
        Questions or privacy requests? Open an issue on the project repository
        (<span class="font-mono text-xs">nagami1917/Trana-fitness-tracker</span>) or contact the
        project maintainers through your institution.
      </p>
    </section>
  </div>

  <p class="mt-6 text-[11px] font-semibold text-ink-400">
    See also: <a href="/terms" class="font-bold text-brand-600 hover:underline">Terms of Service</a>
  </p>
</article>
