// storage.js — S3 또는 로컬 폴더(데모/개발용)를 같은 인터페이스로 감싼다.
//   STORAGE_MODE=s3     : AWS SDK v3 (Lambda nodejs22.x 런타임에 기본 포함) 사용
//   STORAGE_MODE=local  : LOCAL_STORAGE_DIR/<key> 파일로 저장 (버킷 = 폴더)
const fs = require("fs");
const path = require("path");

function localStore(root) {
  const full = (key) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(path.resolve(root))) throw new Error("bad key " + key);
    return p;
  };
  return {
    mode: "local",
    async get(key) { return fs.promises.readFile(full(key)); },
    async put(key, body /*, contentType */) {
      await fs.promises.mkdir(path.dirname(full(key)), { recursive: true });
      await fs.promises.writeFile(full(key), body);
    },
    async exists(key) { return fs.existsSync(full(key)); },
  };
}

function s3Store(bucket) {
  const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
  const s3 = new S3Client({});
  return {
    mode: "s3",
    async get(key) {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await r.Body.transformToByteArray());
    },
    async put(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async exists(key) {
      try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; } catch { return false; }
    },
  };
}

function openStorage(bucket) {
  if ((process.env.STORAGE_MODE || "s3") === "local") {
    return localStore(process.env.LOCAL_STORAGE_DIR || path.join(__dirname, "..", "..", "data", "bucket"));
  }
  return s3Store(bucket || process.env.BUCKET);
}

module.exports = { openStorage };
