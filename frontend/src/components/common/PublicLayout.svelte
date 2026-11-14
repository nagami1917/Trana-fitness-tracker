<script>
  /** Public pages use a lightweight header with the same auth entry points. */
  import Logo from './Logo.svelte';
  import Footer from './Footer.svelte';
  import { session } from '../../stores/index.js';
  import { link } from '../../lib/router.js';

  let { children } = $props();
</script>

<div class="flex min-h-full min-h-[100dvh] flex-col bg-brand-50/40">
  <header class="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 pt-5 sm:px-6">
    <Logo size={36} />
    <nav class="flex items-center gap-2" aria-label="Account navigation">
      {#if $session}
        <a href="/" use:link class="rounded-xl bg-brand-gradient px-4 py-2.5 text-xs font-extrabold text-white shadow-soft transition hover:shadow-glow sm:text-sm">Go to TRANA</a>
      {:else}
        <a href="/login" use:link class="rounded-xl px-3 py-2.5 text-xs font-extrabold text-ink-600 transition hover:bg-white hover:text-brand-700 sm:px-4 sm:text-sm">Sign In</a>
        <a href="/register" use:link class="rounded-xl bg-brand-gradient px-4 py-2.5 text-xs font-extrabold text-white shadow-soft transition hover:shadow-glow sm:px-5 sm:text-sm">Create account</a>
      {/if}
    </nav>
  </header>

  <main class="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
    {@render children?.()}
  </main>

  <Footer />
</div>
