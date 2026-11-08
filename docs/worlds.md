# Aged worlds

An Azgaar world map, aged a thousand years and turned into a Foundry world map with journals. The
first one is **Ogeia, 1183 NE**: the Wallachia campaign's Ogeia, a thousand years after 183 NE.

## What a world bundle is

One folder, `Data/georgios-map-maker/worlds/<id>/`, holding:

- `map.webp`: the world map (9600 x 5400 for Ogeia), drawn in 2MT's Wonderdraft world-map art.
- `bundle.json`: the journals (overview, the eight ages, faiths, fallen realms, one page per realm,
  town, village, ruin and battlefield) and the pins, with nothing tied to a particular Foundry world.

## Moving it to another world (Wallachia, or a module)

1. If the other world is on another Foundry install, copy the folder `Data/georgios-map-maker/worlds/ogeia-1183`
   to the same place there. On this PC it is already in place for every world.
2. Open the other world as GM, with Georgios' Map Maker enabled.
3. **Configure Settings > Georgios' Map Maker > Import a world > Import**, then pick the world.
   (Or from the console: `game.modules.get("georgios-map-maker").api.importWorld("georgios-map-maker/worlds/ogeia-1183")`.)

Everything the import makes carries the flag `georgios-map-maker.world = "<id>"`, so importing again
replaces the earlier import cleanly (the world map scene is updated in place, so cities opened from it
keep their way back), and a module packer (Scene Packer is installed) can pick out the
scene, its folder and the journal folder by that flag. Cities opened from its pins are built by the
companion as usual and remember this map for their "World map" button.

## Building or rebuilding one

```
npx tsx packages/companion/src/cli/world-build.ts --in "<Azgaar full JSON>" --id ogeia-1183 --title "Ogeia, 1183 NE" [--stage age|prose|render|bundle] [--seed s]
```

Stages write into `data/worlds/<id>/` and reuse each other's output:

| Stage | Output | Time (Ogeia) |
|---|---|---|
| age | `aged.json`: the thousand-year simulation, deterministic for the seed | < 1 s |
| prose | `prose.json`: ages, realm histories, fallen realms, notable towns, overview (Claude CLI) | ~3 min |
| render | `map.webp` | ~2.5 min |
| bundle | `bundle.json`, copied with the map into Foundry's Data folder | < 1 s |

A different `--seed` rolls a different history (then rerun prose). To change one thing (a realm's
fate, a town's name), edit `aged.json` and rerun `prose`, `render` and `bundle`.

## Steering the history

Changes you want on top of the rolled history go in `data/worlds/<id>/steer.json`, a list applied in
order after the roll, so everything else stays as rolled. Ogeia's has one, the Research Institute of
Science:

```json
[{ "kind": "invasion", "name": "Research Institute of Science", "at": "Marnovet", "share": 0.03 }]
```

- `at`: the town (its 1183 name) or cell at the middle of the land taken. No capital falls.
- `share`: how much of the realms' land they hold (0.03 = 3%).
- `year` (optional): defaults to the present year, "a few months back".

After editing it, run the stages again (about 4 minutes; only the prose the change touched is rewritten):

```
npx tsx packages/companion/src/cli/world-build.ts --in "<Azgaar full JSON>" --id ogeia-1183 --title "Ogeia, 1183 NE" --stage age,prose,render,bundle
```

then press Import again in Foundry. The prose says only what the steer says about invaders: where they
came from, who they are and what they want is left for the DM.
