// gen-complex-app.js — 복잡도를 조절할 수 있는 "RPG 전투 시뮬레이터" 앱 생성기 (복잡도 실험용)
//   node tools/gen-complex-app.js <데이터 값 개수 N> <함수 개수 F> [-o out.js] [--seed 1]
// 구성: 몬스터·아이템·스킬·스테이지 데이터 표(정수 N 개), 서로 다른 (파라미터 수, 문장 수) 지문을 가진 보조 함수 F 개,
//       GAME_CONFIG(8키, 소수 포함)·PALETTE(8색). simulate(seed) 가 모든 표와 함수를 실제로 써서 전투 결과를 낸다.
// 동작 비교: battleOutcomes(code) → 전투마다 승패 배열. 원본과 비교해 "승패가 뒤바뀐 전투 비율"로 앱이 망가진 정도를 잰다.
const fs = require("fs");
const vm = require("vm");

function makeRng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); }

function generate(N, F, seed = 1) {
  const rnd = makeRng(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  // 데이터 표(모두 수치형 — ID·인덱스로 쓰는 값은 L8 대상이 아님): 몬스터 [hp, atk, def, spd, gold] 40%, 아이템 [atk, def, spd, price] 25%,
  // 스킬 [power, cost, hits] 20%, 스테이지 [몬스터 hp 보정, 영웅 hp 보정, 골드 보너스, 보스 배율 %] 15%
  const tables = [
    { name: "MONSTERS", cols: 5, share: 0.4, gen: () => [ri(110, 530), ri(28, 92), ri(4, 30), ri(5, 40), ri(5, 90)] },
    { name: "ITEMS", cols: 4, share: 0.25, gen: () => [ri(4, 40), ri(4, 30), ri(4, 20), ri(10, 400)] },
    { name: "SKILLS", cols: 3, share: 0.2, gen: () => [ri(10, 90), ri(4, 40), ri(4, 6)] },
    { name: "STAGES", cols: 4, share: 0.15, gen: () => [ri(4, 60), ri(4, 40), ri(5, 50), ri(80, 130)] },
  ];
  const tableSrc = tables.map((t) => {
    const rows = Math.max(2, Math.round((N * t.share) / t.cols));
    const lines = [];
    for (let r = 0; r < rows; r++) lines.push("  [" + t.gen().join(", ") + "]");
    return `var ${t.name} = [\n${lines.join(",\n")}\n];`;
  }).join("\n\n");

  // 보조 함수 F 개: (params, stmts) 쌍이 모두 다르게. params 0~4, stmts 1~.
  const fns = [];
  const pairs = [];
  for (let s = 1; pairs.length < F; s++) for (let p = 1; p <= 4 && pairs.length < F; p++) pairs.push([p, s]);
  pairs.forEach(([p, s], i) => {
    const args = ["a", "b", "c", "d"].slice(0, p);
    const body = [];
    for (let k = 0; k < s - 1; k++) {
      const x = args[k % p];
      body.push(`  ${x} = (${x} * ${ri(3, 9)} + ${ri(1, 17)} + ${i}) % ${ri(97, 211)};`);
    }
    body.push(`  return (${args.join(" + ")} + ${i}) % 13;`);
    fns.push(`function mod${i}(${args.join(", ")}) {\n${body.join("\n")}\n}`);
  });
  // 디스패처: 보조 함수를 모두 호출 (실제로 쓰임)
  const calls = pairs.map(([p], i) => `mod${i}(${["x", "y", "z", "w"].slice(0, p).join(", ")})`);
  const dispatcher = `function modifiers(x, y, z, w) {\n  var total = 0;\n${calls.map((c) => `  total += ${c};`).join("\n")}\n  return total % 21;\n}`;

  // 코어 함수 (이름 고정, 지문은 보조 함수와 겹치지 않도록 params 5+ 또는 고유 문장 수)
  const core = `
function battle(hero, mon, skill, item, rng5) {
  var hp = hero[0] + item[1] * 3, mhp = mon[0], turns = 0;
  var atk = hero[1] + item[0], def = hero[2] + item[1], spd = hero[3] + item[2];
  while (hp > 0 && mhp > 0 && turns < 60) {
    turns++;
    var mods = modifiers(turns, mon[1], skill[0], item[3]);
    var dmg = Math.max(1, Math.floor((atk + skill[0] * (turns % skill[2] === 0 ? 1 : 0)) * GAME_CONFIG.critScale) - mon[2] + mods % 5 - skill[1] % 3);
    if (spd + rng5() * 10 >= mon[3]) { mhp -= dmg; if (mhp > 0) hp -= Math.max(1, mon[1] - def); }
    else { hp -= Math.max(1, mon[1] - def); if (hp > 0) mhp -= dmg; }
  }
  return mhp <= 0 && hp > 0 ? turns : -turns;
}

function simulate(seed, outcomes, gold, party, depth, log) {
  for (var s = 0; s < STAGES.length; s++) {
    var st = STAGES[s];
    for (var e = 0; e < 4; e++) {
      var base = MONSTERS[(s * 7 + e * 13) % MONSTERS.length];
      var mon = [Math.floor((base[0] + st[0]) * (e === 3 ? st[3] : 100) / 100), base[1], base[2], base[3], base[4]];
      var skill = SKILLS[(s + e) % SKILLS.length];
      var item = ITEMS[(s * 3 + e) % ITEMS.length];
      var hero = [GAME_CONFIG.heroHp + st[1], GAME_CONFIG.heroAtk + party, GAME_CONFIG.heroDef, GAME_CONFIG.heroSpd];
      var bs = (seed * 7919 + s * 131 + e * 17) >>> 0;
      var rng5 = function () { bs = (bs * 1103515245 + 12345) >>> 0; return bs / 4294967296; };
      var r = battle(hero, mon, skill, item, rng5);
      outcomes.push(r > 0 ? 1 : 0);
      if (r > 0) gold += mon[4] + st[2];
    }
  }
  log.push(gold);
  return outcomes;
}`;

  const header = `// 합성 앱 (N=${N} 데이터 값, F=${F} 보조 함수) — CodeVault 복잡도 실험용. 실제 제품의 밸런스 표·레벨 데이터를 흉내 낸다.
var GAME_CONFIG = {
  title: "Synthetic RPG",
  heroHp: 160,
  heroAtk: 26,
  heroDef: 10,
  heroSpd: 22,
  critScale: 1.15,
  lootRate: 0.35,
  version: 3
};

var PALETTE = ["#101820", "#28323c", "#3c5a78", "#7896b4", "#f0c850", "#e06040", "#f4f4f4", "#50a070"];
`;
  const footer = `
if (typeof module !== "undefined") module.exports = { simulate: simulate };
`;
  return [header, tableSrc, "", fns.join("\n\n"), "", dispatcher, core, footer].join("\n");
}

/** 코드를 실행해 전투 승패 배열을 얻는다 (시드 여러 개) */
function battleOutcomes(code, seeds = [1, 2, 3, 4, 5]) {
  const sb = { Math, module: { exports: {} } };
  vm.createContext(sb);
  vm.runInContext(code, sb, { timeout: 20000 });
  let sim = sb.module.exports.simulate || sb.simulate;
  if (!sim) {
    // 이름이 바뀐 빌드(minify 등): 인자 6개짜리 최상위 함수 중 배열을 돌려주는 것을 찾는다
    for (const k of Object.keys(sb)) if (typeof sb[k] === "function" && sb[k].length === 6) { sim = sb[k]; break; }
  }
  if (!sim) throw new Error("simulate 함수를 찾지 못함");
  const out = [];
  for (const s of seeds) out.push(...sim(s, [], 0, 4, 8, []));
  return out;
}
const flipRate = (a, b) => { const n = Math.min(a.length, b.length); let f = Math.abs(a.length - b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) f++; return f / Math.max(a.length, b.length); };

module.exports = { generate, battleOutcomes, flipRate };

if (require.main === module) {
  const args = process.argv.slice(2);
  const oi = args.indexOf("-o"); const out = oi >= 0 ? args.splice(oi, 2)[1] : null;
  const si = args.indexOf("--seed"); const seed = si >= 0 ? +args.splice(si, 2)[1] : 1;
  const [N = 1024, F = 30] = args.map(Number);
  const code = generate(N, F, seed);
  if (out) { fs.writeFileSync(out, code); console.log(`생성: ${out} (${code.split("\n").length}줄, ${code.length}B)`); } else process.stdout.write(code);
}
