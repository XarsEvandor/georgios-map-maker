/**
 * Opens a generated map in Dungeondraft after enabling the asset packs it uses.
 *   npx tsx packages/companion/src/cli/dd-open.ts data/maps/roadside-inn/v2.dungeondraft_map
 * Dungeondraft must be closed (it rewrites its settings on exit); a backup of config.ini is kept.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dungeondraftRunning, enablePacksInDungeondraft, openInDungeondraft } from "../dd/bridge";

const file = resolve(process.argv[2] ?? "");
const map = JSON.parse(await readFile(file, "utf8")) as { header?: { asset_manifest?: Array<{ id: string }> } };
const ids = (map.header?.asset_manifest ?? []).map((m) => m.id);
if (await dungeondraftRunning()) {
  console.log("Dungeondraft is running; close it first so the packs can be enabled.");
  process.exit(1);
}
const { added } = await enablePacksInDungeondraft(ids);
console.log(`map uses ${ids.length} packs; enabled ${added.length} more in Dungeondraft`);
openInDungeondraft(file, process.env.GMM_DD_EXE);
console.log(`opening ${file}`);
