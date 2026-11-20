// Builds the Ogeia import for the test world from the COPIED Wallachia data (read-only source).
// Output: Data/georgios-map-maker/ogeia-import.json, fetched by the Foundry client.
const fs = require("fs");
const d = JSON.parse(fs.readFileSync(__dirname + "/wallachia-dump.json", "utf8"));
const SID = "kRPdoVTMfSnJlxm6";
const scene = d.scenes.find(([k]) => k === "!scenes!" + SID)[1];
const notes = d.scenes.filter(([k]) => k.startsWith("!scenes.notes!" + SID + ".")).map(([, v]) => v);

const packs = { Ogeia_Burgs: "Towns", Ogeia_Provinces: "Provinces", Ogeia_Markers: "Markers", Ogeia_Countries: "Countries", Ogeia_Cultures: "Cultures", Ogeia_Religions: "Religions" };
const entries = new Map(); // "Pack.id" -> {name, pages}
for (const pack of Object.keys(packs)) {
  const rows = d[pack] ?? [];
  const pages = new Map(rows.filter(([k]) => k.startsWith("!journal.pages!")).map(([k, v]) => [k.split("!")[2], v]));
  for (const [k, v] of rows) {
    if (!k.startsWith("!journal!")) continue;
    entries.set(`${pack}.${v._id}`, { pack, id: v._id, name: v.name, pages: (v.pages ?? []).map((pid) => pages.get(`${v._id}.${pid}`)).filter(Boolean) });
  }
}
// Compendium links become plain names (the compendiums stay in Wallachia).
const clean = (html) =>
  (html ?? "").replace(/@UUID\[Compendium\.world\.(Ogeia_\w+)\.(\w+)\](\{([^}]*)\})?/g, (_, pack, id, __, label) => `<strong>${label ?? entries.get(`${pack}.${id}`)?.name ?? "?"}</strong>`);

const journals = [];
const used = new Set();
for (const n of notes) {
  const ref = n.flags?.["azgaar-foundry"]?.journal;
  const pack = ref?.compendium?.replace("world.", "");
  const key = `${pack}.${ref?.journal}`;
  const e = entries.get(key);
  if (!e || used.has(key)) continue;
  used.add(key);
  journals.push({
    key,
    name: e.name,
    folder: packs[pack],
    pages: e.pages.map((p) => ({ name: p.name, type: "text", text: { content: clean(p.text?.content), format: 1 } })),
  });
}
const pins = notes.map((n) => {
  const ref = n.flags?.["azgaar-foundry"]?.journal;
  return {
    key: `${ref?.compendium?.replace("world.", "")}.${ref?.journal}`,
    x: n.x, y: n.y, text: n.text, iconSize: n.iconSize, fontSize: n.fontSize, textAnchor: n.textAnchor, textColor: n.textColor,
    texture: { src: n.texture.src, tint: n.texture.tint },
  };
});
const out = {
  scene: { name: "Ogeia (world map)", width: scene.width, height: scene.height, src: scene.background.src, grid: scene.grid },
  journals, pins,
};
// Into Foundry's data folder (FOUNDRY_DATA, else the Windows default under %LOCALAPPDATA%).
const target = require("path").join(process.env.FOUNDRY_DATA ?? require("path").join(process.env.LOCALAPPDATA ?? "", "FoundryVTT", "Data"), "georgios-map-maker", "ogeia-import.json");
fs.writeFileSync(target, JSON.stringify(out));
const byFolder = {};
for (const j of journals) byFolder[j.folder] = (byFolder[j.folder] ?? 0) + 1;
console.log("journals", journals.length, JSON.stringify(byFolder), "pins", pins.length, "unmatched pins", pins.filter((p) => !used.has(p.key)).length);
console.log("sample page:", journals.find((j) => j.folder === "Towns").pages[0].text.content.slice(0, 600));
