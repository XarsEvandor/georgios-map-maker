"""Draw sample objects from several packs at native pixel size on a shared 256 px grid.

Usage: python -I scale_sheet.py <out.png> [<assets root, default D:\\DND Assets>]
"""
import io
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from ddpack import read_index  # noqa: E402

ROOT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(r"D:\DND Assets")
ROWS = [
    ("Volume 3 - Dungeondraft packs/2MT Castle Walls", [r"Door \(2x1\)"]),
    ("Volume 3 - Dungeondraft packs/2MT Castle Furniture", [r"Bed, medium, double", r"Chair, armchair\.", r"^Table"]),
    ("Volume 4 - Dungeondraft packs/2MT Mansion Furniture", [r"Bed, large\.", r"Chair, armchair, 1", r"^Table"]),
    ("Volume 4 - Dungeondraft packs/2MT Typical Tavern", [r"^Bed 2", r"Bench Dining Table 1", r"Chair|Stool"]),
    ("Volume 7 - Dungeondraft packs/2MT Furniture Map Assets", [r"Bed - Pattern 1\.a", r"^Chair", r"^Table"]),
    ("Volume 7 - PLUS Dungeondraft packs/2M Sinister Cabin Pack", [r"^Bed\.", r"^Chair 1", r"Dining table"]),
]
CELL, S = 256, 0.3  # grid cell in asset pixels, display scale
out_rows = []
for pack_rel, patterns in ROWS:
    pack = ROOT / (pack_rel + ".dungeondraft_pack")
    with pack.open("rb") as f:
        entries = [e for e in read_index(f)["entries"] if "/textures/objects/" in e["path"] and "olorable" not in e["path"]]
        picked = []
        for pat in patterns:
            rx = re.compile(pat, re.I)
            e = next((e for e in entries if rx.search(e["path"].rsplit("/", 1)[-1])), None)
            if e:
                f.seek(e["offset"])
                im = Image.open(io.BytesIO(f.read(e["size"]))).convert("RGBA")
                picked.append((e["path"].rsplit("/", 1)[-1], im))
    out_rows.append((pack.stem, picked))

pad = int(CELL * S)
width = max(sum(int(im.width * S) + pad for _, im in row) for _, row in out_rows) + 2 * pad + 360
height = sum(max(int(im.height * S) for _, im in row) + 2 * pad for _, row in out_rows)
sheet = Image.new("RGBA", (width, height), (250, 250, 250, 255))
d = ImageDraw.Draw(sheet)
step = CELL * S
x = 360.0
while x < width:
    d.line([(int(x), 0), (int(x), height)], fill=(200, 200, 200, 255))
    x += step
y = 0.0
while y < height:
    d.line([(360, int(y)), (width, int(y))], fill=(200, 200, 200, 255))
    y += step
y = pad
for name, row in out_rows:
    rh = max(int(im.height * S) for _, im in row)
    d.text((8, y + 4), name, fill=(0, 0, 0, 255))
    x = 360 + pad
    for label, im in row:
        sheet.alpha_composite(im.resize((int(im.width * S), int(im.height * S))), (x, y))
        d.text((x, y + int(im.height * S) + 4), f"{label[:28]} {im.width}x{im.height}", fill=(60, 60, 60, 255))
        x += int(im.width * S) + pad
    y += rh + 2 * pad
sheet.convert("RGB").save(sys.argv[1])
print("saved", sys.argv[1], sheet.size)
