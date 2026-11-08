/**
 * Names for a world that has aged: new names coined in a culture's style (a letter-pair Markov
 * chain over the map's own name base, as Azgaar does), and old names worn down by sound change
 * over the centuries.
 */

import { Rng } from "../gen/rng";
import type { AzNameBase } from "./azgaar";

const VOWELS = "aeiouy";
/** Words a coined name must not contain. */
const RUDE = /shit|fuck|cunt|piss|twat|cock|dick|tits|anus|anal|rape|slut|whore|nazi|nigg|fag|^ass|bitch|crap|turd|wank|porn|sex/;

export class NameMaker {
  private readonly chains = new Map<number, Map<string, string[]>>();
  private readonly used = new Set<string>();

  constructor(private readonly bases: AzNameBase[]) {}

  /** Marks names as taken so new ones don't repeat them. */
  reserve(...names: string[]): void {
    for (const n of names) this.used.add(n.toLowerCase());
  }

  private chain(base: number): Map<string, string[]> {
    let ch = this.chains.get(base);
    if (ch) return ch;
    ch = new Map();
    for (const raw of this.bases[base]?.names ?? []) {
      const name = raw.toLowerCase().replace(/[^a-z' -]/g, "");
      if (name.length < 2) continue;
      const s = `^^${name}$`;
      for (let i = 2; i < s.length; i++) {
        const key = s.slice(i - 2, i);
        (ch.get(key) ?? ch.set(key, []).get(key)!).push(s[i]!);
      }
    }
    this.chains.set(base, ch);
    return ch;
  }

  /** A new name in the style of a name base, not already used and not one of the base's own. */
  coin(base: number, rng: Rng): string {
    const b = this.bases[base] ?? this.bases[0]!;
    const ch = this.chain(base);
    const own = new Set(b.names.map((n) => n.toLowerCase()));
    for (let attempt = 0; attempt < 60; attempt++) {
      let s = "^^";
      while (s.length < 30) {
        const next = ch.get(s.slice(-2));
        if (!next?.length) break;
        const c = rng.pick(next);
        if (c === "$") break;
        s += c;
      }
      let name = s.slice(2).replace(/\s+/g, " ").trim();
      // Tidy: no triple letters, no doubled letters outside the base's allowed ones.
      name = name.replace(/(.)\1\1+/g, "$1$1").replace(/(.)\1/g, (m, c: string) => (b.d.includes(c) ? m : c));
      if (name.length < Math.max(3, b.min - 1) || name.length > Math.min(b.max, 10)) continue;
      if (!/[aeiouy]/.test(name) || own.has(name) || this.used.has(name) || RUDE.test(name)) continue;
      this.used.add(name);
      return capitalize(name);
    }
    // Fallback: a base name, drifted.
    const n = drift(rng.pick(b.names), rng, 2);
    this.used.add(n.toLowerCase());
    return n;
  }
}

export function capitalize(s: string): string {
  return s
    .split(/([ -])/)
    .map((w) => (w.length > 1 && w !== " " && w !== "-" ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join("");
}

/** Sound changes, roughly the kind a thousand years of speech wears into a place name. */
const CHANGES: Array<[RegExp, string]> = [
  [/ville$/, "vel"], [/ville/, "vil"], [/eaux?$/, "o"], [/eau/, "o"], [/ough/, "o"], [/ight/, "ite"], [/ph/, "f"], [/ck/, "k"],
  [/ae/, "e"], [/oe/, "e"], [/([bcdfgklmnprstvz])\1/, "$1"], [/ier$/, "er"], [/ia$/, "a"], [/ie$/, "y"], [/ham$/, "am"],
  [/ton$/, "ten"], [/burgh?$/, "bor"], [/mouth$/, "mo"], [/ford$/, "fort"], [/chester$/, "ster"], [/cester$/, "ster"],
  [/ey$/, "y"], [/ay$/, "ai"], [/^h(?=[aeiou])/, ""], [/th/, "t"], [/w(?=[aeiou])/, "v"], [/qu/, "kw"], [/x$/, "s"],
  [/([aeiou])[aeiou]+/, "$1"], [/e$/, ""], [/y$/, "i"], [/zz/, "z"], [/ss$/, "s"],
];

/** An old name after `strength` rounds of sound change (0: unchanged). Deterministic for a seeded rng. */
export function drift(name: string, rng: Rng, strength: number): string {
  let s = name.toLowerCase();
  const words = s.split(" ");
  // Long multi-word names lose their lesser word.
  if (words.length > 1 && rng.next() < 0.4 * strength) s = words.sort((a, b) => b.length - a.length)[0]!;
  // Doubled place names shed the repeat ("Marvilleville").
  s = s.replace(/(\w{3,})\1/, "$1");
  for (let k = 0; k < strength; k++) {
    const options = CHANGES.filter(([re]) => re.test(s));
    if (!options.length) break;
    const [re, to] = rng.pick(options);
    const next = s.replace(re, to);
    if (next.replace(/[^a-z]/g, "").length >= 3 && [...next].some((c) => VOWELS.includes(c))) s = next;
  }
  if (RUDE.test(s)) return capitalize(name.toLowerCase());
  return capitalize(s);
}
