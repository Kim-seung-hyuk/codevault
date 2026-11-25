// semantic.js — L8 시맨틱 지문: 게임플레이 데이터 표(정수 배열)의 값을 협력사별 ±1 패턴만큼 움직인다.
//
// 왜 지우기 어려운가: 다른 층은 "바꿔도 동작이 같은 자리"에 있어 공격자가 비용 없이 원래대로 정리할 수 있었다.
//   L8 은 낙하 위치·비행 경로·발판 좌표 같은 실제 게임 데이터라, 원본을 모르는 공격자는 되돌릴 수 없고
//   지우려면 우리 패턴보다 큰 잡음을 넣어야 한다 → 게임이 원본과 눈에 띄게 달라진다.
// 검출(비블라인드, 확산 스펙트럼): 원본 값(빌드 때 저장한 레퍼런스)과 유출본의 차이 o 를 구하고,
//   각 mark m 의 비밀 패턴 p_m(±1) 과의 정규화 상관 z_m = Σ o·p_m / √Σo² 를 계산한다.
//   o 가 p_m 과 무관하면 z_m ~ N(0,1) 이므로 z ≥ 5 일 때만 지목한다 (mark 255개 전체 검사 기준 우연 확률 ≈ 7×10⁻⁵).
//   공격자의 잡음이 어떤 분포든 이 영가설 분포는 그대로라 오지목 확률이 보장된다.
const crypto = require("crypto");

const MIN_CARRIER = 4;       // 이보다 작은 값(0, 1, 2 …)은 의미가 커서 건드리지 않음
const Z_THRESHOLD = 5;

// ---------- 숫자 상수 접기 (난독화가 숫자를 식으로 바꿔도 값 복원) ----------
function fold(n) {
  if (!n) return null;
  if (n.type === "Literal" && typeof n.value === "number") return n.value;
  if (n.type === "UnaryExpression" && (n.operator === "-" || n.operator === "+")) {
    const v = fold(n.argument); return v == null ? null : n.operator === "-" ? -v : v;
  }
  if (n.type === "BinaryExpression" && "+-*/".includes(n.operator)) {
    const a = fold(n.left), b = fold(n.right);
    if (a == null || b == null) return null;
    return n.operator === "+" ? a + b : n.operator === "-" ? a - b : n.operator === "*" ? a * b : a / b;
  }
  if (n.type === "ParenthesizedExpression") return fold(n.expression);
  return null;
}
// 배열 노드 → 행 목록 (평평한 정수 배열은 행 1칸짜리로) / 정수가 아니면 null
function tableOf(arr) {
  if (!arr || arr.type !== "ArrayExpression" || arr.elements.length < 2) return null;
  const rows = [];
  for (const el of arr.elements) {
    if (el && el.type === "ArrayExpression") {
      const row = el.elements.map(fold);
      if (!row.length || row.some((v) => v == null || !Number.isInteger(v))) return null;
      rows.push({ values: row, nodes: el.elements });
    } else {
      const v = fold(el);
      if (v == null || !Number.isInteger(v)) return null;
      rows.push({ values: [v], nodes: [el] });
    }
  }
  return rows;
}

/** 원본 코드의 데이터 표 레퍼런스 (최상위 var 의 정수 배열, PALETTE 제외) */
function reference(ast) {
  const tables = [];
  for (const n of ast.body) {
    if (n.type !== "VariableDeclaration") continue;
    for (const d of n.declarations) {
      if (d.id.type !== "Identifier" || d.id.name === "PALETTE") continue;
      const rows = tableOf(d.init);
      if (rows) tables.push({ name: d.id.name, rows: rows.map((r) => r.values) });
    }
  }
  const carriers = tables.reduce((s, t) => s + t.rows.flat().filter((v) => Math.abs(v) >= MIN_CARRIER).length, 0);
  return { tables, carriers };
}

/** mark 별 비밀 ±1 패턴 (길이 n) */
function pattern(markId, n, secret) {
  const out = new Int8Array(n);
  let buf = Buffer.alloc(0), block = 0;
  for (let i = 0; i < n; i++) {
    if ((i >> 3) >= buf.length) buf = Buffer.concat([buf, crypto.createHmac("sha256", secret).update(`L8:${markId}:${block++}`).digest()]);
    out[i] = (buf[i >> 3] >> (i & 7)) & 1 ? 1 : -1;
  }
  return out;
}

/** 삽입: 원본 AST 의 데이터 표 정수를 패턴만큼 움직인다. 반환: 레퍼런스(원본 값) */
function embed(ast, markId, secret) {
  const ref = reference(ast);
  const p = pattern(markId, ref.carriers, secret);
  let i = 0;
  for (const n of ast.body) {
    if (n.type !== "VariableDeclaration") continue;
    for (const d of n.declarations) {
      if (d.id.type !== "Identifier" || d.id.name === "PALETTE") continue;
      const rows = tableOf(d.init);
      if (!rows) continue;
      for (const r of rows) r.nodes.forEach((node, c) => {
        const v = r.values[c];
        if (Math.abs(v) < MIN_CARRIER) return;
        const nv = v + p[i++];
        node.type = "Literal"; node.value = nv; node.raw = String(nv);
        delete node.operator; delete node.argument; delete node.left; delete node.right;
      });
    }
  }
  return ref;
}

// 유출본에서 레퍼런스 표와 같은 모양의 표를 찾아 행 단위로 맞춘다 (행 순서를 섞어도 됨)
function alignOffsets(ast, ref) {
  const leaked = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "ArrayExpression") { const t = tableOf(n); if (t) { leaked.push(t.map((r) => r.values)); return; } }
    for (const k in n) { if (k === "loc") continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v); }
  })(ast);
  const offsets = [], used = new Set();
  let matchedTables = 0;
  for (const t of ref.tables) {
    const shape = t.rows.map((r) => r.length).sort().join(",");
    let best = null;
    leaked.forEach((L, li) => {
      if (used.has(li) || L.length !== t.rows.length || L.map((r) => r.length).sort().join(",") !== shape) return;
      // 행 맞추기 ① 순서 그대로 (대부분의 유출본은 행 순서를 유지 — 행이 많을 때 탐욕 매칭의 오정렬을 피한다)
      const rowCost = (a, b) => (a.length !== b.length ? Infinity : a.reduce((s, v, j) => s + Math.abs(v - b[j]), 0));
      const inOrder = t.rows.reduce((s, row, r) => s + rowCost(row, L[r]), 0);
      const total = t.rows.flat().length;
      if (inOrder / total < 20) {
        if (!best || inOrder < best.cost) best = { li, pairs: L, cost: inOrder };
        return;
      }
      // ② 행이 섞였으면: 원본 행마다 가장 가까운 남은 행
      const free = L.map((r, k) => k), pairs = [];
      let cost = 0;
      for (const row of t.rows) {
        let bk = -1, bc = Infinity;
        for (const k of free) {
          if (L[k].length !== row.length) continue;
          const c = row.reduce((s, v, j) => s + Math.abs(v - L[k][j]), 0);
          if (c < bc) { bc = c; bk = k; }
        }
        free.splice(free.indexOf(bk), 1); pairs.push(L[bk]); cost += bc;
      }
      const avg = cost / t.rows.flat().length;
      if (avg < 20 && (!best || cost < best.cost)) best = { li, pairs, cost };
    });
    const carrierRows = t.rows;
    if (!best) { carrierRows.flat().forEach((v) => { if (Math.abs(v) >= MIN_CARRIER) offsets.push(null); }); continue; }
    used.add(best.li); matchedTables++;
    carrierRows.forEach((row, r) => row.forEach((v, c) => { if (Math.abs(v) >= MIN_CARRIER) offsets.push(best.pairs[r][c] - v); }));
  }
  return { offsets, matchedTables };
}

function normalTail(z) { // P(Z ≥ z) = erfc(z/√2)/2  (Numerical Recipes erfcc)
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return z >= 0 ? y / 2 : 1 - y / 2;
}

/** 검출: 레퍼런스 대비 차이와 mark 1~255 패턴의 상관. 반환 null = 표를 못 찾음 */
function detect(ast, ref, secret) {
  if (!ast || !ref || !ref.carriers) return null;
  const { offsets, matchedTables } = alignOffsets(ast, ref);
  if (!matchedTables) return null;
  const idx = offsets.map((o, i) => (o == null ? -1 : i)).filter((i) => i >= 0);
  const energy = idx.reduce((s, i) => s + offsets[i] * offsets[i], 0);
  const changed = idx.filter((i) => offsets[i] !== 0).length;
  if (!energy) return { present: true, id: null, z: 0, second: 0, carriers: idx.length, changed: 0, tagOk: false, note: "원본 값과 같음 (지문 없음)" };
  let best = { id: null, z: -Infinity }, second = -Infinity;
  for (let m = 1; m <= 255; m++) {
    const p = pattern(m, ref.carriers, secret);
    let dot = 0; for (const i of idx) dot += offsets[i] * p[i];
    const z = dot / Math.sqrt(energy);
    if (z > best.z) { second = best.z; best = { id: m, z }; } else if (z > second) second = z;
  }
  const ok = best.z >= Z_THRESHOLD;
  return {
    present: true, id: best.id, z: Math.round(best.z * 100) / 100, second: Math.round(second * 100) / 100,
    carriers: idx.length, changed, tagOk: ok,
    chance: ok ? Math.min(1, 255 * normalTail(best.z)) : null,
    meanAbsOffset: Math.round((idx.reduce((s, i) => s + Math.abs(offsets[i]), 0) / idx.length) * 100) / 100,
  };
}

module.exports = { reference, embed, detect, pattern, fold, alignOffsets, Z_THRESHOLD, MIN_CARRIER };
