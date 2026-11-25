#!/usr/bin/env node
// 로컬 모드에서 S3 ObjectCreated 이벤트를 흉내 내 Lambda 핸들러를 실행한다.
//   STORAGE_MODE=local LOCAL_STORAGE_DIR=... node local-invoke.js uploads/<job_id>/game.zip
// IAM 역할이 없어 Lambda 를 만들 수 없을 때는 EC2 에서 STORAGE_MODE=s3 BUCKET=... 로 같은 방식으로 돌린다.
const { handler } = require("./index");
const key = process.argv[2];
if (!key) { console.error("usage: node local-invoke.js <key>"); process.exit(2); }
const event = { Records: [{ eventSource: "aws:s3", eventName: "ObjectCreated:Put",
  s3: { bucket: { name: process.env.BUCKET || "local-bucket" }, object: { key: encodeURIComponent(key).replace(/%2F/g, "/") } } }] };
handler(event).then((r) => { console.log(JSON.stringify(r)); }).catch((e) => { console.error(e); process.exit(1); });
