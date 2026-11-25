// 게임 3개(원본 + 워터마크 빌드)를 가짜 DOM/canvas 에서 600 프레임씩 돌려 예외 없이 진행되는지 확인
//   node tests/smoke-games.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const wm = require("../lambda/lib/watermark");

function run(code, script) {
  const listeners = {};
  let raf = null, fills = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === "fillRect" ? () => fills++ : () => {})), set: (t, k, v) => ((t[k] = v), true) });
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx, addEventListener: (n, f) => ((listeners["c:" + n] = f)),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) };
  const sandbox = {
    Math, console,
    document: { getElementById: () => canvas, title: "" },
    requestAnimationFrame: (f) => { raf = f; },
  };
  sandbox.window = { addEventListener: (n, f) => ((listeners[n] = f)) };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  listeners.load();
  const key = (type, k) => listeners[type] && listeners[type]({ key: k, preventDefault() {} });
  for (let f = 0; f < 600; f++) {
    script(f, key, listeners);
    const cb = raf; raf = null; cb();
  }
  return { fills, title: sandbox.document.title };
}

const scripts = {
  "comet-shower": (f, key) => { key(f % 120 < 60 ? "keydown" : "keyup", "ArrowLeft"); },
  "lantern-range": (f, key, L) => { if (f % 30 === 0) { L["c:pointermove"]({ clientX: 200, clientY: 150 }); L["c:pointerdown"]({ clientX: 200, clientY: 150 }); } },
  "moss-hop": (f, key) => { key(f % 50 < 25 ? "keydown" : "keyup", f % 100 < 50 ? "ArrowRight" : "ArrowLeft"); key(f % 40 === 0 ? "keydown" : "keyup", " "); },
};
let bad = 0;
for (const g of Object.keys(scripts)) {
  const src = fs.readFileSync(path.join(__dirname, "..", "games", g, "game.js"), "utf8");
  for (const [label, code] of [["원본", src], ["mark 42 빌드", wm.insert(src, 42)]]) {
    try {
      const r = run(code, scripts[g]);
      console.log(`PASS ${g.padEnd(14)} ${label.padEnd(10)} 600프레임, fillRect ${r.fills}회, title="${r.title}"`);
    } catch (e) { bad++; console.log(`FAIL ${g} ${label}: ${e.stack}`); }
  }
}
process.exit(bad ? 1 : 0);
