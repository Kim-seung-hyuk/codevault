const fs = require("fs");
const wm = require("./watermark");
const atk = require("./attacks");

const code = fs.readFileSync("sample-game.js", "utf8");
const CUSTOMERS = { "Publisher-A": 10, "Publisher-B": 20, "Publisher-C": 30 };

function layerStr(r) {
  const L = r.layers;
  const f = (v, mask) => (v == null ? "✗" : "✓");
  return `L1 ${f(L.L1)} | L2 ${f(L.L2)} | L3 ${f(L.L3)} | L4 ${f(L.L4)}`;
}

(async () => {
  // ---- round-trip identity: 3 customers, no attack ----
  console.log("=== 1) 식별 정확도 (공격 없음) ===");
  for (const [name, id] of Object.entries(CUSTOMERS)) {
    const w = wm.insert(code, id);
    const r = wm.extract(w);
    console.log(`${name}(id=${id}) -> idStar=${r.idStar} tagOk=${r.tagOk} ${r.decision} conf=${(r.confidence*100).toFixed(0)}%`);
  }

  // ---- attack matrix on Publisher-B ----
  const id = CUSTOMERS["Publisher-B"];
  const w = wm.insert(code, id);
  const attacks = [
    ["A0 그대로", async (c) => c],
    ["A1 주석·공백 제거", atk.stripComments],
    ["A2 terser minify+mangle", atk.terserMangle],
    ["A3 beautify+수동편집", async (c) => atk.beautifyAndEdit(c)],
    ["A4 강한 난독화", async (c) => atk.obfuscate(c)],
    ["A5 처음부터 재작성(무워터마크)", async () => code],
  ];

  console.log("\n=== 2) 공격 단계별 생존 (대상: Publisher-B, id=20, 정답 tag=" + wm.tagFor(id) + ") ===");
  const rows = [];
  for (const [label, fn] of attacks) {
    let attacked;
    try { attacked = await fn(w); } catch (e) { console.log(`${label}: 변환 실패 ${e.message}`); continue; }
    const r = wm.extract(attacked);
    const idMatch = r.idStar === id && r.tagOk;
    rows.push({ label, r, idMatch, size: attacked.length });
    console.log(`\n[${label}]  (${attacked.length}B)`);
    console.log(`   ${layerStr(r)}`);
    console.log(`   idCands=[${r.idCands.join(",")}] -> idStar=${r.idStar}  tagStar=${r.tagStar} expect=${r.expectTag} tagOk=${r.tagOk}`);
    console.log(`   생존층=${r.survivingLayers}/4  신뢰도=${(r.confidence*100).toFixed(0)}%  판정=${r.decision}  ${r.decision==="IDENTIFIED"?(r.idStar===id?"✔ 정범 지목":"✗ 오지목!"):"(추적불가)"}`);
  }

  // ---- false positives ----
  console.log("\n=== 3) 오탐 검사 (워터마크 없는 입력은 거부해야 정상) ===");
  const negatives = [
    ["원본(무워터마크)", code],
    ["무관한 JS", "function add(a,b){return a+b;} const PALETTE=['#000000','#111111'];var GAME_CONFIG={a:1};console.log(add(1,2));"],
  ];
  for (const [label, c] of negatives) {
    const r = wm.extract(c);
    console.log(`${label}: 판정=${r.decision} tagOk=${r.tagOk} idStar=${r.idStar} ${r.decision==="NO_RELIABLE_MARK"?"✔ 올바르게 거부":"✗ 오탐!"}`);
  }
})();
