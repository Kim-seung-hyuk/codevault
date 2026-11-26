// build-lambda-zip.js — Lambda 업로드용 zip 을 만든다 → dist/codevault-lambda.zip
//   node tools/build-lambda-zip.js
// 런타임 의존성(acorn, astring, fflate)만 넣는다. @aws-sdk/client-s3 는 optional 이고 Lambda 런타임(nodejs22.x)에 내장이라 뺀다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-lambda-"));
for (const f of ["index.js", "extract-cli.js", "package.json", "package-lock.json"]) fs.copyFileSync(path.join(ROOT, "lambda", f), path.join(tmp, f));
// fs.cpSync 는 Windows 한글 경로에서 오류 없이 프로세스를 끝내는 경우가 있어 직접 복사한다
(function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n), d = path.join(dst, n);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.writeFileSync(d, fs.readFileSync(s));
  }
})(path.join(ROOT, "lambda", "lib"), path.join(tmp, "lib"));
execSync("npm ci --omit=dev --omit=optional --no-audit --no-fund", { cwd: tmp, stdio: "inherit" });

const { zipSync } = require(path.join(ROOT, "lambda", "node_modules", "fflate"));
const files = {};
(function add(dir, rel) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n), r = rel ? `${rel}/${n}` : n;
    if (fs.statSync(p).isDirectory()) add(p, r); else if (r !== "package-lock.json") files[r] = new Uint8Array(fs.readFileSync(p));
  }
})(tmp, "");
fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
const out = path.join(ROOT, "dist", "codevault-lambda.zip");
fs.writeFileSync(out, zipSync(files, { level: 9 }));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`생성: ${path.relative(process.cwd(), out)} (${Object.keys(files).length}개 파일, ${fs.statSync(out).size.toLocaleString()} B) — 핸들러 index.handler, 런타임 Node.js 22.x`);
