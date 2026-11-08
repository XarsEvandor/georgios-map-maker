/** Godot var2str value formatting and parsing, as used inside .dungeondraft_map JSON. */

export type Vec2 = [number, number];

/** Godot prints integers without a decimal point and floats with up to 6 decimals. */
export function formatReal(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite number ${v}`);
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(6)));
}

export function formatVector2([x, y]: Vec2): string {
  return `Vector2( ${formatReal(x)}, ${formatReal(y)} )`;
}

export function formatVector2Array(points: Vec2[]): string {
  if (!points.length) return "PoolVector2Array(  )";
  return `PoolVector2Array( ${points.map(([x, y]) => `${formatReal(x)}, ${formatReal(y)}`).join(", ")} )`;
}

export function formatIntArray(v: ArrayLike<number>): string {
  return v.length ? `PoolIntArray( ${Array.from(v).join(", ")} )` : "PoolIntArray(  )";
}

export function formatByteArray(v: Uint8Array): string {
  if (!v.length) return "PoolByteArray(  )";
  // Join in chunks; one giant Array.from(...).join is slow for maps with large splats.
  const parts: string[] = [];
  for (let i = 0; i < v.length; i += 65536) parts.push(Array.from(v.subarray(i, i + 65536)).join(", "));
  return `PoolByteArray( ${parts.join(", ")} )`;
}

function body(s: string, kind: string): string {
  const t = s.trim();
  if (!t.startsWith(`${kind}(`) || !t.endsWith(")")) throw new Error(`expected ${kind}(...), got ${t.slice(0, 40)}`);
  return t.slice(kind.length + 1, -1);
}

function numbers(s: string): number[] {
  const trimmed = s.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((x) => {
    const n = Number(x.trim());
    if (!Number.isFinite(n)) throw new Error(`bad number "${x.trim()}"`);
    return n;
  });
}

export function parseVector2(s: string): Vec2 {
  const v = numbers(body(s, "Vector2"));
  if (v.length !== 2) throw new Error(`Vector2 needs 2 numbers: ${s}`);
  return [v[0]!, v[1]!];
}

export function parseVector2Array(s: string): Vec2[] {
  const v = numbers(body(s, "PoolVector2Array"));
  if (v.length % 2) throw new Error("PoolVector2Array has an odd number of values");
  const out: Vec2[] = [];
  for (let i = 0; i < v.length; i += 2) out.push([v[i]!, v[i + 1]!]);
  return out;
}

export function parseByteArray(s: string): Uint8Array {
  return Uint8Array.from(numbers(body(s, "PoolByteArray")));
}

/** "#RRGGBB", "RRGGBB" or Dungeondraft ARGB "AARRGGBB" -> lowercase ARGB. */
export function toArgb(color: string): string {
  const c = color.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(c)) return `ff${c}`;
  if (/^[0-9a-f]{8}$/.test(c)) return c;
  throw new Error(`color must be #RRGGBB or AARRGGBB, got ${JSON.stringify(color)}`);
}
