<script>
  import TranaMap from '../../src/components/map/TranaMap.svelte';

  let plannedRoute = $state(null);
  let plannedWaypoints = $state([]);
  let routeDashed = $state(false);
  let showRoads = $state(false);
  let interactiveRoute = $state(true);
  let currentPosition = $state(null);
  let following = $state(true);

  export function setRouteState(next) {
    if ('plannedRoute' in next) plannedRoute = next.plannedRoute;
    if ('plannedWaypoints' in next) plannedWaypoints = next.plannedWaypoints;
    if ('routeDashed' in next) routeDashed = next.routeDashed;
    if ('showRoads' in next) showRoads = next.showRoads;
    if ('interactiveRoute' in next) interactiveRoute = next.interactiveRoute;
    if ('currentPosition' in next) currentPosition = next.currentPosition;
    if ('following' in next) following = next.following;
  }

  export function getFollowing() {
    return following;
  }
</script>

<TranaMap
  {plannedRoute}
  {plannedWaypoints}
  {routeDashed}
  {showRoads}
  {interactiveRoute}
  {currentPosition}
  bind:following
/>
