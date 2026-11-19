import { render } from 'svelte/server';
import FuelingPlan from '../src/components/fueling/FuelingPlan.svelte';

export default function renderPlan(plan) {
  const { body } = render(FuelingPlan, { props: { plan } });
  return body;
}
