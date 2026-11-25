// attacks.js - transformations a leaker might apply to erase the watermark
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
  const ast = acorn.parse(code, { ecmaVersion: 2020 });
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

module.exports = { stripComments, terserMangle, beautifyAndEdit, obfuscate };
