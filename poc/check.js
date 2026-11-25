const fs = require("fs");
const wm = require("./watermark");
const code = fs.readFileSync("sample-game.js", "utf8");
const ast = wm.acornParse(code);
const fns = wm.topFunctions(ast);
const fps = fns.map(f => ({ name: f.node.id.name, fp: wm.fnFingerprint(f.node), params: f.node.params.length, stmts: f.node.body.body.length }));
console.log("functions:", fns.length);
fps.forEach(f => console.log(`  ${f.name.padEnd(16)} params=${f.params} stmts=${f.stmts} fp=${f.fp}`));
const distinct = new Set(fps.map(f=>f.fp)).size === fps.length;
console.log("fingerprints distinct:", distinct);
// round-trip for ids 10,20,30
[10,20,30].forEach(id => {
  const w = wm.insert(code, id);
  const r = wm.extract(w);
  console.log(`id=${id} -> idStar=${r.idStar} tagOk=${r.tagOk} decision=${r.decision} layers=`, r.layers, "conf=", r.confidence);
});
