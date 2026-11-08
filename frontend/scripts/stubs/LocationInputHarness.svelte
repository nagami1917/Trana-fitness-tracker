<script>
  import CityRegionInput from '../../src/components/common/CityRegionInput.svelte';

  let city = $state('Original City');
  let locating = $state(false);
</script>

<CityRegionInput id="test-city" bind:value={city} bind:busy={locating} />
<output id="bound-city">{city}</output>
<button id="save" disabled={locating} onclick={() => window.locationTestSaves.push(city)}>Save</button>
