/**
 * Past-session (baseline) entry logic, shared by onboarding and Settings.
 *
 * One form, one set of rules. The duration model fits a pace curve per sport
 * from these rows, so a row that is silently wrong is worse than a row that is
 * missing: it looks like history and it moves every future prediction.
 *
 * The rules that matter, and why:
 *
 * 1. **Pace and speed are reciprocals.** A cyclist reading "pace (min/km)"
 *    types their speed by reflex: `20.2` meant as km/h is 2.97 km/h as pace —
 *    a ~7x error that still lands inside the model's accepted speed window,
 *    so nothing rejects it. Each sport therefore gets the unit it is actually
 *    thought about in (riders think km/h, runners think min/km), and the
 *    derived equivalent is always shown next to it.
 *
 * 2. **Hard bounds are not enough.** The model discards rows outside
 *    SPEED_BOUNDS_KMH, but the window is wide enough to accept nonsense.
 *    TYPICAL_SPEED_KMH adds a much tighter *soft* band that only warns.
 *
 * 3. **The caller posts kilometres and minutes.** Whatever unit the athlete
 *    typed in, `toPayloadValue` normalises it, so the API never has to guess.
 */

/** The four sports the model knows. Mirrors App\Models\Activity::TYPES. */
export const ACTIVITY_TYPES = [
  { id: 'run', label: 'Running', hint: 'Road, trail or treadmill' },
  { id: 'ride', label: 'Cycling', hint: 'Road or gravel' },
  { id: 'walk', label: 'Walking', hint: 'Easy or brisk' },
  { id: 'hike', label: 'Hiking', hint: 'Trail with climbing' },
];

/**
 * How each sport is most naturally remembered.
 *
 * `pace` => minutes per distance unit (runners, walkers, hikers)
 * `speed` => distance units per hour (cyclists)
 */
export const DEFAULT_ENTRY_UNIT = {
  run: 'pace',
  walk: 'pace',
  hike: 'pace',
  ride: 'speed',
};

/**
 * Hard bounds, in km/h. MUST match
 * backend BaselineActivityController::SPEED_BOUNDS_KMH, which mirrors
 * ml/duration_model/preprocess.py::SPEED_BOUNDS_KMH.
 *
 * Outside these the model silently drops the row, so the UI must block.
 */
export const SPEED_BOUNDS_KMH = {
  run: [2.5, 30],
  ride: [1.5, 65],
  walk: [0.5, 14],
  hike: [0.5, 14],
};

/**
 * Plausible everyday speeds, in km/h. Deliberately *inside* the hard bounds:
 * these warn rather than block, because a genuinely slow or fast athlete is
 * allowed to exist — they just deserve to be told the number looks unusual.
 */
export const TYPICAL_SPEED_KMH = {
  run: [6, 18],
  ride: [12, 40],
  walk: [3, 8],
  hike: [2, 7],
};

/** Coarse recency, so nobody has to recall an exact day. */
export const PERIODS = [
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'few_months', label: 'A few months ago' },
  { id: 'longer_ago', label: 'Longer ago' },
];

/** Two rows per sport is what the model needs to fit a curve. */
export const MAX_ROWS_PER_SPORT = 2;

const MILES_PER_KM = 0.621371;
const KM_PER_MILE = 1.609344;

export function activityLabel(id) {
  return ACTIVITY_TYPES.find((type) => type.id === id)?.label ?? id;
}

/** A blank row in the shape the form binds to. */
export function blankRow(type) {
  return {
    activity_type: type,
    // Start in the unit this sport is normally remembered in, so the athlete
    // is not silently nudged into "distance + time" (which throws away the
    // pace information they actually recall).
    mode: DEFAULT_ENTRY_UNIT[type] ?? 'pace',

    distance: '', // in the athlete's display unit
    duration_min: '',
    pace: '', // minutes per display distance unit
    speed: '', // display distance units per hour
    elevation_gain_m: '',
    performed_period: 'last_week',
  };
}

/**
 * Migrate a row saved before the speed option existed.
 * `mode: 'pace'` keeps working; nothing is silently reinterpreted.
 */
export function normaliseRow(row, type) {
  const mode = ['time', 'pace', 'speed'].includes(row?.mode) ? row.mode : 'time';
  return { ...blankRow(type), ...row, activity_type: type, mode };
}

function displayDistanceUnit(units) {
  return units === 'imperial' ? 'mi' : 'km';
}

/** Minutes of moving time, whichever way the athlete expressed the session. */
export function rowMinutes(row) {
  const distance = Number(row.distance);
  if (!(distance > 0)) return 0;

  if (row.mode === 'pace') {
    const pace = Number(row.pace);
    if (!(pace > 0)) return 0;
    // pace is minutes per *display* unit, distance is in display units, so the
    // product is minutes with no conversion needed.
    return pace * distance;
  }

  if (row.mode === 'speed') {
    const speed = Number(row.speed);
    if (!(speed > 0)) return 0;
    // display units per hour -> hours -> minutes
    return (distance / speed) * 60;
  }

  const minutes = Number(row.duration_min);
  return minutes > 0 ? minutes : 0;
}

/** Kilometres, converted out of whatever display unit was typed. */
export function rowDistanceKm(row, units) {
  const distance = Number(row.distance);
  if (!(distance > 0)) return 0;
  return units === 'imperial' ? distance * KM_PER_MILE : distance;
}

/** Moving speed in km/h — the unit the model and the guards speak. */
export function rowSpeedKmh(row, units) {
  const km = rowDistanceKm(row, units);
  const minutes = rowMinutes(row);
  if (!(km > 0) || !(minutes > 0)) return 0;
  return km / (minutes / 60);
}

/**
 * The athlete-facing equivalent of what they typed.
 *
 * The whole point of this is the reciprocal check: if someone types a speed
 * into a pace box, the derived line reads back a number they instantly
 * recognise as wrong.
 */
export function derivedReadout(row, units) {
  const speed = rowSpeedKmh(row, units);
  const km = rowDistanceKm(row, units);
  if (!(speed > 0) || !(km > 0)) return '';

  const unit = displayDistanceUnit(units);
  const paceMin = 60 / (units === 'imperial' ? speed / KM_PER_MILE : speed);

  if (row.mode === 'speed') {
    // Show what that speed means as pace, since pace is what the model fits.
    const mm = Math.floor(paceMin);
    const ss = Math.round((paceMin - mm) * 60);
    return `${mm}:${String(ss).padStart(2, '0')} /${unit} · ${formatDuration(rowMinutes(row))}`;
  }
  if (row.mode === 'pace') {
    const speedDisplay = units === 'imperial' ? speed * MILES_PER_KM : speed;
    return `${speedDisplay.toFixed(1)} ${unit}/h · ${formatDuration(rowMinutes(row))}`;
  }
  const speedDisplay = units === 'imperial' ? speed * MILES_PER_KM : speed;
  return `${speedDisplay.toFixed(1)} ${unit}/h`;
}

/** "48 min" / "1 h 05 min" — short, because it sits in a pill. */
export function formatDuration(minutes) {
  if (!(minutes > 0)) return '';
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

/** A row is complete when everything the model needs is present. */
export function validRow(row, units) {
  const km = rowDistanceKm(row, units);
  if (!(km >= 0.1 && km <= 500)) return false;

  const minutes = rowMinutes(row);
  if (!(minutes >= 1 && minutes <= 1440)) return false;

  const elevation = row.elevation_gain_m === '' ? 0 : Number(row.elevation_gain_m);
  if (!(elevation >= 0 && elevation <= 12000)) return false;

  return true;
}

/**
 * Blocking problem: the model would discard this row, so it must not save.
 * Returns '' when the row is acceptable.
 */
export function hardError(row, units) {
  if (!validRow(row, units)) return '';
  const speed = rowSpeedKmh(row, units);
  const [min, max] = SPEED_BOUNDS_KMH[row.activity_type] ?? [0.5, 60];
  if (speed >= min && speed <= max) return '';

  const label = activityLabel(row.activity_type).toLowerCase();
  return `That works out to ${speed.toFixed(1)} km/h, which the model can't use for ${label} (${min}–${max} km/h). Check the distance and ${modeLabel(row.mode)}.`;
}

/**
 * Non-blocking warning: inside the model's bounds, outside what is normal.
 * This is what catches "typed speed into the pace box".
 */
export function softWarning(row, units) {
  if (!validRow(row, units)) return '';
  if (hardError(row, units)) return '';

  const speed = rowSpeedKmh(row, units);
  const [lo, hi] = TYPICAL_SPEED_KMH[row.activity_type] ?? [1, 50];
  if (speed >= lo && speed <= hi) return '';

  const label = activityLabel(row.activity_type).toLowerCase();
  const hint =
    row.mode === 'pace'
      ? `Pace is minutes per unit — if you meant speed, switch to “Distance + speed”.`
      : row.mode === 'speed'
        ? `Speed is distance per hour — if you meant pace, switch to “Distance + pace”.`
        : `Check the distance and time.`;
  return `${speed.toFixed(1)} km/h is unusual for ${label} (normally ${lo}–${hi} km/h). ${hint}`;
}

export function modeLabel(mode) {
  if (mode === 'pace') return 'pace';
  if (mode === 'speed') return 'speed';
  return 'time';
}

/** What the "How do you remember it?" dropdown offers for one sport. */
export function modeOptions(type) {
  const preferred = DEFAULT_ENTRY_UNIT[type] ?? 'pace';
  const first = preferred === 'speed'
    ? { id: 'speed', label: 'Distance + speed' }
    : { id: 'pace', label: 'Distance + pace' };
  const second = preferred === 'speed'
    ? { id: 'pace', label: 'Distance + pace' }
    : { id: 'speed', label: 'Distance + speed' };
  return [first, second, { id: 'time', label: 'Distance + time' }];
}

/**
 * The API payload for one row: always kilometres and minutes, so the server
 * never has to interpret a unit.
 */
export function toPayload(row, units) {
  const km = rowDistanceKm(row, units);
  const minutes = rowMinutes(row);
  return {
    activity_type: row.activity_type,
    distance_km: Math.round(km * 100) / 100,
    duration_min: Math.round(minutes * 100) / 100,
    elevation_gain_m: row.elevation_gain_m === '' ? 0 : Number(row.elevation_gain_m),
    performed_period: row.performed_period,
  };
}

/**
 * Rebuild an editable row from an API row, which is always metric.
 * Used by the Settings editor so a saved session can be corrected.
 */
export function fromApiRow(saved, units) {
  const km = Number(saved?.distance_km) || 0;
  const minutes = Number(saved?.duration_min) || 0;
  const distance = units === 'imperial' ? km * MILES_PER_KM : km;
  const type = saved?.activity_type;
  const mode = DEFAULT_ENTRY_UNIT[type] ?? 'pace';

  const row = blankRow(type);
  row.distance = distance ? String(Math.round(distance * 100) / 100) : '';
  row.elevation_gain_m = saved?.elevation_gain_m ? String(saved.elevation_gain_m) : '';
  row.performed_period = 'last_week';
  row.mode = mode;

  if (mode === 'speed') {
    const hours = minutes / 60;
    row.speed = hours > 0 ? String(Math.round((distance / hours) * 10) / 10) : '';
  } else {
    row.pace = distance > 0 ? String(Math.round((minutes / distance) * 100) / 100) : '';
  }
  // Keep minutes so a partially-filled row still validates.
  row.duration_min = minutes ? String(Math.round(minutes * 10) / 10) : '';
  return row;
}
