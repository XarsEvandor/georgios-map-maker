/**
 * The weather: one sky for the whole world, moving a step at a time. Every new segment of the
 * clock it may change, by the chances in NEXT for the season and the weather now: clear skies
 * cloud over before it drizzles, drizzle turns to rain before a storm, light snow comes before
 * snow and snow before a blizzard, and each eases off the same way. No Foundry calls here, so the
 * tests can run it.
 *
 * The rolls are fixed by the world and the segment, so every client walks to the same weather;
 * the GM's client keeps a record of the weather each segment had (the world setting weatherLog),
 * so stepping back brings back the weather that was.
 */

/**
 * Each weather: Foundry's effect it starts from (CONFIG.weatherEffects key), how much it dims the
 * daylight, its icon, and how it is drawn: `tune` changes the settings of Foundry's rain, snow or
 * fog shader in it, `layers` adds another copy of one (a second layer of snowflakes). Foundry's
 * own rain (opacity 0.25) and single layer of snow barely show on a street map, so the module
 * draws them stronger, and each step up a ladder looks heavier: drizzle is short scattered drops,
 * rain long streaks, a thunderstorm dense slanting streaks in a haze; light snow dim flakes, snow
 * two layers, a blizzard two fast layers in a whiteout; mist a thin haze, fog a thick one. Tuned by
 * eye with Foundry's shaders over a street map and a city (DESIGN 35, 36).
 */
export const WEATHER = {
  clear: { effect: null, dim: 0, icon: null },
  cloudy: { effect: null, dim: 0.12, icon: "fa-cloud" },
  mist: { effect: "fog", dim: 0.05, icon: "fa-smog", tune: { fog: { intensity: 0.5, slope: 0.45 } } },
  fog: { effect: "fog", dim: 0.12, icon: "fa-smog", tune: { fog: { intensity: 0.9, slope: 0.35 } } },
  // Drizzle: short, thin, scattered drops falling slowly (resolution: drops across x along; Foundry's rain is 3200 x 80, long streaks).
  drizzle: { effect: "rain", dim: 0.08, icon: "fa-cloud-rain", tune: { rain: { opacity: 1, intensity: 1.1, strength: 0.6, resolution: [2000, 220], tint: [0.8, 0.95, 1], rotation: 0.15, speed: 0.12 } } },
  rain: { effect: "rain", dim: 0.12, icon: "fa-cloud-showers-heavy", tune: { rain: { opacity: 0.7, intensity: 1.4, strength: 1.4, rotation: 0.35, speed: 0.25 } } },
  storm: { effect: "rainStorm", dim: 0.25, icon: "fa-cloud-bolt", tune: { rain: { opacity: 0.9, intensity: 1.8, strength: 1.8 }, fog: { intensity: 0.12 } } },
  // Light snow: one layer, the flakes dimmed (the snow shader has no density setting; its tint sets how bright the flakes are).
  flurries: { effect: "snow", dim: 0.05, icon: "fa-snowflake", tune: { snow: { tint: [0.7, 0.73, 0.76] } } },
  snow: { effect: "snow", dim: 0.1, icon: "fa-snowflake", tune: { snow: { tint: [1, 1, 1] } }, layers: [{ like: "snow", config: { scale: 1.7, direction: 0.3, speed: 1.6 } }] },
  blizzard: { effect: "blizzard", dim: 0.25, icon: "fa-wind", tune: { fog: { intensity: 0.3 } }, layers: [{ like: "snow", config: { scale: 1.7, direction: 0.9, speed: 6 } }] },
  leaves: { effect: "leaves", dim: 0, icon: "fa-leaf" },
};

/** Which of Foundry's shaders a weather effect entry is (by its id: rainShader, snowShader, fogShader). */
const kindOf = (id) => (/^rain/i.test(id ?? "") ? "rain" : /^snow/i.test(id ?? "") ? "snow" : /^fog/i.test(id ?? "") ? "fog" : null);

/**
 * The effect to draw for a weather, from Foundry's (`base`, CONFIG.weatherEffects[WEATHER[w].effect]):
 * its shaders tuned, the extra layers added (each with an id of its own, as Foundry keeps effects
 * by id), and snowflakes shrunk by `k` (flakeScale). Foundry's config holds classes, so it is
 * copied by hand, not cloned.
 */
export function effectFor(base, w, k = 1) {
  const def = WEATHER[w];
  if (!base || !def?.effect) return null;
  const effects = (base.effects ?? []).map((e) => ({ ...e, config: { ...(e.config ?? {}) } }));
  for (const e of effects) {
    const t = def.tune?.[kindOf(e.id)];
    if (t) Object.assign(e.config, t);
  }
  (def.layers ?? []).forEach((x, i) => {
    const src = effects.find((e) => kindOf(e.id) === x.like);
    if (src) effects.push({ ...src, id: `${src.id}Gmm${i + 1}`, config: { ...src.config, ...x.config } });
  });
  for (const e of effects) if (kindOf(e.id) === "snow") e.config.scale = (e.config.scale ?? 1) * k;
  return { ...base, effects };
}

export const SEASONS = ["spring", "summer", "autumn", "winter"];

/**
 * The chances (percent) of the weather in the next segment, by season and by the weather now.
 * Edit these to change the climate; every row adds up to 100. A weather a season has no row for
 * (snow left over into spring, rain when winter sets in) eases a step toward clear (EASE).
 */
export const NEXT = {
  winter: {
    clear: { clear: 82, cloudy: 13, mist: 5 },
    cloudy: { cloudy: 60, clear: 15, flurries: 12, mist: 7, drizzle: 6 },
    mist: { mist: 55, fog: 15, clear: 18, cloudy: 12 },
    fog: { fog: 60, mist: 40 },
    drizzle: { drizzle: 50, cloudy: 38, flurries: 12 },
    flurries: { flurries: 55, cloudy: 27, snow: 18 },
    snow: { snow: 62, flurries: 30, blizzard: 8 },
    blizzard: { blizzard: 50, snow: 50 },
  },
  spring: {
    clear: { clear: 82, cloudy: 14, mist: 4 },
    cloudy: { cloudy: 55, clear: 22, drizzle: 14, mist: 5, flurries: 4 },
    mist: { mist: 50, fog: 8, clear: 30, cloudy: 12 },
    fog: { fog: 50, mist: 50 },
    drizzle: { drizzle: 50, cloudy: 30, rain: 20 },
    rain: { rain: 60, drizzle: 30, storm: 10 },
    storm: { storm: 45, rain: 55 },
    flurries: { flurries: 40, cloudy: 50, drizzle: 10 },
  },
  summer: {
    clear: { clear: 88, cloudy: 10, mist: 2 },
    cloudy: { cloudy: 50, clear: 32, drizzle: 9, rain: 4, storm: 5 },
    mist: { mist: 35, clear: 55, cloudy: 10 },
    fog: { fog: 30, mist: 70 },
    drizzle: { drizzle: 40, cloudy: 40, rain: 20 },
    rain: { rain: 50, drizzle: 25, storm: 15, cloudy: 10 },
    storm: { storm: 40, rain: 45, cloudy: 15 },
  },
  autumn: {
    clear: { clear: 78, cloudy: 11, leaves: 6, mist: 5 },
    cloudy: { cloudy: 58, clear: 14, drizzle: 12, mist: 8, leaves: 6, flurries: 2 },
    leaves: { leaves: 60, clear: 25, cloudy: 15 },
    mist: { mist: 55, fog: 20, clear: 13, cloudy: 12 },
    fog: { fog: 62, mist: 38 },
    drizzle: { drizzle: 50, cloudy: 30, rain: 20 },
    rain: { rain: 60, drizzle: 32, storm: 8 },
    storm: { storm: 45, rain: 55 },
    flurries: { flurries: 40, cloudy: 50, snow: 10 },
    snow: { snow: 40, flurries: 60 },
  },
};

/** One step toward clear, for a weather the season has no row for. */
export const EASE = { storm: "rain", rain: "drizzle", drizzle: "cloudy", blizzard: "snow", snow: "flurries", flurries: "cloudy", fog: "mist", mist: "clear", leaves: "clear", cloudy: "clear", clear: "clear" };

/** With no record near, the weather is walked from a clear sky this many segments (four days) before. */
export const SETTLE = 64;
/** The longest walk from a recorded weather (twelve days); further on, the weather settles afresh. */
export const MAX_WALK = 192;

/**
 * Which of the four seasons a calendar's season is: by its name (spring, summer, autumn or fall,
 * winter), else by the month (the first three months of a twelve-month year are winter's, and so
 * on round the year).
 */
export function seasonKind(name, month, months) {
  const n = String(name ?? "").toLowerCase();
  for (const k of SEASONS) if (n.includes(k)) return k;
  if (n.includes("fall")) return "autumn";
  const m = Number.isFinite(month) ? month : 0, total = months > 0 ? months : 12;
  return ["winter", "spring", "summer", "autumn"][Math.floor((((m + 1) % total) * 4) / total) % 4];
}

/** A number from 0 to 1 fixed by the seed, the segment and what it is for (FNV-1a, then a mixer). */
export function chance(seed, n, salt) {
  let h = 0x811c9dc5;
  const s = `${seed}|${n}|${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The chances of the next segment's weather, from a weather in a season. */
export function chancesFrom(from, season) {
  const table = NEXT[season] ?? NEXT.spring;
  return table[from] ?? { [EASE[from] ?? "clear"]: 100 };
}

/** The next segment's weather from a weather in a season, by a roll x (0 to 1). */
export function nextWeather(from, season, x) {
  const row = chancesFrom(from, season);
  let at = x * 100;
  for (const [w, p] of Object.entries(row)) {
    if (at < p) return w;
    at -= p;
  }
  return Object.keys(row).pop();
}

/** Walks the weather on from segment a (weather w) to segment b, one roll a segment. */
export function walk(a, w, b, seasonAt, seed) {
  for (let k = a + 1; k <= b; k++) w = nextWeather(w, seasonAt(k), chance(seed, k, "sky"));
  return w;
}

/**
 * The weather in segment n (counted from the start of world time): the recorded one, else walked
 * on from the latest record before it (up to MAX_WALK), else walked from a clear sky SETTLE
 * segments before. `log` maps segments to the weather they had; `seasonAt(n)` names a segment's
 * season; `seed` makes each world's weather its own.
 */
export function weatherAt(n, { seed, seasonAt, log = {} }) {
  if (log[n] && WEATHER[log[n]]) return log[n];
  let from = -Infinity;
  for (const k of Object.keys(log)) {
    const s = Number(k);
    if (s < n && s > from && n - s <= MAX_WALK && WEATHER[log[k]]) from = s;
  }
  return from > -Infinity ? walk(from, log[from], n, seasonAt, seed) : walk(n - SETTLE, "clear", n, seasonAt, seed);
}

/** A record kept to the segments near n (the weather log stays small). */
export function trimLog(log, n, keep = 400) {
  return Object.fromEntries(Object.entries(log).filter(([k]) => Math.abs(Number(k) - n) <= keep));
}

/** Scene pixels per foot that Foundry's snowflakes are drawn for: a battle map's 100 pixels to 5 ft. */
export const FLAKES_AT = 20;
/** The most the flakes shrink on a coarse map (a city seen from above); smaller, they read as grain. */
export const FLAKES_SHRINK_MOST = 3;

/**
 * How much smaller to draw the snowflakes on a scene, so snow reads as falling snow on a city scene
 * as on a battle map: 1 on battle and street maps, FLAKES_SHRINK_MOST on a city scene. Foundry sizes
 * them in scene pixels, so on a city (2 px a foot) its flakes are each as big as a house. Half the
 * true ratio: at the full ratio they are too small to see.
 */
export function flakeScale(gridSize, gridDistance, units) {
  const feet = /^m/i.test(String(units ?? "")) ? gridDistance * 3.28084 : gridDistance;
  const pxPerFt = gridSize > 0 && feet > 0 ? gridSize / feet : FLAKES_AT;
  return Math.max(1, Math.min(FLAKES_SHRINK_MOST, FLAKES_AT / pxPerFt / 2));
}
