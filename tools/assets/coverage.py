"""Count objects matching room-furnishing keywords across all packs (non-colorable only).

Usage: python -I coverage.py <inventory.json>
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

inv = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
KEYWORDS = {
    "tavern": ["bar", "counter", "keg", "tankard|mug", "bench", "stool", "fireplace|hearth", "table", "chair", "bed", "stairs|staircase"],
    "castle/manor": ["throne", "banner", "rug|carpet", "bookcase|bookshelf", "wardrobe|dresser", "chandelier", "candelabra", "armor|armour", "weapon rack|rack"],
    "gothic": ["coffin", "sarcophagus|sarcophagi", "tomb|tombstone|headstone|gravestone|grave", "crypt", "altar", "pew", "lectern|pulpit", "skeleton|skull|bone", "blood", "body|corpse", "candle", "statue", "cage", "chain", "web|cobweb", "debris|rubble", "torture|iron maiden", "cauldron", "mirror", "painting|portrait"],
}
for group, words in KEYWORDS.items():
    print(f"== {group}")
    for w in words:
        rx = re.compile(rf"\b(?:{w})(?:s|es)?\b", re.I)
        per_pack = Counter()
        for r in inv:
            for o in r["object_list"]:
                if o["colorable"]:
                    continue
                stem = o["path"].rsplit("/", 1)[-1].rsplit(".", 1)[0]
                stem = re.sub(r"([a-z])([A-Z])", r"\1 \2", stem).replace("_", " ").replace("-", " ")
                if rx.search(stem):
                    per_pack[r["name"]] += 1
        total = sum(per_pack.values())
        top = ", ".join(f"{n} {c}" for n, c in per_pack.most_common(3))
        print(f"   {w:<26} {total:>4}   {top}")
