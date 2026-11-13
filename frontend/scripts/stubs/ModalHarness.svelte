<script>
  import Modal from '../../src/components/common/Modal.svelte';

  let open = $state(false);
  let openerBtn = $state(null);

  export function getOpener() {
    return openerBtn;
  }
</script>

<button bind:this={openerBtn} id="modal-opener" type="button" onclick={() => (open = true)}>Open modal</button>

<Modal {open} title="Sample modal" onclose={() => (open = false)}>
  <p>Modal content</p>
  <button id="modal-close-inside" type="button" onclick={() => (open = false)}>Done</button>
</Modal>
