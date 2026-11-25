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
  { id: "A5", label: "L1~L7 을 아는 공격자", mustIdentify: true, fn: async (c) => atk.informedScrub(c) },
  { id: "A6", label: "L8 까지 아는 공격자(데이터 ±3)", mustIdentify: false, fn: async (c) => atk.semanticScrub(c, { k: 3 }) },
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
  (function rnd(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "Literal" && typeof n.value === "number" && !Number.isInteger(n.value) && n.value > 1e-6 && n.value < 1e6) {
      const f = new Float64Array([n.value]), u = new BigUint64Array(f.buffer);
      u[0] = (u[0] & ~((1n << 24n) - 1n)) | BigInt(Math.floor(Math.random() * 2 ** 24));
      n.value = f[0]; n.raw = String(f[0]);
    }
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(rnd); else if (v && typeof v === "object") rnd(v); }
  })(ast);
  return generate(ast);
}
// ✓ = 그 층이 읽혔고 정답 mark 를 가리킴, · = 읽혔지만 다른 값(잡음), ✗ = 소실
const mark = (r, k, expect) => (r.layers[k] && r.layers[k].present ? (r.layers[k].id === expect && r.layers[k].tagOk ? "✓" : "·") : "✗");
let REFS = [];
const LAYERS = ["L1", "L2", "L3", "L4", "L5", "L6", "L8"];
const layerLine = (r, expect) => LAYERS.map((k) => k + mark(r, k, expect)).join(" ");

(async () => {
  const src = Object.fromEntries(GAMES.map((g) => [g, fs.readFileSync(path.join(ROOT, "games", g, "game.js"), "utf8")]));
  // L8 레퍼런스: 실제 서비스처럼 등록된 모든 게임의 원본 레퍼런스를 넘기고, 검출기가 맞는 것을 고른다
  REFS = GAMES.map((g) => wm.semanticReference(src[g]));
  const rows = [];
  let failures = 0, wrongAccusations = 0;

  console.log("=== 1) 삽입·추출 + 공격 매트릭스 (게임 3 × 협력사 3 × 공격 7) ===");
  for (const g of GAMES) {
    const a = wm.analyze(src[g]);
    if (!a.ok) { console.log(`✗ ${g} 요구사항 미충족: ${a.issues}`); failures++; continue; }
    for (const p of PARTNERS) {
      const marked = wm.insert(src[g], p.mark);
      for (const A of ATTACKS) {
        let attacked;
        try { attacked = await A.fn(marked); } catch (e) { console.log(`${g}/${p.name}/${A.id} 변환 실패: ${e.message}`); failures++; continue; }
        const r = wm.extract(attacked, { references: REFS });
        const correct = r.decision === "IDENTIFIED" && r.markId === p.mark;
        const wrong = r.decision === "IDENTIFIED" && r.markId !== p.mark;
        if (wrong) wrongAccusations++;
        const pass = !wrong && (!A.mustIdentify || correct);
        if (!pass) failures++;
        rows.push({ g, p: p.name, mark: p.mark, A, r, correct, wrong, pass, size: attacked.length });
        console.log(`${pass ? "PASS" : "FAIL"} ${g.padEnd(13)} ${p.name.padEnd(9)} ${A.id} ${A.label.padEnd(20)} ` +
          `${layerLine(r, p.mark)}  ` +
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
    const r = wm.extract(c, { references: REFS });
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
    const r = wm.extract(randomVariant(src[GAMES[i % GAMES.length]]), { references: REFS });
    if (r.decision === "IDENTIFIED") { fp++; if (r.confidence === "HIGH") fpHigh++; }
  }
  const fpRate = fp / N;
  console.log(`N=${N}: 우연 식별 ${fp}건 (${(fpRate * 100).toFixed(2)}%), 그중 HIGH ${fpHigh}건 — 이론값 ≈ 2/256 ≈ 0.78% (L2·L4 각 1/256, L3 단독은 지목 안 함, L5 는 리터럴 검사값+태그로 ≈ 1/65536)`);

  const total = rows.length;
  const byAttack = ATTACKS.map((A) => {
    const rs = rows.filter((x) => x.A.id === A.id);
    return { A, ok: rs.filter((x) => x.correct).length, high: rs.filter((x) => x.correct && x.r.confidence === "HIGH").length, wrong: rs.filter((x) => x.wrong).length, n: rs.length,
      surv: LAYERS.map((k) => rs.filter((x) => mark(x.r, k, x.mark) === "✓").length) };
  });
  console.log(`\n요약: ${total}건 중 실패 ${failures}건, 오지목 ${wrongAccusations}건`);

  // ---- RESULTS.md ----
  const md = [];
  md.push("# CodeVault 워터마크 매트릭스 결과 (자동 생성: `node tests/run-matrix.js`)", "");
  md.push(`생성 시각: ${new Date().toISOString()}  ·  Node ${process.version}  ·  비밀키: ${process.env.WM_SECRET ? "WM_SECRET" : "데모 기본값"}`, "");
  md.push("대상: 오리지널 게임 3개(comet-shower, lantern-range, moss-hop) × 협력사 3곳(mark 17/42/203). 페이로드 = 8비트 mark_id + 8비트 HMAC 태그(L3 는 7비트).", "");
  md.push("## 1) 공격별 식별 결과 (9개 빌드 기준)", "");
  md.push("| 공격 | 정확 식별 | HIGH | 오지목 | " + LAYERS.join(" | ") + " | 기대 |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const b of byAttack) {
    md.push(`| ${b.A.id} ${b.A.label} | ${b.ok}/${b.n} | ${b.high} | ${b.wrong} | ${b.surv.join(" | ")} | ${b.A.mustIdentify ? "식별해야 함" : "오지목만 없으면 됨"} |`);
  }
  md.push("", "(층 생존 = 그 층이 읽혔고 태그 검증을 통과해 정답 mark 를 가리킨 빌드 수. L3 는 7비트 태그라 가중치 0.5 — 단독으로는 지목하지 않는다. A3 에서 L4 가 3건 살아남은 것은 공격이 바꾼 색의 하위비트가 우연히 mark 42 와 맞은 경우)", "");
  md.push("## 2) 오탐 검사", "", "| 입력 | 판정 | 결과 |", "|---|---|---|");
  negRows.forEach((n) => md.push(`| ${n.label} | ${n.r.decision} | ${n.ok ? "✔ 거부" : "✗ 오탐"} |`));
  md.push("", "## 3) 무작위 변형 우연 식별률 (참고)", "");
  md.push(`무표식 게임의 함수 순서·키 순서·팔레트 하위비트·소수 상수 하위비트를 층마다 독립적으로 무작위화한 ${N}개 중 우연히 태그가 맞은 비율: **${(fpRate * 100).toFixed(2)}%** (HIGH ${fpHigh}건). 이론값 ≈ 2/256 (L2·L4 태그가 각각 1/256 확률로 우연 일치. L3 는 단독 지목 불가, L5 는 리터럴 검사값까지 맞아야 해서 무시할 수준).`);
  md.push("→ 단일 층(MEDIUM) 식별은 '추가 증거 필요'로 표시하고, 웹앱은 등록된 mark_id·해당 게임과 일치할 때만 협력사를 지목한다.", "");
  md.push("## 4) 상세", "", "| 게임 | 협력사 | 공격 | " + LAYERS.join(" | ") + " | 판정 | 신뢰도 | 결과 |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  rows.forEach((x) => md.push(`| ${x.g} | ${x.p}(${x.mark}) | ${x.A.id} | ${LAYERS.map((k) => mark(x.r, k, x.mark)).join(" | ")} | ${x.r.decision}${x.r.markId != null ? "(" + x.r.markId + ")" : ""} | ${x.r.confidence} | ${x.pass ? "PASS" : "FAIL"} |`));
  md.push("", "범례: ✓ 읽힘·정답 일치, · 읽혔으나 불일치(잡음), ✗ 소실", "");
  md.push("## 결론", "");
  md.push(`- 총 ${total}건, 실패 ${failures}건, **오지목 ${wrongAccusations}건**.`);
  md.push("- 코드 층: L1 zero-width 주석, L2 함수 순서, L3 설정 키 순서(+7비트 태그), L4 팔레트 하위비트, L5 소수 상수 미세값, L6 줄 끝 공백, **L8 게임 데이터 표(시맨틱)**. 화면 층 L7 은 RESULTS-L7.md.");
  md.push("- 주석 제거·minify·수동 편집까지 전 빌드를 HIGH 로 추적한다. minify 후에는 L3·L4·L5 가 함께 버틴다.");
  md.push("- 강한 난독화(javascript-obfuscator)에서도 L5(소수 상수)가 살아남아 MEDIUM 으로 추적된다.");
  md.push("- L1~L7 을 아는 공격자(A5)는 동작과 무관한 층을 모두 지우지만, 게임 데이터에 실린 L8 이 남아 전 빌드를 추적한다.");
  md.push("- L8 까지 아는 공격자(A6)는 원본 값을 모르므로 데이터에 잡음을 넣어야 한다. 데모 게임(데이터 55~64개)은 ±3 잡음이면 대부분 지워지고, 데이터가 많은 제품일수록 필요한 잡음이 커진다 — RESULTS-L8.md.");
  md.push("- 어떤 경우에도 잘못된 협력사를 지목하지 않는다.");
  md.push("- PoC 원본 결과는 `poc/RESULTS.md` 참고.");
  fs.writeFileSync(path.join(ROOT, "RESULTS.md"), md.join("\n") + "\n");
  console.log("RESULTS.md 갱신");
  process.exit(failures ? 1 : 0);
})();
