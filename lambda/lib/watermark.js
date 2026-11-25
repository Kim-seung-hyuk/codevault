// watermark.js — CodeVault 4층 워터마크 (poc/watermark.js 를 일반화)
//
//   L1  zero-width 문자 주석                 16비트 코드워드 (주석 제거에 약함)
//   L2  최상위 함수 선언 순서 (Lehmer 순열)    16비트 코드워드
//   L3  GAME_CONFIG 키 순서 (Lehmer 순열)      8비트 mark_id (태그 없음 → 보조 단서)
//   L4  PALETTE 8색 blue 채널 하위 2비트       16비트 코드워드 (minify+mangle 생존)
//
// 코드워드 = (mark_id << 8) | HMAC-SHA256(secret, mark_id)[0]
// PoC 대비 변경점
//   - 비밀키를 환경변수 WM_SECRET 에서 읽음 (insert/extract 모두 옵션으로 덮어쓰기 가능)
//   - 층별 "자기검증"(태그 일치)을 먼저 보고, 실패할 때만 PoC 방식 비트 다수결로 보조 복원
//   - 태그 후보가 하나도 없으면 절대 식별하지 않음 (PoC 의 tagStar=0 우연일치 구멍 제거)
//   - analyze(): 업로드된 게임이 워터마크 요구사항을 만족하는지 검사

const acorn = require("acorn");
const { generate } = require("astring");
const crypto = require("crypto");

const DEFAULT_SECRET = "codevault-demo-secret-v1";
const ZW0 = "​"; // zero-width space      -> bit 0
const ZW1 = "‌"; // zero-width non-joiner -> bit 1
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const PARSE_OPTS = { ecmaVersion: 2022, sourceType: "script" };

function secretOf(opts) {
  return (opts && opts.secret) || process.env.WM_SECRET || DEFAULT_SECRET;
}
function tagFor(id, secret) {
  return crypto.createHmac("sha256", secret || secretOf()).update(String(id & 0xff)).digest()[0];
}
function codeword(id, secret) {
  return ((id & 0xff) << 8) | tagFor(id, secret);
}

// ---------- Lehmer code ----------
function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
function intToPerm(value, n) {
  const avail = []; for (let i = 0; i < n; i++) avail.push(i);
  const perm = []; let v = value;
  for (let i = n; i >= 1; i--) {
    const f = factorial(i - 1);
    const idx = Math.floor(v / f); v %= f;
    perm.push(avail.splice(idx, 1)[0]);
  }
  return perm;
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

// ---------- AST helpers ----------
function parse(code) { return acorn.parse(code, PARSE_OPTS); }
function tryParse(code) { try { return parse(code); } catch { return null; } }

function fnFingerprint(node) { return node.params.length * 1000 + node.body.body.length; }
function topFunctions(ast) {
  const out = [];
  ast.body.forEach((n, i) => { if (n.type === "FunctionDeclaration") out.push({ node: n, bodyIndex: i }); });
  return out;
}
function canonicalOrder(fns) {
  const withFp = fns.map((f) => ({ ...f, fp: fnFingerprint(f.node) }));
  const sorted = [...withFp].sort((a, b) => a.fp - b.fp);
  const distinct = new Set(sorted.map((s) => s.fp)).size === sorted.length;
  sorted.forEach((s, r) => (s.rank = r));
  return { sorted, distinct };
}
function findTopDecl(ast, name, initType) {
  for (const n of ast.body) {
    if (n.type !== "VariableDeclaration") continue;
    for (const d of n.declarations) {
      if (d.id.type === "Identifier" && d.id.name === name && d.init && d.init.type === initType) return d.init;
    }
  }
  return null;
}
const keyName = (p) => (p.key.type === "Identifier" ? p.key.name : String(p.key.value));
function collectHexColors(ast) {
  const colors = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Literal" && typeof node.value === "string" && HEX6.test(node.value)) colors.push(node.value);
    for (const k in node) {
      if (k === "loc" || k === "start" || k === "end") continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v);
    }
  })(ast);
  return colors;
}

// ================= ANALYZE (업로드 검증) =================
function analyze(code) {
  const issues = [];
  const ast = tryParse(code);
  if (!ast) return { ok: false, issues: ["JS 파싱 실패"], functions: [], configKeys: [], palette: [] };
  const fns = topFunctions(ast);
  const { distinct } = canonicalOrder(fns);
  const functions = fns.map((f) => ({
    name: f.node.id.name, params: f.node.params.length, stmts: f.node.body.body.length, fp: fnFingerprint(f.node),
  }));
  if (fns.length < 10 || fns.length > 12) issues.push(`최상위 함수가 ${fns.length}개 (요구: 10~12개)`);
  if (!distinct) {
    const seen = {};
    functions.forEach((f) => (seen[f.fp] = (seen[f.fp] || []).concat(f.name)));
    const dup = Object.values(seen).filter((v) => v.length > 1).map((v) => v.join("/"));
    issues.push(`(파라미터 수, 문장 수) 지문 중복: ${dup.join(", ")}`);
  }
  const cfg = findTopDecl(ast, "GAME_CONFIG", "ObjectExpression");
  const configKeys = cfg ? cfg.properties.map(keyName) : [];
  if (!cfg) issues.push("GAME_CONFIG 객체 없음");
  else if (configKeys.length !== 8) issues.push(`GAME_CONFIG 키가 ${configKeys.length}개 (요구: 8개)`);
  else if (new Set(configKeys).size !== 8) issues.push("GAME_CONFIG 키 이름 중복");
  const pal = findTopDecl(ast, "PALETTE", "ArrayExpression");
  const palette = pal ? pal.elements.map((e) => (e && e.type === "Literal" ? e.value : null)) : [];
  if (!pal) issues.push("PALETTE 배열 없음");
  else if (palette.length !== 8 || !palette.every((c) => typeof c === "string" && HEX6.test(c)))
    issues.push("PALETTE 는 '#rrggbb' 8색이어야 함");
  // L4 는 소스 순서상 처음 8개 hex 색을 읽으므로 PALETTE 앞에 다른 hex 색이 있으면 안 됨
  const allHex = collectHexColors(ast);
  if (pal && palette.length === 8 && allHex.slice(0, 8).join() !== palette.join())
    issues.push("PALETTE 보다 앞에 다른 '#rrggbb' 문자열이 있음 (L4 추출 불가)");
  if (allHex.length > 8) issues.push(`PALETTE 밖에 hex 색 문자열 ${allHex.length - 8}개 (PALETTE 참조로 바꿀 것)`);
  const capacityBits = fns.length ? Math.floor(Math.log2(factorial(fns.length))) : 0;
  return { ok: issues.length === 0, issues, functions, configKeys, palette, capacityBits };
}

// ================= INSERT =================
function insert(code, markId, opts) {
  if (!(markId >= 1 && markId <= 255)) throw new Error(`mark_id 범위 밖: ${markId} (1~255)`);
  const secret = secretOf(opts);
  const cw = codeword(markId, secret);
  const ast = parse(code);

  // L2: 함수 순서
  const fns = topFunctions(ast);
  const { sorted, distinct } = canonicalOrder(fns);
  if (!distinct) throw new Error("함수 지문 중복 — L2 삽입 불가");
  const perm = intToPerm(cw % factorial(fns.length), fns.length);
  const byRank = {}; sorted.forEach((s) => (byRank[s.rank] = s.node));
  const slots = fns.map((f) => f.bodyIndex).sort((a, b) => a - b);
  slots.forEach((slotIdx, k) => { ast.body[slotIdx] = byRank[perm[k]]; });

  // L3: GAME_CONFIG 키 순서
  const cfg = findTopDecl(ast, "GAME_CONFIG", "ObjectExpression");
  if (cfg) {
    const m = cfg.properties.length;
    const keysSorted = cfg.properties.map((p) => ({ p, key: keyName(p) })).sort((a, b) => (a.key < b.key ? -1 : 1));
    const perm3 = intToPerm(markId % factorial(m), m);
    cfg.properties = perm3.map((r) => keysSorted[r].p);
  }

  // L4: PALETTE blue 하위 2비트
  const pal = findTopDecl(ast, "PALETTE", "ArrayExpression");
  if (pal) {
    for (let i = 0; i < pal.elements.length && i < 8; i++) {
      const el = pal.elements[i];
      if (!(el && el.type === "Literal" && typeof el.value === "string" && HEX6.test(el.value))) continue;
      const bits = (cw >> (i * 2)) & 0x3;
      const hex = el.value.slice(1);
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16);
      const b = (parseInt(hex.slice(4, 6), 16) & ~0x3) | bits;
      const nhex = "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
      el.value = nhex; el.raw = JSON.stringify(nhex);
    }
  }

  // L1: zero-width 주석
  let zw = "";
  for (let i = 15; i >= 0; i--) zw += (cw >> i) & 1 ? ZW1 : ZW0;
  return "//" + zw + "\n" + generate(ast);
}

// ================= EXTRACT =================
function extractL1(code) {
  const m = code.match(/[​‌]{16}/);
  if (!m) return null;
  return [...m[0]].reduce((a, c) => (a << 1) | (c === ZW1 ? 1 : 0), 0);
}
function extractL2(ast) {
  if (!ast) return null;
  const fns = topFunctions(ast);
  if (fns.length < 2) return null;
  const { sorted, distinct } = canonicalOrder(fns);
  if (!distinct) return null;
  const rankOf = new Map(); sorted.forEach((s) => rankOf.set(s.node, s.rank));
  return permToInt(fns.map((f) => rankOf.get(f.node))) % 65536;
}
function extractL3(ast) {
  if (!ast) return null;
  const cfg = findTopDecl(ast, "GAME_CONFIG", "ObjectExpression");
  if (!cfg || cfg.properties.length < 2) return null;
  const keys = cfg.properties.map(keyName);
  const sorted = [...keys].sort();
  const rankMap = new Map(); sorted.forEach((k, r) => rankMap.set(k, r));
  return permToInt(keys.map((k) => rankMap.get(k))) % 256;
}
function extractL4(ast) {
  if (!ast) return null;
  const colors = collectHexColors(ast);
  if (colors.length < 8) return null;
  let cw = 0;
  for (let i = 0; i < 8; i++) cw |= (parseInt(colors[i].slice(5, 7), 16) & 0x3) << (i * 2);
  return cw;
}
function voteBits(cands, nbits) {
  let out = 0;
  for (let i = 0; i < nbits; i++) {
    let ones = 0, total = 0;
    for (const v of cands) { if (v == null) continue; total++; if ((v >> i) & 1) ones++; }
    if (total && ones * 2 > total) out |= 1 << i;
  }
  return out;
}

const LAYER_INFO = {
  L1: { name: "zero-width 주석", bits: 16 },
  L2: { name: "함수 선언 순서", bits: 16 },
  L3: { name: "GAME_CONFIG 키 순서", bits: 8 },
  L4: { name: "PALETTE 색 하위비트", bits: 16 },
};

/**
 * 유출본 분석.
 * decision: IDENTIFIED | NO_RELIABLE_MARK | CONFLICT
 * confidence: HIGH (독립 2층 이상 일치) | MEDIUM (1층 태그 검증) | NONE
 * chanceMatch: 무관한 파일이 우연히 같은 결과를 낼 확률(대략)
 */
function extract(code, opts) {
  const secret = secretOf(opts);
  const ast = tryParse(code);
  const raw = { L1: extractL1(code), L2: extractL2(ast), L3: extractL3(ast), L4: extractL4(ast) };

  const layers = {};
  for (const k of ["L1", "L2", "L4"]) {
    const v = raw[k];
    if (v == null) { layers[k] = { ...LAYER_INFO[k], present: false }; continue; }
    const id = (v >> 8) & 0xff, tag = v & 0xff;
    const tagOk = id >= 1 && tag === tagFor(id, secret);
    layers[k] = { ...LAYER_INFO[k], present: true, raw: v, id, tag, tagOk };
  }
  layers.L3 = raw.L3 == null
    ? { ...LAYER_INFO.L3, present: false }
    : { ...LAYER_INFO.L3, present: true, raw: raw.L3, id: raw.L3, tagOk: null };

  const valid = ["L1", "L2", "L4"].filter((k) => layers[k].present && layers[k].tagOk);
  const validIds = [...new Set(valid.map((k) => layers[k].id))];

  let decision = "NO_RELIABLE_MARK", markId = null, method = null, agreeing = [];
  if (validIds.length > 1) {
    decision = "CONFLICT"; // 서로 다른 태그 검증 결과 → 지목하지 않음
  } else if (validIds.length === 1) {
    decision = "IDENTIFIED"; markId = validIds[0]; method = "layer-tag";
    agreeing = valid.slice();
  } else {
    // 보조: PoC 방식 비트 다수결. 우연일치를 줄이려고 L3(독립 채널)가 같은 id 를 가리킬 때만 채택
    //       (안 그러면 무표식 파일 오탐률이 약 1/256 만큼 늘어난다 — tests/run-matrix.js 3번 항목)
    const cws = ["L1", "L2", "L4"].filter((k) => layers[k].present).map((k) => layers[k].raw);
    if (cws.length >= 2) {
      const idCands = cws.map((v) => (v >> 8) & 0xff);
      if (raw.L3 != null) idCands.push(raw.L3);
      const idStar = voteBits(idCands, 8);
      const tagStar = voteBits(cws.map((v) => v & 0xff), 8);
      if (idStar >= 1 && tagStar === tagFor(idStar, secret) && raw.L3 === idStar) {
        decision = "IDENTIFIED"; markId = idStar; method = "bit-vote";
      }
    }
  }
  if (decision === "IDENTIFIED" && layers.L3.present && layers.L3.id === markId) agreeing.push("L3");
  for (const k of Object.keys(layers)) if (layers[k].present) layers[k].agrees = decision === "IDENTIFIED" && layers[k].id === markId;

  // 신뢰도: 태그로 검증된 독립 층 수 + L3 일치
  const strength = decision === "IDENTIFIED"
    ? (method === "layer-tag" ? valid.length + (agreeing.includes("L3") ? 0.5 : 0) : 1)
    : 0;
  const confidence = strength >= 1.5 ? "HIGH" : strength >= 1 ? "MEDIUM" : "NONE";
  // 우연일치 확률: 8비트 태그 1층당 1/256, L3 일치 시 추가 1/256
  let chanceMatch = null;
  if (decision === "IDENTIFIED") {
    const tagLayers = method === "layer-tag" ? valid.length : 1;
    chanceMatch = Math.pow(1 / 256, tagLayers) * (agreeing.includes("L3") ? 1 / 256 : 1);
  }
  const l3Hint = decision !== "IDENTIFIED" && layers.L3.present ? layers.L3.id : null;

  return {
    decision, markId, method, confidence, chanceMatch,
    survivingLayers: Object.values(layers).filter((l) => l.present).length,
    agreeingLayers: agreeing,
    l3Hint, parsed: !!ast, layers,
  };
}

module.exports = {
  insert, extract, analyze, codeword, tagFor,
  fnFingerprint, topFunctions, canonicalOrder, parse,
  _internal: { intToPerm, permToInt, factorial, voteBits },
};
