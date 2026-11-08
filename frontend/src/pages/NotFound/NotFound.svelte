<script>
  import { navigate } from '../router.js';
</script>

<div class="grid min-h-[60vh] place-items-center">
  <div class="text-center">
    <img src="/mascot-cat.png" alt="" class="mx-auto h-32 w-auto animate-float" />
    <h1 class="mt-4 font-display text-3xl font-extrabold">Lost the trail</h1>
    <p class="mt-1 text-sm font-semibold text-ink-400">That page doesn’t exist — let’s get you back on route.</p>
    <button class="btn-primary mt-5" onclick={() => navigate('/')}>Back to dashboard</button>
  </div>
</div>
