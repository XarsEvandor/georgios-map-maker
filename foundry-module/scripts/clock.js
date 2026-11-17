/**
 * The clock: a bar of the day's segments and the date at the top of the screen for everyone, a GM
 * button that moves it one segment on, a GM dialog for time skips and the weather, and the
 * lighting and weather of every scene following it. Foundry's world time is the clock and the
 * world's calendar (dnd5e's setting) names the days, so the date rolls over at midnight and
 * anything else that reads world time agrees with the bar.
 */

import { MODULE_ID, esc } from "./lib.js";
import { SEGMENTS, SEGMENTS_PER_PHASE, absoluteSegment, dayOfYear, isNight, sceneLighting, segmentOf, segmentSpan, segmentStart, stepSeconds } from "./daytime.js";
import { WEATHER, chancesFrom, effectFor, flakeScale, seasonKind, trimLog, weatherAt } from "./weather.js";

/** How long the light takes to change when the clock moves, in milliseconds. */
const FADE_MS = 6000;

/**
 * Battle and street maps get weather once they carry the region that keeps it out of their
 * buildings (main.js ensureRoofs sets the scene flag `roofs`).
 */
export const ROOFS_LOOK = 1;

const t = (key) => game.i18n.localize(`GMM.Clock.${key}`);
const tw = (key) => game.i18n.localize(`GMM.Weather.${key}`);
const isActiveGM = () => !!game.user?.isGM && game.users.activeGM?.id === game.user.id;

function units() {
  const d = game.time.calendar?.days ?? {};
  return { spm: d.secondsPerMinute ?? 60, mph: d.minutesPerHour ?? 60, hpd: d.hoursPerDay ?? 24 };
}
function secondsPerDay() {
  const u = units();
  return u.spm * u.mph * u.hpd;
}
function secondsIntoDay() {
  const u = units();
  const c = game.time.components;
  if (Number.isFinite(c?.hour)) return (c.hour * u.mph + (c.minute ?? 0)) * u.spm + (c.second ?? 0);
  const day = secondsPerDay();
  return ((game.time.worldTime % day) + day) % day;
}

/** The segment the world clock is in now (0 to 15, 0 = the first of the day). */
export const currentSegment = () => segmentOf(secondsIntoDay(), secondsPerDay());
/** The segment counted from the start of world time: changes with every step and every skip. */
const segmentNow = () => absoluteSegment(game.time.worldTime, secondsPerDay());

function hhmm(s) {
  const u = units();
  const h = Math.floor(s / (u.spm * u.mph));
  const m = Math.floor(s / u.spm) % u.mph;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------
// The calendar and the weather.

const loc = (s) => (s ? game.i18n.localize(s) : "");

/** Today's date in the world's calendar: short for the bar, long for its tooltip. */
function today() {
  const cal = game.time.calendar;
  const c = game.time.components ?? {};
  const year = (c.year ?? 0) + (cal?.years?.yearZero ?? 0);
  const month = cal?.months?.values?.[c.month];
  const weekday = loc(cal?.days?.values?.[c.dayOfWeek]?.name);
  const season = loc(cal?.seasons?.values?.[c.season]?.name);
  if (!month) {
    const d = (c.day ?? 0) + 1;
    return { short: game.i18n.format("GMM.Clock.DayOfYear", { day: d, year }), long: game.i18n.format("GMM.Clock.DayOfYear", { day: d, year }), season };
  }
  const day = (c.dayOfMonth ?? 0) + 1;
  const abbr = month.abbreviation ? loc(month.abbreviation) : loc(month.name);
  return { short: `${day} ${abbr} ${year}`, long: `${weekday ? `${weekday}, ` : ""}${day} ${loc(month.name)} ${year}`, season };
}

/** The season (spring, summer, autumn, winter) of a world time, from the calendar. */
function seasonOfTime(time) {
  const cal = game.time.calendar;
  const c = cal.timeToComponents(time);
  const s = cal.seasons?.values?.[c.season];
  return seasonKind(s ? `${s.name} ${loc(s.name)}` : "", c.month, cal.months?.values?.length ?? 0);
}

const seasonCache = new Map();
/** The season of a segment (counted from the start of world time), looked up once a day. */
function seasonAt(n) {
  const spd = secondsPerDay();
  const day = Math.floor(segmentStart(n, spd) / spd);
  let k = seasonCache.get(day);
  if (!k) {
    k = seasonOfTime(day * spd + spd / 2);
    if (seasonCache.size > 5000) seasonCache.clear();
    seasonCache.set(day, k);
  }
  return k;
}

/** The weather each recent segment had (segment -> weather), kept by the active GM. */
const weatherLog = () => game.settings.get(MODULE_ID, "weatherLog") ?? {};
const pinnedWeather = () => {
  const p = game.settings.get(MODULE_ID, "weather");
  return p && p !== "auto" && WEATHER[p] ? p : null;
};

/** The weather a segment has by the season's chances: recorded, or walked on from the last record. */
const seasonalWeather = (n = segmentNow()) => weatherAt(n, { seed: game.world.id, seasonAt, log: weatherLog() });

/** The weather now: the one the GM pinned, or the season's. The same in every scene and for every player. */
export function currentWeather() {
  return pinnedWeather() ?? seasonalWeather();
}

/** The chances of the next segment's weather, from the weather now, likeliest first. */
function nextChances() {
  const row = chancesFrom(currentWeather(), seasonAt(segmentNow() + 1));
  return Object.entries(row).sort((a, b) => b[1] - a[1]).map(([w, p]) => `${tw(w)} ${p}%`).join(", ");
}

let recording = Promise.resolve();
/**
 * The active GM writes down the weather of the segment the clock is in (pinned or not), so that
 * stepping back brings it back and the season's walk goes on from it after a pin is lifted.
 */
function recordWeather() {
  if (!isActiveGM()) return recording;
  recording = recording.then(async () => {
    const n = segmentNow();
    const log = weatherLog();
    const w = currentWeather();
    if (log[n] === w) return;
    await game.settings.set(MODULE_ID, "weatherLog", trimLog({ ...log, [n]: w }, n));
  }).catch((e) => console.error(`${MODULE_ID} | weather record`, e));
  return recording;
}

/** Scenes the clock's weather falls on: city scenes, and module maps that keep it out of their buildings. A scene flag `weather: false` opts out. */
export function weatherScene(scene) {
  const f = scene?.flags?.[MODULE_ID] ?? {};
  if (f.weather === false) return false;
  if (f.mapId) return f.roofs === ROOFS_LOOK;
  return !!f.city;
}

/** How long the old weather takes to fade out, and the new one to fade in (ms). */
const FADE_OUT_MS = 1500;
const FADE_IN_MS = 3000;

/**
 * The weather's effect for this scene (weather.js effectFor): Foundry's, drawn stronger, its
 * snowflakes smaller on coarse maps (Foundry sizes flakes in scene pixels).
 */
function sceneEffect(w, scene) {
  const base = CONFIG.weatherEffects[WEATHER[w]?.effect];
  return effectFor(base, w, flakeScale(scene.grid?.size, scene.grid?.distance, scene.grid?.units));
}

let drawn = null;
let fading = 0;

/** Fades a display object's alpha; false when another fade took over or it is gone. */
function fade(obj, to, ms, token) {
  return new Promise((resolve) => {
    const from = obj.alpha, t0 = performance.now();
    const tick = (now) => {
      if (token !== fading || obj.destroyed) return resolve(false);
      const f = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
      obj.alpha = from + (to - from) * f;
      if (f < 1) requestAnimationFrame(tick);
      else resolve(true);
    };
    tick(performance.now());
  });
}

/**
 * Draws the weather on this screen's scene. Every client draws its own, so nothing is written to
 * the scene (a change to a scene's weather field redraws the whole canvas). The old weather fades
 * out and the new one in. A scene with its own weather (Scene config) keeps it.
 */
export function applyWeather({ instant = false } = {}) {
  if (!canvas?.ready || !canvas.scene || !canvas.weather?.initializeEffects) return;
  const scene = canvas.scene;
  if (scene.weather) return;
  const w = weatherScene(scene) ? currentWeather() : null;
  const effect = w && WEATHER[w]?.effect ? w : null;
  const key = `${scene.id}:${effect}`;
  if (key === drawn) return;
  const wasDrawn = !!drawn && drawn.startsWith(`${scene.id}:`) && drawn !== `${scene.id}:null`;
  drawn = key;
  const strength = 1;
  const layer = canvas.weather;
  const token = ++fading;
  const show = () => {
    try {
      // Nothing drawn and nothing to draw: leave Foundry's layer as it is.
      if (effect || layer.effects?.size) layer.initializeEffects(effect ? sceneEffect(effect, scene) : null);
    } catch (e) {
      console.error(`${MODULE_ID} | weather`, e);
    }
    // Suppress Weather regions draw erasers (blend ERASE) that stay inside the weather layer only
    // while its pass-through filter is on. Clearing the weather turns that filter off and leaves the
    // erasers, which then rub the scene itself out: buildings went black when the sky cleared.
    // With no weather there is nothing for them to keep out, so they are hidden with it.
    if (layer.suppression) layer.suppression.visible = !!effect;
  };
  const box = layer.weatherEffects;
  if (instant || !box) {
    show();
    if (layer.weatherEffects) layer.weatherEffects.alpha = strength;
    return;
  }
  fade(box, 0, wasDrawn ? FADE_OUT_MS : 0, token).then((ok) => {
    if (!ok) return;
    show();
    const now = layer.weatherEffects;
    if (!now) return;
    now.alpha = 0;
    fade(now, strength, FADE_IN_MS, token);
  });
}

// ---------------------------------------------------------------------------------------
// The GM's controls.

/** Moves the clock one segment on (1) or back (-1). World time is a world setting: GM only. */
async function step(n) {
  if (!game.user.isGM) return;
  try {
    await game.time.advance(stepSeconds(secondsIntoDay(), secondsPerDay(), n));
  } catch (e) {
    ui.notifications.error(`Map Maker: the clock did not move (${e.message})`);
  }
}

/** The world time of a date (year as shown, month from 0, day from 1) at the start of a segment. */
function timeOf(year, month, day, segment) {
  const cal = game.time.calendar;
  const spd = secondsPerDay();
  const y = Math.max(0, Math.round(year) - (cal.years?.yearZero ?? 0));
  const months = cal.months?.values ?? [];
  const doy = months.length ? dayOfYear(months, !!cal.isLeapYear?.(y), month, day) : Math.max(0, day - 1);
  return cal.componentsToTime({ year: y, day: doy, second: segmentSpan(segment, spd)[0] });
}

/** The GM's dialog: skip forward or back, go to a date, pin the weather. */
async function openTimeDialog() {
  if (!game.user.isGM) return;
  const cal = game.time.calendar;
  const months = cal.months?.values ?? [];
  const spd = secondsPerDay();
  const opt = (v, label) => `<option value="${esc(v)}">${esc(label)}</option>`;
  const segOptions = SEGMENTS.map((s, i) => opt(i, `${t(s.key)} (${hhmm(segmentSpan(i, spd)[0])})`)).join("");
  const weatherOptions = opt("auto", "") + Object.keys(WEATHER).map((k) => opt(k, tw(k))).join("");
  const content = `<div class="gmm-time">
    <fieldset><legend>${esc(t("Skip"))}</legend>
      <div class="gmm-time-row">
        <input type="number" name="amount" value="1" min="1" step="1">
        <select name="unit">${opt("segment", t("Segments"))}<option value="day" selected>${esc(t("Days"))}</option>${opt("week", t("Weeks"))}</select>
        <button type="button" data-skip="-1"><i class="fa-solid fa-backward"></i> ${esc(t("Back"))}</button>
        <button type="button" data-skip="1">${esc(t("Forward"))} <i class="fa-solid fa-forward"></i></button>
      </div>
    </fieldset>
    <fieldset><legend>${esc(t("GoTo"))}</legend>
      <div class="gmm-time-row">
        <input type="number" name="day" min="1" step="1" aria-label="${esc(t("Day"))}">
        ${months.length ? `<select name="month" aria-label="${esc(t("Month"))}">${months.map((m, i) => opt(i, loc(m.name))).join("")}</select>` : ""}
        <input type="number" name="year" step="1" aria-label="${esc(t("Year"))}">
      </div>
      <div class="gmm-time-row">
        <select name="segment" aria-label="${esc(t("TimeOfDay"))}">${segOptions}</select>
        <button type="button" data-go><i class="fa-solid fa-calendar-check"></i> ${esc(t("Go"))}</button>
      </div>
    </fieldset>
    <fieldset><legend>${esc(t("WeatherLegend"))}</legend>
      <div class="gmm-time-row"><select name="weather">${weatherOptions}</select></div>
      <p class="gmm-time-next"></p>
      <p class="hint">${esc(t("WeatherHint"))}</p>
    </fieldset>
  </div>`;

  let root = null;
  const field = (name) => root?.querySelector(`[name="${name}"]`);
  const fill = () => {
    if (!root?.isConnected) return;
    const c = game.time.components ?? {};
    field("year").value = (c.year ?? 0) + (cal.years?.yearZero ?? 0);
    if (field("month")) field("month").value = String(c.month ?? 0);
    field("day").value = (months.length ? c.dayOfMonth ?? 0 : c.day ?? 0) + 1;
    field("segment").value = String(currentSegment());
    const auto = field("weather").querySelector('option[value="auto"]');
    auto.textContent = game.i18n.format("GMM.Clock.WeatherAuto", { now: tw(seasonalWeather()) });
    field("weather").value = pinnedWeather() ?? "auto";
    const next = root.querySelector(".gmm-time-next");
    if (next) next.textContent = game.i18n.format("GMM.Clock.NextChances", { chances: nextChances() });
  };
  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      ui.notifications.error(`Map Maker: ${e.message}`);
    }
    fill();
  };
  const hook = Hooks.on("updateWorldTime", fill);
  const weatherHook = Hooks.on(`${MODULE_ID}.weather`, fill);

  await foundry.applications.api.DialogV2.wait({
    window: { title: t("DialogTitle"), icon: "fa-solid fa-calendar-days" },
    position: { width: 460 },
    classes: ["gmm-time-dialog"],
    content,
    buttons: [{ action: "done", label: t("Done"), icon: "fa-solid fa-check", default: true }],
    render: (_ev, dialog) => {
      root = dialog.element;
      fill();
      for (const b of root.querySelectorAll("[data-skip]")) {
        b.addEventListener("click", () => run(() => {
          const unit = { segment: spd / SEGMENTS.length, day: spd, week: spd * (cal.days?.values?.length || 7) }[field("unit").value] ?? spd;
          const n = Math.max(1, Math.round(Number(field("amount").value) || 1));
          return game.time.advance(Number(b.dataset.skip) * n * unit);
        }));
      }
      root.querySelector("[data-go]")?.addEventListener("click", () => run(() => {
        const time = timeOf(Number(field("year").value), Number(field("month")?.value ?? 0), Number(field("day").value), Number(field("segment").value));
        return game.time.set(time);
      }));
      field("weather").addEventListener("change", (ev) => run(() => game.settings.set(MODULE_ID, "weather", ev.target.value)));
    },
  }).finally(() => {
    Hooks.off("updateWorldTime", hook);
    Hooks.off(`${MODULE_ID}.weather`, weatherHook);
  });
}

// ---------------------------------------------------------------------------------------
// The bar.

let shown = null;
let shownWeather = null;

/** Where this player keeps the bar ({x, y} in screen pixels, none = top centre) and whether it is folded. Client setting: each browser its own. */
const VIEW = "clockView";
const view = () => game.settings.get(MODULE_ID, VIEW) ?? {};
const saveView = (patch) => game.settings.set(MODULE_ID, VIEW, { ...view(), ...patch });

/**
 * Puts the bar at x, y (kept on screen), or back at the top centre when x is null. Returns where
 * it went. A moved bar lives in the page body: Foundry scales #ui-middle with a transform, which
 * would make fixed positions relative to it.
 */
function place(el, x, y) {
  const top = document.getElementById("ui-top");
  if (x == null || y == null) {
    el.classList.remove("moved");
    el.style.left = el.style.top = "";
    if (top && el.parentElement !== top) top.prepend(el);
    return null;
  }
  if (el.parentElement !== document.body) document.body.append(el);
  el.classList.add("moved");
  const r = el.getBoundingClientRect();
  const nx = Math.round(Math.max(0, Math.min(window.innerWidth - r.width, x)));
  const ny = Math.round(Math.max(0, Math.min(window.innerHeight - r.height, y)));
  el.style.left = `${nx}px`;
  el.style.top = `${ny}px`;
  return { x: nx, y: ny };
}

/** Drag the bar anywhere (buttons too: a press that moves more than a few pixels is a drag, not a click). */
function draggable(el) {
  let dragged = false;
  el.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const r = el.getBoundingClientRect();
    const start = { x: ev.clientX, y: ev.clientY, dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    let to = null;
    dragged = false;
    const move = (e) => {
      if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
      dragged = true;
      el.classList.add("dragging");
      to = place(el, e.clientX - start.dx, e.clientY - start.dy);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.classList.remove("dragging");
      if (dragged && to) saveView(to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  // The click that ends a drag is not a click on a button.
  el.addEventListener("click", (ev) => {
    if (dragged) {
      dragged = false;
      ev.stopImmediatePropagation();
    }
  }, true);
  // Double-click (off the buttons): back to the top centre.
  el.addEventListener("dblclick", (ev) => {
    if (ev.target.closest("button")) return;
    place(el, null, null);
    saveView({ x: null, y: null });
  });
  window.addEventListener("resize", () => {
    const v = view();
    if (v.x != null) place(el, v.x, v.y);
  });
}

/** Draws the bar: the current phase's eight segments, a sun or a moon, the segment's name, the date and the weather. */
function render() {
  let el = document.getElementById("gmm-clock");
  if (!el) {
    el = document.createElement("div");
    el.id = "gmm-clock";
    el.addEventListener("click", (ev) => {
      if (ev.target.closest(".gmm-clock-step")) step(1);
      else if (ev.target.closest(".gmm-clock-fold")) saveView({ min: !view().min }).then(render);
      else if (ev.target.closest("button.gmm-clock-date")) openTimeDialog();
    });
    el.addEventListener("contextmenu", (ev) => {
      if (!ev.target.closest(".gmm-clock-step")) return;
      ev.preventDefault();
      step(-1);
    });
    draggable(el);
    (document.getElementById("ui-top") ?? document.body).prepend(el);
    // The GM's way back up (main.js) sits under the clock.
    const up = document.getElementById("gmm-way-up");
    if (up) el.after(up);
  }
  const i = currentSegment();
  const weather = currentWeather();
  shown = segmentNow();
  shownWeather = weather;
  const v = view();
  const night = i >= SEGMENTS_PER_PHASE;
  const into = i % SEGMENTS_PER_PHASE;
  const [from, to] = segmentSpan(i, secondsPerDay());
  const name = t(SEGMENTS[i].key);
  const when = `${name}, ${hhmm(from)} to ${hhmm(to)}`;
  const date = today();
  const sky = tw(weather);
  const about = [date.long, date.season, sky].filter(Boolean).join(". ") + (game.user.isGM ? `. ${game.i18n.format("GMM.Clock.NextChances", { chances: nextChances() })}. ${t("DateHint")}` : "");
  const icon = WEATHER[weather]?.icon;
  el.classList.toggle("night", night);
  el.classList.toggle("min", !!v.min);
  const pips = Array.from({ length: SEGMENTS_PER_PHASE }, (_, k) => `<span class="gmm-clock-pip${k < into ? " past" : k === into ? " now" : ""}"></span>`).join("");
  const dateInner = `<span class="gmm-clock-day">${esc(date.short)}</span>${icon ? `<i class="gmm-clock-weather fa-solid ${icon}" aria-label="${esc(sky)}"></i>` : ""}`;
  el.innerHTML = `<span class="gmm-clock-face" data-tooltip="${esc(when)}">`
    + `<button type="button" class="gmm-clock-fold" data-tooltip="${esc(v.min ? `${when}. ${date.long}. ${sky}. ${t("Unfold")}` : t("Fold"))}" aria-label="${esc(v.min ? t("Unfold") : t("Fold"))}"><i class="gmm-clock-phase fa-solid ${night ? "fa-moon" : "fa-sun"}"></i></button>`
    + `<span class="gmm-clock-pips">${pips}</span>`
    + `<span class="gmm-clock-name">${esc(name)}</span></span>`
    + (game.user.isGM
      ? `<button type="button" class="gmm-clock-date" data-tooltip="${esc(about)}" aria-label="${esc(t("DialogTitle"))}">${dateInner}</button>`
      : `<span class="gmm-clock-date" data-tooltip="${esc(about)}">${dateInner}</span>`)
    + (game.user.isGM ? `<button type="button" class="gmm-clock-step" data-tooltip="${esc(t("StepHint"))}" aria-label="${esc(t("Step"))}"><i class="fa-solid fa-forward-step"></i></button>` : "");
  place(el, v.x, v.y);
}

// ---------------------------------------------------------------------------------------
// Scenes.

/** The level a scene's background lives on (Foundry 14), or none (Foundry 13 keeps it on the scene). */
function levelOf(scene) {
  return scene.levels ? scene.levels.get(scene._source.initialLevel) ?? scene.levels.contents[0] : undefined;
}

/** The image a scene shows. */
export function backgroundOf(scene) {
  return levelOf(scene)?.background?.src ?? scene.background?.src;
}

async function showBackground(scene, src) {
  const level = levelOf(scene);
  return level ? level.update({ "background.src": src }) : scene.update({ "background.src": src });
}

let queue = Promise.resolve();

/**
 * Brings every scene to the current segment's lighting (darkness and Global Illumination), the
 * daylight dimmed by bad weather where the weather falls. Scenes with their darkness locked keep
 * their own. Active GM only; the viewed scene fades when `animate` is set.
 */
export function syncScenes({ animate = false } = {}) {
  if (!isActiveGM()) return queue;
  queue = queue
    .then(async () => {
      const i = currentSegment();
      const dim = WEATHER[currentWeather()]?.dim ?? 0;
      const updates = [];
      const swaps = [];
      for (const scene of game.scenes) {
        // A city scene with a night image (main.js ensureNight) shows it from nightfall to first light.
        const day = scene.getFlag(MODULE_ID, "daySrc"), night = scene.getFlag(MODULE_ID, "nightSrc");
        const nightImage = !!(day && night);
        const u = sceneLighting(scene._source.environment, i, { overview: !scene.tokenVision, nightImage, dim: weatherScene(scene) && !scene.weather ? dim : 0 });
        if (u) updates.push({ _id: scene.id, ...u });
        const want = isNight(i) ? night : day;
        if (nightImage && !scene._source.environment?.darknessLock && backgroundOf(scene) !== want) swaps.push([scene, want]);
      }
      if (updates.length) await Scene.implementation.updateDocuments(updates, animate ? { animateDarkness: FADE_MS } : {});
      for (const [scene, src] of swaps) await showBackground(scene, src);
    })
    .catch((e) => console.error(`${MODULE_ID} | clock lighting`, e));
  return queue;
}

/** The bar, the scenes' light and this screen's weather, after the time or the weather changed. */
function refresh() {
  render();
  applyWeather();
  syncScenes({ animate: true });
  recordWeather();
  Hooks.callAll(`${MODULE_ID}.weather`);
}

export function registerClock() {
  game.settings.register(MODULE_ID, VIEW, { scope: "client", config: false, type: Object, default: {} });
  // The weather the GM pinned ("auto": the season's).
  game.settings.register(MODULE_ID, "weather", {
    scope: "world", config: false, type: String, default: "auto",
    onChange: () => { if (game.ready) refresh(); },
  });
  // The weather each recent segment had (weather.js weatherAt), written by the active GM.
  game.settings.register(MODULE_ID, "weatherLog", {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => {
      if (!game.ready) return;
      if (currentWeather() !== shownWeather) refresh();
      else Hooks.callAll(`${MODULE_ID}.weather`);
    },
  });
  Hooks.once("ready", () => {
    render();
    applyWeather({ instant: true });
    syncScenes();
    recordWeather();
  });
  // Every change of world time (the button, the dialog, dnd5e's calendar, a rest, combat rounds):
  // redraw, relight and change the weather only when the segment (or the weather) changes.
  Hooks.on("updateWorldTime", () => {
    if (segmentNow() === shown && currentWeather() === shownWeather) return;
    refresh();
  });
  // Foundry clears the weather layer on every canvas draw: draw this screen's weather again.
  Hooks.on("canvasReady", () => {
    drawn = null;
    applyWeather({ instant: true });
  });
  // A scene that just got its roofs (or opted out) changes whether the weather falls on it.
  Hooks.on("updateScene", (scene, change) => {
    if (scene !== canvas?.scene || !(change.flags?.[MODULE_ID] || "weather" in change)) return;
    applyWeather();
  });
  // New scenes (maps, cities, world maps) start at the clock's light.
  Hooks.on("createScene", () => syncScenes());
}
