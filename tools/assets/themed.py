"""List packs whose names match medieval / gothic themes, with piece-vs-prebuilt status.

Usage: python -I themed.py <inventory_all.json>
"""
import json
import re
import sys
from pathlib import Path

inv = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rx = re.compile(
    r"church|chapel|cathedral|grave|crypt|tomb|ossuary|haunt|vampire|mansion|manor|castle|keep|tavern|\binn\b|"
    r"monastery|abbey|asylum|prison|jail|bone|witch|swamp|cult|necro|gothic|cursed|plague|torture|hag|ghost|"
    r"blood|sinister|dungeon|village|town|market|blacksmith|metalsmith|medieval|victorian|ballroom|grime|ruin|statue",
    re.I,
)
rows = []
for r in inv:
    n = r.get("name") or ""
    if not rx.search(n):
        continue
    o, big = r["objects"], r["objects_large"]
    kind = "prebuilt" if o and big == o else "pieces"
    cats = {k: v for k, v in r["categories"].items() if k in ("walls", "patterns", "terrain", "portals")}
    rows.append((n, o, kind, r["volume"], cats))
rows.sort(key=lambda x: x[0].lower())
for n, o, kind, vol, cats in rows:
    extra = " ".join(f"{k}:{v}" for k, v in cats.items())
    print(f"{n[:46]:<46} {o:>5} {kind:<8} {vol[:30]:<30} {extra}")
print(len(rows), "themed packs;", sum(1 for x in rows if x[2] == "pieces"), "with separate pieces")
