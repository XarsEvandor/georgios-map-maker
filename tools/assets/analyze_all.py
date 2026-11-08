"""Summarize the full inventory: building-block categories, prefab vs modular, duplicates.

Usage: python -I analyze_all.py <inventory_all.json>
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

inv = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
LARGE = 1500

# 1. Building-block categories (non-object textures)
totals = Counter()
by_cat = defaultdict(list)
for r in inv:
    for k, v in r["categories"].items():
        if k.startswith("data:"):
            continue
        totals[k] += v
        if k != "objects":
            by_cat[k].append((v, r["name"]))
print("== texture categories across all packs:", dict(totals.most_common()))
for cat in ("tilesets", "walls", "terrain", "patterns", "materials"):
    rows = sorted(by_cat[cat], reverse=True)
    print(f"-- {cat}: {sum(v for v, _ in rows)} in {len(rows)} packs")
    print("   " + "; ".join(f"{n} {v}" for v, n in rows[:40]))

# 2. Prefab vs modular packs
prefab, modular = [], []
for r in inv:
    sized = [o for o in r["object_list"] if o["size"]]
    if sized and all(max(o["size"]) > LARGE for o in sized):
        prefab.append(r["name"])
    elif r["objects"]:
        modular.append(r)
print(f"\n== packs: {len(inv)} | only-large-image packs (likely pre-built maps): {len(prefab)} | packs with separate objects: {len(modular)}")
unsized = sum(1 for r in inv for o in r["object_list"] if not o["size"])
print("objects with unknown size:", unsized)

# 3. Duplicates by (normalized filename, size)
def key(o):
    stem = o["path"].rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()
    return (re.sub(r"\s+", " ", stem).strip(), tuple(o["size"] or ()))

seen = Counter()
for r in inv:
    for o in r["object_list"]:
        if not o["colorable"]:
            seen[key(o)] += 1
total = sum(seen.values())
print(f"\n== non-colorable objects: {total} | unique by name+size: {len(seen)} | duplicate copies: {total - len(seen)}")

# Base vs Plus overlap
names = {r["name"]: r for r in inv}
pairs = []
for n, r in names.items():
    for suffix in (" Plus", " Pack"):
        base = n[: -len(suffix)] if n.endswith(suffix) else None
        if base and base in names:
            a = {key(o) for o in names[base]["object_list"]}
            b = {key(o) for o in r["object_list"]}
            pairs.append((base, n, len(a), len(b), len(a & b)))
print(f"base/Plus pairs found: {len(pairs)}; base objects also in the Plus pack: "
      f"{sum(p[4] for p in pairs)}/{sum(p[2] for p in pairs)}")
for p in pairs[:8]:
    print(f"   {p[0]} ({p[2]}) vs {p[1]} ({p[3]}): shared {p[4]}")
