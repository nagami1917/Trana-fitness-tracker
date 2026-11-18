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
 * Convert every baseline row from one display unit to another.
 *
 * Rows store raw numbers in whatever unit was on screen when they were typed,
 * alongside a `mode` that says what the number *means*. Changing the unit
 * without converting leaves a 5 km session reading "5 mi" — a 61% distance
 * error that the model would accept. Weight, height and temperature convert on
 * the fly in onboarding for the same reason.
 *
 * Returns new row objects; never mutates.
 */
export function convertRows(rows, fromUnits, toUnits) {
  const from = fromUnits === 'imperial' ? 'imperial' : 'metric';
  const to = toUnits === 'imperial' ? 'imperial' : 'metric';
  if (from === to) return rows;

  const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

  return rows.map((row) => {
    const distance = Number(row.distance);
    // Distance is in display units, so it scales by the unit factor.
    const nextDistance = distance > 0
      ? round(to === 'imperial' ? distance * MILES_PER_KM : distance * KM_PER_MILE, 2)
      : row.distance;

    const next = { ...row, distance: nextDistance };

    if (row.mode === 'speed') {
      // Speed is distance per hour, so it scales the same way as distance.
      const speed = Number(row.speed);
      next.speed = speed > 0
        ? round(to === 'imperial' ? speed * MILES_PER_KM : speed * KM_PER_MILE, 1)
        : row.speed;
    } else if (row.mode === 'pace') {
      // Pace is minutes per unit — the reciprocal, so it scales the other way.
      const pace = Number(row.pace);
      next.pace = pace > 0
        ? round(to === 'imperial' ? pace * KM_PER_MILE : pace * MILES_PER_KM, 2)
        : row.pace;
    }
    // mode === 'time': duration and elevation are unit-independent.

    return next;
  });
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

/**
 * Would the duration model actually *use* this saved session?
 *
 * `validRow` only answers "is this row complete?". A saved row can be complete
 * and still be discarded, and then the UI shows a session the model ignores —
 * which is exactly how an athlete ends up reading "2 sessions" next to an
 * estimate built from none. The two ways a complete row is still unusable:
 *
 * 1. its speed falls outside SPEED_BOUNDS_KMH for its sport, so
 *    validHistoryPoints() drops it before the curve is fitted;
 * 2. it belongs to a different sport than the one being planned — the curve
 *    is fitted per activity type, so two walks can never inform a ride.
 *
 * The bounds below mirror ml/duration_model/preprocess.py::SPEED_BOUNDS_KMH
 * via the same constant the entry form enforces, so all three layers agree.
 */
export function rowUsable(row, units) {
  const km = rowDistanceKm(row, units);
  const minutes = rowMinutes(row);
  if (!(km > 0) || !(minutes > 0)) return false;
  const speed = km / (minutes / 60);
  const [min, max] = SPEED_BOUNDS_KMH[row.activity_type] ?? [0.5, 60];
  return speed >= min && speed <= max;
}

/** Why a saved session cannot be used, in the athlete's words. '' when it can. */
export function unusableReason(row, units) {
  if (rowUsable(row, units)) return '';
  const km = rowDistanceKm(row, units);
  const minutes = rowMinutes(row);
  if (!(km > 0) || !(minutes > 0)) {
    return 'This session has no usable distance or time.';
  }
  const speed = km / (minutes / 60);
  const [min, max] = SPEED_BOUNDS_KMH[row.activity_type] ?? [0.5, 60];
  const label = activityLabel(row.activity_type).toLowerCase();
  return `${speed.toFixed(1)} km/h is outside what the model accepts for ${label} (${min}–${max} km/h).`;
}

/**
 * Split the athlete's saved sessions into what the model counts and what it
 * does not, for one planned sport.
 *
 * `savedSessions` are API rows: { activity_type, distance_km, duration_min,
 * elevation_gain_m }. They are already metric, so they are adapted to the row
 * shape rather than being re-entered in a display unit.
 *
 * Returns counts plus the reason text the UI should show, so the number on
 * screen and the number the model used can never drift apart.
 */
export function sessionUsability(savedSessions = [], plannedType) {
  const ofType = [];
  const otherSports = [];

  for (const saved of savedSessions) {
    const row = {
      activity_type: saved.activity_type,
      distance: Number(saved.distance_km) || 0,
      duration_min: Number(saved.duration_min) || 0,
      elevation_gain_m: saved.elevation_gain_m ?? 0,
      mode: 'time',
    };
    if (saved.activity_type !== plannedType) {
      otherSports.push(saved);
      continue;
    }
    ofType.push({ saved, usable: rowUsable(row, 'metric'), reason: unusableReason(row, 'metric') });
  }

  const usable = ofType.filter((entry) => entry.usable);
  const rejected = ofType.filter((entry) => !entry.usable);

  return {
    /** Sessions of the planned sport the model can fit a curve from. */
    usableCount: usable.length,
    /** Sessions of the planned sport that exist but were discarded by the model. */
    rejectedCount: rejected.length,
    /** Sessions of other sports — real data, but irrelevant to this sport's curve. */
    otherSportCount: otherSports.length,
    /** One human sentence covering whichever case applies. '' when usable >= 2. */
    note: usabilityNote({
      usableCount: usable.length,
      rejectedCount: rejected.length,
      otherSportCount: otherSports.length,
      plannedType,
    }),
  };
}

function usabilityNote({ usableCount, rejectedCount, otherSportCount, plannedType }) {
  const sport = activityLabel(plannedType).toLowerCase();

  if (usableCount >= 2) return '';

  if (usableCount === 1) {
    return `Only 1 usable ${sport} session — the model needs 2 to fit your pace, so this estimate is blended with a generic pace.`;
  }

  // usableCount === 0
  if (rejectedCount > 0) {
    const one = rejectedCount === 1;
    const headline = one
      ? `Your 1 ${sport} session is saved but not usable`
      : `Your ${rejectedCount} ${sport} sessions are saved but not usable`;
    const reason = one
      ? 'it falls outside the pace'
      : 'they fall outside the pace';
    return `${headline} — ${reason} the model accepts, so this estimate uses a generic pace. Fix ${one ? 'it' : 'them'} in Settings → Past sessions.`;
  }
  if (otherSportCount > 0) {
    return `You have ${otherSportCount} saved session${otherSportCount === 1 ? '' : 's'}, but none for ${sport} — each sport learns its own pace, so this estimate is generic.`;
  }
  return '';
}

/**
 * A realistic example for each sport, in the unit that sport is entered in.
 *
 * These are placeholders, so they are also the strongest hint the form gives:
 * an athlete who has no idea what to type will copy them. Showing `6.0` for
 * walking (10 km/h) pointed at a pace outside walking's own 3–8 km/h band, so
 * following the placeholder produced a row the model rejects. Each value here
 * sits inside TYPICAL_SPEED_KMH for its sport, expressed the way it is typed:
 * pace sports get min/unit, cycling gets km/h.
 */
export const EXAMPLE_ENTRY = {
  run: { pace: 5.5, speed: 10.9, distance: 5, duration_min: 28 },
  ride: { pace: 2.9, speed: 21, distance: 25, duration_min: 71 },
  walk: { pace: 9.5, speed: 6.3, distance: 4, duration_min: 38 },
  hike: { pace: 15, speed: 4.0, distance: 8, duration_min: 120 },
};

/** The placeholder for one input, or '' when the sport has no example. */
export function exampleFor(type, field) {
  const entry = EXAMPLE_ENTRY[type];
  if (!entry) return '';
  const value = entry[field];
  return value === undefined || value === '' ? '' : String(value);
}
