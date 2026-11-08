# Vision tagging guide

You tag Dungeondraft assets (top-down battle map art, 1 grid square = 256 px) from numbered contact sheets.
Each cell shows: the number (red, top left), the image, the file name, the pack name and the footprint in grid squares (width x height).
The generator uses your tags to build medieval and gothic horror battle maps, so be exact about **role**, **facing** and **placement**.

## Output

One JSON object per line (JSONL), one line for every numbered cell, in sheet order:

```json
{"n":12,"role":"chair","facing":"down","placement":"free","tone":"medium","style":"rustic","condition":"fine","fit":3}
{"n":13,"role":"table_set","facing":"none","placement":"free","composite":true,"contains":["table_medium","chair","candle"],"seats":4,"tone":"medium","style":"rustic","condition":"fine","fit":3,"lit":true}
```

Fields (required unless marked optional):

- `n`: the cell number.
- `role`: one value from the role list below. Use `other` with a short `note` when nothing fits.
- `facing`: the direction the piece's **front** points in the image: `down`, `up`, `left`, `right`, or `none` for pieces with no front (round tables, barrels, rugs, rocks, most clutter).
  - Front = the side a person uses or faces: the sitting side of a chair, bench or sofa (the backrest is at the BACK); the open/usable side of shelves, cabinets, wardrobes, counters, ovens, fireplaces, altars (their back goes against a wall); the foot end of a bed points to the front (the headboard is the back); the customer side of a bar counter (where stools would be).
  - Example: a chair drawn with its backrest along the top edge faces `down`. A bar drawn vertically with stools on its left side faces `left`.
- `placement`: where it goes:
  - `free`: stands on the floor away from walls (tables, table sets, chairs, round rugs are `rug`, see below).
  - `wall`: stands on the floor with its back against a wall (shelves, cabinets, wardrobes, beds, counters, ovens, fireplaces, bar back-shelves, altars).
  - `corner`: made for a room corner (corner shelves, corner counters, L-shaped pieces).
  - `surface`: small item that sits ON a table, counter, desk or shelf (candles, mugs, plates, food, books, bottles, papers, cutlery).
  - `wallmount`: hangs on or is set into the wall line (sconces, torches in holders, paintings, banners, wall shelves, windows, mounted heads).
  - `overhead`: hangs above the floor (chandeliers, hanging lamps, beams, canopies).
  - `rug`: rugs, carpets, mats, runners, furs on the floor.
  - `decal`: flat floor marks (dirt, grime, stains, blood, scorch, cracks, puddles, cobwebs, moss, floor imperfections).
  - `outdoor`: exterior pieces (trees, bushes, rocks, fences, gravestones, carts, wells, vegetation).
- `composite` (optional, true only): one image that already contains a group of several pieces arranged by the artist (a table with chairs, a dressed counter with food, a pile of crates, a stack of barrels, a whole room or building).
- `contains` (optional, with composite): roles inside the composite.
- `seats` (optional): number of chairs, stools or bench places in a table set.
- `tone`: overall color: `light`, `medium`, `dark` (dark wood), `black` (near-black/grey art), `stone`, `metal`, `colorful`, `tintable` (bright red or pink fabric/paint areas: 2MT uses red as the default for pieces that Dungeondraft can recolor, such as "Pattern" beds and cushions).
- `style`: `rustic`, `plain`, `ornate` (noble, carved, gilded), `gothic` (dark, spiky, religious-horror), `crude` (goblin, makeshift), `magical` (glowing, arcane), `whimsical` (toy-like, cartoonish, bright), `modern` (anything post-medieval: electric, plastic, cars), `exotic` (clearly Japanese, Egyptian, Aztec etc.).
- `condition`: `fine`, `worn`, `broken`, `bloody`, `burnt`, `overgrown`.
- `fit`: how well the piece suits ordinary medieval-fantasy and gothic-horror battle maps: 3 = great, 2 = fine, 1 = only for special cases, 0 = never (modern, sci-fi, toy-like, labels/UI, tokens of creatures, whole pre-built rooms, unreadable).
- `lit` (optional, true only): the image shows a lit flame or glow, or the piece is a light source (candle, lantern, torch, brazier, fireplace with fire).
- `note` (optional): anything the generator should know, e.g. "only the left half is a table", "doorway, not a door", "3 crates stacked".

## Roles

Seating: `chair`, `armchair`, `stool`, `bench`, `sofa`, `throne`, `pew`
Tables: `table_small` (seats 1-2, up to ~1.2 squares), `table_medium` (seats 4), `table_long` (dining or banquet, 2.5+ squares long), `table_set` (composite table with seating), `desk`, `workbench`, `counter` (kitchen or shop worktop), `bar_counter`, `lectern`, `side_table` (nightstand, end table)
Beds and bath: `bed_single`, `bed_double`, `cot` (bedroll, straw bed, hammock), `bathtub`, `washbasin`, `chamber_pot`, `latrine`
Storage: `wardrobe`, `dresser` (chest of drawers), `cabinet`, `bookshelf`, `shelf` (floor-standing shelving), `display_case`, `chest`, `crate`, `barrel`, `keg`, `sack`, `basket`, `pot_large` (urn, jar, amphora), `rack` (wine rack, tool rack, weapon rack, standing)
Hearth and work: `fireplace` (set into a wall), `oven` (kitchen stove, bread oven), `firepit` (freestanding fire, hearth in a room's middle), `brazier`, `forge`, `anvil`, `cauldron`, `alchemy` (alembic, distillery, lab bench), `loom`, `spinning_wheel`, `grindstone`
Religious and gothic: `altar`, `coffin`, `sarcophagus`, `tomb`, `gravestone`, `grave` (open or dug grave, dirt mound), `mausoleum`, `statue`, `font` (basin, holy water), `candelabra` (floor-standing candle stand), `shrine`, `bones`, `skull`, `corpse`, `cage`, `torture` (rack, iron maiden, stocks, pillory, gallows), `ritual` (summoning circle, runes)
Lights: `candle`, `lantern`, `torch`, `chandelier`, `sconce`, `lamp_post`
Surface items: `mug` (tankard, cup, goblet), `bottle` (bottles, jugs, flasks), `plate` (plates, bowls, platters), `food`, `cutlery`, `cookware` (pots, pans, kettles, cutting boards), `book`, `scroll` (papers, letters, maps), `writing` (quill, ink), `coins`, `games` (cards, dice, chess), `potion`, `tool` (hammer, saw, tongs), `weapon`, `instrument` (lute, drum), `trinket` (any other small item)
Wall decor: `window`, `painting`, `banner` (banner, tapestry, flag), `shelf_wall`, `trophy` (mounted head, antlers), `weapon_wall`, `mirror`, `curtain`
Floor coverings: `rug`, `runner`, `fur`, `mat`
Decals and clutter: `dirt`, `grime`, `stain`, `blood`, `scorch`, `crack`, `puddle`, `cobweb`, `moss`, `debris` (rubble, broken boards, splinters, shards), `straw`, `leaves`, `paper_scatter`, `floor_trim` (floorboard edging, skirting, borders)
Structure: `wall_piece` (wall drawn as an object), `door`, `doorway`, `stairs`, `ladder`, `trapdoor`, `pillar`, `beam`, `railing`, `roof`, `floor_piece` (floor tile or platform drawn as an object), `well`, `fence`, `gate`, `bridge`
Outdoor: `tree`, `dead_tree`, `tree_canopy`, `bush`, `hedge`, `flowers`, `grass`, `mushroom`, `rock`, `boulder`, `log`, `stump`, `cart`, `wagon`, `woodpile`, `haystack`, `hitching_post`, `trough`, `sign`, `tent`, `campfire`, `crops`, `water` (pond, stream piece), `animal`
Other: `instrument_large` (piano, organ, harp), `clock`, `globe`, `easel`, `plant` (potted plant), `training` (dummy, target), `armor_stand`, `mannequin`, `prefab` (whole room or building image), `token` (creature or character token), `label` (text, UI, marker), `other`

## Tips

- Names help a lot: trust the name for the role when the image agrees, but read facing from the image.
- Twilight Tavern style "Dark" pieces are near-black versions of the same art: tone `black`.
- If the art is very small in the cell, the footprint tells you its real size.
- Tag every numbered cell, even blank or unreadable ones (role `other`, fit 0, note "blank").
