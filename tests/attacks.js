// attacks.js (poc/attacks.js 재사용) - transformations a leaker might apply to erase the watermark
const acorn = require("acorn");
const { generate } = require("astring");
const { minify } = require("terser");
const JSObf = require("javascript-obfuscator");

// A1: strip comments + whitespace only (no mangling)
async function stripComments(code) {
  const r = await minify(code, { compress: false, mangle: false, format: { comments: false, beautify: true } });
  return r.code;
}
// A2: full terser minify + mangle (incl. toplevel names)
async function terserMangle(code) {
  const r = await minify(code, { compress: true, mangle: { toplevel: true }, format: { comments: false } });
  return r.code;
}
// A3: beautify + manual edits: reorder 2 functions AND recolor 2 palette entries
function beautifyAndEdit(code) {
  const ast = acorn.parse(code, { ecmaVersion: 2022 });
  // reorder two top-level functions (swap first two FunctionDeclarations encountered)
  const idx = [];
  ast.body.forEach((n, i) => { if (n.type === "FunctionDeclaration") idx.push(i); });
  if (idx.length >= 4) {
    const a = idx[1], b = idx[2];
    const t = ast.body[a]; ast.body[a] = ast.body[b]; ast.body[b] = t;
  }
  // recolor 2 palette entries to a new theme (attacker "reskins")
  for (const n of ast.body) {
    if (n.type === "VariableDeclaration") for (const d of n.declarations) {
      if (d.id.name === "PALETTE" && d.init && d.init.elements) {
        const repl = { 1: "#2a1f3d", 4: "#55b08a" };
        d.init.elements.forEach((el, i) => { if (repl[i]) { el.value = repl[i]; el.raw = JSON.stringify(repl[i]); } });
      }
    }
  }
  return generate(ast);
}
// A4: heavy obfuscation
function obfuscate(code) {
  return JSObf.obfuscate(code, {
    compact: true, controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true, deadCodeInjectionThreshold: 0.4, stringArray: true,
    stringArrayEncoding: ["base64"], stringArrayThreshold: 0.8, numbersToExpressions: true,
    simplify: true, transformObjectKeys: true, renameGlobals: true,
  }).getObfuscatedCode();
}

// A5: 층을 아는 공격자 — 알려진 지문 위치를 전부 흔든다 (난독화 없이 원본 구조를 유지)
//   주석·공백 재생성, 함수 순서 셔플, 설정 키 알파벳 정렬, 소수 상수 4자리 반올림, 팔레트 하위비트 덮어쓰기
function informedScrub(code) {
  const ast = acorn.parse(code, { ecmaVersion: 2022 });
  const slots = [], fns = [];
  ast.body.forEach((n, i) => { if (n.type === "FunctionDeclaration") { slots.push(i); fns.push(n); } });
  fns.reverse();
  slots.forEach((s, k) => (ast.body[s] = fns[k]));
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "ObjectExpression" && n.properties.length === 8) n.properties.sort((a, b) => ((a.key.name || a.key.value) < (b.key.name || b.key.value) ? -1 : 1));
    if (n.type === "Literal" && typeof n.value === "number" && !Number.isInteger(n.value)) { n.value = Math.round(n.value * 1e4) / 1e4; n.raw = String(n.value); }
    if (n.type === "Literal" && typeof n.value === "string" && /^#[0-9a-f]{6}$/i.test(n.value)) {
      const v = n.value.slice(0, 5) + ((parseInt(n.value.slice(5), 16) & 0xfc) | 1).toString(16).padStart(2, "0");
      n.value = v; n.raw = JSON.stringify(v);
    }
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v); }
  })(ast);
  return generate(ast);
}

module.exports = { stripComments, terserMangle, beautifyAndEdit, obfuscate, informedScrub };
