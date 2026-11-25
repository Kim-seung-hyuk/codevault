// watermark.js — CodeVault 6층 워터마크 (poc/watermark.js 를 일반화·확장)
//
//   층  위치                                   페이로드             태그  주로 살아남는 공격
//   L1  zero-width 문자 주석                    코드워드 16비트       8비트  그대로 유출
//   L2  최상위 함수 선언 순서 (Lehmer 순열)       코드워드 16비트       8비트  주석·공백 제거
//   L3  설정 객체(GAME_CONFIG) 키 순서            mark 8 + 태그 7비트   7비트  주석 제거·minify·수동 편집
//   L4  PALETTE 8색 blue 하위 2비트              코드워드 16비트       8비트  minify+mangle
//   L5  소수 상수의 가수 최하위 24비트            리터럴마다 코드워드   8비트  minify·함수 이동·색 변경
//   L6  줄 끝 공백 패턴 (줄 내용 해시로 슬롯 결정)  코드워드 16비트       8비트  주석만 손으로 지운 경우
//
// 코드워드 = (mark_id << 8) | HMAC-SHA256(secret, mark_id)[0]
// 판정: 태그가 검증된 층들을 mark 별로 묶어 가중치(8비트 태그 = 1, L3 의 7비트 태그 = 0.5)를 더한다.
//   1 이상인 묶음이 하나뿐이면 IDENTIFIED, 다른 mark 묶음이 같거나 더 무거우면 CONFLICT, 그 밖은 NO_RELIABLE_MARK.
//   L3 단독(0.5)으로는 지목하지 않는다.

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
function hmacByte(secret, msg) {
  return crypto.createHmac("sha256", secret).update(msg).digest()[0];
}
function tagFor(id, secret) { return hmacByte(secret || secretOf(), String(id & 0xff)); }
function codeword(id, secret) { return ((id & 0xff) << 8) | tagFor(id, secret); }
function tag7For(id, secret) { return hmacByte(secret || secretOf(), "L3:" + (id & 0xff)) & 0x7f; }
const splitCw = (cw, secret) => {
  const id = (cw >> 8) & 0xff, tag = cw & 0xff;
  return { id, tag, tagOk: id >= 1 && tag === tagFor(id, secret) };
};

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
function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const k in node) {
    if (k === "loc" || k === "start" || k === "end") continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn)); else if (v && typeof v === "object") walk(v, fn);
  }
}

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
function topDeclarators(ast) {
  const out = [];
  for (const n of ast.body) if (n.type === "VariableDeclaration") out.push(...n.declarations);
  return out;
}
function findTopDecl(ast, name, initType) {
  const d = topDeclarators(ast).find((d) => d.id.type === "Identifier" && d.id.name === name && d.init && d.init.type === initType);
  return d ? d.init : null;
}
const keyName = (p) => (p.key.type === "Identifier" ? p.key.name : String(p.key.value));
const isLiteralValue = (v) => v && (v.type === "Literal" || (v.type === "UnaryExpression" && v.argument.type === "Literal"));
// L3 후보: 최상위 변수에 담긴, 값이 모두 리터럴인 8키 객체 (minify 로 이름이 바뀌어도 찾는다)
function configCandidates(ast) {
  const named = [], others = [];
  for (const d of topDeclarators(ast)) {
    const o = d.init;
    if (!o || o.type !== "ObjectExpression" || o.properties.length !== 8) continue;
    if (!o.properties.every((p) => p.type === "Property" && !p.computed && isLiteralValue(p.value))) continue;
    (d.id.name === "GAME_CONFIG" ? named : others).push(o);
  }
  return named.concat(others);
}
function collectHexColors(ast) {
  const colors = [];
  walk(ast, (n) => { if (n.type === "Literal" && typeof n.value === "string" && HEX6.test(n.value)) colors.push(n.value); });
  return colors;
}

// ---------- L5: 소수 리터럴 가수 하위 24비트 ----------
// 하위 24비트 = [검사 8비트 | 코드워드 16비트]. 검사값은 리터럴의 "기본값"(하위 24비트를 지운 값)에 대한 HMAC 이라
// 원래 숫자는 1/256 확률로만 통과하고, 리터럴 위치·순서와 무관하게 각자 코드워드 전체를 싣는다.
// 값 변화는 상대 2^-28(약 4e-9) 이하라 게임 동작에는 영향이 없다. 단, 소스에 긴 소수(2.2000000041…)로 보인다.
const F64 = new Float64Array(1), U64 = new BigUint64Array(F64.buffer);
const LOW24 = (1n << 24n) - 1n;
const toBits = (v) => { F64[0] = v; return U64[0]; };
const fromBits = (b) => { U64[0] = b; return F64[0]; };
const l5Eligible = (v) => typeof v === "number" && isFinite(v) && !Number.isInteger(v) && v > 1e-6 && v < 1e6;
const l5Check = (base, secret) => hmacByte(secret, "L5:" + base.toString(16));
function l5Encode(v, cw, secret) {
  const base = toBits(v) & ~LOW24;
  return fromBits(base | (BigInt(l5Check(base, secret)) << 16n) | BigInt(cw));
}
function l5Decode(v, secret) {
  const b = toBits(v), base = b & ~LOW24, low = Number(b & LOW24);
  return (low >> 16) === l5Check(base, secret) ? low & 0xffff : null;
}

// ---------- L6: 줄 끝 공백 ----------
// 줄 내용(앞뒤 공백 제외)의 FNV 해시로 슬롯(0~15)을 정하고, 그 슬롯의 코드워드 비트를 줄 끝 문자로 적는다.
// 공백 ' ' = 0, 탭 '\t' = 1. 줄을 옮기거나 일부 지워도 남은 줄들이 다수결로 비트를 복원한다.
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
function l6Embed(text, cw) {
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    return line.replace(/[ \t]+$/, "") + (((cw >> (fnv(t) % 16)) & 1) ? "\t" : " ");
  }).join("\n");
}

// ================= ANALYZE (업로드 검증) =================
function analyze(code) {
  const issues = [], notes = [];
  const ast = tryParse(code);
  if (!ast) return { ok: false, issues: ["JS 파싱 실패"], notes, functions: [], configKeys: [], palette: [], floats: 0 };
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
  else if (!cfg.properties.every((p) => isLiteralValue(p.value))) issues.push("GAME_CONFIG 값은 모두 리터럴이어야 함");
  const pal = findTopDecl(ast, "PALETTE", "ArrayExpression");
  const palette = pal ? pal.elements.map((e) => (e && e.type === "Literal" ? e.value : null)) : [];
  if (!pal) issues.push("PALETTE 배열 없음");
  else if (palette.length !== 8 || !palette.every((c) => typeof c === "string" && HEX6.test(c)))
    issues.push("PALETTE 는 '#rrggbb' 8색이어야 함");
  const allHex = collectHexColors(ast);
  if (pal && palette.length === 8 && allHex.slice(0, 8).join() !== palette.join())
    issues.push("PALETTE 보다 앞에 다른 '#rrggbb' 문자열이 있음 (L4 추출 불가)");
  if (allHex.length > 8) issues.push(`PALETTE 밖에 hex 색 문자열 ${allHex.length - 8}개 (PALETTE 참조로 바꿀 것)`);
  let floats = 0;
  walk(ast, (n) => { if (n.type === "Literal" && l5Eligible(n.value)) floats++; });
  if (floats < 3) notes.push(`소수 상수가 ${floats}개뿐 — L5 층이 약함 (3개 이상 권장)`);
  const capacityBits = fns.length ? Math.floor(Math.log2(factorial(fns.length))) : 0;
  return { ok: issues.length === 0, issues, notes, functions, configKeys, palette, floats, capacityBits };
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

  // L3: GAME_CONFIG 키 순서 = Lehmer(mark 8비트 | 태그 7비트)  (8! = 40320 ≥ 2^15)
  const cfg = findTopDecl(ast, "GAME_CONFIG", "ObjectExpression");
  if (cfg && cfg.properties.length === 8) {
    const keysSorted = cfg.properties.map((p) => ({ p, key: keyName(p) })).sort((a, b) => (a.key < b.key ? -1 : 1));
    const perm3 = intToPerm((markId << 7) | tag7For(markId, secret), 8);
    cfg.properties = perm3.map((r) => keysSorted[r].p);
  }

  // L4: PALETTE blue 하위 2비트
  const pal = findTopDecl(ast, "PALETTE", "ArrayExpression");
  const palNodes = new Set();
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
      palNodes.add(el);
    }
  }

  // L5: 모든 소수 리터럴
  walk(ast, (n) => {
    if (n.type === "Literal" && l5Eligible(n.value)) {
      const v = l5Encode(n.value, cw, secret);
      n.value = v; n.raw = String(v);
    }
  });

  // L6: 줄 끝 공백,  L1: zero-width 주석
  let zw = "";
  for (let i = 15; i >= 0; i--) zw += (cw >> i) & 1 ? ZW1 : ZW0;
  return "//" + zw + "\n" + l6Embed(generate(ast), cw);
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
// L3: 후보 객체마다 해독해서 태그가 맞는 첫 후보를 쓴다. 맞는 게 없으면 첫 후보 값을 그대로 보고(present, tagOk=false)
function extractL3(ast, secret) {
  if (!ast) return null;
  let first = null;
  for (const o of configCandidates(ast)) {
    const keys = o.properties.map(keyName);
    if (new Set(keys).size !== 8) continue;
    const sorted = [...keys].sort();
    const v = permToInt(keys.map((k) => sorted.indexOf(k)));
    const id = v >> 7, tag = v & 0x7f;
    const r = { raw: v, id: id & 0xff, tag, tagOk: id >= 1 && id <= 255 && tag === tag7For(id, secret) };
    if (r.tagOk) return r;
    if (!first) first = r;
  }
  return first;
}
function extractL4(ast) {
  if (!ast) return null;
  const colors = collectHexColors(ast);
  if (colors.length < 8) return null;
  let cw = 0;
  for (let i = 0; i < 8; i++) cw |= (parseInt(colors[i].slice(5, 7), 16) & 0x3) << (i * 2);
  return cw;
}
// L5: 검사값을 통과한 리터럴들의 코드워드 중 최다값
function extractL5(ast, secret) {
  if (!ast) return null;
  const counts = new Map();
  let total = 0;
  walk(ast, (n) => {
    if (n.type !== "Literal" || !l5Eligible(n.value)) return;
    total++;
    const cw = l5Decode(n.value, secret);
    if (cw != null) counts.set(cw, (counts.get(cw) || 0) + 1);
  });
  if (!counts.size) return null;
  const [cw, votes] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { raw: cw, votes, total };
}
// L6: 줄 끝 공백 1글자가 있는 줄들의 슬롯별 다수결. 16슬롯이 모두 채워져야 읽힌 것으로 본다
function extractL6(code) {
  const ones = new Array(16).fill(0), tot = new Array(16).fill(0);
  let lines = 0;
  for (const line of code.split(/\r?\n/)) {
    const m = line.match(/\S([ \t])$/);
    if (!m) continue;
    const s = fnv(line.trim()) % 16;
    tot[s]++; lines++;
    if (m[1] === "\t") ones[s]++;
  }
  if (lines < 16 || tot.some((t) => t === 0)) return null;
  let cw = 0;
  for (let s = 0; s < 16; s++) if (ones[s] * 2 > tot[s]) cw |= 1 << s;
  return { raw: cw, lines };
}

const LAYER_INFO = {
  L1: { name: "zero-width 주석", bits: 16, tagBits: 8 },
  L2: { name: "함수 선언 순서", bits: 16, tagBits: 8 },
  L3: { name: "설정 객체 키 순서", bits: 15, tagBits: 7 },
  L4: { name: "PALETTE 색 하위비트", bits: 16, tagBits: 8 },
  L5: { name: "소수 상수 미세값", bits: 16, tagBits: 8 },
  L6: { name: "줄 끝 공백 패턴", bits: 16, tagBits: 8 },
};
const weightOf = (k) => (LAYER_INFO[k].tagBits >= 8 ? 1 : 0.5);

/**
 * 유출본 분석.
 * decision: IDENTIFIED | NO_RELIABLE_MARK | CONFLICT
 * confidence: HIGH (가중치 합 1.5 이상, 반대 층 없음) | MEDIUM (1 이상) | NONE
 * chanceMatch: 무관한 파일이 우연히 같은 결과를 낼 확률(대략) = 일치한 층들의 태그 우연일치 확률의 곱
 */
function extract(code, opts) {
  const secret = secretOf(opts);
  const ast = tryParse(code);
  const layers = {};
  const put = (k, info) => { layers[k] = info ? { ...LAYER_INFO[k], present: true, ...info } : { ...LAYER_INFO[k], present: false }; };

  const l1 = extractL1(code); put("L1", l1 == null ? null : { raw: l1, ...splitCw(l1, secret) });
  const l2 = extractL2(ast); put("L2", l2 == null ? null : { raw: l2, ...splitCw(l2, secret) });
  put("L3", extractL3(ast, secret));
  const l4 = extractL4(ast); put("L4", l4 == null ? null : { raw: l4, ...splitCw(l4, secret) });
  const l5 = extractL5(ast, secret); put("L5", l5 && { ...l5, ...splitCw(l5.raw, secret) });
  const l6 = extractL6(code); put("L6", l6 && { ...l6, ...splitCw(l6.raw, secret) });

  // mark 별 가중치 합
  const groups = new Map();
  for (const [k, l] of Object.entries(layers)) {
    if (!l.present || !l.tagOk) continue;
    const g = groups.get(l.id) || { id: l.id, weight: 0, layers: [] };
    g.weight += weightOf(k); g.layers.push(k);
    groups.set(l.id, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.weight - a.weight);
  const best = ranked[0], second = ranked[1];

  let decision = "NO_RELIABLE_MARK", markId = null, confidence = "NONE", chanceMatch = null, agreeing = [], dissenting = [];
  if (best && best.weight >= 1) {
    if (second && second.weight >= best.weight) {
      decision = "CONFLICT";
    } else {
      decision = "IDENTIFIED"; markId = best.id; agreeing = best.layers;
      dissenting = ranked.slice(1).flatMap((g) => g.layers);
      confidence = best.weight >= 1.5 && !dissenting.length ? "HIGH" : "MEDIUM";
      chanceMatch = agreeing.reduce((p, k) => p / Math.pow(2, LAYER_INFO[k].tagBits), 1);
    }
  }
  for (const l of Object.values(layers)) if (l.present) l.agrees = decision === "IDENTIFIED" && l.tagOk && l.id === markId;
  const l3Hint = decision !== "IDENTIFIED" && layers.L3.present && layers.L3.tagOk ? layers.L3.id : null;

  return {
    decision, markId, confidence, chanceMatch, method: decision === "IDENTIFIED" ? "layer-tag" : null,
    survivingLayers: Object.values(layers).filter((l) => l.present).length,
    agreeingLayers: agreeing, dissentingLayers: dissenting,
    l3Hint, parsed: !!ast, layers,
  };
}

module.exports = {
  insert, extract, analyze, codeword, tagFor,
  fnFingerprint, topFunctions, canonicalOrder, parse,
  LAYER_INFO,
  _internal: { intToPerm, permToInt, factorial, l5Encode, l5Decode, l5Eligible, fnv },
};
