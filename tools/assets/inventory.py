"""Inventory Dungeondraft packs without unpacking them.

Usage: python -I inventory.py <out.json> <packs_dir> [<packs_dir> ...]
Per pack: metadata, texture counts by category, object image sizes, tags.
Prints one summary line per pack and writes full detail to out.json.
"""
import io
import json
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from ddpack import read_index  # noqa: E402

IMG_EXT = (".png", ".webp", ".jpg", ".jpeg")
LARGE = 1500  # px; objects bigger than this on either side are likely whole buildings/scenes


def lenient_json(raw):
    return json.loads(re.sub(r",\s*([}\]])", r"\1", raw))


def image_size(f, e):
    f.seek(e["offset"])
    head = f.read(min(e["size"], 262144))
    for data in (head, None):
        try:
            if data is None:  # large WebP needs the whole file to report its size
                f.seek(e["offset"])
                data = f.read(e["size"])
            with Image.open(io.BytesIO(data)) as im:
                return im.size
        except Exception:
            continue
    return None


def inventory_pack(path, volume):
    with path.open("rb") as f:
        info = read_index(f)
        rec = {"file": path.name, "volume": volume, "files": len(info["entries"])}
        cats = Counter()
        objects = []
        for e in info["entries"]:
            p = e["path"]
            low = p.lower()
            if low.endswith(".json") and p.count("/") == 3:  # res://packs/<id>.json
                f.seek(e["offset"])
                meta = json.loads(f.read(e["size"]).decode("utf-8-sig"))
                rec.update(name=meta.get("name"), id=meta.get("id"), version=meta.get("version"))
            elif low.endswith(".dungeondraft_tags"):
                f.seek(e["offset"])
                try:
                    tags = lenient_json(f.read(e["size"]).decode("utf-8-sig"))
                    rec["tags"] = {k: len(v) for k, v in tags.get("tags", {}).items()}
                except Exception as ex:
                    rec["tags_error"] = str(ex)
            if "/textures/" in p and low.endswith(IMG_EXT):
                rel = p.split("/textures/", 1)[1]
                cat = rel.split("/", 1)[0]
                cats[cat] += 1
                if cat == "objects":
                    size = image_size(f, e)
                    objects.append({"path": rel, "size": size, "colorable": "colorable" in low})
            elif "/data/" in p or low.endswith(".json"):
                cats["data:" + p.rsplit("/", 1)[-1]] += 1
        rec["categories"] = dict(cats)
        sized = [o for o in objects if o["size"]]
        rec["objects"] = len(objects)
        rec["objects_colorable"] = sum(o["colorable"] for o in objects)
        rec["objects_large"] = sum(max(o["size"]) > LARGE for o in sized)
        rec["obj_median_px"] = int(statistics.median(max(o["size"]) for o in sized)) if sized else None
        rec["object_list"] = objects
        return rec


def main():
    out = Path(sys.argv[1])
    results = []
    for d in map(Path, sys.argv[2:]):
        for pack in sorted(d.glob("*.dungeondraft_pack")):
            results.append(inventory_pack(pack, d.name))
    out.write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(f"{'volume':<34} {'pack':<44} {'obj':>4} {'col':>4} {'big':>4} {'med':>5}  other categories")
    for r in results:
        other = {k: v for k, v in r["categories"].items() if k != "objects" and not k.startswith("data:")}
        print(f"{r['volume'][:34]:<34} {str(r.get('name'))[:44]:<44} {r['objects']:>4} {r['objects_colorable']:>4} "
              f"{r['objects_large']:>4} {str(r['obj_median_px']):>5}  {other or ''}")
    print("packs:", len(results), " objects:", sum(r["objects"] for r in results))


if __name__ == "__main__":
    main()
