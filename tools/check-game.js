// 게임 JS 가 워터마크 요구사항을 만족하는지 검사: node tools/check-game.js games/<name>/game.js
const fs = require("fs");
const wm = require("../lambda/lib/watermark");
let bad = 0;
for (const file of process.argv.slice(2)) {
  const a = wm.analyze(fs.readFileSync(file, "utf8"));
  console.log(`\n# ${file}  -> ${a.ok ? "OK" : "FAIL"}  (함수 ${a.functions.length}개, L2 용량 ${a.capacityBits}비트)`);
  a.functions.forEach((f) => console.log(`  ${f.name.padEnd(16)} params=${f.params} stmts=${f.stmts}`));
  console.log(`  GAME_CONFIG keys: ${a.configKeys.join(", ")}`);
  console.log(`  PALETTE: ${a.palette.join(" ")}`);
  a.issues.forEach((i) => console.log("  ! " + i));
  if (!a.ok) bad++;
}
process.exit(bad ? 1 : 0);
