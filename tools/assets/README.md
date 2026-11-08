# Asset inventory tools

Scripts used to audit the 2-Minute Tabletop Dungeondraft library before design work. They read Dungeondraft packs (Godot 3 PCK archives) directly and never modify them. Python 3.10+ and Pillow.

| Script | What it does |
|---|---|
| `ddpack.py` | Reads a pack's file index; can unpack a folder of packs. Other scripts import `read_index` from it. |
| `inventory.py` | Inventories every pack in one or more folders: metadata, texture categories, object sizes, tags. Writes JSON, prints one line per pack. |
| `analyze_all.py` | Summarizes an inventory: walls/floors/terrain per pack, pre-built vs modular packs, duplicates. |
| `coverage.py` | Counts objects by furnishing keyword (tavern, castle/manor, gothic). |
| `themed.py` | Lists medieval and gothic packs and whether they hold separate pieces. |
| `inspect_key.py` | Tags and sample objects for named packs. |
| `scale_sheet.py` | Draws sample furniture from several packs on a shared 256 px grid to compare scale. |
| `match_builtin.py` | Matches Dungeondraft's thumbnail cache to its built-in assets (diagnostic). |

Regenerate the full inventory (about 15 seconds for 416 packs):

```powershell
$dirs = @(Get-ChildItem -Directory "D:\DND Assets" | Where-Object { (Get-ChildItem -File $_.FullName -Filter *.dungeondraft_pack).Count -gt 0 } | ForEach-Object { $_.FullName }) + "D:\DND Assets\Volume 5 - PLUS content\Dungeondraft Packs"
python -I -W ignore tools\assets\inventory.py data\inventory_all.json @dirs > data\inventory_all.txt
python -I tools\assets\analyze_all.py data\inventory_all.json
```

`data/` holds generated output and lists 2MT asset filenames, so keep it out of any public repository.
