#!/usr/bin/env node
// 유출본 추출 CLI — EC2 웹앱이 subprocess 로 호출한다 (Lambda 와 같은 lib 사용).
//   node extract-cli.js <파일경로> [원래파일명]   → stdout 에 JSON 리포트
// 파일은 .js / .html(인라인 스크립트) / .zip(게임 패키지) / .png(스크린샷 → L7 출력 지문) 모두 가능. 여러 JS 가 있으면 각각 추출 후
// 식별된 결과 중 가장 신뢰도 높은 것을 대표로 고른다. 서로 다른 mark 가 나오면 CONFLICT.
const fs = require("fs");
const wm = require("./lib/watermark");
const { leakSources } = require("./lib/pkg");
const { isPNG, extractImage } = require("./lib/outputmark");

const RANK = { HIGH: 2, MEDIUM: 1, NONE: 0 };

function analyzeLeak(buf, filename) {
  // 스크린샷(PNG) → L7 출력 지문
  if (isPNG(buf)) {
    try { return extractImage(buf); } catch (e) { return { kind: "image", decision: "NO_RELIABLE_MARK", error: e.message, marks: [], canvases: [] }; }
  }
  let sources;
  try { sources = leakSources(buf, filename); } catch (e) { return { decision: "NO_RELIABLE_MARK", error: e.message, sources: [] }; }
  const per = sources.map((s) => ({ name: s.name, bytes: Buffer.byteLength(s.code), ...wm.extract(s.code) }));
  const identified = per.filter((r) => r.decision === "IDENTIFIED");
  const marks = [...new Set(identified.map((r) => r.markId))];
  let best = null, decision = "NO_RELIABLE_MARK";
  if (marks.length > 1) decision = "CONFLICT";
  else if (marks.length === 1) {
    decision = "IDENTIFIED";
    best = identified.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.survivingLayers - a.survivingLayers)[0];
  } else if (per.some((r) => r.decision === "CONFLICT")) decision = "CONFLICT";
  const rep = best || per.slice().sort((a, b) => b.survivingLayers - a.survivingLayers)[0] || null;
  return {
    kind: "code", decision, markId: best ? best.markId : null, confidence: best ? best.confidence : "NONE",
    chanceMatch: best ? best.chanceMatch : null, representative: rep ? rep.name : null,
    layers: rep ? rep.layers : null, l3Hint: rep ? rep.l3Hint : null, method: best ? best.method : null,
    sources: per.map((r) => ({ name: r.name, bytes: r.bytes, parsed: r.parsed, decision: r.decision, markId: r.markId, confidence: r.confidence, survivingLayers: r.survivingLayers })),
  };
}

if (require.main === module) {
  const [file, name] = process.argv.slice(2);
  if (!file) { console.error("usage: node extract-cli.js <file> [original-name]"); process.exit(2); }
  process.stdout.write(JSON.stringify(analyzeLeak(fs.readFileSync(file), name || file)));
}
module.exports = { analyzeLeak };
