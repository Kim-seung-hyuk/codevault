// pkg.js — 게임 패키지(zip) 읽기/쓰기 + 워터마크 빌드 생성
const { unzipSync, zipSync, strToU8, strFromU8 } = require("fflate");
const crypto = require("crypto");
const path = require("path");
const wm = require("./watermark");

class ValidationError extends Error {
  constructor(msg, details) { super(msg); this.name = "ValidationError"; this.details = details; }
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".zip": "application/zip",
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** zip 버퍼 → { "index.html": Uint8Array, ... } (공통 최상위 폴더와 __MACOSX 제거) */
function readPackage(buf) {
  let entries;
  try { entries = unzipSync(new Uint8Array(buf)); } catch (e) { throw new ValidationError("zip 해제 실패: " + e.message); }
  const files = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || path.basename(name).startsWith("._")) continue;
    if (name.includes("..")) throw new ValidationError("잘못된 경로: " + name);
    files[name.replace(/\\/g, "/")] = data;
  }
  const names = Object.keys(files);
  if (!names.length) throw new ValidationError("빈 zip");
  const first = names[0].split("/")[0] + "/";
  if (names.every((n) => n.startsWith(first) && n.length > first.length)) {
    const stripped = {};
    for (const n of names) stripped[n.slice(first.length)] = files[n];
    return stripped;
  }
  return files;
}

function readManifest(files) {
  if (!files["manifest.json"]) throw new ValidationError("manifest.json 없음");
  let m;
  try { m = JSON.parse(strFromU8(files["manifest.json"])); } catch { throw new ValidationError("manifest.json 파싱 실패"); }
  const targets = (m.watermark && m.watermark.targets) || [];
  if (!targets.length) throw new ValidationError("manifest.watermark.targets 비어 있음");
  for (const t of targets) if (!files[t]) throw new ValidationError(`워터마크 대상 파일 없음: ${t}`);
  if (!files[m.entry || "index.html"]) throw new ValidationError(`entry 파일 없음: ${m.entry || "index.html"}`);
  return m;
}

/** 패키지 검증 → { manifest, files, analysis:{target: analyze()} } */
function inspectPackage(buf) {
  const files = readPackage(buf);
  const manifest = readManifest(files);
  const analysis = {};
  for (const t of manifest.watermark.targets) {
    const a = wm.analyze(strFromU8(files[t]));
    analysis[t] = { ok: a.ok, issues: a.issues, functions: a.functions.length, capacityBits: a.capacityBits };
    if (!a.ok) throw new ValidationError(`${t} 가 워터마크 요구사항 미충족: ${a.issues.join("; ")}`, analysis);
  }
  return { files, manifest, analysis };
}

/** 한 협력사용 빌드: 대상 JS 에 mark 삽입 → 자체 추출로 검증 → 파일맵 + zip */
function buildFor(pkg, markId, opts) {
  const out = {};
  for (const [name, data] of Object.entries(pkg.files)) out[name] = data;
  for (const t of pkg.manifest.watermark.targets) {
    const marked = wm.insert(strFromU8(pkg.files[t]), markId, opts);
    const check = wm.extract(marked, opts);
    if (check.decision !== "IDENTIFIED" || check.markId !== markId || check.survivingLayers !== 4)
      throw new Error(`자체 검증 실패 (${t}, mark ${markId})`);
    out[t] = strToU8(marked);
  }
  const zip = Buffer.from(zipSync(out, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") }));
  return { files: out, zip, sha256: sha256(zip) };
}

/** 유출본(파일 하나) → 추출 대상 JS 텍스트 목록 */
function leakSources(buf, filename) {
  const lower = (filename || "").toLowerCase();
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip || lower.endsWith(".zip")) {
    const files = readPackage(buf);
    let targets = [];
    try { targets = readManifest(files).watermark.targets; } catch { /* manifest 없이 유출될 수 있음 */ }
    const names = targets.length ? targets : Object.keys(files).filter((n) => n.endsWith(".js"));
    return names.filter((n) => files[n]).map((n) => ({ name: n, code: strFromU8(files[n]) }));
  }
  const text = Buffer.from(buf).toString("utf8");
  if (lower.endsWith(".html") || /^\s*<(!doctype|html)/i.test(text)) {
    const scripts = [...text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    return scripts.map((code, i) => ({ name: `inline-script-${i + 1}`, code }));
  }
  return [{ name: filename || "leak.js", code: text }];
}

module.exports = { ValidationError, readPackage, readManifest, inspectPackage, buildFor, leakSources, mimeOf, sha256 };
