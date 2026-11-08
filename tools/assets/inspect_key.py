"""Print tags and sample object names/sizes for selected packs from inventory.json.

Usage: python -I inspect_key.py <inventory.json> <name substring> [...]
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

inv = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
probe = re.compile(r"(bed|chair|stool|table|barrel|door|coffin|candle|bookcase|bookshelf)", re.I)
for want in sys.argv[2:]:
    for r in inv:
        if r.get("name") != want:
            continue
        print(f"== {r['name']} ({r['volume']}) objects={r['objects']} cats={ {k: v for k, v in r['categories'].items() if not k.startswith('data:')} }")
        tags = r.get("tags", {})
        print("   tags:", ", ".join(f"{k}:{v}" for k, v in sorted(tags.items(), key=lambda kv: -kv[1])[:14]))
        folders = Counter(o["path"].rsplit("/", 1)[0] for o in r["object_list"])
        print("   folders:", dict(folders.most_common(8)))
        hits = [o for o in r["object_list"] if probe.search(o["path"].rsplit("/", 1)[-1]) and not o["colorable"]]
        for o in hits[:10]:
            print(f"     {str(o['size']):>12}  {o['path']}")
