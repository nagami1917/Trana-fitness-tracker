<script>
  let { class: cls = '', padded = true, soft = false, flat = false, children } = $props();
</script>

<div class="{flat ? 'card-flat' : soft ? 'card-soft' : 'card'} {padded ? 'p-4 sm:p-6' : ''} {cls}">
  {@render children?.()}
</div>
