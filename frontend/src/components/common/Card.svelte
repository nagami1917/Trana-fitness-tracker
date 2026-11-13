<script>
  let { class: cls = '', padded = true, soft = false, children } = $props();
</script>

<div class="{soft ? 'card-soft' : 'card'} {padded ? 'p-4 sm:p-6' : ''} {cls}">
  {@render children?.()}
</div>
