# Material tagging guide

You tag Dungeondraft textures (top-down battle-map art, 1 grid square = 256 px) from numbered contact sheets.
The sheets hold five kinds of texture; sheet.json gives each cell's number `n`, asset `name`, `pack` and `id` (the id contains `textures/<kind>/`, which tells you the kind):

- `paths`: long strips Dungeondraft repeats along a line (roads, trails, fences, edging, rails, rivers).
- `patterns`: tiling fills for floors (floorboards, flagstones, tiles, carpets).
- `portals`: doors and windows set into walls (drawn as a horizontal strip, the wall runs left-right).
- `terrain`: tiling ground textures blended across the map (grass, dirt, mud, sand, stone, snow).
- `walls`: wall strips Dungeondraft repeats along a wall line.

The generator uses your tags to pick floors, walls, doors, windows, ground and roads for medieval and gothic horror battle maps.

## Output

One JSON object per line (JSONL), one line for every numbered cell, in sheet order:

```json
{"n":101,"use":"floor_wood","tone":"medium","style":"rustic","fit":3}
{"n":102,"use":"wall_stone","tone":"stone","style":"plain","fit":3,"note":"thick castle wall"}
```

Fields:

- `n`: the cell number.
- `use`: one value from the list below.
- `tone`: `light`, `medium`, `dark`, `black`, `grey`, `warm` (reddish/orange), `cool` (blue/green), `colorful`.
- `style`: `rustic`, `plain`, `ornate`, `gothic`, `crude`, `magical`, `whimsical`, `modern`, `exotic`.
- `fit`: 3 = great for ordinary medieval-fantasy or gothic-horror maps, 2 = fine, 1 = special cases only, 0 = never (modern, sci-fi, toy-like, broken art, colorable greyscale base that only makes sense tinted).
- `gloomy` (optional, true only): dead, withered, cursed, dark or eerie look that suits gothic horror.
- `note` (optional): anything useful ("has blood stains", "very busy pattern", "includes a grid").

## Uses

Paths: `road_cobble`, `road_dirt`, `road_stone` (paved slabs), `trail` (narrow foot path), `fence_wood`, `fence_stone` (low wall), `fence_iron`, `hedge`, `edging` (curbs, borders, trims), `rail`, `river`, `cliff_edge`, `rope`, `vine`, `path_other`
Patterns: `floor_wood`, `floor_stone` (flagstones, slabs), `floor_brick`, `floor_tile` (tiles, marble, checker), `floor_cobble`, `floor_dirt` (packed earth, cave floor), `floor_carpet`, `floor_grate`, `floor_other`
Portals: `door`, `door_double`, `door_secret`, `window`, `window_large`, `gate`, `archway` (open doorway), `bars` (cell bars), `portal_other`
Terrain: `grass`, `grass_dry`, `dirt`, `mud`, `sand`, `gravel`, `stone` (rock ground), `moss`, `leaves` (forest floor), `snow`, `ice`, `water`, `lava`, `flowers`, `terrain_other`
Walls: `wall_wood`, `wall_stone`, `wall_brick`, `wall_plaster` (daub, timber-frame, painted), `wall_castle` (thick fortification), `wall_cave` (natural rock), `wall_hedge`, `wall_fence`, `wall_ruined`, `wall_other`

## Tips

- Trust the name for the kind of material when the image agrees; judge tone, style and fit from the image.
- Recolour or "Colorable" variants in grey are tintable bases: tone `grey`, fit 1 unless they look good as they are.
- Tag every numbered cell, even blank or unreadable ones (`*_other`, fit 0, note "blank").
