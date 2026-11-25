// CodeVault 워터마크 Lambda
// 트리거: S3 ObjectCreated, prefix "uploads/"  (키 형식: uploads/<job_id>/<파일명>.zip)
// 입력 : jobs/<job_id>/spec.json  ← EC2 가 presigned URL 발급 전에 써 둔 작업 명세
//        { "job_id": "...", "builds": [ { "mark_id": 17, "label": "partner-b" }, ... ] }
// 출력 : outputs/<job_id>/<mark_id>/files/<경로>   (나란히 플레이용, 개별 파일)
//        outputs/<job_id>/<mark_id>/<slug>-<label>.zip  (다운로드용)
// 실패 : failed/<job_id>/error.json (+ 원본 사본)  → EC2 콜백 FAILED
//        검증 오류(잘못된 패키지)는 재시도해도 같으므로 throw 하지 않음.
//        그 밖의 오류(S3/네트워크)는 throw → Lambda 비동기 재시도(최대 2회). 산출물 키가 고정이라 재실행해도 멱등.
// 환경변수: WM_SECRET, CALLBACK_URL, CALLBACK_SECRET, (BUCKET), STORAGE_MODE=s3|local

const { openStorage } = require("./lib/storage");
const { inspectPackage, buildFor, mimeOf, ValidationError } = require("./lib/pkg");
const { notify } = require("./lib/callback");

const safe = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "build";

async function processUpload(store, key) {
  const parts = key.split("/");
  if (parts[0] !== "uploads" || parts.length < 3) return { skipped: key };
  const jobId = parts[1];
  const started = Date.now();
  await notify({ job_id: jobId, status: "PROCESSING" }).catch((e) => console.warn("PROCESSING 콜백 실패(무시)", e.message));

  try {
    if (!(await store.exists(`jobs/${jobId}/spec.json`))) throw new ValidationError("등록되지 않은 작업 (jobs/<id>/spec.json 없음)");
    const spec = JSON.parse((await store.get(`jobs/${jobId}/spec.json`)).toString("utf8"));
    if (!spec.builds || !spec.builds.length) throw new ValidationError("spec.json 에 builds 없음");
    const pkg = inspectPackage(await store.get(key));
    const slug = safe(pkg.manifest.name || pkg.manifest.title);

    const builds = [];
    for (const b of spec.builds) {
      const built = buildFor(pkg, b.mark_id);
      const base = `outputs/${jobId}/${b.mark_id}`;
      for (const [name, data] of Object.entries(built.files)) {
        await store.put(`${base}/files/${name}`, Buffer.from(data), mimeOf(name));
      }
      const zipKey = `${base}/${slug}-${safe(b.label)}.zip`;
      await store.put(zipKey, built.zip, "application/zip");
      builds.push({ mark_id: b.mark_id, zip_key: zipKey, files_prefix: `${base}/files/`, sha256: built.sha256, size: built.zip.length });
    }
    const result = {
      job_id: jobId, status: "DONE", builds,
      game: { name: pkg.manifest.name, title: pkg.manifest.title, version: pkg.manifest.version, entry: pkg.manifest.entry || "index.html" },
      analysis: pkg.analysis, references: pkg.references, elapsed_ms: Date.now() - started,
    };
    await notify(result);
    return result;
  } catch (err) {
    const permanent = err instanceof ValidationError;
    const info = { job_id: jobId, key, error: err.message, kind: permanent ? "validation" : "transient", details: err.details || null, at: new Date().toISOString() };
    try {
      await store.put(`failed/${jobId}/error.json`, Buffer.from(JSON.stringify(info, null, 2)), "application/json");
      if (permanent) await store.put(`failed/${jobId}/${parts.slice(2).join("/")}`, await store.get(key), "application/zip");
    } catch (e2) { console.error("failed/ 기록 실패", e2); }
    await notify({ job_id: jobId, status: "FAILED", error: err.message, retrying: !permanent }).catch((e3) => console.error("콜백 실패", e3));
    if (!permanent) throw err; // Lambda 비동기 재시도
    return info;
  }
}

exports.handler = async (event) => {
  const store = openStorage(process.env.BUCKET);
  const results = [];
  for (const rec of event.Records || []) {
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    const bucket = rec.s3.bucket.name;
    const s = store.mode === "s3" ? openStorage(bucket) : store;
    console.log(JSON.stringify({ msg: "upload event", bucket, key }));
    results.push(await processUpload(s, key));
  }
  return results;
};
exports.processUpload = processUpload;
