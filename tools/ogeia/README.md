# Ogeia import (Azgaar world map into a test world)

Copies the Wallachia campaign's Azgaar map into another world without touching Wallachia.

1. Copy (never open in place) these LevelDB folders from `Data/worlds/wallachia` into a scratch folder:
   `data/scenes`, `data/journal`, `data/folders`, and `packs/Ogeia_Burgs`, `Ogeia_Provinces`, `Ogeia_Markers`,
   `Ogeia_Countries`, `Ogeia_Cultures`, `Ogeia_Religions`. Set `base` in `read-world.cjs` to that folder.
2. `node read-world.cjs` reads the copies with Foundry's own classic-level and writes `wallachia-dump.json` next to them.
3. `node build-import.cjs` writes `Data/georgios-map-maker/ogeia-import.json`: the map scene (image stays at
   `Data/assets/Ogeia ...png`), 465 pins, and one journal per town, province, marker and country. Compendium links
   become plain names; each town keeps its City Map link.
4. In the target world, as GM, run the import snippet (fetch the JSON, create folders, journals, scene, notes;
   see the 2026-11-07 session notes in TASK.md).

The scene and journals are flagged `georgios-map-maker.ogeia`, so a re-import deletes the previous one first.
