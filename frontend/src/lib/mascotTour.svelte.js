/**
 * App-wide TRANA cat mascot welcome tour controller.
 *
 * Automatically greets new users when they enter the authenticated app (either
 * right after finishing/skipping Onboarding or on first visit with empty
 * history), walks them step-by-step across the core pages, persists completion
 * per user in localStorage, and can be replayed anytime via `start()`.
 */
import { get } from 'svelte/store';
import { navigate, route } from './router.js';
import { session } from '../stores/index.js';

const SEEN_PREFIX = 'trana:tour_seen:';
const PENDING_PREFIX = 'trana:tour_pending:';

export const TOUR_STEPS = [
  {
    id: 'welcome',
    badge: 'Welcome guide',
    title: (firstName) => `Hi ${firstName}! I’m your TRANA cat guide`,
    body: 'Welcome to TRANA! Let me show you around so you can plan routes, track workouts live, fuel smart, and hit your goals.',
    tip: 'Follow along for a 30-second tour, or skip anytime and reopen me from the Guide button.',
    route: null,
    selector: null,
    centered: true,
    cta: 'Show me around',
  },
  {
    id: 'dashboard',
    badge: 'Dashboard',
    title: 'Your daily command center',
    body: 'See your live Track Activity card, today’s calories burned, distance, active minutes, and weekly progress all in one place.',
    tip: 'Whenever you start GPS tracking, a live status card updates right here on Dashboard too.',
    route: '/',
    selector: '[data-tour="dashboard-overview"]',
    centered: false,
    cta: 'Next',
  },
  {
    id: 'plan',
    badge: 'Plan Activity',
    title: 'Build routes & predict fueling',
    body: 'Pick your sport and tap Start and Destination on the map. TRANA calculates finish time plus carbs, sodium, and fluids to pack.',
    tip: 'Save a plan to add it to your Week Calendar or load the route into Track Activity.',
    route: '/plan',
    selector: '[data-tour="plan-activity-card"]',
    centered: false,
    cta: 'Next',
  },
  {
    id: 'track',
    badge: 'Track Activity',
    title: 'Record live GPS workouts',
    body: 'Start Free GPS, draw a custom path, or follow a saved plan. Recording keeps running smoothly even if you switch pages.',
    tip: 'Tap End & save when done to record your map and automatically update Dashboard.',
    route: '/track',
    selector: '[data-tour="track-controls-header"]',
    centered: false,
    cta: 'Next',
  },
  {
    id: 'activities',
    badge: 'Activities & Analytics',
    title: 'Logbook & progress trends',
    body: 'Every GPS run or manually logged workout lives here — feeding your Analytics pace trends, personal bests, and duration model.',
    tip: 'Need to add a treadmill session or older workout? Tap Log activity anytime.',
    route: '/activities',
    selector: '[data-tour="activities-header"]',
    centered: false,
    cta: 'Next',
  },
  {
    id: 'goals',
    badge: 'Goals & Fueling',
    title: 'Targets & nutrition calculator',
    body: 'Set your daily and weekly calorie, distance, and active-minute targets here, or open Fueling anytime for quick nutrition guidance.',
    tip: 'Your daily goal ring fills automatically as you save workouts.',
    route: '/goals',
    selector: '[data-tour="goals-header"]',
    centered: false,
    cta: 'Next',
  },
  {
    id: 'complete',
    badge: 'All set!',
    title: 'You’re ready for your first move',
    body: 'That’s the quick tour! Whenever you want me to show you around again, just click the Guide button in the top bar.',
    tip: 'Ready to plan your first route or explore Dashboard on your own?',
    route: '/',
    selector: '[data-tour="tour-replay"]',
    centered: true,
    cta: 'Start exploring',
  },
];

let open = $state(false);
let stepIndex = $state(0);
let activeUserId = $state(null);
let checkedUserId = null;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function seenKey(userId) {
  return userId ? `${SEEN_PREFIX}${userId}` : null;
}

function pendingKey(userId) {
  return userId ? `${PENDING_PREFIX}${userId}` : null;
}

function hasSeenTour(userId) {
  if (!canUseStorage() || !userId) return false;
  try {
    return Boolean(localStorage.getItem(seenKey(userId)));
  } catch {
    return false;
  }
}

function hasPendingTour(userId) {
  if (!canUseStorage() || !userId) return false;
  try {
    return localStorage.getItem(pendingKey(userId)) === '1';
  } catch {
    return false;
  }
}

function markSeen(userId, outcome = 'completed') {
  if (!canUseStorage() || !userId) return;
  try {
    localStorage.setItem(seenKey(userId), outcome);
    localStorage.removeItem(pendingKey(userId));
  } catch {
    // ignore storage errors
  }
}

function queueForUser(userId) {
  if (!canUseStorage() || !userId) return;
  try {
    localStorage.setItem(pendingKey(userId), '1');
    localStorage.removeItem(seenKey(userId));
  } catch {
    // ignore storage errors
  }
}

function syncRouteForStep(index) {
  if (typeof window === 'undefined') return;
  const target = TOUR_STEPS[index]?.route;
  if (!target) return;
  if (get(route) !== target) {
    navigate(target, { scroll: false });
  }
}

function start({ reset = true, userId = activeUserId } = {}) {
  if (userId) activeUserId = userId;
  checkedUserId = activeUserId;
  if (reset) stepIndex = 0;
  open = true;
  syncRouteForStep(stepIndex);
}

function maybeAutoStart({
  userId,
  onboarded = true,
  activitiesCount = 0,
  totalActivities = null,
  plansCount = 0,
} = {}) {
  if (typeof window === 'undefined' || !userId || onboarded === false) return false;
  activeUserId = userId;
  if (checkedUserId === userId) return false;
  checkedUserId = userId;

  const pending = hasPendingTour(userId);
  const count = totalActivities ?? activitiesCount ?? 0;
  const isFreshAccount = count === 0 && (plansCount ?? 0) === 0;

  if (pending || (!hasSeenTour(userId) && isFreshAccount)) {
    if (pending) {
      try {
        localStorage.removeItem(pendingKey(userId));
      } catch {
        // ignore
      }
    }
    stepIndex = 0;
    open = true;
    return true;
  }
  return false;
}

function goTo(index) {
  const clamped = Math.max(0, Math.min(TOUR_STEPS.length - 1, Number(index) || 0));
  stepIndex = clamped;
  syncRouteForStep(clamped);
}

function next() {
  if (stepIndex >= TOUR_STEPS.length - 1) {
    finish();
    return;
  }
  goTo(stepIndex + 1);
}

function prev() {
  if (stepIndex <= 0) return;
  goTo(stepIndex - 1);
}

function skip() {
  markSeen(activeUserId, 'skipped');
  open = false;
}

function finish(nextRoute = null) {
  markSeen(activeUserId, 'completed');
  open = false;
  if (nextRoute && typeof window !== 'undefined' && get(route) !== nextRoute) {
    navigate(nextRoute);
  }
}

function resetForTests() {
  open = false;
  stepIndex = 0;
  activeUserId = null;
  checkedUserId = null;
}

session.subscribe((user) => {
  const nextId = user?.id ?? null;
  if (!nextId) {
    open = false;
    activeUserId = null;
    checkedUserId = null;
    return;
  }
  if (nextId !== activeUserId) {
    activeUserId = nextId;
    checkedUserId = null;
  }
});

const currentStep = $derived(TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0]);

export const mascotTour = {
  get open() { return open; },
  get stepIndex() { return stepIndex; },
  get totalSteps() { return TOUR_STEPS.length; },
  get currentStep() { return currentStep; },
  get isFirst() { return stepIndex === 0; },
  get isLast() { return stepIndex >= TOUR_STEPS.length - 1; },

  queueForUser,
  hasSeenTour,
  maybeAutoStart,
  start,
  goTo,
  next,
  prev,
  skip,
  finish,
  resetForTests,
};
