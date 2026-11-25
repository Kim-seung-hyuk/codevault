// semantic-attack.js — L8 시맨틱 지문 vs "층을 아는 공격자" 측정
//   A5  : L1~L7 을 아는 공격자 (데이터 표는 안 건드림)
//   A6  : L8 까지 아는 공격자 — 데이터 표 정수에 ±k 잡음 / q 배수 반올림 / 행 섞기
// 측정: 추적 성공률, 오지목, 그리고 "원본 대비 게임 데이터 변화량"(공격자가 치르는 비용)
//   node tests/semantic-attack.js   → 콘솔 + RESULTS-L8.md, 종료코드 0 = 오지목 0 이고 A5 전원 추적
const fs = require("fs");
const path = require("path");
const wm = require("../lambda/lib/watermark");
const atk = require("./attacks");

const ROOT = path.join(__dirname, "..");
const GAMES = ["comet-shower", "lantern-range", "moss-hop"];
const MARKS = [17, 42, 203];
const TRIALS = 20;
let seed = 2026;
const rng = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

// 원본 대비 데이터 변화량: 레퍼런스 표와 행을 맞춘 뒤 같은 위치 값의 평균 |차이|, 최대 |차이|
const sem = require("../lambda/lib/semantic");
function dataDrift(code, ref) {
  const { offsets } = sem.alignOffsets(wm.parse(code), ref);
  const o = offsets.filter((v) => v != null).map(Math.abs);
  return { mean: o.length ? o.reduce((s, v) => s + v, 0) / o.length : NaN, max: o.length ? Math.max(...o) : NaN };
}

const SCEN = [
  { id: "A5", label: "L1~L7 을 아는 공격자", opts: null },
  { id: "A6 k=1", label: "+ 데이터 ±1 잡음", opts: { k: 1 } },
  { id: "A6 k=2", label: "+ 데이터 ±2 잡음", opts: { k: 2 } },
  { id: "A6 k=3", label: "+ 데이터 ±3 잡음", opts: { k: 3 } },
  { id: "A6 k=5", label: "+ 데이터 ±5 잡음", opts: { k: 5 } },
  { id: "A6 k=8", label: "+ 데이터 ±8 잡음", opts: { k: 8 } },
  { id: "A6 q=4", label: "+ 데이터 4 단위 반올림", opts: { q: 4 } },
  { id: "A6 q=8", label: "+ 데이터 8 단위 반올림", opts: { q: 8 } },
  { id: "A6 k=1+섞기", label: "+ ±1 잡음 + 표 행 섞기", opts: { k: 1, shuffle: true } },
];

let wrong = 0, a5miss = 0;
const rows = [];
for (const sc of SCEN) {
  let hit = 0, total = 0, high = 0, zs = [], drift = [], maxd = 0;
  for (const g of GAMES) {
    const src = fs.readFileSync(path.join(ROOT, "games", g, "game.js"), "utf8");
    const ref = wm.semanticReference(src);
    for (const m of MARKS) {
      const marked = wm.insert(src, m);
      const trials = sc.opts && (sc.opts.k || sc.opts.shuffle) ? TRIALS : 1;
      for (let t = 0; t < trials; t++) {
        const leak = sc.opts ? atk.semanticScrub(marked, { ...sc.opts, rng }) : atk.informedScrub(marked);
        const r = wm.extract(leak, { reference: ref });
        total++;
        if (r.decision === "IDENTIFIED" && r.markId === m) { hit++; if (r.confidence === "HIGH") high++; }
        else if (r.decision === "IDENTIFIED") wrong++;
        else if (sc.id === "A5") a5miss++;
        zs.push(r.layers.L8 && r.layers.L8.present ? (r.layers.L8.id === m ? r.layers.L8.z : 0) : 0);
        const d = dataDrift(leak, ref); drift.push(d.mean); maxd = Math.max(maxd, d.max);
      }
    }
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const row = { ...sc, hit, total, high, z: avg(zs), drift: avg(drift), maxd };
  rows.push(row);
  console.log(`${sc.id.padEnd(12)} ${sc.label.padEnd(22)} 추적 ${String(hit).padStart(3)}/${total} (HIGH ${high})  평균 z ${row.z.toFixed(1).padStart(5)}  원본 대비 데이터 변화 평균 ${row.drift.toFixed(2)} / 최대 ${maxd}`);
}
console.log(`\n오지목 ${wrong}건, A5 놓침 ${a5miss}건`);

// ---- 규모 효과: 데이터 표가 큰 제품이라면? (합성 데이터 표 N 개, mark 42, 조합마다 10회) ----
console.log("\n=== 규모 효과: 데이터 값 개수 N 별, 잡음 ±k 에서의 추적률 ===");
const KS = [1, 2, 3, 5, 8, 12, 20, 30];
const scale = [];
for (const N of [64, 256, 1024, 4096]) {
  const vals = []; for (let i = 0; i < N; i++) vals.push(10 + Math.floor(rng() * 190));
  const rowsTxt = []; for (let i = 0; i < N; i += 4) rowsTxt.push("[" + vals.slice(i, i + 4).join(", ") + "]");
  const code = `var BALANCE = [${rowsTxt.join(", ")}];\nfunction tick(s) { return BALANCE[s % BALANCE.length][0]; }\n`;
  const ref = wm.semanticReference(code), marked = wm.insert(code, 42);
  const line = { N, rates: [], drift: [] };
  for (const k of KS) {
    let hit = 0, d = 0;
    for (let t = 0; t < 10; t++) {
      const leak = atk.semanticScrub(marked, { k, rng });
      const r = wm.extract(leak, { reference: ref });
      if (r.decision === "IDENTIFIED" && r.markId === 42) hit++; else if (r.decision === "IDENTIFIED") wrong++;
      d += dataDrift(leak, ref).mean;
    }
    line.rates.push(hit * 10); line.drift.push(d / 10);
  }
  const ei = line.rates.findIndex((r) => r < 50);
  line.evadeK = ei >= 0 ? KS[ei] : null; line.evadeDrift = ei >= 0 ? line.drift[ei] : null;
  scale.push(line);
  console.log(`N=${String(N).padStart(4)}  ` + KS.map((k, i) => `±${k}:${String(line.rates[i]).padStart(3)}%`).join("  ") +
    `  → 50% 미만 잡음 ±${line.evadeK ?? ">30"} (그때 원본 대비 평균 변화 ${line.evadeDrift != null ? line.evadeDrift.toFixed(1) : "-"})`);
}
const md = ["# L8 시맨틱 지문 vs 층을 아는 공격자 (자동 생성: `node tests/semantic-attack.js`)", "",
  `게임 3개 × 협력사 3곳, 잡음 공격은 조합마다 ${TRIALS}회 무작위 반복. 지문 빌드 자체의 데이터 변화량은 평균 1.00(값마다 ±1).`, "",
  "| 공격 | 내용 | 추적 성공 | 그중 HIGH | 평균 상관 z | 원본 대비 데이터 변화 (평균 / 최대) |", "|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.id} | ${r.label} | ${r.hit}/${r.total} (${Math.round((100 * r.hit) / r.total)}%) | ${r.high} | ${r.z.toFixed(1)} | ${r.drift.toFixed(2)} / ${r.maxd} |`),
  "", `오지목 ${wrong}건. z ≥ 5 일 때만 지목(255개 mark 전체 검사 기준 우연 확률 ≈ 7×10⁻⁵).`,
  "데이터 변화 단위는 게임마다 px(낙하 x, 비행 높이, 발판·씨앗·딱정벌레 좌표), 프레임(낙하 간격), %(비행 속도).",
  "", "## 규모 효과 (합성 데이터 표, mark 42, 조합마다 10회)", "",
  "| 데이터 값 개수 N | " + KS.map((k) => `±${k}`).join(" | ") + " | 추적률 50% 미만이 되는 잡음 | 그때 원본 대비 평균 변화 |",
  "|---|" + KS.map(() => "---").join("|") + "|---|---|",
  ...scale.map((l) => `| ${l.N} | ${l.rates.map((r) => r + "%").join(" | ")} | ±${l.evadeK ?? ">30"} | ${l.evadeDrift != null ? l.evadeDrift.toFixed(1) : "-"} |`),
  "", "z 는 √N 에 비례한다. 데이터 표가 클수록 지문을 지우는 데 필요한 잡음이 커지고, 그만큼 제품이 원본에서 멀어진다."];
fs.writeFileSync(path.join(ROOT, "RESULTS-L8.md"), md.join("\n") + "\n");
console.log(`\n최종 오지목 ${wrong}건`);
process.exit(wrong || a5miss ? 1 : 0);
