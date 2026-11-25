// games/<slug>/ 폴더를 업로드용 zip 으로 묶는다 → games/dist/<slug>.zip
//   node tools/pack-games.js
const fs = require("fs");
const path = require("path");
const { zipSync } = require("../lambda/node_modules/fflate");
const root = path.join(__dirname, "..", "games");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
for (const slug of fs.readdirSync(root)) {
  const dir = path.join(root, slug);
  if (slug === "dist" || !fs.existsSync(path.join(dir, "manifest.json"))) continue;
  const files = {};
  for (const f of fs.readdirSync(dir)) files[f] = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  const out = path.join(dist, slug + ".zip");
  fs.writeFileSync(out, zipSync(files, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") }));
  console.log("packed", path.relative(process.cwd(), out), Object.keys(files).join(", "));
}
