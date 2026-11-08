# Georgios' Map Maker

Builds battle maps for Foundry VTT from a description. Claude interviews you, writes a scene plan, and a deterministic generator assembles the map from your own 2-Minute Tabletop Dungeondraft packs: walls, floors, doors, furniture, clutter and lights. You get 3 versions with different looks, pick one, and build the Foundry scene with walls, doors and lights already placed. You can open any map in Dungeondraft, edit it, save, and your edits come back and survive regeneration.

Design: [DESIGN.md](DESIGN.md). Status of each part: [Status](#status).

## What you need

- Windows PC with Node.js 20+ (tested on Node 24)
- Your 2-Minute Tabletop Dungeondraft packs (tested with Volumes 1 to 12 plus PLUS in `D:\DND Assets`)
- Dungeondraft 1.2.0.1 (for hand edits)
- Foundry VTT v13 or v14 (tested on 14.370), on this PC or hosted
- Claude: Claude Code signed in with your subscription (used through `claude -p`), or an Anthropic API key

## Setup

```powershell
cd georgios-map-maker
npm install
npm run index -- --root "D:\DND Assets"    # about 1 minute the first time, seconds after
npm test                                    # 152 tests
```

`npm run index` writes `data/asset-index.json` and `data/index-report.md` (type coverage and lookalike groups). `data/` lists 2MT asset names; keep it out of public repositories.

The generator also needs the vision tags in `data/asset-tags.json`: what each piece is, which way it faces, where it goes, and which floors, walls and doors suit medieval and gothic maps. They were made once by Claude agents looking at contact sheets (`tools/vision/`); `node tools/vision/merge.mjs` rebuilds the file from the tag batches in `data/vision/`. To tag more packs, add them to `tools/vision/packs.txt`, run `node tools/vision/prepare.mjs <batches> data/vision`, render sheets with `asset-sheet.ts --ids`, tag them with agents following `ROLES.md`, and check each batch with `check.mjs`.

## Run

```powershell
npm run serve                                # claude -p backend, your Claude subscription
$env:GMM_BACKEND="api"; $env:ANTHROPIC_API_KEY="sk-..."; npm run serve   # API backend
```

The companion listens on `http://127.0.0.1:47110` only and writes a token to `data/companion-token.txt`.
Options: `GMM_PORT`, `GMM_MODEL` (for `claude -p`, e.g. `opus` or `sonnet`), `GMM_CLAUDE` (path to claude.exe; by default it finds the one bundled with the VS Code extension), `GMM_DD_EXE` (Dungeondraft path).

In subscription mode the companion removes `ANTHROPIC_API_KEY` from the environment of `claude -p`, because a set key would switch it to API billing.

## Foundry module

The module is in [foundry-module/](foundry-module/). Copy that folder to your Foundry `Data/modules/georgios-map-maker` (already done on this PC; Foundry runs that copy, so copy `scripts/main.js` again after the module changes), enable it in a world, then in **Configure Settings > Georgios' Map Maker** paste the token from `data/companion-token.txt`. The token is stored only in your browser.

Open the panel with the **Map Maker** button in the Scenes sidebar (GM only), or `game.modules.get("georgios-map-maker").api.open()`.

1. Describe the map. Claude may ask a few questions.
2. Click a version to pick it.
3. **Build scene** uploads the render to `Data/georgios-map-maker/` and creates the scene with walls, doors and lights (or updates the scene it made before).
4. Ask for changes in the chat ("remove the chairs from table 3", "keep the bar, re-roll the rest").
5. **Open in Dungeondraft**, edit, save with Ctrl+S: the companion sees the save, locks your edits, and the panel refreshes. **Build scene** again to update Foundry.
6. **Enable packs in Dungeondraft** adds the map's packs to Dungeondraft's active packs (Dungeondraft must be closed; a backup of its config is kept).

## Cities

Cities from Azgaar's Fantasy Map Generator (the azgaar-foundry import) open as scenes:

1. On the world map, open a city's pin and click its **City Map** link (or call `game.modules.get("georgios-map-maker").api.openCity(url, name)`). Confirm, and the companion fetches the city's layout from watabou's Medieval Fantasy City Generator (headless Edge), draws it with your 2MT textures at 25 or 50 ft per square, and opens it for everyone with pins on its places: market, the castle's keep, temple, a tavern by the main gate, the main gate, the docks. It takes about 10 seconds.
2. While the players look at the city, the places build in the background (interiors first). A grey pin turns white when its battle map is ready; double-click it to open the map (Shift + double-click shows it to everyone). In a test, six places were ready in about 100 seconds.
3. To build any other spot, pick **Map an area** in the left toolbar's **Georgios' Modules** group (the dragon), drag a box on the city scene and confirm. The box shows its size in feet and stops growing at about 390 ft; that area becomes a street-level battle map (real building outlines, cobbled streets, city walls with towers, piers, market stalls, street clutter).
4. Street-level maps show every building from inside: floor, walls, a door and windows, rooms with doors between them, and furniture by room (homes with a hearth, beds and a table; a bar in the tavern; pews in the church; hall, dining room, kitchen and chambers in the keep; stores in warehouses; hay in stables). The city scene keeps its roofs. Street maps built before this change are rebuilt once, the first time the GM opens them.
5. Every city has shops: a blacksmith by a gate, a merchant on the market square, a baker and a butcher near it, a herbalist and a potion maker a walk away, a fishmonger by the water; a city adds an armourer, tailor, cobbler, chandler, potter and carpenter, a large city a jeweller, a bookseller and more. Each shop has a pin with its trade's icon; double-click it for a map of the shop and its street. The shop shows its counter, goods and work pieces, the keeper behind the counter and a customer or two by day. City scenes opened before shops existed get their shop pins the first time the GM opens them.
6. Cities also have their services, the law and the underworld: a healer by the temple, a watch house by a gate, an alehouse, a beggars' den, a thieves' den and a fence (a pawnshop with contraband in the back), a tannery by the water and a furrier; a city adds an alchemist, a moneylender, an undertaker, a bathhouse, a gaol (its cells locked), a gambling den, a smugglers' den by the sea, a brewery, a shipwright and a stonemason. Noble mansions (one in a town without a castle, three in a city, six in a large one, each named for its house), a garrison by the main gate and stables have their own art on the city scene. The thieves' den, the fence, the gambling den and the smugglers' den are secret: only the GM sees their pins. Inside, people go about their business: patients and a healer, guards in their bunks and at the mess table, prisoners in the cells, thieves and gamblers at their tables, beggars round the fire, nobles at dinner. A city opened before this is drawn again with its mansions and garrison, and gets the new pins, the first time the GM opens it.

Layouts are cached in `data/cities`. Watabou's generators are free to use, generated maps included ([FAQ](https://watabou.github.io/faq.html)).

## Command line

```powershell
npm run gen -- examples/plans/tavern.json          # 3 versions in data/maps/<plan id>/
npm run render -- data/maps/smugglers-tavern --pps 48 [--lighting] [--grid]
npx tsx packages/companion/src/cli/versions-sheet.ts data/maps/smugglers-tavern
npx tsx packages/companion/src/cli/layout-sheet.ts examples/plans/tavern.json   # floor plans for 9 seeds
npx tsx packages/companion/src/cli/debug-styles.ts medieval chair,bar_counter    # each version's anchor pack and role pools
npx tsx packages/companion/src/cli/asset-sheet.ts --pack "Twilight Tavern" --out data/sheets/tt   # numbered contact sheets
npx tsx packages/companion/src/cli/dump-assets.ts out 1200 "<asset name or id>"  # pull images out of the packs
```

Example plans: [examples/plans/](examples/plans/): smugglers' tavern with a pinned table, roadside inn with three guest rooms, ruined chapel in a graveyard, gothic manor, haunted manor with six rooms, forgotten crypt, graveyard, and the entrance to Dracula's castle (a gallery corridor with a frayed red carpet, a locked gothic gate and two wrecked gates).

What a plan can ask for besides rooms: gates (`via: "gate"`, a `width`, a Foundry `state` of closed, locked or open; their leaves swing open in Foundry), gates blown apart (`broken: "medieval"` or `"scifi"`), doors into the unseen rest of a building (`to: "beyond"`: nothing is drawn behind them, and the map becomes `enclosed`, dark around the walls with an approach only in front of the entrance), corridors with rooms or gates off their left and right walls (`gothic.gallery`, `wall`, `along`), lighting by mood (`mood.lighting`: bright, dim or dark), and colors and wear for a step (`modify` with `color: "crimson"`, `condition: "frayed"`). DESIGN.md section 19 has the details.

## Layout

| Path | What |
|---|---|
| `packages/core` | Pure TypeScript: asset model and taxonomy, scene plan and validation, layout, palettes, furnishing, Dungeondraft map writer, round-trip diff, Foundry scene conversion |
| `packages/companion` | Node: pack reader, indexer, renderer, map store, local server, Claude backends, MCP proxy, Dungeondraft bridge, CLIs |
| `foundry-module` | Foundry VTT module (plain ES modules, no build step) |
| `tools/assets` | Python audit scripts from the design phase |

## Status

Verified on this PC on 2026-11-06:

- Index of the full library: 416 pack files, 404 unique packs, 44,450 textures, 64 s first run.
- Generation: tavern, chapel with graveyard, and manor plans in about 50 ms each; maps render with the real 2MT art.
- A Dungeondraft map written by this code opened in Dungeondraft 1.2.0.1 via its command line; a generated map (roadside inn v2, 25 packs) looks there like our renders. `npx tsx packages/companion/src/cli/dd-open.ts <map>` enables a map's packs and opens it.
- The Foundry module, live in Foundry 14.370 (the Scribbler Test world, migrated from v13 with a backup): the Map Maker button and panel, the token setting, chat with Claude through `claude -p` (questions, plan, previews, a change request), version thumbnails, Build scene (background, grid, 53 walls, 24 lights), a locked gate that the GM opens and whose leaves swing open, walls blocking a token's sight.
- `claude -p` with your subscription drove the tools end to end through the MCP proxy (a full inn built from one message in about 10 s).
- Cities: a city link in a journal opened as a city scene in Foundry 14 (test world, a pin and journal in the Azgaar format), six places built in the background and opened from their pins, and a drawn rectangle built as a street map.
- 149 tests (12 for aged worlds, one for steering, 8 for townsfolk, 3 for clearings in front of enclosed maps, 11 for house interiors, shops and services), plan validation, cities (parsing, hot spots, plans, street maps, link guard, hip roofs, 2MT house placement and landmarks, places by size and location, ships), determinism, connectivity, no overlaps, overrides, locks through reseed and restart, edits staying in their room, corridors and gates, gates into the unseen beyond, the dark around enclosed maps, mood lighting, wrecked-gate gaps, Foundry conversion (door states, gate animation, windows), module helpers, server auth and limits, hostile packs and maps.

Not yet verified or built:

- The Dracula map and the city street maps have not been opened in Dungeondraft (street maps use roof textures as floor patterns, unchecked there).
- Cities were tested with a stand-in pin and journal, not your Ogeia import; the azgaar-foundry module is marked for Foundry 12 and is untested on 14. Street maps and the city scene build every building from 2MT roof drawings, with landmark art for the temple, keep, tavern, guildhall and warehouses, more places by city size and location (inns, stables, parish chapels, a wizard's tower, lighthouse, windmills, fountains, a gatehouse), ships and boats at the piers and barges on rivers (DESIGN 20); after a new asset library, rerun `npx tsx packages/companion/src/cli/house-outlines.ts`. Markets and docks are dressed, plain streets stay sparse and there are no people; interiors are sized to the building's footprint, not shaped like it. Its gates use a scaled portal texture, a frame at the above-walls layer and stretched carpet pieces; how Dungeondraft draws a scaled portal is unchecked.
- "Open in Dungeondraft" and "Enable packs" from the Foundry panel were not clicked in this test (the same code ran from the command line earlier).
- Generated maps are judged against 2MT's own furnished maps by a vision critic; they don't match them yet (see TASK.md for the latest scores and remaining problems).
- The API backend is written to the current SDK but has not been run (no API key here).
- Multi-level maps, the `.dd2vtt` exact-render path, pre-built building quick-pick and Dungeondraft built-in assets are not implemented.

## Licensing

2-Minute Tabletop assets are CC BY-NC 4.0 and "only intended for private use". This project ships no assets and reads your purchased packs locally; only rendered images go to your own Foundry. Packs that set `allow_3rd_party_mapping_software_to_read` to false are skipped (none of yours do). Keep it free and personal; ask 2-Minute Tabletop before any paid release.
