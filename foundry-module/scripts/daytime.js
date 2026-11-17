/**
 * The clock's day: 16 segments of equal length, 8 of day from 06:00 and 8 of night from 18:00
 * (1.5 hours each on a 24-hour calendar). No Foundry calls here, so the tests can run it.
 */

export const SEGMENTS_PER_PHASE = 8;

/** Each segment's name key (lang GMM.Clock.<key>) and the scene darkness it brings (0 bright, 1 dark). */
export const SEGMENTS = [
  { key: "Dawn", darkness: 0.35 },
  { key: "EarlyMorning", darkness: 0.15 },
  { key: "Morning", darkness: 0.05 },
  { key: "LateMorning", darkness: 0 },
  { key: "Midday", darkness: 0 },
  { key: "Afternoon", darkness: 0 },
  { key: "LateAfternoon", darkness: 0.1 },
  { key: "Dusk", darkness: 0.3 },
  { key: "Nightfall", darkness: 0.6 },
  { key: "Evening", darkness: 0.75 },
  { key: "Night", darkness: 0.85 },
  { key: "LateNight", darkness: 0.9 },
  { key: "Midnight", darkness: 0.95 },
  { key: "SmallHours", darkness: 0.9 },
  { key: "BeforeDawn", darkness: 0.8 },
  { key: "FirstLight", darkness: 0.65 },
];

/** Foundry switches Global Illumination off above this darkness: every night segment, no day one. */
export const DAYLIGHT_UNTIL = 0.5;
/** Lamps shine from this darkness (core LAMPS_LIT_FROM). Below it daylight is bright light; from it to DAYLIGHT_UNTIL, dim. */
export const LAMPS_LIT_FROM = 0.25;
/** City and world maps (scenes without token vision) darken no further than this at night, so they stay readable. */
export const OVERVIEW_DARKEST = 0.6;

const mod = (a, n) => ((a % n) + n) % n;

/** A night segment: from nightfall to first light, when Global Illumination is out. */
export const isNight = (i) => SEGMENTS[i].darkness > DAYLIGHT_UNTIL;

/** Which segment (0 to 15, 0 = the first of the day) a time of day falls in. */
export function segmentOf(secondsIntoDay, secondsPerDay) {
  const len = secondsPerDay / SEGMENTS.length;
  return Math.min(SEGMENTS.length - 1, Math.floor(mod(secondsIntoDay - secondsPerDay / 4, secondsPerDay) / len));
}

/**
 * Seconds to add to the world time to reach the start of the next segment (step 1) or of the
 * previous one (step -1). From the middle of a segment, step 1 goes to the next one's start.
 */
export function stepSeconds(secondsIntoDay, secondsPerDay, step) {
  const len = secondsPerDay / SEGMENTS.length;
  const into = mod(secondsIntoDay - secondsPerDay / 4, len);
  return Math.round(step > 0 ? len - into : -(into + len));
}

/**
 * The segment a world time falls in, counted from the start of world time (segment 0 starts at
 * 06:00 on the first day; the hours before it are segments -4 to -1). Its remainder by 16 is the
 * segment of the day.
 */
export function absoluteSegment(worldTime, secondsPerDay) {
  return Math.floor((worldTime - secondsPerDay / 4) / (secondsPerDay / SEGMENTS.length));
}

/** The world time a segment (counted as absoluteSegment does) starts at. */
export function segmentStart(n, secondsPerDay) {
  return secondsPerDay / 4 + n * (secondsPerDay / SEGMENTS.length);
}

/** Where a segment starts and ends, in seconds into the day. */
export function segmentSpan(i, secondsPerDay) {
  const len = secondsPerDay / SEGMENTS.length;
  const start = mod(secondsPerDay / 4 + i * len, secondsPerDay);
  return [start, mod(start + len, secondsPerDay)];
}

/** The darkest a dim sky (`dim`, weather.js) makes the day: Global Illumination stays on. */
export const OVERCAST_DARKEST = 0.45;

/**
 * The scene lighting of a segment: its darkness, and Global Illumination that goes out at night.
 * Bad weather (`dim`) darkens the day, never past OVERCAST_DARKEST; a heavy storm lights the lamps.
 * An overview map gets a softer night; a city with a night image shows the night in the picture
 * itself, so no darkness goes on top of it.
 */
export function lightingFor(i, { overview = false, nightImage = false, dim = 0 } = {}) {
  const night = isNight(i);
  let d = SEGMENTS[i].darkness;
  if (!night && dim > 0) d = Math.round(Math.min(OVERCAST_DARKEST, Math.max(d, d + dim)) * 100) / 100;
  d = nightImage && night ? 0 : overview ? Math.min(d, OVERVIEW_DARKEST) : d;
  return { darknessLevel: d, globalLight: { enabled: true, bright: d < LAMPS_LIT_FROM, darkness: { min: 0, max: DAYLIGHT_UNTIL } } };
}

/**
 * The update that brings a scene's environment (its source data) to a segment's lighting, or null
 * when it is there already or its darkness is locked (a locked scene keeps its own light).
 */
export function sceneLighting(env, i, opts = {}) {
  if (!env || env.darknessLock) return null;
  const want = lightingFor(i, opts);
  const g = env.globalLight ?? {};
  const same = Math.abs((env.darknessLevel ?? 0) - want.darknessLevel) < 0.001
    && g.enabled === true && g.bright === want.globalLight.bright
    && (g.darkness?.min ?? 0) === 0 && (g.darkness?.max ?? 1) === DAYLIGHT_UNTIL;
  return same ? null : { environment: want };
}

/**
 * A calendar date as days into its year (0 = the first day): `months` as Foundry's calendar lists
 * them ({days, leapDays}), `month` from 0, `day` from 1 (kept within the month).
 */
export function dayOfYear(months, leap, month, day) {
  const len = (m) => (leap ? m.leapDays ?? m.days : m.days);
  const mi = Math.max(0, Math.min(months.length - 1, month));
  let d = Math.max(1, Math.min(len(months[mi]), day)) - 1;
  for (let k = 0; k < mi; k++) d += len(months[k]);
  return d;
}
