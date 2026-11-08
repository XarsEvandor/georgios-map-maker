/**
 * The prose of an aged world, written by Claude (the Claude Code CLI) from the simulation's facts:
 * a chronicle per age, a history and present-day page per realm, short notes on fallen realms and
 * on notable towns, and an overview. Every prompt carries the facts and the exact names; Claude
 * adds colour, never new places or dates.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventText, majorEvents, namer, peoplesOf, realmEvents, townEvents, type AgedBurg, type AgedState, type AgedWorld, type AzWorld } from "@gmm/core";
import { findClaude } from "../llm/claude-cli";

export interface Prose {
  overview: string;
  ages: Array<{ from: number; to: number; title: string; text: string }>;
  realms: Record<string, { history: string; today: string }>;
  fallen: Record<string, string>;
  towns: Record<string, string>;
}

const STYLE = `Writing rules: plain, concrete words; active voice; vary sentence length; no em dashes or en dashes (use commas or full stops);
no "not X, but Y" contrasts; no throat-clearing; no adverbs where a verb does the job. Use only the facts given and the names exactly as written.
You may add colour (causes, weather, epithets, a ruler's name in the people's style) but never new realms, towns, wars or dates.`;

/** One prompt to Claude, text back. */
export async function claudeText(prompt: string, opts: { model?: string; timeoutMs?: number } = {}): Promise<string> {
  const cwd = join(tmpdir(), "georgios-map-maker-claude");
  await mkdir(cwd, { recursive: true });
  return new Promise((resolveText, reject) => {
    const proc = spawn(findClaude(), ["-p", "--output-format", "text", "--setting-sources", "local", "--tools", "ToolSearch", "--model", opts.model ?? "opus"], { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { proc.kill(); reject(new Error("claude timed out")); }, opts.timeoutMs ?? 360_000);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("close", (code) => { clearTimeout(timer); code === 0 ? resolveText(out.trim()) : reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`)); });
    proc.stdin.end(prompt);
  });
}

/** The first JSON object in a reply. */
function json<T>(text: string): T {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(a, b + 1)) as T;
}

async function ask<T>(prompt: string, retries = 1): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return json<T>(await claudeText(prompt));
    } catch (e) {
      if (i >= retries) throw e;
    }
  }
}

/** Runs tasks with at most `n` at once. */
async function pool<T>(tasks: Array<() => Promise<T>>, n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; out[i] = await tasks[i]!(); }
  }));
  return out;
}

export function notableTowns(w: AgedWorld): AgedBurg[] {
  const alive = w.burgs.filter((b) => b.alive);
  const top = [...alive].sort((a, b) => b.population - a.population).slice(0, 24);
  const caps = alive.filter((b) => b.capital);
  return [...new Set([...top, ...caps])];
}

export async function writeProse(az: AzWorld, w: AgedWorld, opts: { concurrency?: number; onProgress?: (msg: string) => void; prior?: Partial<Prose> } = {}): Promise<Prose> {
  const n = namer(w);
  const cells = az.cells.map((c) => c.p);
  const line = (e: Parameters<typeof eventText>[0]) => eventText(e, n, cells);
  const cultureName = (i: number) => az.cultures.find((c) => c.i === i)?.name ?? "mixed";
  const say = opts.onProgress ?? (() => undefined);
  const prose: Prose = { overview: opts.prior?.overview ?? "", ages: opts.prior?.ages ?? [], realms: { ...(opts.prior?.realms ?? {}) }, fallen: { ...(opts.prior?.fallen ?? {}) }, towns: { ...(opts.prior?.towns ?? {}) } };
  const alive = w.states.filter((s) => s.alive).sort((a, b) => b.cells - a.cells);
  const renamed = w.burgs.filter((b) => b.oldName && b.oldName !== b.name && b.population > 8).slice(0, 30).map((b) => `${b.oldName} (later ${b.name})`);
  // Invaders laid on by the DM: the prose knows only what the DM said of them.
  const strangers = w.states.filter((s) => s.alive && s.invader).map((s) => {
    const took = w.events.filter((e) => e.kind === "invasion" && e.states[0] === s.id);
    const towns = took.flatMap((e) => e.burgs).map((b) => n.town(b, w.year));
    return `
${s.founded === w.year ? `A few months ago, in ${s.founded},` : `In ${s.founded},`} the ${s.name} invaded and took the land round ${towns.join(", ") || "a few villages"} from ${took.map((e) => n.realm(e.states[1]!, e.year)).join(" and ")}. Its seat is ${w.burgs.find((b) => b.id === s.capital)?.name ?? "unknown"}.
Nothing more is known of the ${s.name}. Never invent where it came from or what it is, and never describe its people, leaders, weapons, machines, beliefs or aims: the DM decides those. Write only what the people of ${w.name} can know: that it came, what it took, and how they and their neighbours meet it.`;
  }).join("");
  const world = `The world is ${w.name}. The years run from ${w.startYear} to ${w.year} ${w.eraShort}. Constant wars kept it medieval: no gunpowder, no printing, castles and pikes.
Its peoples: ${az.cultures.filter((c) => c.i > 0).map((c) => c.name).join(", ")}.${strangers}`;

  const tasks: Array<() => Promise<void>> = [];
  // Ages of 125 years; a repeated title is written again.
  {
    const span = 125;
    const titles = new Set<string>();
    prose.ages = prose.ages.filter((a) => (titles.has(a.title) ? false : (titles.add(a.title), true)));
    for (let from = w.startYear; from < w.year; from += span) {
      const to = Math.min(w.year, from + span);
      if (prose.ages.some((a) => a.from === from)) continue;
      tasks.push(async () => {
        const evs = majorEvents(w, from, to);
        const realmsThen = w.states.filter((s) => s.founded <= from && (!s.ended || s.ended > from)).map((s) => `${n.realm(s.id, from)} (${cultureName(s.culture)})`);
        const r = await ask<{ title: string; text: string }>(`${world}
Write the chronicle of the years ${from} to ${to} for a Dungeon Master: a short title (4 to 7 words) and 3 to 5 paragraphs, 250 to 350 words in all.
${titles.size ? `Other ages are already titled ${[...titles].map((t) => `"${t}"`).join(", ")}: choose a title unlike these.` : ""}
Realms at the start of this age: ${realmsThen.join(", ")}.
${from + span / 2 > w.startYear + (w.year - w.startYear) / 2 && renamed.length ? `Some towns are known by later names now: ${renamed.join(", ")}.` : ""}
Events (from the history):
${evs.map(line).join("\n")}
${STYLE}
Reply with JSON only: {"title": "...", "text": "paragraphs separated by blank lines"}`);
        prose.ages.push({ from, to, title: r.title, text: r.text });
        say(`age ${from}-${to}: ${r.title}`);
      });
    }
  }
  // Living realms.
  for (const s of alive) {
    if (prose.realms[s.id]) continue;
    tasks.push(async () => {
      const cap = w.burgs.find((b) => b.id === s.capital);
      const towns = w.burgs.filter((b) => b.alive && b.state === s.id).sort((a, b) => b.population - a.population).slice(0, 6).map((b) => `${b.name} (${b.population.toFixed(1)} thousand)`);
      const evs = realmEvents(w, s).slice(-60);
      const share = Math.round((s.cells / w.cells.state.filter((x) => x > 0).length) * 100);
      const r = await ask<{ history: string; today: string }>(`${world}
Write two texts about the realm ${s.fullName} for a Dungeon Master.
Facts: ${s.invader ? `invaders who came in ${s.founded}; see above for all that is known of them` : s.origin === "old" ? `one of the oldest realms, known in ${w.startYear} as ${s.oldName}` : s.origin === "rebellion" ? `born in ${s.founded} when it broke away from ${n.realm(s.parent ?? -1, s.founded)}` : `formed in ${s.founded}`}.
${s.invader ? `Seat: ${cap?.name ?? "none"}. The peoples of the land it holds (a mix; do not call its towns all one people): ${peoplesOf(w, s).map((p) => `${cultureName(p.culture)} (${p.cells} of its ${s.cells} parts of land, about ${Math.round(p.townsfolk)} thousand in its towns)`).join(", ")}.` : `Capital: ${cap?.name ?? "none"}. People: ${cultureName(s.culture)}. Faith: ${n.religion(s.religion)}.`} Holds about ${share}% of the settled land.
Chief towns: ${towns.join(", ")}.
Events:
${evs.map(line).join("\n")}
${s.invader ? `1. "history": 1 or 2 paragraphs, 100 to 160 words: the invasion as the people of the land lived it.
2. "today": one paragraph, 70 to 110 words: how the land it holds stands in ${w.year} and how its neighbours meet it. Do not name its leaders. Give the DM one hook.` : `1. "history": 2 or 3 paragraphs, 180 to 260 words: how it came to be what it is.
2. "today": one paragraph, 70 to 110 words: how it stands in ${w.year}, who rules (you may name the ruler), what it wants, whom it fears. Give the DM one hook.`}
${STYLE}
Reply with JSON only: {"history": "...", "today": "..."}`);
      prose.realms[s.id] = r;
      say(`realm ${s.fullName}`);
    });
  }
  // Fallen realms, in one go.
  const fallen = w.states.filter((s) => !s.alive && !prose.fallen[s.id]);
  if (fallen.length) {
    tasks.push(async () => {
      const facts = fallen.map((s) => {
        const end = w.events.find((e) => (e.kind === "annexed" || e.kind === "union") && e.states[1] === s.id);
        return `${s.id}: ${n.realm(s.id, s.founded)} (${cultureName(s.culture)}), ${s.origin === "old" ? `old realm` : `broke from ${n.realm(s.parent ?? -1, s.founded)} in ${s.founded}`}; ended ${s.ended}${end ? `, ${end.kind === "union" ? "joined" : "swallowed by"} ${n.realm(end.states[0]!, end.year)}` : ""}.`;
      });
      const r = await ask<Record<string, string>>(`${world}
For each fallen realm below, write one or two sentences a DM can use (what it was, how it ended, what is left of it).
${facts.join("\n")}
${STYLE}
Reply with JSON only, keyed by the number: {"12": "...", ...}`);
      Object.assign(prose.fallen, r);
      say(`fallen realms: ${Object.keys(r).length}`);
    });
  }
  // Notable towns, eight to a prompt.
  const notable = notableTowns(w).filter((b) => !prose.towns[b.id]);
  for (let i = 0; i < notable.length; i += 8) {
    const batch = notable.slice(i, i + 8);
    tasks.push(async () => {
      const facts = batch.map((b) => {
        const realm = w.states.find((s) => s.id === b.state);
        const evs = townEvents(w, b).slice(-12).map(line);
        const traits = [b.walls && "walled", b.citadel && "a citadel", b.port && "a port", b.river && "on a river", b.temple && "a great temple", b.plaza && "a market square", b.shanty && "slums outside the walls"].filter(Boolean).join(", ");
        return `${b.id}: ${b.name}${b.oldName && b.oldName !== b.name ? ` (once ${b.oldName})` : ""}${b.founded ? `, founded ${b.founded}` : ""}; ${Math.round(b.population * 1000)} people; ${b.capital ? "capital of " : "in "}${realm?.fullName ?? "no realm"}; ${cultureName(b.culture)}; ${traits || "plain"}.
  ${evs.join("\n  ") || "No great events."}`;
      });
      const r = await ask<Record<string, string>>(`${world}
For each town below, write 70 to 110 words for a Dungeon Master: what it is like in ${w.year}, what its past left behind, and one rumour or hook.
${facts.join("\n")}
${STYLE}
Reply with JSON only, keyed by the number: {"12": "...", ...}`);
      Object.assign(prose.towns, r);
      say(`towns: ${batch.map((b) => b.name).join(", ")}`);
    });
  }
  await pool(tasks, opts.concurrency ?? 4);
  prose.ages.sort((a, b) => a.from - b.from);
  if (!prose.overview) {
    prose.overview = (await ask<{ text: string }>(`${world}
Write an overview of ${w.name} in ${w.year} ${w.eraShort} for a Dungeon Master, 180 to 250 words: the realms, the balance of power, the mood of the age.
Realms: ${alive.map((s) => `${s.fullName} (${cultureName(s.culture)}, capital ${w.burgs.find((b) => b.id === s.capital)?.name ?? "none"})`).join("; ")}.
The ages: ${prose.ages.map((a) => `${a.from}-${a.to} "${a.title}"`).join("; ")}.
${STYLE}
Reply with JSON only: {"text": "..."}`)).text;
    say("overview");
  }
  return prose;
}

/** A page for a town without its own prose: its facts and its past, from the event log. */
export function townPage(az: AzWorld, w: AgedWorld, b: AgedBurg): string {
  const n = namer(w);
  const cells = az.cells.map((c) => c.p);
  const realm = w.states.find((s) => s.id === b.state);
  const evs = townEvents(w, b);
  const intro = b.alive
    ? `${b.name} is ${b.kind === "fort" ? "a fort" : b.population >= 10 ? "a city" : b.population >= 2 ? "a town" : "a village"} of about ${Math.round(b.population * 1000).toLocaleString("en")} people in the ${realm?.fullName ?? "wild lands"}.`
    : `The ruins of ${b.oldName ?? b.name}, ${b.ruined ? `empty since ${b.ruined}` : "long empty"}.`;
  const past = b.oldName && b.oldName !== b.name ? ` In older days it was called ${b.oldName}.` : b.founded ? ` It was founded in ${b.founded}.` : "";
  return `${intro}${past}${evs.length ? `\n\n${evs.map((e) => eventText(e, n, cells)).join("\n")}` : ""}`;
}

export function realmFacts(az: AzWorld, w: AgedWorld, s: AgedState): string {
  const cap = w.burgs.find((b) => b.id === s.capital);
  return `Capital: ${cap?.name ?? "none"}. People: ${az.cultures.find((c) => c.i === s.culture)?.name ?? "mixed"}. Faith: ${w.religions.find((r) => r.i === s.religion)?.name ?? "none"}.`;
}
