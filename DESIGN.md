# Georgios' Map Maker: Design

Status (2026-11-06): first build done (M0 to M6). The generator was then rebuilt for quality after the v0 maps were judged unusable: vision-tagged assets, an architect, room recipes and per-pack styles. Section 18 describes the rebuild and supersedes the generation parts of sections 7 to 9. Open gaps are in the README's Status section.

## 1. What it does

Georgios' Map Maker is a Foundry VTT module that builds battle maps from a DM's description. The DM types a request ("a smuggler's tavern by the docks, two floors, a fight breaks out in the common room"). Claude asks a few questions to fill the gaps, then the generator assembles the map piece by piece from the DM's own 2-Minute Tabletop (2MT) Dungeondraft assets: walls, floors, furniture, clutter, lights. The result lands in Foundry as a scene with walls, doors and lights already placed.

The DM stays in control. They can ask for changes in chat ("remove the chairs from that table"), lock parts they like and re-roll the rest, or open the map in Dungeondraft, edit it by hand and save. Saved edits flow back into Foundry and survive later regeneration.

## 2. Scope

**In scope for v1**

- Genres: medieval and gothic horror.
- Asset library: 2-Minute Tabletop Dungeondraft packs, Volumes 1 to 12 plus PLUS packs, read from the DM's disk.
- Dungeondraft 1.2.0.1 as the hand-editing tool.
- Foundry VTT v13 (check v14 compatibility once we know which version you run).
- Claude through `claude -p` (subscription) or the Anthropic API.

**Out of scope for now**

- Sci-fi. 2MT has sci-fi packs in the same art style if it comes back.
- AI-generated map images. Every pixel comes from real assets.
- Bundling, uploading or selling assets.
- Other asset libraries (Forgotten Adventures, Dungeondraft built-ins). The design keeps the asset layer generic so they can be added later.

## 3. Key decisions

| Decision | Reason |
|---|---|
| Maps are built from assets, never generated as images | Image generators give maps with no walls or editable pieces and no consistent art. |
| `.dungeondraft_map` is the master file for every map | The DM can open any generated map in Dungeondraft, and one file feeds both Dungeondraft and our renderer. |
| Claude decides *what* goes *where* in words; code does the geometry | LLMs are unreliable at placing hundreds of objects by coordinate. |
| Overrides live in the plan, not in the output | Regenerating never loses a DM's choices or hand edits. |
| A companion app runs on the DM's PC | It needs the asset files, Dungeondraft, and `claude -p`, all of which live on that PC. |
| Shipped code is TypeScript | It shares types with the Foundry module and runs in Node. The Python scripts in `tools/assets/` stay as audit tools. |
| The module never ships or uploads raw assets | 2MT licenses its assets CC BY-NC 4.0 for private use (section 14). Only the rendered map image goes to the DM's own Foundry. |
| Each request produces 3 versions with different asset palettes | Many assets fit one description. The DM picks the version that fits the vibe, and a palette keeps each version cohesive (section 9). |

## 4. Architecture

```
 DM's browser                          DM's PC
┌──────────────────────┐   websocket  ┌─────────────────────────────────────────────┐
│ Foundry module       │◄────────────►│ Companion app (Node/TypeScript)             │
│  - chat panel        │              │  ┌──────────────┐   ┌────────────────────┐  │
│  - scene builder     │              │  │ LLM layer     │──►│ Tools (MCP + API)  │  │
│  - selection, labels │              │  │ claude -p/API │   └─────────┬──────────┘  │
└──────────┬───────────┘              │  └──────────────┘             ▼             │
           │ creates scene,           │  ┌──────────────┐   ┌────────────────────┐  │
           ▼ walls, doors, lights     │  │ Asset index   │◄──│ Generator core     │  │
┌──────────────────────┐              │  └──────▲───────┘   │ plan→layout→dress  │  │
│ Foundry server       │              │         │           │ →.dungeondraft_map │  │
│ (local or hosted)    │              │  D:\DND Assets      └─────────┬──────────┘  │
└──────────────────────┘              │  (2MT packs)                  ▼             │
                                      │  ┌──────────────┐   ┌────────────────────┐  │
                                      │  │ Renderer      │◄──│ Dungeondraft bridge│◄─┼── Dungeondraft 1.2.0.1
                                      │  │ map → WebP    │   │ open, watch, diff  │  │   (DM edits, saves)
                                      │  └──────────────┘   └────────────────────┘  │
                                      └─────────────────────────────────────────────┘
```

| Component | Job |
|---|---|
| **Foundry module** (`georgios-map-maker`) | Chat panel, generate and re-roll buttons, "Open in Dungeondraft", scene creation (background image, walls, doors, lights), selecting map pieces to refer to in chat. |
| **Companion app** | Hosts everything else. Talks to the module over a local websocket and to `claude -p` over MCP. |
| **Generator core** | Pure TypeScript library: scene plan in, `.dungeondraft_map` out. Deterministic for a given plan and seed. |
| **Asset index** | Catalog of every usable asset with type, footprint, tags and variants. Built once from the packs, rebuilt when packs change. |
| **Renderer** | Draws a `.dungeondraft_map` into a WebP image using the pack textures. |
| **Dungeondraft bridge** | Opens maps in Dungeondraft, watches for saves, compares the saved file with the last generated one, and turns hand edits into plan directives. |
| **LLM layer** | One interface with two backends: `claude -p` and the Anthropic API. |

Rendering happens in the companion app, not in Foundry, because the asset files only exist on the DM's PC. Foundry can be self-hosted or hosted elsewhere. The module receives the finished image and uploads it to the DM's own Foundry data.

## 5. End-to-end flow

1. **Request.** The DM types a description in the Foundry panel.
2. **Interview.** Claude reads the request, fills what it can into a scene plan, and asks 3 to 5 questions about the gaps: size in squares, entrances, time of day, encounter needs (cover, elevation, hazards), mood. Every question has a default the DM can accept.
3. **Generate.** The generator lays out zones, builds walls and floors, places furniture groups and clutter, and adds lights. It then furnishes that one layout with 3 different asset palettes (section 9), writing one `.dungeondraft_map` per version plus a shared `plan.json`.
4. **Pick.** The panel shows the 3 versions side by side as quick low-resolution previews, each with a short name such as "dark and grimy" or "warm and lived-in". The DM picks one, mixes parts of them, or asks for more.
5. **Render and import.** The renderer draws the picked version at full resolution. The module creates or updates the Foundry scene with the image, walls, doors and lights.
6. **Critique.** In the background, the companion renders a labeled preview and sends it to Claude, which flags problems ("the northeast corner is empty", "a tavern needs a bar") and patches the plan. This repeats at most 2 or 3 times (configurable). The DM can play on the first import, and the scene updates whenever a pass improves it.
7. **Edit.** The DM asks for changes in chat, selects pieces in Foundry, or opens the map in Dungeondraft. Every change becomes a directive in the plan.
8. **Re-roll.** The DM can regenerate any unlocked part, or "shuffle layout" for a new seed. Directives and locks always survive.

## 6. Scene plan

The scene plan is the single source of truth for intent. Claude writes and patches it through tools, and the engine validates every change against a JSON Schema and returns structured errors.

```json
{
  "id": "smugglers-tavern",
  "seed": 81723,
  "genre": "medieval",
  "size": { "w": 30, "h": 22 },
  "mood": { "time": "night", "wear": "grimy", "lighting": "dim" },
  "versions": { "count": 3, "vary": "palette", "picked": "v2" },
  "levels": [{
    "id": "ground",
    "zones": [
      { "id": "common", "type": "tavern.common_room", "area": "large" },
      { "id": "kitchen", "type": "tavern.kitchen" },
      { "id": "cellar_stairs", "type": "stairs.down" }
    ],
    "connections": [
      { "from": "common", "to": "kitchen", "via": "door" },
      { "from": "common", "to": "outside", "via": "door", "side": "south" }
    ]
  }],
  "directives": [
    { "id": "d1", "pin": "table.dining.long", "zone": "common",
      "at": { "anchor": "center" }, "slots": { "chairs": 0 },
      "with": ["corpse"], "source": "dm-chat" },
    { "id": "d2", "forbid": ["rug"], "zone": "kitchen", "source": "dm-chat" },
    { "id": "d3", "modify": "group.table_set", "zone": "common",
      "count": { "min": 5, "max": 7 }, "source": "llm" }
  ],
  "locks": [
    { "id": "l1", "region": { "x": 2, "y": 3, "w": 8, "h": 6 }, "source": "dm-dungeondraft" }
  ]
}
```

**Directive types**

| Type | Effect |
|---|---|
| `pin` | Places a specific asset type or asset. The generator places pins first, builds around them and never moves them. |
| `modify` | Changes a rule's output: slot contents ("no chairs"), counts, density, condition ("broken"). |
| `forbid` | Bans an asset type or tag from a zone or the whole map. |
| `free` | Adds something outside any rule ("a rowboat in the chapel"). It works like a pin, but no rule expects the object. |
| `restyle` | Sets which look an asset type uses in a zone or the whole map: "all chairs in the common room from version 1", "floors from version 2". |

**Locks** freeze a region or a list of element IDs. Locked content is copied unchanged into every regeneration.

**Anchors.** Claude never writes pixel coordinates. It writes anchors and the engine resolves them: `center`, `along: north_wall`, `corner: ne`, `near: <element id>`, `facing: <element id | door>`, `between: [a, b]`, and an optional `offset` in squares.

**Priority** when rules collide: lock > pin > forbid > modify > rule default. If a directive can't be satisfied (a pin blocks the only door), the engine returns a conflict to Claude, and Claude asks the DM instead of guessing.

**Provenance.** Every directive records its `source` (`dm-chat`, `dm-dungeondraft`, `dm-foundry`, `llm`). The DM's own directives outrank Claude's suggestions on conflict.

## 7. Rule packs

A rule pack describes how one room type gets furnished. It refers to semantic asset types (`table.dining.long`, `chair.wood`), never to filenames, so the same rules work across packs and future libraries.

A rule pack contains:

- **Required and optional features**, such as a bar, a hearth or stairs, each with placement rules (against a wall, near the hearth, clear of doors).
- **Group templates** with slots: `table_set = 1 table + 2..6 chairs (around) + 0..3 tankards (on top)`. Overrides target the slots.
- **Floor and wall style choices**, as weighted lists of 2MT patterns, terrain and wall textures.
- **Clutter and wear**: density per zone, scattered at a minimum spacing with random rotation and variants. The wear level adds grime, cobwebs and debris from Grime and Shine Assets.
- **Variety level** per zone (`low`, `medium`, `high`): a chapel stays uniform, a junk shop mixes many looks on purpose. This controls how far the palette may stretch (section 9).
- **Lighting**: light sources and their colors, which export to Foundry lights.

**First rule packs**

| Genre | Room types |
|---|---|
| Medieval | Tavern: common room, kitchen, cellar, guest rooms. Then shop, smithy, house, castle hall. |
| Gothic horror | Chapel and cathedral nave, crypt, graveyard, manor rooms (ballroom, study, bedroom), asylum ward. |

Appendix A lists which 2MT packs supply each.

## 8. Asset index

**Index entry fields:**

- **Identity:** `id` (pack ID + texture path), pack name, style family (`2MT` or the newer `2M` packs).
- **Classification:** semantic types, plus normalized tags.
- **Size:** footprint in squares, from the trimmed image size at 256 px per square. Some images include transparent padding: the Castle Walls "Door (2x1)" is a 512×256 canvas with the door drawn in a small part of it.
- **Variants:** a colorable flag and a variant group (normal and colorable copies of the same item).
- **Orientation:** which side the front faces, needed for chairs facing tables and beds against walls.
- **Flags:** `prefab` (a whole pre-built map) and `scale_override`.
- **Look:** look features and a lookalike group (section 9).

**Build steps:**

1. Read every pack's file index directly, without unpacking. This is a TypeScript port of `tools/assets/ddpack.py`.
2. Keep one copy of each pack ID. 12 pack IDs appear in two volume folders, such as Haunted Graveyard in both Volume 8 folders.
3. Parse filenames. 2MT names are descriptive: `Bed, large, royal, double`, `Door (2x1)`.
4. Merge the two tag vocabularies. Older packs use `[2MT] Seat`, `[2MT] Table`, `[2MT] Storage`. Newer `2M` packs use `Chair`, `Skeleton`, `Debris`.
5. Run a vision pass with Claude to fill in the type, orientation and footprint wherever the filename and tags leave them unclear. Tag the categories the current rule packs need first, not all 34,675 unique objects.
6. Cache the index as JSON next to the companion's data.

**Scale.** 2MT draws at 256 px per grid square, and Dungeondraft positions use the same unit. Most furniture sits at believable sizes across packs. Beds from five packs measure 1 to 1.8 squares wide. A few outliers need overrides: the Mansion Furniture armchair is 100×88 px, less than half a square, next to a 348 px bed.

**Pre-built maps.** 56 packs contain only large pre-built images (whole tavern floors, Haunted Mansion, Dungeon Catacomb). They're indexed as `prefab` for a later "drop in a ready-made building" feature. They can't take overrides, and their Foundry walls would have to be traced from the image.

## 9. Versions, variety and cohesion

Many assets fit the same request, and many look alike: the library has 553 chairs and 867 tables by filename count (Appendix A). The generator uses that overlap two ways. Inside one map, it uses lookalike assets for variety without breaking the look. Across versions, it uses different looks so the DM can pick the vibe.

**Look features.** The indexer computes these from the images, with no Claude calls:

- **Perceptual hash**, to find near-identical images such as copies across packs, recolors and colorable twins.
- **Color profile**: dominant colors, brightness, saturation and wood tone.
- **Condition**, from filenames and tags. Names already say "Broken", "Dark", "messy" and "Bloody", as in `Table - Broken 1 - Dark` and `Adventurer 1 - Bloody`.
- **Family**: the pack and series an asset came from. Assets drawn for the same pack match each other best.

**Lookalike groups.** The indexer clusters assets of the same type whose look features are close, such as six dark wooden chairs drawn alike. Members of a group are interchangeable.

**Asset palette.** A palette assigns one lookalike group, or a short list of compatible ones, to each asset type a map needs. It also picks the floor and wall textures and a tint color for colorable assets. Choosing assets through a palette keeps a map cohesive:

- Every chair in a room comes from one group. The generator alternates members so identical copies don't sit side by side.
- Floors, walls and furniture are matched on color profile and family.
- Colorable assets are tinted to the palette's accent color through Dungeondraft's `custom_color`. The library has 6,006 colorable objects (43,417 objects minus 37,411 non-colorable).
- Each zone's variety level sets how far a palette may stretch (section 7).

The generator scores every palette for internal consistency (color distance and family match) and drops palettes whose parts clash before rendering anything.

**Versions.** By default, one plan and one layout get 3 palettes, chosen to differ from each other as much as possible while each stays cohesive. Keeping the layout fixed makes the comparison about look alone. "Shuffle layout" re-rolls the seed separately. Code picks the palettes. Claude only names each version ("dark and grimy", "warm and lived-in", "faded grandeur") and, when the DM describes a vibe, proposes palettes to match. Versions render in parallel at low resolution for picking (section 11), and critique runs only on the version the DM picks.

**Mixing and picking pieces.**
- **Mixing versions:** "floors from version 2, furniture from version 1" becomes `restyle` directives.
- **Alternatives for one piece:** "show me other bars" makes the panel show a strip of candidates from compatible groups. The DM's pick becomes a `pin` of that exact asset.

**Different takes.** "Give me three different takes" writes 3 separate plans in parallel Claude sessions, giving different layouts and ideas, not only different looks. It uses three times the subscription usage or API cost, so it's opt-in. Every tool call carries a `map_id` so parallel sessions don't collide (section 13).

## 10. Dungeondraft format and round trip

**Format facts.** These come from Dungeondraft-MCP's research notes, a community source, and still need checking against your Dungeondraft 1.2.0.1 by saving a test map:

- The file is plain UTF-8 JSON with `header`, `world` and `levels`. Godot types are strings in `var2str` form, such as `"Vector2( 7040, 5120 )"`.
- Every element (walls, portals, patterns, paths, objects, lights) has a hex `node_id`, allocated from `world.next_node_id`.
- Positions are in pixels at 256 px per square, origin top-left. Rotations are in radians, and light `range` is in squares.
- Custom pack textures are `res://packs/<PACK_ID>/textures/...`, and each pack must be listed in `header.asset_manifest`.
- Dungeondraft 1.2.0.1 writes `format: 3`.
- Readers must preserve key order. Standard JSON parsers reorder integer-like keys such as level `"0"` and layer `"100"`.

**Writer.** It emits format 3, lists every 2MT pack used in `asset_manifest`, and allocates node IDs itself. It records an element map from `node_id` to plan element (zone, group, directive) in `plan.json`.

**Round trip:**

1. The DM clicks "Open in Dungeondraft". The companion opens the file in Dungeondraft. Whether Dungeondraft accepts a file path on launch is an open question.
2. The DM edits and saves. The companion's file watcher sees the save.
3. The bridge parses the saved file and compares it with the last generated version by `node_id`:

| Change in Dungeondraft | Becomes |
|---|---|
| Object added | `free` directive at its position, source `dm-dungeondraft` |
| Generated object deleted | `forbid` on that element |
| Object moved, rotated, scaled or recolored | `pin` at the new transform |
| Walls, floors or terrain changed | `lock` on the bounding box of the changed elements |
| Anything the bridge can't map (new level, water, roofs, text) | Map flagged as hand-edited. Regeneration then only touches zones the DM names. |

4. The companion re-renders the map and updates the Foundry scene.

**Exact-render option.** The DM exports a Universal VTT file (`.dd2vtt`) from Dungeondraft into a folder the companion watches. The companion swaps the Foundry background for Dungeondraft's own render and takes walls, doors and lights from the export. This is the fallback whenever an edit uses features our renderer doesn't draw.

## 11. Renderer

The renderer draws layers in the same order Dungeondraft does:

1. Terrain: up to 8 textures blended by the `splat` map (4×4 samples per square).
2. Floor patterns: polygons filled with pattern textures.
3. Paths along their edit points.
4. Walls: texture along each polyline, plus a wall shadow.
5. Portals (doors and windows).
6. Objects by layer, with rotation, scale, mirroring, custom color and drop shadow.

Lighting is not baked into the image. Dungeondraft lights become Foundry lights, so Foundry's own lighting and vision work.

v1 draws terrain, patterns, paths, walls, portals and objects. Water, caves, the material brush, roofs and text fall back to the `.dd2vtt` exact-render path.

Renders run in worker threads, so the 3 versions render at the same time. Previews for picking render at low resolution, about 64 px per square. The full-resolution render happens only for the picked version, and decoded textures are cached between renders.

Output is WebP at a resolution the DM chooses: 128, 200 or 256 px per square. A 30×22 map at 256 px per square comes to 7,680 × 5,632 px, so the default should be lower. The library is a Node 2D canvas with transforms and clipping (candidates: `@napi-rs/canvas`, `skia-canvas`), to pick in milestone 4.

## 12. Foundry integration

**Module settings:**
- Companion address (default `localhost`)
- LLM backend (`claude -p` or API)
- Render resolution
- Maximum critique passes

**Panel:** the chat with Claude, plus buttons to generate, re-roll the unlocked parts, shuffle the layout, open in Dungeondraft, and toggle labels. It also has a version picker with the 3 previews side by side, and an alternatives strip for swapping a single piece.

**Scene build:**
- **Background:** the uploaded render. The grid size matches the render's pixels per square.
- **Walls:** each Dungeondraft wall polyline becomes Foundry wall segments.
- **Doors and windows:** portals become door walls, and windows become walls that block movement but not sight.
- **Lights:** Dungeondraft lights become Foundry lights with the same range, color and intensity.

**Pointing at things.** The DM selects pieces in Foundry, and the module sends their element IDs with the next chat message. A label overlay numbers furniture groups so the DM can say "table 3".

## 13. LLM layer

**One interface, two backends.** Both get the same tools from one definition list:

- `get_plan`, `submit_plan`, `apply_directive`, `remove_directive`
- `generate`
- `render_preview`, which returns a labeled image
- `search_assets`, which searches the asset index by meaning
- `get_conflicts`

The companion exposes them as an MCP server for `claude -p` and as tool definitions for the API. Every tool takes a `map_id`, so several sessions can work on different maps at once, as with "three different takes" (section 9).

**Backend A: `claude -p` (subscription).** These flags are verified against the Claude Code CLI reference:

- `-p` with `--input-format stream-json --output-format stream-json`, so one process stays alive for a whole session.
- `--system-prompt-file` for our instructions.
- `--strict-mcp-config --mcp-config`, so Claude sees only our tools.
- `--resume` or `--session-id` to return to a map later.
- `--max-turns` as a safety limit, `--model` to pick the model, and `--json-schema` for one-shot structured output.

Anthropic's help center (updated 2026-10-07) says `claude -p` usage draws from the subscription's limits when you sign in with your plan. Users report that a set `ANTHROPIC_API_KEY` switches `claude -p` to API billing. The companion removes that variable from the environment when it starts `claude -p` in subscription mode.

**Backend B: Anthropic API.**
- Model `claude-opus-5-5` by default, with adaptive thinking.
- `effort` set explicitly, because Opus 5.5 defaults to `medium`.
- Streaming, structured outputs for plans, and server-side refusal fallbacks.
- Prompt caching for the system prompt, tool definitions and the asset vocabulary.

My rough estimate is $0.25 to $1 per map at list prices ($4 per million input tokens, $20 per million output tokens). That assumes about 60k input and 10k output tokens per map, and long edit sessions cost more. It hasn't been measured.

**Prompting rules:**
- Claude edits the plan only through tools.
- Claude never invents coordinates or filenames. It asks `search_assets` for types.
- Claude asks the DM when a conflict involves the DM's own directives.

## 14. Licensing and distribution

- 2MT assets are CC BY-NC 4.0. 2MT's FAQ says they are "only intended for private use" and that it is "not making any exceptions to the license."
- The module and companion ship no 2MT files. They read the DM's purchased library from disk, and only rendered map images go to the DM's own Foundry.
- Generated scenes carry a credit line, "Map assets: 2-Minute Tabletop", in the scene notes.
- Keep the project free and personal. Ask 2MT before any paid release.
- `data/` (generated inventories) lists 2MT asset filenames and stays out of any public repository.
- Dungeondraft built-in assets are unused in v1. Their license for use outside Dungeondraft is unchecked.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Dungeondraft's map format is undocumented and may change | Support Dungeondraft 1.2.0.1 only. Keep golden-file tests: maps saved by Dungeondraft, read, rewritten, reopened in Dungeondraft. Check `world.format` on load. |
| Our renderer looks different from Dungeondraft's | Match Dungeondraft's draw order and shadows. Offer the `.dd2vtt` exact-render path. |
| Claude places things badly | The engine owns all geometry. The schema validates every plan change, and the critique loop catches empty or nonsensical rooms. |
| Asset metadata gaps (orientation, padded footprints, odd scales) | Vision tagging, trimmed bounding boxes and per-object overrides. |
| Duplicate pack IDs in `D:\DND Assets` confuse Dungeondraft | The indexer dedupes. Check whether Dungeondraft warns, and if so move the repeat folders out of the asset directory. |
| `claude -p` billing or terms change | Keep the API backend working at all times. Recheck Anthropic's help center at each release. |
| Large maps make huge images | Configurable resolution, and a warning above a size limit. |
| Palettes score as consistent but still look mismatched | The critique loop checks cohesion too. The DM can `restyle` any type, and palette scoring weights get tuned against picks the DM makes. |
| The 3 versions look too much alike | Pick palettes for maximum difference between versions, and fall back to fewer versions when the library can't offer distinct looks for a room type. |

## 16. Milestones

| # | Milestone | Done means |
|---|---|---|
| M0 | Asset audit | Done: `tools/assets/`, Appendix A. |
| M1 | Asset indexer (TS) | The index JSON covers every pack, keeps one copy of each, and has types, footprints and variants for tavern-relevant categories. Vision tags cover tables, chairs, beds, bars, hearths, stairs, barrels and doors. Look features and lookalike groups exist for those categories, with a report of group sizes. |
| M2 | Generator v0: tavern | A plan with directives produces a `.dungeondraft_map` that Dungeondraft 1.2.0.1 opens with every asset resolved. Overrides (`pin`, `modify`, `forbid`, `free`, `restyle`) visibly work. One plan yields 3 palette versions that look clearly different and each look cohesive. |
| M3 | Round trip | Hand edits saved in Dungeondraft become directives, and regenerating keeps them. |
| M4 | Renderer and Foundry module | A generated tavern appears as a Foundry scene with a background, working doors, walls and lights. The 3 version previews render in parallel, and the DM picks one in the panel. |
| M5 | LLM layer | The interview, plan patching and background critique loop run on both backends. "Three different takes" runs 3 sessions in parallel without collisions. |
| M6 | Gothic horror rule packs | Chapel, crypt, graveyard and manor rooms generate and pass the critique loop. |
| M7 | Extras | Pre-built building quick-pick, `.dd2vtt` exact render, label overlay polish. |

## 17. Open questions

1. Does Dungeondraft 1.2.0.1 open a map passed as a launch argument, or register `.dungeondraft_map` with Windows? This decides how "Open in Dungeondraft" works.
2. Which Foundry version do you run, and is it on this PC or hosted elsewhere?
3. Default render resolution: 128, 200 or 256 px per square?
4. Vision-tagging budget: tag only the needed categories per milestone (planned), or the whole library up front?
5. Does Dungeondraft warn about the 12 duplicate pack IDs in `D:\DND Assets`?
6. Is 3 the right default number of versions, and should versions stay on one layout (planned) or vary the layout too?

## 18. Generation v2: the quality rebuild

The v0 generator dropped single objects by rule into BSP rectangles, and the maps looked empty and random. 2MT's own furnished maps (Twilight Tavern, Haunted Mansion) are Dungeondraft maps built from the same modular pieces, so the gap was composition knowledge. v2 encodes it.

**Vision-tagged assets.** Claude agents tagged 9,626 objects from 73 medieval and gothic packs, and 2,459 floors, walls, terrain, paths, doors and windows, from numbered contact sheets (`tools/vision/ROLES.md`, `MATERIALS.md`). Each object has a role (about 150, such as `chair`, `table_set`, `bar_counter`, `sconce` or `cobweb`), a facing (which way its front points in the image), a placement (free, wall, corner, surface, wallmount, overhead, rug, decal, outdoor), a composite flag (an artist-made group such as a table with chairs and a candle), tone, style, condition, fit (0 to 3) and a lit flag. Colorable twins and near-duplicates inherit their base's tag. `tools/vision/merge.mjs` writes `data/asset-tags.json`; the companion merges it at load.

**Architect** (`layout.ts`, `rooms.ts`). Each room type has a target area, a minimum side and an aspect range taken from 2MT's maps (a common room of 64 to 120 squares, a kitchen of 20 to 36). Small rooms may become annexes, which gives L, T and U shaped buildings. 400 candidate plans are scored on area error, aspect, adjacency of connected rooms and outside access, and the best one wins. Walls, doors and windows come from a cell grid: doors sit away from corners and junctions, naves get their door on a short side, and windows space out along outside walls.

**Styles** (`style.ts`). Each version anchors on one furniture pack, ranked by how well it covers the plan's core roles and by theme ("Tavern" packs for taverns, "Cathedral" packs for chapels). Packs with a clashing art style (cartoon, crayon, ink sketch) never anchor, and one anchor per product line keeps versions distinct. For every role a style uses one pack's pieces, preferring the anchor, the genre's wood tone, calm colors and big variants for big roles. 2MT's red default pieces are swapped for their Colorable twins and given a muted fabric color, which Dungeondraft paints over the red.

**Recipes and the dressing engine** (`recipes.ts`, `dress.ts`). A recipe is an ordered list of steps per room type:

| Step | Does |
|---|---|
| bar | Straight bars sit off a wall with a walkway, back shelves and stools. L-bars go into a corner. |
| anchor | A key piece against a chosen wall (far from the door, outside, inside), with rug, seats facing it, flanking pieces and things on top. |
| groups | Tables with seating, packed snugly against walls and each other: artist-made table sets with seats, or tables with jittered chairs, benches, pairs, lounges. Rugs under some groups, items on tables. |
| line | Wall lining: counters, shelves, barrels in clusters, a second row in storerooms, then small pieces filling the gaps. Tall pieces avoid windows. |
| rows | Pews or tombs in rows facing the far wall with a center aisle and runner. |
| corners, center, colonnade, sconces, overhead | Corner clusters, a center piece, pillar rings, wall lights, chandeliers. |
| decals, scatter | Grime and dirt along edges and doors, cobwebs in corners, spills, rubble by wear. |

Pieces are oriented from their tagged facing and placed by the center of their visible art on a quarter-square occupancy grid. Door fronts stay clear, and each room's wall band comes from the wall texture's painted width. The pieces that define a room (bed, bar, oven, altar) go in before the DM's pins. Pins, frees, forbids, modifies, restyles and locks work as before.

**Exterior** (`exterior.ts`). A gently curving road runs from the main door to the map edge, with trails from back doors and props by the doors. Bushes hug the walls, and vegetation clusters frame the map edges. Graveyards get fenced rows of headstones with mounds, a gate where the road crosses, and greenery along the fence.

**Renderer.** Lighting is a light map: the ambient color, lifted on floors, plus additive pools clipped by visibility polygons so walls cast shadows. Colorable pieces have their red swapped for the custom color, as in Dungeondraft.

**Evaluation loop.** A critic agent compares renders of every example plan against the 2MT references and ranks problems. Each round's fixes go back through the critic. Fill per room (furniture footprint over area) is measured as a sanity number: 2MT's kitchens and storerooms run about 45 to 55%.

## 19. Corridors, gates and set pieces (live Foundry test, 2026-11-06)

The first live test asked for "the entrance to Dracula's castle": a large gate into a corridor with a long, frayed red carpet and old, impressive art on stone walls; at the far end a sealed gothic gate that can be opened; before it, left and right, two metal gates blown apart, one sci-fi and one medieval. None of that existed, so v2 grew these parts.

**Plan fields.** A connection may carry `id`, `via: "gate"` (a wide double door with a frame), `width` in squares (1 to 6), `state` (`closed`, `locked`, `open`, which become Foundry door states), `broken: "medieval" | "scifi"` (the gate was blown apart: an open gap with its wreckage), and for rooms off a corridor `wall: "left" | "right" | "end"` with `along` from 0 (entrance) to 1 (far end). A modify directive may carry `color` (a name such as "crimson" or a hex value) and `condition` ("frayed", "worn", "torn"). Connections written from outside or an outdoor zone toward a room are read the other way round.

**Corridor architect.** `gothic.gallery` is a spine room. When a plan has one, `layout.ts` builds the corridor first, walking from an entrance on one short side: side rooms attach to the left or right wall at their `along` position, one room sits past the far end, and the whole thing is turned to fit the map. A framed gate in the far wall needs the corridor about 1.75 times wider than the opening, and side doors keep clear of the frame. Doors wider than one square take a straight run of wall clear of corners. `gothic.vault` is the small side chamber.

**Gates** (`features.ts`). The entrance gate gets round towers astride the wall and braziers outside. An interior gate in a gothic map gets frame art from a curated open/closed pair (Living Depths' iron gate): the open drawing goes into the map, standing on the wall line and rising into the approach room; the leaves come from the closed drawing, at the box where the two differ (measured once). In Foundry each gate is a door wall with `animation: {type: "swing", double: true}` whose texture is one leaf (the left half of that box, padded so its edge sits on the wall), uploaded by the module. Foundry draws the leaves shut and swings them open; the background render leaves them out. Gates without frame art use the half of their portal texture. `state: "locked"` gives `ds: 2`, which only the GM can change. Previews and Dungeondraft show the closed leaves.

**Wrecked gates.** A broken gate leaves a gap in the wall (outer walls split into runs, inner walls into pieces). Its wreckage lies thrown into the room you approach from, kept off the gate frame: medieval wrecks are bent iron gate leaves, stone rubble and soot; sci-fi wrecks are warped plates, a door slab and cables, from sci-fi packs the genre otherwise excludes (`Catalog.offGenre`), with a cold flickering light on the cables.

**Gallery and carpet.** The `gallery` step hangs face-on paintings (Artist Atelier) in mirrored pairs along both long walls, scaled up to about two squares, with matching statues or armor between them and lit wall lights in the rhythm; openings in either wall clear the slot on both. The `runner` step lays one carpet down the long axis, centered on the gates: long plain runners tinted to the requested color, stretched along the hall to fill each stretch; a frayed carpet gets a torn stretch, a ragged end, grime and loose scraps.

**Edits stay local.** Each room now draws from its own random stream, so removing a pin or forbidding a step in one room leaves the other rooms exactly as they were. A locked region keeps exactly what it had: new pieces that land in it are dropped, so repeated locks no longer stack copies. The `unlock` tool removes locks.

**Foundry 14.** The module works on Foundry 14.370: v14 keeps a scene's background on its Level documents, so the module sets it on the initial level. Windows let sight through but block light (open panes threw searchlight beams across the ground). The panel renders Claude's markdown safely and reopens on the last map after a reload. The companion's `claude -p` runs with only ToolSearch and the map tools, setting sources limited to `local`, in a neutral folder, so the DM's own Claude Code setup (CLAUDE.md, skills) stays out of the map builder.

**Round 2: only what was asked, and the mood** (user feedback: "the vibe is wrong, and so is the lighting. You added rooms beyond the gates, which i did not ask, also I wanted stone and got marble for the floors"). The first run added a graveyard forecourt, two guardrooms and a grand hall because Claude offered them as defaults and I accepted them on the DM's behalf. Now:

- A connection may lead `"beyond"`: a door into an unseen part of the building with nothing drawn behind it. A building with such doors and no outdoor zones is `enclosed`: the map crops to the walls with one square of near-black rock around them, and only a five-square approach in front of the entrance is open ground. Outdoor pieces stay on the approach. On an enclosed corridor the gates into the beyond go where the plan says (left, right, end).
- Claude's instructions: build what the DM described and nothing more; never offer extra rooms as defaults; undescribed far sides lead "beyond"; lighting follows the described mood.
- `mood.lighting` is used at last: "dim" keeps 70% of the ambient light and 72% of lamp reach, "dark" 50% and 58%. Foundry lights get a bright core of a third of their reach, lower alpha and more attenuation: pools of candlelight instead of floodlit rooms.
- Gothic stone floors are rough flagstones and paving blocks (tags say "crazy-paving", "irregular", "paving blocks"); veined or square slabs, which read as marble, are out, and dark moods prefer the dark ones. Gothic walls are thick and dark, never from clashing art packs. Dark gothic grounds are dirt, stone and mud, with dead plants and no flowers; roads and rubble are dark.
- The enclosed entrance gate gets dark guardian statues (gargoyles, demons) and braziers instead of the round towers.

## 20. Cities: world map -> city scene -> places (2026-11-07)

Azgaar's Fantasy Map Generator links every city to watabou's Medieval Fantasy City Generator (MFCG) with that city's parameters (the azgaar-foundry import puts the link in each city's journal). MFCG exports a city as GeoJSON with `export=json`: buildings (polygons), roads with widths, walls (rings), rivers, piers ("planks"), squares, monuments ("prisms"), named districts, fields, water and trees, in about metres. The companion opens the link in headless Edge (playwright-core, no browser download) and caches the file in `data/cities`.

- **City model and hot spots** (`city/city.ts`): parse (y flipped to screen space), the city wall (the ring holding most buildings), gates (main roads crossing it, the longest road's first), and places: the market (the biggest square), the keep (the biggest building in a district named Castle or Citadel), the temple (a big building near the market), a tavern (a good-sized building on a main road nearest the main gate), the main gate, the docks (the biggest group of piers).
- **One town set** (round 2, after the user called round 1 ugly): every city uses the same assets. Roofs: 2M Modular Rooftops red slate, blue slate for the castle district and buildings over 380 m². Ground: 2M City Street Pack brown cobbles in town, brown flagstones on squares and main streets (the pack is filed as modern; the textures suit any old town). Grass: Fort Foul Luck's quiet grass. Towers: Castle Walls round tower roofs. Trees: Roadside Forest tokens.
- **2MT houses everywhere** (round 3, the user's call: "2MT everywhere"; `city/houses.ts`). Every building outline from the city generator is a plot, and every plot gets whole 2MT roof drawings, used as drawn (turned and scaled, never stretched). 87 drawings: Prefab Rooftops, Town Center rooftops, Medieval City Center corner buildings and the 2MT Buildings Pack (red and blue) for houses; landmark art for the places of interest. Ordinary plots are filled along their street side with rows of houses (scale 0.8-1.2), deep plots (17 m+) get a back row, the rest of the plot is a grass yard (Grass & Road Assets 2 "Sodden") with a few bushes and barrels on battle maps. Plots no row fits get one more pass (0.65-1.35) and then the single drawing with the best overlap-over-union with the outline. Stonesoul: 1,367 plots, 2,978 drawings, 64 designs, no plot without art. Placement runs in under half a second and is the same every time for a city.
- **Places of interest** get art chosen for what they are: the temple the Medieval City Center library roof (a church with an octagonal apse) when over 350 m², otherwise the Wedding Chapel roof with its spire over one gable; the keep the Castle Keep roof (14x14); other big castle buildings the Square Keep or Great Tower roofs; the tavern by the gate the Typical Tavern thatch; the biggest building on the market square a guildhall (Town Center "Rooftop 5" or the Prefab manor roof); buildings within 25 m of a pier's landward end warehouse roofs (Shipyard warehouse, Simple Stable). Each is fitted to its whole plot by overlap over union.
- **Places by size and location** (`city/places.ts`, round 4: "add buildings of interest dynamically ... rules depending on city size or location"). Size from the building count: town under 250, city under 700, large 700+. Location: coast, river, walls, farms, castle district. Rules (the table at the top of places.ts is the reference):
  - always: temple (church over 350 m², else chapel with spire), tavern by the main gate; a castle district gets the keep and castle roofs;
  - city and large: a guildhall (the biggest building fronting the market), inns inside the wall by the other gates (one for a city, every gate for a large city, 2-Minute Tavern roofs), the market monument becomes a fountain (Statue Map Assets "Fountain - Large", the Neptune fountain for a large city's market over 900 m²);
  - large: parish chapels in big districts without the temple (Wedding Chapel whitewashed with steeple, the Haunted Graveyard chapel), a wizard's tower (Wizards Tower roof) on the squarest mid-sized plot 80-350 m from the market, a gatehouse (Castle Gatehouse roof) over the main gate on the city scene;
  - walls: stables (Simple Stable roof) just outside the gates; houses outside the wall take country art three times in four (Bumblebee Farm red and blue cottages, Sinister Cabin thatch, Creepy Cabin cottage);
  - coast: warehouses by the piers' landward ends (2 / 6 / 14 by size); a lighthouse (2M Lighthouse roof) on the land reaching farthest out to sea within 450 m of the harbour;
  - farms: windmills (Harvest Horror) in the fields by a road, 150 m apart (1 / 2 / 3).
- **Ships** (houses.ts `placeFeatures`): piers are planks with an end in the sea; the landward end is the one shallower in the water (MFCG piers often start just inside the water outline). Each pier may take a ship on each side, by size: large ports alternate a 2MT Galleon hull (22x7, sails furled) and medium ships (2M Sailing Ship example, the Rocky Fissures longboat, the Viking longship), cities take medium and small, towns only rowboats and skiffs. A ship lies alongside its pier, all on water, clear of piers and other ships (separating-axis test). Large ports get two galleons under sail at anchor out in the bay, a city one. River cities get barges (Jungle Wetland river barge) moored along the banks inside the walls, 70 m apart and 30 m from bridges (1 / 2 / 4). Ships and barges appear on the city scene and on any battle map whose area they reach; they have no walls, so tokens can board.
- **Pins for the new places**: the wizard's tower, the lighthouse (a street map of its shore) and the inns get pins that build the first time the DM double-clicks them (grey until then); the six original places still build when the city opens. Parish chapels, stables, warehouses, mills and fountains are scenery without pins.
- **Ground** (round 5: "the ground needs to look better"). Street maps paint one 2MT terrain set for every town, blended through the terrain splat: Fort Foul Luck grass, Grass & Road Assets 2 round cobbles (Sodden) and dirt, Fort Foul Luck mud. Inside the walls the streets are cobbled, worn to mud in noise patches and along the house fronts, and fade over 1.6 m into grass yards (no hard yard rectangles). Outside, roads are trodden dirt with ragged verges, grass wears to dirt round the houses and in patches, mud within 3.5 m of water. Squares and the wharf take square cobbles from the same family. Fields are Farmer's Field wheat or fallow patterns turned to the field's long side, edged with a Hedge Maze hedge or a Farmer's Field dry-stone wall. Ground cover comes from one meadow set (Green Hill grass clumps and wall-foot strips, Meadow Picnic and Farm Friends flowers, Roadside Forest clovers, leaf litter, rocks, trees and stumps, Farmer's Field bushes and loose stones): clusters in yards, a strip of grass at the foot of house walls, clusters on the road verges, wild clusters on open ground. Yards get kitchen-garden rows, woodpiles, hay, and Farm Friends animals (country) or a hen or dog (town). Without the ground set (other libraries) the old cobble pattern and road paths stand in.
- **City-scene ground**: the grass, a Green Hill meadow and a withered-grass layer are blended through smooth noise into a raster under the SVG (an SVG mask cost 30 s); fields take the same crop textures rotated to each field with a hedge drawn round them; copses of Farmer's Field and Roadside Forest trees grow where the noise peaks on clear open ground, with a tree now and then along the hedges. Shrunk art for the city scene is cached in `data/cache/city-art` (decoding full-size 2MT art was most of the render): Stonesoul renders in about 30 s warm.
- **Way back up** (module `renderWayUp`): on a place's battle map the GM gets buttons to its city and to the world map; on a city scene, to the world map. A city remembers the scene it was opened from (flag `worldScene`). Click views the scene; Shift-click activates it for everyone. GM only.
- **Real-map fixes** (Ogeia test): a small second wall ring holding at most 8 buildings and no named castle district becomes a "Citadel" district (parseCity), so its keep is found; open towns (no wall) take country ground on street maps; the tavern is "Tavern" when there is no gate; large cities get at most 3 inns, at the busiest gates. `cli/city-fetch.ts` caches any city link for offline previews.
- **Traced outlines** (`cli/house-outlines.ts`, `data/house-outlines.json`, applied by `loadIndex`): every house and landmark drawing's opaque shape, traced on a 160-cell grid and simplified to 5-12 corners. Walls in Foundry, the door and the city-scene shadows follow the drawing's own L, T or cross shape, not its box. The script also trims the large images the indexer left untrimmed (library, keep, manor). Rerun it when the asset library changes.
- **Fallback**: with no house art in the library (or `houses: "roofs"`), street maps and the city scene draw procedural hip roofs as before.
- **Hip roofs** (`city/roof.ts`): every building outline gets a straight-skeleton hip roof: one face per wall, rising to hips and a ridge, as Dungeondraft's roof tool draws them. Convex outlines are solved exactly (edge-collapse wavefront); concave ones (about 10% in MFCG) are cut into convex pieces (ear clipping, then merging while convex) and read as wings. Faces carry their eave and down-slope direction; a north-west sun lights them from 0.56 to 1.
- **City scene** (companion `city/render.ts`): an SVG drawing of the whole layout, 50 px per square at 25 ft (50 ft for cities over 1.1 km). Roof faces are grouped by colour and 5-degree tile angle (one rotated pattern per group), shade overlays by brightness, cream hips and ridges over a dark under-stroke, dark eaves, offset shadows. Town ground cobbled inside the wall with flagstone streets (clipped to the wall), dirt roads outside, dirt yards round the houses outside the walls, a muddy shore band under the water, tower-roof art on the wall corners, tree art. About 20-25 seconds for a 1,400-building city.
- **Places** (`city/plans.ts`): market, gate and docks are street-level maps of their area (55 to 90 m); tavern, temple and keep are interiors from the ordinary room generator, sized to the building's footprint (tavern rooms; nave and vestry; hall, dining, study, bedroom, and a ballroom in a big keep).
- **Street maps** (`city/street.ts`, plans with `street: {city, area}` and a `street.area` zone): ground and cobbles; buildings with hip roofs as Dungeondraft patterns, one per face (roof tiles turned so the shingle rows run along the eave, colour set to the face's sun shade, layer 400), hips and ridges as paths with the roof set's own hip and ridge strips, chimneys on about half the bigger houses, walls with a door on the longest street-facing side; the city wall cut into runs at the gates with round towers (two flanking each gate); water and rivers as patterns with stone quays along the sea shore and both river banks; a flagstone wharf along the sea; piers as deck boards laid across the walk with a dark timber edge; rowboats moored by the piers, rope coils, cargo piles on the wharf; market stalls (Market Festival, Medieval City Center, Medieval City Streets clusters) in rows along the square's long side; clutter piles along house fronts, carts, lamps along main roads, trees, grime. Lights only after dark. Quay and pier edges are left out of the Foundry walls (looks only). Version name "Streets".
- **Renderer changes for this**: patterns and paths draw together in layer order (as Dungeondraft stacks them); patterns honour `rotation`; pattern tiles line up with the world, so neighbouring patches show no seams; wall strips longer than the canvas are cropped. Polylines are clipped segment by segment (Liang-Barsky): before, a coastline or road segment with both ends off the map vanished.
- **Not yet checked in Dungeondraft**: roof faces are rotated, colour-shaded patterns and ridges are paths with textures from a roof folder; Dungeondraft's native roofs (a ridge line, a width and a type) are not used because their save format is undocumented.
- **Foundry** (module): a GM click on a city-generator link asks to open the city; the companion returns the city image and places; the module creates the scene (in a folder named after the city), a journal with one page per place (so players see the pins), the pins, and activates it. It then builds each place in turn (interiors first) and lights its pin when ready; double-click opens it, with Shift for everyone. A rectangle drawn on a city scene becomes a street map of that area.

## Appendix A: Asset audit results (2026-11-06)

Source: `data/inventory_all.json`, produced by `tools/assets/inventory.py` over every 2MT Dungeondraft folder in `D:\DND Assets`.

| Measure | Count |
|---|---|
| Pack files | 416 |
| Unique pack IDs | 404 (12 IDs appear in two folders) |
| Objects | 43,417 |
| Non-colorable objects | 37,411 |
| Unique by name and size | 34,675 |
| Packs with separate pieces | 356 |
| Packs with only pre-built images | 56 |
| Walls | 684 |
| Floor patterns | 567 |
| Terrain textures | 608 |
| Materials | 520 |
| Paths | 945 |
| Portals (doors and windows) | 180 |
| Tilesets | 28 in 12 packs (2MT floors come mostly as patterns and terrain) |

**Coverage by object filename** (whole-word matches, colorable copies excluded):

| Medieval | Count | Gothic | Count |
|---|---|---|---|
| Tables | 867 | Graves and headstones | 92 |
| Chairs | 553 | Sarcophagi | 59 |
| Stairs | 473 | Coffins | 48 |
| Rugs and carpets | 412 | Altars | 43 |
| Beds | 315 | Crypt pieces | 42 |
| Counters | 33 | Candelabras | 23 |
| Stools | 104 | Pews | 14 |
| Benches | 83 | Lecterns and pulpits | 7 |
| Thrones | 56 | Skeletons, skulls and bones | 729 |
| Bookcases | 54 | Debris and rubble | 687 |
| Chandeliers | 50 | Candles | 164 |
| Fireplaces | 43 | Cobwebs | 114 |
| Tankards and mugs | 34 | Chains | 60 |
| Kegs | 6 | Cages | 26 |

"Bar" matches 149 filenames, but most come from prison and jail packs (Dungeon Wall and Floor Assets Plus 32, Island Prison Plus 16, Isometric Jail Plus 14), so the table lists counters instead. Tavern bar counters need confirming in the vision pass.

**Key packs for v1**

| Use | Packs |
|---|---|
| Walls and floors | Dungeon Wall and Floor Assets Plus (128 walls, 48 patterns), Medieval Building Map Assets (32 walls, 4 patterns, 7 portals), Dungeon Map Tiles Plus (16 walls), Castle Walls, Dungeon Room Builder |
| Tavern | Twilight Tavern Plus, 2-Minute Tavern Plus, Typical Tavern, Dwarven Tavern Plus |
| General furniture | Furniture Map Assets and Plus, Castle Furniture, Mansion Furniture, Broken Furniture Assets and Plus |
| Gothic | Haunted Graveyard, Moonlit Cathedral Plus, Cathedral Ruins Plus, Church of Bones Plus, Crystal Crypts Plus, Infested Crypt, Mental Asylum Plus, Victorian Ballroom Plus, Sinister Cabin Pack, Sinister Woodland Plus, Cultist Lair Pack, Castle Ruin Plus |
| Wear and gore | Grime and Shine Assets (885), Blood and Bodies Map Assets and Plus, Battle Damage Assets, Monster Bone Map Assets |

## Appendix B: Sources

- Dungeondraft-MCP format research: https://raw.githubusercontent.com/casancam/Dungeondraft-MCP/main/docs/research.md (community source, not official)
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude help center, Agent SDK and `claude -p` usage: https://support.claude.com/en/articles/15036540
- 2-Minute Tabletop license FAQ: https://2minutetabletop.com/faq/map-commission-license/
- 2-Minute Tabletop Dungeondraft packs: https://2minutetabletop.com/dungeondraft/
- Local checks: Dungeondraft 1.2.0.1 at `C:\Program Files\Dungeondraft`, custom asset folder `D:\DND Assets` (from Dungeondraft's `config.ini`)

## 21. Aged worlds (2026-11-07)

The user asked for Ogeia remade a thousand years on, still medieval because of constant war, in the test world and easy to migrate. docs/worlds.md is the user guide.

- **Model** (`core/world/azgaar.ts`): Azgaar's full JSON export read into cells (height, biome, people, realm, province, culture, faith), vertices and their cells, towns, realms, provinces, cultures, faiths, rivers, routes, markers, name bases. `edgeLines` chains cell edges between unlike neighbours into polylines (coast, borders).
- **Names** (`names.ts`): a letter-pair Markov chain over each culture's own name base coins new names; `drift` wears old names down with sound changes; a filter keeps crude words out.
- **History** (`history.ts`, `ageWorld`): 25-year steps. Provinces (and clusters of unclaimed land) are the units that change hands. Each step: wars between neighbours (strength from people and towns, with overreach for big realms; the winner takes one to three border provinces; towns may be sacked or razed, capitals fall and courts flee); rebellions in big or mixed realms (seeded in the province farthest from the capital, of another people); civil war splitting any realm over 30% of the land; unions of small kin realms; settlers claiming empty land; plague out of big ports; town growth (trade, ports, rivers, capitals, with a ceiling towards 100k) and decline at the front; new towns at good sites and forts on contested borders; walls where the fighting is; capitals moving to greater cities; peoples and faiths following their rulers; church schisms; forests cleared round big towns; a road from each capital to its great towns each century. At the end: realm forms by size (Empire, Kingdom, Duchy... Free City), old names drifted, new realms and some towns renamed, ruins and the great battlefields as markers. Deterministic for a seed.
- **City links** (`cityLink`): the city generator link built the way Azgaar builds it (size = people^0.375, matched 364 of 369 real links; sea direction matched 42 of 43).
- **Prose** (`companion/world/write.ts`): Claude CLI, four at a time, from the event log rendered as dated sentences (`chronicle.ts`): eight ages of 125 years (titles kept distinct), a history and a present-day page with a hook for each realm, a line on each fallen realm, a page for each notable town (the 24 biggest and the capitals), an overview. The rest get pages built from their facts and events.
- **Map** (`companion/world/render.ts`): parchment base painted per cell (terrain colours by biome and height, realm washes) at map scale, blurred and blown up five times, with paper grain and a dark rim; ink shelf bands, coast, rivers widening downstream, roads and sea lanes, province and realm borders; 2MT Wonderdraft world-map art for mountains (by height), hills, forests (thick), reeds, volcanoes, settlements by kind and size, ruins, mines, lighthouses, ships on the sea lanes; battlefield crosses; names with collision boxes; title banner, compass rose, frame.
- **Bundle and import** (`companion/world/bundle.ts`, module `scripts/worlds.js`): one portable folder in Data; the module's "Import a world" menu and API make the scene, folders, journals and pins, all flagged with the world id so a re-import replaces cleanly.
- **City scene size**: city scenes now take the finest of 25/50/100/200 ft per square that keeps the image under 8000 px (Signi 1183, 8655 buildings, renders at 100 ft in about 90 s).
- **Steers** (`core/world/steer.ts`, `applySteers`): the DM's changes, kept in `data/worlds/<id>/steer.json` and laid over the rolled history in the age stage, so the dice and the rest of the history stay as rolled (the roll is checked byte for byte against the old aged.json). One kind so far, `invasion`: an outside power takes a block of realm land round a town (`share` of the realms' land, default 3%), grown cell by cell from the town so it stays in one piece and cuts across provinces and borders; no realm's capital falls; towns change hands as they stand, the largest becomes the seat; the block becomes a region of its own; one `invasion` event per realm that lost land. The invader realm carries `invader: true`: its faith is unknown, its page lists the seat and the people of the land, and every prose prompt carries what the DM said of it and nothing more (no origin, people, leaders, weapons, machines or aims). A new steer drops the prose it touched (its realms and towns, the age it falls in, the overview), so the next prose stage rewrites only those. Realm names keep clear of towns and their names (long names over small realms wrap to two or three lines). Invader land is hatched in the invader's colour (clipped to the inked coast) behind a bold front line along its land border, so the occupied ground reads at a glance (user asked 2026-11-08 to see what the Institute occupies). The last age's events now include the present year (an off-by-one had left 1183 out).
- **Research Institute of Science** (user, 2026-11-07: "A few months back, the Research Institute of Science has invaded our medieval world. They have taken some territory but not too much."): steer at Marnovet, 3% of realm land, 1183 NE; it took 47 cells and 14 towns from Navarg and a sliver of Solington, seated at Iscombon. Place and share were my choice; the user named neither. The pre-invasion build is kept in `data/worlds/ogeia-1183/before-invasion/`.

## 22. Townsfolk (2026-11-08)

The user asked for people "for when we zoom in": movable, not necessarily actors, only on building-level maps (never the city scene), free art only (no Forgotten Adventures purchase). Agreed design (2026-11-07): tokens on a few shared dnd5e stat blocks.

- **Placement** (`core/gen/people.ts`, `placePeople`): reads a built map's rooms (layout zones), furniture (placed pieces with their facings and parent tables) and the Dungeondraft walls, doors, water and pier patterns. Tavern: patrons on chairs, stools, benches and armchairs facing the way the seat faces; a barkeep about a square and a half behind the bar's customer edge (works for straight and L-shaped bars); a server or two; a minstrel by the hearth now and then; a cook at the oven, a kitchen hand, a cellarman; guests asleep in the beds at night. Temple: a priest behind the altar, acolytes by the lecterns and statues, worshippers on the pews. Keep: guards flanking the main door inside and out, a captain, a servant, the lord in the study, nobles at the dining table and in the ballroom in the evening, asleep at night. Wizard's tower (study without a hall): the wizard and an apprentice. Street maps: vendors under the market stalls with shoppers in front (none at night), a guard each side of every gate in the city wall and travellers on the road, sailors on the ships, dockworkers at the cargo, a few at the fountain, passers-by at house doors, the watch at night. Busy by day, busier at dusk, few at night; at most 40 per map. Nobody stands in a wall, a house (closed house walls), the water (unless on a pier or the wharf), a piece of furniture or another person. Deterministic per map seed and version.
- **Companion**: `MapStore.people` and RPC `maps.people` give each person in scene pixels with a token rotation (the dnd5e figures face down the image: rotation 0 is facing south).
- **Module** (`foundry-module/scripts/people.js`): a "Townsfolk" actor folder with one actor per stat block, made once from the dnd5e SRD monsters (Commoner, Noble, Guard, Knight, Veteran, Thug, Priest, Acolyte, Mage) by plain creation from the entry's data (the first try used `importFromCompendium`, which failed in the user's browser with "Cannot read properties of undefined (reading 'id')" before reaching the server; Foundry 14's import also keeps the entry's id and replaces any actor holding it); failing that a bare NPC of that name; failing that, tokens without an actor. Errors go to the console with their stack. The second run showed the cause: dnd5e 5.2.5 (verified for Foundry 13) fails its own data validation for every new actor on Foundry 14.370 ("SchemaField#_validateRecursive ... reading 'message'"); dnd5e 6.x is the Foundry 14 release. The tokens were placed without actors (19 on the Chadonvel tavern). So the module now makes no actors while the system is not verified for this Foundry generation (no error spam) and, once it is, `attachStats` gives the bare tokens their stat blocks where they stand; tokens unlinked, neutral, name on hover ("Wenna, barkeep"), art from `systems/dnd5e/tokens` (apprentice: ApprenticeWizard, minstrel: the BardLute hero), mirrored half the time, sized 0.88 to 1.0 and softly tinted so a room of Commoners reads as different people. Each wears a Foundry token ring (user, 2026-11-08: "a circle border so they pop out more"): a gold ring (#e0a92e) on a parchment disc (#d9c9a3); tokens placed earlier get it the next time the GM views their scene (`ringUp`). City places get townsfolk when built; places built earlier get them the first time the active GM views them (scene flag `people` records it, so deleting them all does not bring them back); `api.populate(scene)` redoes a scene. The dnd5e token art is licensed for use inside Foundry, which is all this does.
- Checked on six real places (Chadonvel tavern, temple, keep, market, gate; Durton docks) and six taverns, drawn over the renders with the real token art; then in Foundry after the user had dnd5e updated to 6.0.6 (2026-11-08): 19 townsfolk on the Chadonvel tavern with their stat blocks attached in place, no console errors.

## 23. A clearing in front of an enclosed map (2026-11-08)

The user asked to add the outside to the castle corridor ("Entrance to Dracula's Castle"): "Just a small clearing where my players can start".

- Plan field `approach {depth?, width?}` (enclosed maps only, validated 2 to 80 squares): the open ground in front of the main entrance reaches `depth` squares from the wall (default 5) and the map is at least `width` wide. `layoutBuilding` lays the building out exactly as before, then `widenApproach` grows the map and moves everything with it, so the rooms and their dressing do not change (tested piece for piece).
- Eight squares or deeper, the approach is a clearing: the outdoor ground set (grass, earth, leaf litter) even on a dark gothic map, trees standing at its far edge and sides (crowns may hang off the map; indoor potted trees excluded), undergrowth among them, the road from the gate running through, the middle open.
- The castle corridor now has a 12 x 20 clearing (map 20 x 41, was 12 x 34). Removing `approach` from its plan brings the old map back exactly (generation is deterministic). The panel's Claude knows the field (tool schema and system prompt), so "add a clearing outside" works from the Map Maker chat too.

## 24. A shared toolbar group (2026-11-08)

The user asked for a left-toolbar button "like other modules", one parent "Georgios' Modules" holding both the Map Maker and Georgios Scribbler. Both modules add to `controls.georgios` in `getSceneControlButtons` (whichever loads first creates it; GM only; icon fa-dragon): Map Maker (order 0) opens the Map Maker panel; Scribbler's Panel (10) and DM Assistant (11) moved there from the Journal Notes group. The sidebar buttons stay, since Foundry's toolbar does nothing while no scene is shown.


## 25. "Map an area" tool and buildings from inside (2026-11-08)

The user: "the tool should be a rectangle tool inside the module menu, not separate. Also, I want to render the insides of the houses when at building level, not just the roofs."

**The tool.** The module registers its own canvas layer (`CONFIG.Canvas.layers.georgios`, foundry-module/scripts/area-tool.js) whose `prepareSceneControls` makes the "Georgios' Modules" group. A layer is what lets a group hold a drag tool: Foundry hands left-drags to the active layer. Tools: "Map an area" (the default tool of the group) and the Map Maker panel button; Georgios Scribbler still adds its two buttons from `getSceneControlButtons`. The drag draws a gold box with its size in feet; it stops growing at the companion's 120 m limit and grows to 15 m round its middle when smaller. Off a city scene the tool says to open one. Drawings made with Foundry's own Drawing tools no longer start a build.

**Inside the buildings** (core city/interiors.ts; street.ts option `interiors`, default on; the city scene keeps its roofs):
- Each building's wall line (the traced 2MT outline, or the plot when no art fits) is framed along its long side; the frame is cut into a grid of rooms: one to three across a house, two rows in a deep one, rooms about nine squares a side in a keep or a hall. Grid cells mostly outside the walls (a cross-shaped keep's corners) are left out. A tree of doors joins the rooms, from the room with the street door outward.
- The ordinary room engine (gen/dress.ts) furnishes the rooms in that frame, kept inside the real walls by a mask (`DressInput.mask`, `maskPad`); the pieces are turned back onto the street map.
- Programs by building: homes by size (one room with hearth, bed and table; or a main room and a bedroom; big houses add a trade room: workroom, smithy, weaver or store), a tavern's common room and kitchen, a church's nave and vestry, a keep's hall, dining room, kitchen, study, chambers and vaults, a guildhall's dining hall, warehouse stores, stable hay. New room types: house.home, house.living, house.bedroom, house.workroom, house.smithy, house.weaver, house.stable.
- Floors: wood in homes, stone in churches, keeps, warehouses and smithies, earth in stables. Windows on walls that face open ground, clear of the door and corners. A building cut by the map's edge whose street door falls off the map gets its door on the nearest wall that is on the map and opens onto free ground.
- Foundry: house walls, inner walls, doors and windows all become Foundry walls. Street scenes built before this change are rebuilt in place the first time the GM opens them (scene flag `look`, image, walls, lights and townsfolk; other tokens stay).

## 26. Shops (2026-11-08)

The user: "we need to add stores. You know, blacksmith, herbalist, potion maker, butcher, fishman, merchants and anything else you can think of."

- **Which and where** (core city/shops.ts, chosen in places.ts): a town has a blacksmith (by a gate), merchant (on the market square), baker and butcher (near the market), herbalist and potion maker (a walk away) and, with a coast or river, a fishmonger (by the water). A city adds an armourer (by the keep), tailor, cobbler, chandler, potter and carpenter (towards the edge of town); a large city a jeweller, a bookseller and a second merchant, baker, butcher and blacksmith. Shops take ordinary house plots (45-450 m², 90 m² for the smith and the carpenter), never a place of interest, the castle or a country cottage, at least 22 m apart. In a plot of several houses, the biggest keeps the shop, so every street map shows the same shop in the same house.
- **Pins**: each shop is a hot spot (kind "shop", its trade, the trade's Foundry core icon) built on demand as a street-level map of the shop and its frontage (at least 26 m across). Second shops of a trade get numbered ids (shop-baker-2); hot spot ids are now unique everywhere (Chadonvel had two "inn-east"). City scenes opened before shops existed get the missing pins on the GM's first look (RPC `city.places`, which lists the places without drawing the city again; scene flag `pins`).
- **Inside**: the shop takes the room with the street door, with a store and the family's rooms behind in bigger houses. Shop recipes (gen/recipes.ts `shop.*`): a counter across the back of the shop a step off the wall, goods on it, shelves of goods along the walls, a display table; the smith's fire and anvil, the potion maker's cauldron or alchemy station, the baker's oven, the carpenter's bench. Named goods within roles pick the right art (gen/style.ts `GOODS`: food:fish, food:meat, food:bread, food:herbs, other:cloth, rack:clothes, rack:weapons, shelf:boots, trinket:jewels, counter:butcher, alchemy:alchemy). Shop surfaces carry denser and bigger goods (`SurfaceSpec.fill`).
- **People**: the keeper stands behind the counter (the smith at the anvil, the carpenter at the bench), named for the trade ("Bram, butcher"), with a customer or two in front by day; shops shut at night. Placed pieces record their room type (`Placed.room`) for this.

## 27. Services, the law, the underworld and the nobles (2026-11-08)

The user: "next maybe add some utilities. Healer, nobles mansions, stable, alchemist, den of thieves/beggars, fence for contrabant, guard garisson. Come on dude you get the idea. Come up with as much shit as you can that make sense."

- **What a city gets** (core city/shops.ts SERVICES, placed in places.ts after the shops so no shop or pin moves): a town has a healer (by the temple), a watch house (by a gate), an alehouse, a beggars' den, a thieves' den and a fence (on poor streets towards the edge), a tannery (by water) and a furrier. A city adds an alchemist, a moneylender (on the market square), an undertaker (by the temple), a bathhouse, a gaol (by the keep), a gambling den, a smugglers' den (by the sea), a brewery, a shipwright (by the sea) and a stonemason. A large city doubles the healer, alehouse, watch house and thieves' den. Asked for by the user: healer, mansions, stables, alchemist, thieves' and beggars' dens, fence, garrison; the rest are my additions.
- **Places of interest with their own art** (city scene and street maps): noble mansions (town without a keep 1, city 3, large 6; big plots a short walk from the keep, temple or market; 2MT's haunted mansion rooftop, Town Center rooftop 5, the Medieval City Center corner buildings; each named for a noble house from a syllable list), the garrison (cities and up, a big plot by the main gate, a stone keep or tower roof) and, in a town without walls, a stable by a road at its edge. Stables by the gates now get pins too.
- **Rooms** (gen/recipes.ts, gen/rooms.ts): infirmary, alchemist's laboratory, counting room and strongroom, undertaker's shop, bath hall; pawnshop front, contraband store, thieves' den, hideout, beggars' squat, gambling hall; guard post, barracks, mess hall, armoury, captain's office, gaol guardroom and cells (cell doors locked in Foundry); tannery, brewery, shipwright's shed, furrier's shop, stonemason's yard. Mansions: hall, dining room, kitchen, study, bedrooms, strongroom, rooms sized to the house. The garrison: mess hall, barracks, armoury, captain's office, a cell, kitchen, stores.
- **People** (gen/people.ts): beds and seats by room type: patients (and a healer at a bedside by day), guards asleep in the barracks at night and at the mess table by day, a captain at his desk, prisoners in the cells, thieves at the den's tables, gamblers, beggars on their cots, nobles at dinner, in the study and asleep at night, patrons in alehouses, bathers in the tubs. Keepers behind every trade's counter (the fence, the moneylender). At most eight to a building.
- **Secret places**: the thieves' den, fence, gambling den and smugglers' den pins link to journal pages closed to players (ownership NONE), which Foundry uses to hide the pin.
- **Foundry upgrade**: city scenes from before (scene flag `pins` under 3) are drawn again (RPC `city.refresh`, the city image from its saved layout) and get the new pins on the GM's first look; street maps rebuild once more (`look` 3).
- Checked on Chadonvel: 6 mansions (one great one with 9 rooms, the others 4), the garrison (mess, barracks, armoury, office), 4 stables, and renders of the thieves' den, gaol, healer, beggars' den, gambling den, bathhouse and fence with their people.
