/**
 * Realm colours for the world map. Every realm gets one of twelve clearly different colours, chosen
 * so that realms sharing a border look as different as possible, that no two realms look alike
 * while the palette lasts, and that realms two borders apart differ as much as the rest allows. A
 * realm whose colour was set on purpose (an invader the DM steered in) keeps it, and the others keep
 * away from it.
 */

/**
 * Twelve colours, every pair at least ΔE 29 apart and none near teal (the Institute's): red,
 * orange, gold, lime, green, sky, blue, violet, pink, plum, brown, lavender.
 */
export const REALM_PALETTE = ["#b8382e", "#e07b1a", "#d6b11a", "#8db32b", "#2e7d32", "#3fa7d6", "#2c4fa3", "#7e3fa8", "#e07aa8", "#8e2f6b", "#8d5a2b", "#9a8fd0"];

/** Neighbours this far apart (ΔE) look clearly different on the map. */
const CLEAR = 40;
/** Colours closer than this (ΔE) count as the same colour already in use. */
const ALIKE = 25;

/** CIE L*a*b* of an sRGB hex colour. */
function lab(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const lin = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const [r, g, b] = lin;
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = xyz.map(f) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** How different two colours look (ΔE 1976). */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Which realms touch which, and along how many cell edges, from the cells' neighbours. */
export function realmNeighbours(cells: Array<{ i: number; c: number[] }>, state: number[], land: boolean[]): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  for (const cell of cells) {
    const s = land[cell.i] ? state[cell.i] ?? 0 : 0;
    if (!s) continue;
    for (const n of cell.c) {
      const t = land[n] ? state[n] ?? 0 : 0;
      if (!t || t === s) continue;
      const m = out.get(s) ?? out.set(s, new Map()).get(s)!;
      m.set(t, (m.get(t) ?? 0) + 1);
    }
  }
  return out;
}

/** The first place two keys differ decides; the larger wins. */
const better = (a: number[], b: number[]) => {
  for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j]! > b[j]!;
  return false;
};

/** A small seeded random source, so the same map always gets the same colours. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A colour for each realm. Realms choose one after another; each takes a palette colour clearly
 * unlike its neighbours', preferring one that looks like no realm's yet, then the farthest from its
 * neighbours and from the realms two borders away, then the earliest in the palette. Choosing in one
 * order can corner the last realms, so 200 orders are tried (the busiest realms first, then seeded
 * shuffles) and the best map kept: fewest neighbours alike, then fewest realms alike, then the
 * neighbours farthest apart. The same map always gets the same colours.
 */
export function realmColors(ids: number[], neighbours: Map<number, Map<number, number>>, fixed: Map<number, string> = new Map(), palette: string[] = REALM_PALETTE): Map<number, string> {
  const pinned = [...fixed].filter(([id]) => ids.includes(id));
  const near = (id: number) => [...(neighbours.get(id)?.keys() ?? [])].filter((n) => ids.includes(n));
  const ring2 = (id: number) => [...new Set(near(id).flatMap(near))].filter((x) => x !== id && !near(id).includes(x));
  const border = (id: number) => [...(neighbours.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const free = ids.filter((id) => !fixed.has(id));

  const paint = (order: number[]) => {
    const color = new Map<number, string>(pinned);
    const uses = (c: string) => [...color.values()].filter((x) => colorDistance(x, c) < ALIKE).length;
    const minTo = (c: string, others: number[]) => Math.min(Infinity, ...others.filter((o) => color.has(o)).map((o) => colorDistance(c, color.get(o)!)));
    for (const id of order) {
      let best: { c: string; key: number[] } | undefined;
      for (const [i, c] of palette.entries()) {
        // First: clearly unlike every neighbour (ΔE 40, about 60° round the wheel). Then a colour
        // like no realm's yet; then the farthest from the neighbours and from the realms two borders
        // away (in coarse steps, so the later terms still count).
        const d1 = minTo(c, near(id));
        const key = [d1 >= CLEAR ? 1 : 0, -uses(c), Math.floor(Math.min(120, d1) / 8), Math.floor(Math.min(120, minTo(c, ring2(id))) / 8), -i];
        if (!best || better(key, best.key)) best = { c, key };
      }
      color.set(id, best!.c);
    }
    return color;
  };

  const grade = (color: Map<number, string>) => {
    let clashes = 0, alike = 0, closest = Infinity, total = 0;
    for (const [i, a] of ids.entries()) {
      for (const b of ids.slice(i + 1)) {
        const d = colorDistance(color.get(a)!, color.get(b)!);
        const touch = near(a).includes(b);
        if (touch) {
          if (d < CLEAR) clashes++;
          closest = Math.min(closest, d);
          total += d;
        }
        if (d < ALIKE) alike++;
      }
    }
    return [-clashes, -alike, Math.floor(Math.min(closest, 120)), Math.round(total)];
  };

  const busiest = [...free].sort((a, b) => near(b).length - near(a).length || border(b) - border(a) || a - b);
  const rand = seeded(1183);
  let best = paint(busiest);
  let bestGrade = grade(best);
  for (let k = 1; k < 200; k++) {
    const order = [...busiest];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const c = paint(order);
    const g = grade(c);
    if (better(g, bestGrade)) [best, bestGrade] = [c, g];
  }
  return best;
}
