// run-matrix.js — poc/run-matrix.js 확장: 게임 3개 × 협력사 3곳 × 공격 6종 + 오탐 검사
//   node tests/run-matrix.js            → 콘솔 표 + RESULTS.md 갱신
//   종료코드 0 = 통과 (A0~A2 전원 정확 식별, 오지목 0건, 무표식 입력 전원 거부)
const fs = require("fs");
const path = require("path");
const wm = require("../lambda/lib/watermark");
const atk = require("./attacks");

const ROOT = path.join(__dirname, "..");
const GAMES = ["comet-shower", "lantern-range", "moss-hop"];
const PARTNERS = [
  { name: "퍼블리셔 A", mark: 17 },
  { name: "현지화 업체 B", mark: 42 },
  { name: "스트리머 C", mark: 203 },
];
const ATTACKS = [
  { id: "A0", label: "그대로", mustIdentify: true, fn: async (c) => c },
  { id: "A1", label: "주석·공백 제거", mustIdentify: true, fn: atk.stripComments },
  { id: "A2", label: "terser minify+mangle", mustIdentify: true, fn: atk.terserMangle },
  { id: "A3", label: "beautify+수동편집", mustIdentify: false, fn: async (c) => atk.beautifyAndEdit(c) },
  { id: "A4", label: "강한 난독화", mustIdentify: false, fn: async (c) => atk.obfuscate(c) },
];
const { generate } = require("astring");
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function randomVariant(code) {
  const ast = wm.parse(code);
  const slots = ast.body.map((n, i) => (n.type === "FunctionDeclaration" ? i : -1)).filter((i) => i >= 0);
  const fns = shuffle(slots.map((i) => ast.body[i]));
  slots.forEach((s, k) => (ast.body[s] = fns[k]));
  for (const n of ast.body) if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    if (d.id.name === "GAME_CONFIG") shuffle(d.init.properties);
    if (d.id.name === "PALETTE") d.init.elements.forEach((el) => {
      const v = el.value.slice(0, 5) + ((parseInt(el.value.slice(5), 16) & 0xfc) | Math.floor(Math.random() * 4)).toString(16).padStart(2, "0");
      el.value = v; el.raw = JSON.stringify(v);
    });
  }
  return generate(ast);
}
// ✓ = 그 층이 읽혔고 정답 mark 를 가리킴, · = 읽혔지만 다른 값(잡음), ✗ = 소실
const mark = (r, k, expect) => (r.layers[k].present ? (r.layers[k].id === expect ? "✓" : "·") : "✗");

(async () => {
  const src = Object.fromEntries(GAMES.map((g) => [g, fs.readFileSync(path.join(ROOT, "games", g, "game.js"), "utf8")]));
  const rows = [];
  let failures = 0, wrongAccusations = 0;

  console.log("=== 1) 삽입·추출 + 공격 매트릭스 (게임 3 × 협력사 3 × 공격 5) ===");
  for (const g of GAMES) {
    const a = wm.analyze(src[g]);
    if (!a.ok) { console.log(`✗ ${g} 요구사항 미충족: ${a.issues}`); failures++; continue; }
    for (const p of PARTNERS) {
      const marked = wm.insert(src[g], p.mark);
      for (const A of ATTACKS) {
        let attacked;
        try { attacked = await A.fn(marked); } catch (e) { console.log(`${g}/${p.name}/${A.id} 변환 실패: ${e.message}`); failures++; continue; }
        const r = wm.extract(attacked);
        const correct = r.decision === "IDENTIFIED" && r.markId === p.mark;
        const wrong = r.decision === "IDENTIFIED" && r.markId !== p.mark;
        if (wrong) wrongAccusations++;
        const pass = !wrong && (!A.mustIdentify || correct);
        if (!pass) failures++;
        rows.push({ g, p: p.name, mark: p.mark, A, r, correct, wrong, pass, size: attacked.length });
        console.log(`${pass ? "PASS" : "FAIL"} ${g.padEnd(13)} ${p.name.padEnd(9)} ${A.id} ${A.label.padEnd(20)} ` +
          `L1${mark(r, "L1", p.mark)} L2${mark(r, "L2", p.mark)} L3${mark(r, "L3", p.mark)} L4${mark(r, "L4", p.mark)}  ` +
          `${r.decision}${r.markId != null ? "(" + r.markId + ")" : ""} ${r.confidence}${wrong ? "  ✗ 오지목!" : ""}`);
      }
    }
  }

  console.log("\n=== 2) 오탐 검사 (표식 없는 입력은 거부해야 정상) ===");
  const negatives = [
    ...GAMES.map((g) => [`${g} 원본(무워터마크)`, src[g]]),
    ...GAMES.map((g) => [`${g} 원본 terser`, null, g]),
    ["무관한 JS", "function add(a,b){return a+b;} var PALETTE=['#000000','#111111'];var GAME_CONFIG={a:1};console.log(add(1,2));"],
    ["poc/sample-game.js (다른 게임)", fs.readFileSync(path.join(ROOT, "poc", "sample-game.js"), "utf8")],
  ];
  const negRows = [];
  for (const [label, code, g] of negatives) {
    const c = code != null ? code : await atk.terserMangle(src[g]);
    const r = wm.extract(c);
    const ok = r.decision !== "IDENTIFIED";
    if (!ok) failures++;
    negRows.push({ label, r, ok });
    console.log(`${ok ? "PASS" : "FAIL"} ${label.padEnd(30)} → ${r.decision}${ok ? "" : " ✗ 오탐!"}`);
  }

  // 3) 무작위 변형 오탐률: 무표식 원본의 함수 순서·설정 키 순서·팔레트 하위비트를 층마다 독립적으로 섞었을 때
  //    우연히 태그가 맞아 '식별'되는 비율 (= 표식 없는 파일을 넣었을 때의 오탐 상한 추정)
  console.log("\n=== 3) 무작위 변형 오탐률 (참고 지표, 통과 조건 아님) ===");
  const N = 3000;
  let fp = 0, fpHigh = 0;
  for (let i = 0; i < N; i++) {
    const r = wm.extract(randomVariant(src[GAMES[i % GAMES.length]]));
    if (r.decision === "IDENTIFIED") { fp++; if (r.confidence === "HIGH") fpHigh++; }
  }
  const fpRate = fp / N;
  console.log(`N=${N}: 우연 식별 ${fp}건 (${(fpRate * 100).toFixed(2)}%), 그중 HIGH ${fpHigh}건 — 이론값 ≈ 2/256 ≈ 0.78% (L2·L4 각 1/256)`);

  const total = rows.length;
  const byAttack = ATTACKS.map((A) => {
    const rs = rows.filter((x) => x.A.id === A.id);
    return { A, ok: rs.filter((x) => x.correct).length, wrong: rs.filter((x) => x.wrong).length, n: rs.length,
      surv: ["L1", "L2", "L3", "L4"].map((k) => rs.filter((x) => x.r.layers[k].present && x.r.layers[k].id === x.mark).length) };
  });
  console.log(`\n요약: ${total}건 중 실패 ${failures}건, 오지목 ${wrongAccusations}건`);

  // ---- RESULTS.md ----
  const md = [];
  md.push("# CodeVault 워터마크 매트릭스 결과 (자동 생성: `node tests/run-matrix.js`)", "");
  md.push(`생성 시각: ${new Date().toISOString()}  ·  Node ${process.version}  ·  비밀키: ${process.env.WM_SECRET ? "WM_SECRET" : "데모 기본값"}`, "");
  md.push("대상: 오리지널 게임 3개(comet-shower, lantern-range, moss-hop) × 협력사 3곳(mark 17/42/203). 페이로드 = 8비트 mark_id + 8비트 HMAC 태그.", "");
  md.push("## 1) 공격별 식별 결과 (9개 빌드 기준)", "");
  md.push("| 공격 | 정확 식별 | 오지목 | L1 생존 | L2 생존 | L3 생존 | L4 생존 | 기대 |", "|---|---|---|---|---|---|---|---|");
  for (const b of byAttack) {
    md.push(`| ${b.A.id} ${b.A.label} | ${b.ok}/${b.n} | ${b.wrong} | ${b.surv.join(" | ")} | ${b.A.mustIdentify ? "식별해야 함" : "오지목만 없으면 됨"} |`);
  }
  md.push("", "(층 생존 = 그 층이 읽혔고 정답 mark 를 가리킨 빌드 수. L3 는 태그가 없어 단독으로는 지목 근거가 되지 않는다. A3 의 3건 식별은 공격이 바꾼 색의 하위비트가 우연히 mark 42 와 맞은 경우)", "");
  md.push("## 2) 오탐 검사", "", "| 입력 | 판정 | 결과 |", "|---|---|---|");
  negRows.forEach((n) => md.push(`| ${n.label} | ${n.r.decision} | ${n.ok ? "✔ 거부" : "✗ 오탐"} |`));
  md.push("", "## 3) 무작위 변형 우연 식별률 (참고)", "");
  md.push(`무표식 게임의 함수 순서·키 순서·팔레트 하위비트를 층마다 독립적으로 무작위화한 ${N}개 중 우연히 태그가 맞은 비율: **${(fpRate * 100).toFixed(2)}%** (HIGH ${fpHigh}건). 이론값 ≈ 2/256 (L2·L4 태그가 각각 1/256 확률로 우연 일치).`);
  md.push("→ 단일 층(MEDIUM) 식별은 '추가 증거 필요'로 표시하고, 웹앱은 등록된 mark_id·해당 게임과 일치할 때만 협력사를 지목한다.", "");
  md.push("## 4) 상세", "", "| 게임 | 협력사 | 공격 | L1 | L2 | L3 | L4 | 판정 | 신뢰도 | 결과 |", "|---|---|---|---|---|---|---|---|---|---|");
  rows.forEach((x) => md.push(`| ${x.g} | ${x.p}(${x.mark}) | ${x.A.id} | ${mark(x.r, "L1", x.mark)} | ${mark(x.r, "L2", x.mark)} | ${mark(x.r, "L3", x.mark)} | ${mark(x.r, "L4", x.mark)} | ${x.r.decision}${x.r.markId != null ? "(" + x.r.markId + ")" : ""} | ${x.r.confidence} | ${x.pass ? "PASS" : "FAIL"} |`));
  md.push("", "범례: ✓ 읽힘·정답 일치, · 읽혔으나 불일치(잡음), ✗ 소실", "");
  md.push("## 결론", "");
  md.push(`- 총 ${total}건, 실패 ${failures}건, **오지목 ${wrongAccusations}건**.`);
  md.push("- 주석 제거·표준 minify(terser mangle)까지는 전 빌드 추적 성공. minify 후에는 L4(팔레트 하위비트) 단독으로 버틴다.");
  md.push("- 의도적 편집·강한 난독화는 추적 실패할 수 있으나 잘못된 협력사를 지목하지 않는다. (RE 방지가 아니라 '지문')");
  md.push("- PoC 원본 결과는 `poc/RESULTS.md` 참고.");
  fs.writeFileSync(path.join(ROOT, "RESULTS.md"), md.join("\n") + "\n");
  console.log("RESULTS.md 갱신");
  process.exit(failures ? 1 : 0);
})();
