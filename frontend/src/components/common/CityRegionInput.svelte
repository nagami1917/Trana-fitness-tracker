<script>
  import { LocateFixed, X } from 'lucide-svelte';
  import { detectCityRegion } from '../../lib/location.js';

  let { value = $bindable(''), busy = $bindable(false), disabled = false, id = 'city' } = $props();
  let message = $state('');
  let tone = $state('neutral');
  let controller;

  function cancelDetection() {
    if (!controller) return;
    controller.abort();
    controller = null;
    busy = false;
    message = 'Location detection cancelled. Your entry was kept.';
    tone = 'neutral';
  }

  function handleInput() {
    if (controller) cancelDetection();
    else message = '';
  }

  async function useCurrentLocation() {
    if (busy) return;
    const initialValue = value;
    const request = new AbortController();
    controller = request;
    busy = true;
    tone = 'neutral';
    message = 'Finding your device location…';
    try {
      const detected = await detectCityRegion({
        signal: request.signal,
        onLookup: () => { message = 'Finding your city or region…'; },
      });
      if (request.signal.aborted) return;
      if (value !== initialValue) {
        message = 'The field changed while locating; your entry was kept.';
        return;
      }
      value = detected;
      message = 'Location found. You can edit it before saving.';
      tone = 'success';
    } catch (error) {
      if (request.signal.aborted) return;
      message = error?.message || 'Location could not be detected. Please enter it manually.';
      tone = 'error';
    } finally {
      if (controller === request) {
        controller = null;
        busy = false;
      }
    }
  }

  $effect(() => {
    return () => {
      controller?.abort();
      busy = false;
    };
  });
</script>

<div>
  <label class="label" for={id}>City / region</label>
  <input
    {id}
    class="input"
    placeholder="City, region"
    maxlength="120"
    autocomplete="address-level2"
    aria-describedby="{id}-notice {id}-status"
    bind:value
    oninput={handleInput}
  />
  <p id="{id}-notice" class="mt-2 text-[11px] font-semibold leading-relaxed text-ink-400">
    Optional: detection sends your coordinates and IP to
    <a class="underline hover:text-brand-700" href="https://www.bigdatacloud.com/privacy-and-cookie-policy" target="_blank" rel="noopener noreferrer">BigDataCloud</a>,
    which uses them to improve its IP geolocation. TRANA stores the city / region, not the coordinates, when you save.
  </p>
  <button
    type="button"
    class="btn-chip mt-2 disabled:cursor-not-allowed disabled:opacity-50"
    onclick={busy ? cancelDetection : useCurrentLocation}
    disabled={disabled && !busy}
    aria-describedby={busy ? undefined : `${id}-notice`}
  >
    {#if busy}<X size={14} /> Cancel detection{:else}<LocateFixed size={14} /> Use current location{/if}
  </button>
  <p
    id="{id}-status"
    aria-live="polite"
    class="mt-1 text-[11px] font-bold leading-relaxed {tone === 'error' ? 'text-rose-600' : tone === 'success' ? 'text-emerald-700' : 'text-ink-500'}"
  >{message}</p>
</div>
