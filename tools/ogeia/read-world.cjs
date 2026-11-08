// Reads the COPIED Wallachia LevelDB folders (never the live world) with Foundry's own classic-level.
const { ClassicLevel } = require("C:/Program Files/Foundry Virtual Tabletop/resources/app/node_modules/classic-level");
const fs = require("fs");
const base = "C:/Users/giorg/AppData/Local/Temp/claude/03d9be09856c09a0/3f8cccea-bd6e-4cee-91c7-f8db7aabef02/scratchpad/wallachia-copy";
const out = {};
(async () => {
  for (const name of fs.readdirSync(base)) {
    const db = new ClassicLevel(`${base}/${name}`, { valueEncoding: "json" });
    const rows = [];
    for await (const [k, v] of db.iterator()) rows.push([k, v]);
    await db.close();
    out[name] = rows;
    const kinds = {};
    for (const [k] of rows) { const t = k.split("!")[1] ?? k; kinds[t.split(".")[0]] = (kinds[t.split(".")[0]] ?? 0) + 1; }
    console.log(name, rows.length, JSON.stringify(kinds));
  }
  fs.writeFileSync(`${base}/../wallachia-dump.json`, JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
