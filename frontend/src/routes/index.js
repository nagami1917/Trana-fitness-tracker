/**
 * Central route table — the single place mapping URL paths to pages.
 * App.svelte renders ROUTES[$route] inside the shell; public routes
 * (login/register/onboarding) are handled separately.
 */
import Dashboard from '../pages/Dashboard/Dashboard.svelte';
import PlanActivity from '../pages/PlanActivity/PlanActivity.svelte';
import Track from '../pages/Track/Track.svelte';
import TrackHistory from '../pages/Track/History.svelte';
import TrackSession from '../pages/Track/SessionDetail.svelte';
import Activities from '../pages/Activities/Activities.svelte';
import Analytics from '../pages/Analytics/Analytics.svelte';
import Fueling from '../pages/Fueling/Fueling.svelte';
import Goals from '../pages/Goals/Goals.svelte';
import Profile from '../pages/Profile/Profile.svelte';
import Settings from '../pages/Settings/Settings.svelte';

export const ROUTES = {
  '/': Dashboard,
  '/plan': PlanActivity,
  '/track': Track,
  '/track/history': TrackHistory,
  '/track/session': TrackSession,
  '/activities': Activities,
  '/analytics': Analytics,
  '/fueling': Fueling,
  '/goals': Goals,
  '/profile': Profile,
  '/settings': Settings,
};
