<script>
  /**
   * Layout for pages that anyone can open — Preview, Privacy and Terms.
   * Brand header + centered content + footer, no app shell / sidebar.
   */
  import Logo from './Logo.svelte';
  import Footer from './Footer.svelte';

  let { children } = $props();
</script>

<div class="flex min-h-full min-h-[100dvh] flex-col bg-brand-50/40">
  <header class="flex justify-center px-4 pt-5 sm:px-6">
    <Logo size={36} />
  </header>

  <main class="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
    {@render children?.()}
  </main>

  <Footer />
</div>
