"""Count how many Dungeondraft thumbnails belong to Dungeondraft's own built-in assets.

Reads only the file index of Dungeondraft.pck (no extraction).
Usage: python -I match_builtin.py <Dungeondraft.pck> <thumbnails_dir> <vol01 index.json>
"""
import collections
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ddpack import read_index  # noqa: E402

thumbs = {p.stem for p in Path(sys.argv[2]).glob("*.png")}
with open(sys.argv[1], "rb") as f:
    info = read_index(f)
print(f"Dungeondraft.pck: format {info['format']}, godot {info['godot']}, {len(info['entries'])} files")


def norm(path):
    # Godot stores imported textures as foo.png.import / .stex; thumbnails hash the source path
    for suffix in (".import",):
        if path.endswith(suffix):
            path = path[: -len(suffix)]
    return path


builtin_hits = collections.Counter()
seen = set()
for e in info["entries"]:
    p = norm(e["path"])
    if p in seen:
        continue
    seen.add(p)
    if hashlib.md5(p.encode()).hexdigest() in thumbs:
        parts = p.removeprefix("res://").split("/")
        builtin_hits["/".join(parts[:3])] += 1

pack_index = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
pack_hits = sum(
    1
    for info2 in pack_index.values()
    for e in info2["entries"]
    if "/textures/" in e["path"] and hashlib.md5(e["path"].encode()).hexdigest() in thumbs
)
total_builtin = sum(builtin_hits.values())
print(f"thumbnails: {len(thumbs)}  |  2MT Volume 1: {pack_hits}  |  Dungeondraft built-in: {total_builtin}  |  unmatched: {len(thumbs) - pack_hits - total_builtin}")
print("built-in thumbnails by folder:")
for folder, n in builtin_hits.most_common(20):
    print(f"  {n:>5}  {folder}")
