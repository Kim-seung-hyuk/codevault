// watermark.js - insert/extract a 4-layer watermark for attribution (leak tracing)
// Layers:
//   L1  zero-width chars in a leading comment      (weak; dies on comment-strip/minify)
//   L2  top-level function declaration order        (Lehmer rank, 16 bits)
//   L3  config object key order                     (Lehmer rank, 8-bit ID only)
//   L4  palette color low-bits                      (2 bits/color x 8 = 16 bits)
// Payload = 8-bit customerId + 8-bit HMAC tag.

const acorn = require("acorn");
const { generate } = require("astring");
const crypto = require("crypto");

const SECRET = "codevault-demo-secret-v1";
const ZW0 = "​"; // zero-width space  -> bit 0
const ZW1 = "‌"; // zero-width non-joiner -> bit 1

function tagFor(id) {
  const h = crypto.createHmac("sha256", SECRET).update(String(id & 0xff)).digest();
  return h[0]; // 8-bit tag
}
function codeword(id) { return ((id & 0xff) << 8) | tagFor(id); } // 16 bits: ID<<8 | TAG

// ---------- Lehmer code (permutation <-> integer) ----------
function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
function intToPerm(value, n) {
  const avail = []; for (let i = 0; i < n; i++) avail.push(i);
  const perm = []; let v = value;
  for (let i = n; i >= 1; i--) {
    const f = factorial(i - 1);
    const idx = Math.floor(v / f); v = v % f;
    perm.push(avail.splice(idx, 1)[0]);
  }
  return perm; // perm[k] = canonical index placed at source position k
}
function permToInt(perm) {
  const n = perm.length;
  const avail = []; for (let i = 0; i < n; i++) avail.push(i);
  let v = 0;
  for (let k = 0; k < n; k++) {
    const idx = avail.indexOf(perm[k]);
    v += idx * factorial(n - 1 - k);
    avail.splice(idx, 1);
  }
  return v;
}

// ---------- structural fingerprint (rename-invariant identity of a function) ----------
function fnFingerprint(node) {
  const params = node.params.length;
  const stmts = node.body.body.length;
  return params * 1000 + stmts;
}
function topFunctions(ast) {
  const out = [];
  ast.body.forEach((n, i) => { if (n.type === "FunctionDeclaration") out.push({ node: n, bodyIndex: i }); });
  return out;
}
// canonical order = functions sorted by fingerprint (stable). Returns array of {node,bodyIndex,rank}
function canonicalOrder(fns) {
  const withFp = fns.map((f) => ({ ...f, fp: fnFingerprint(f.node) }));
  const sorted = [...withFp].sort((a, b) => a.fp - b.fp);
  const distinct = new Set(sorted.map((s) => s.fp)).size === sorted.length;
  sorted.forEach((s, r) => (s.rank = r));
  return { sorted, distinct, map: withFp };
}

// ---------- config object helpers ----------
function findConfigObject(ast) {
  for (const n of ast.body) {
    if (n.type === "VariableDeclaration") {
      for (const d of n.declarations) {
        if (d.id.name === "GAME_CONFIG" && d.init && d.init.type === "ObjectExpression") return d.init;
      }
    }
  }
  return null;
}
function findPaletteArray(ast) {
  for (const n of ast.body) {
    if (n.type === "VariableDeclaration") {
      for (const d of n.declarations) {
        if (d.id.name === "PALETTE" && d.init && d.init.type === "ArrayExpression") return d.init;
      }
    }
  }
  return null;
}

// ================= INSERT =================
function insert(code, customerId) {
  const cw = codeword(customerId); // 16-bit
  const ast = acorn.parse(code, { ecmaVersion: 2020 });

  // ---- L2: reorder top-level functions to encode 16-bit codeword as Lehmer rank
  const fns = topFunctions(ast);
  const { sorted } = canonicalOrder(fns);
  const n = fns.length;
  const maxRank = factorial(n);
  const rank2 = cw % maxRank;
  const perm = intToPerm(rank2, n); // perm[position] = canonical rank to place there
  // canonical-rank -> node
  const byRank = {}; sorted.forEach((s) => (byRank[s.rank] = s.node));
  const newFnOrder = perm.map((r) => byRank[r]);
  // write functions back into the same body slots (in source-body order) they occupied
  const slots = fns.map((f) => f.bodyIndex).sort((a, b) => a - b);
  slots.forEach((slotIdx, k) => { ast.body[slotIdx] = newFnOrder[k]; });

  // ---- L3: reorder GAME_CONFIG keys to encode 8-bit ID as Lehmer rank
  const cfg = findConfigObject(ast);
  if (cfg) {
    const m = cfg.properties.length;
    const keysSorted = [...cfg.properties].map((p, i) => ({ p, key: p.key.name || p.key.value, i }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    const rank3 = (customerId & 0xff) % factorial(m);
    const perm3 = intToPerm(rank3, m);
    const byKeyRank = {}; keysSorted.forEach((s, r) => (byKeyRank[r] = s.p));
    cfg.properties = perm3.map((r) => byKeyRank[r]);
  }

  // ---- L4: encode 16-bit codeword into palette color low-bits (2 bits/color, blue channel)
  const pal = findPaletteArray(ast);
  if (pal) {
    for (let i = 0; i < pal.elements.length && i < 8; i++) {
      const el = pal.elements[i];
      if (el && el.type === "Literal" && typeof el.value === "string" && /^#?[0-9a-fA-F]{6}$/.test(el.value)) {
        const bits = (cw >> (i * 2)) & 0x3; // 2 bits for this color
        let hex = el.value.replace("#", "");
        let r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
        b = (b & ~0x3) | bits; // put 2 bits into blue low bits
        const nhex = "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
        el.value = nhex; el.raw = JSON.stringify(nhex);
      }
    }
  }

  let out = generate(ast);

  // ---- L1: prepend zero-width codeword in a comment (weak layer)
  let zw = "";
  for (let i = 15; i >= 0; i--) zw += (cw >> i) & 1 ? ZW1 : ZW0;
  out = "//" + zw + "\n" + out;
  return out;
}

// ================= EXTRACT =================
function bitsToNum(bits) { return bits.reduce((a, b) => (a << 1) | b, 0); }

function extractL1(code) {
  const m = code.match(/[​‌]{16}/);
  if (!m) return null;
  const bits = [...m[0]].map((c) => (c === ZW1 ? 1 : 0));
  return bitsToNum(bits); // 16-bit codeword
}
function extractL2(code) {
  let ast; try { ast = acorn.parse(code, { ecmaVersion: 2020 }); } catch { return null; }
  const fns = topFunctions(ast);
  if (fns.length < 2) return null;
  const { sorted, distinct } = canonicalOrder(fns);
  if (!distinct) return null; // fingerprints collided -> unreliable
  const rankOf = new Map(); sorted.forEach((s) => rankOf.set(s.node, s.rank));
  const perm = fns.map((f) => rankOf.get(f.node));
  const value = permToInt(perm);
  return value < 65536 ? value : value % 65536; // 16-bit codeword candidate
}
function extractL3(code) {
  let ast; try { ast = acorn.parse(code, { ecmaVersion: 2020 }); } catch { return null; }
  const cfg = findConfigObject(ast);
  if (!cfg) return null;
  const keys = cfg.properties.map((p) => p.key.name || p.key.value);
  const sorted = [...keys].sort();
  const rankMap = new Map(); sorted.forEach((k, r) => rankMap.set(k, r));
  const perm = keys.map((k) => rankMap.get(k));
  const id = permToInt(perm);
  return id < 256 ? id : id % 256; // 8-bit ID candidate
}
function extractL4(code) {
  let ast; try { ast = acorn.parse(code, { ecmaVersion: 2020 }); } catch { return null; }
  // find all hex color string literals, in source order, take first 8
  const colors = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Literal" && typeof node.value === "string" && /^#[0-9a-fA-F]{6}$/.test(node.value)) colors.push(node.value);
    for (const k in node) { const v = node[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v); }
  })(ast);
  if (colors.length < 8) return null;
  let cw = 0;
  for (let i = 0; i < 8; i++) {
    const b = parseInt(colors[i].slice(5, 7), 16) & 0x3;
    cw |= b << (i * 2);
  }
  return cw; // 16-bit codeword candidate
}

// Majority vote per bit across candidates; candidates are {value,bits}
function voteBits(cands, nbits) {
  const votes = new Array(nbits).fill(0), total = new Array(nbits).fill(0);
  for (const v of cands) {
    if (v == null) continue;
    for (let i = 0; i < nbits; i++) { total[i]++; if ((v >> i) & 1) votes[i]++; }
  }
  let out = 0;
  for (let i = 0; i < nbits; i++) if (total[i] && votes[i] * 2 >= total[i] && votes[i] * 2 > total[i] - 0.0001) { if (votes[i] * 2 > total[i]) out |= 1 << i; }
  // simple strict majority
  out = 0;
  for (let i = 0; i < nbits; i++) if (total[i] && votes[i] * 2 > total[i]) out |= 1 << i;
  return out;
}

function extract(code) {
  const l1 = extractL1(code); // 16-bit cw
  const l2 = extractL2(code); // 16-bit cw
  const l3 = extractL3(code); // 8-bit id
  const l4 = extractL4(code); // 16-bit cw

  const layers = { L1: l1, L2: l2, L3: l3, L4: l4 };

  // ID candidates (8-bit): from L1/L2/L4 take high byte; L3 is id directly
  const idCands = [];
  if (l1 != null) idCands.push((l1 >> 8) & 0xff);
  if (l2 != null) idCands.push((l2 >> 8) & 0xff);
  if (l3 != null) idCands.push(l3 & 0xff);
  if (l4 != null) idCands.push((l4 >> 8) & 0xff);
  // TAG candidates (8-bit): from L1/L2/L4 low byte
  const tagCands = [];
  if (l1 != null) tagCands.push(l1 & 0xff);
  if (l2 != null) tagCands.push(l2 & 0xff);
  if (l4 != null) tagCands.push(l4 & 0xff);

  const idStar = voteBits(idCands, 8);
  const tagStar = voteBits(tagCands, 8);

  const expectTag = tagFor(idStar);
  const tagOk = tagStar === expectTag;

  // confidence: fraction of surviving ID layers agreeing with idStar
  const agree = idCands.filter((v) => v === idStar).length;
  const confidence = idCands.length ? agree / idCands.length : 0;

  return {
    layers,
    idCands,
    idStar,
    tagStar,
    expectTag,
    tagOk,
    survivingLayers: Object.values(layers).filter((v) => v != null).length,
    confidence,
    decision: tagOk && idCands.length >= 1 && confidence >= 0.5 ? "IDENTIFIED" : "NO_RELIABLE_MARK",
  };
}

module.exports = { insert, extract, codeword, tagFor, fnFingerprint, topFunctions, canonicalOrder, acornParse: (c) => acorn.parse(c, { ecmaVersion: 2020 }) };
