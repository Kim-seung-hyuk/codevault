#!/usr/bin/env bash
# S3 버킷 + 퍼블릭 차단 + 기본 암호화 + CORS(브라우저 presigned PUT) + 수명주기
#   uploads/ 3일, outputs/ OUTPUT_EXPIRE_DAYS일, failed/ 30일, jobs/ 30일 후 자동 삭제
source "$(dirname "$0")/_common.sh"
confirm "S3 버킷 $BUCKET 을 만들고 설정합니다 (저장 용량만큼 소액 과금)."

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "버킷 이미 있음 — 설정만 갱신"
elif [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET"
else
  aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint="$REGION"
fi

aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# CORS: 브라우저가 EC2 페이지에서 S3 로 바로 PUT(업로드)·GET(다운로드) 하므로 필요
cat > "$TMP/cors.json" <<JSON
{"CORSRules":[{
  "AllowedOrigins":["${EC2_PUBLIC_URL}","http://localhost:8000"],
  "AllowedMethods":["PUT","GET"],
  "AllowedHeaders":["*"],
  "ExposeHeaders":["ETag"],
  "MaxAgeSeconds":3000}]}
JSON
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "file://$TMP/cors.json"

cat > "$TMP/lifecycle.json" <<JSON
{"Rules":[
  {"ID":"expire-uploads","Filter":{"Prefix":"uploads/"},"Status":"Enabled","Expiration":{"Days":3}},
  {"ID":"expire-outputs","Filter":{"Prefix":"outputs/"},"Status":"Enabled","Expiration":{"Days":${OUTPUT_EXPIRE_DAYS}}},
  {"ID":"expire-failed","Filter":{"Prefix":"failed/"},"Status":"Enabled","Expiration":{"Days":30}},
  {"ID":"expire-jobs","Filter":{"Prefix":"jobs/"},"Status":"Enabled","Expiration":{"Days":30}},
  {"ID":"abort-mpu","Filter":{"Prefix":""},"Status":"Enabled","AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}
]}
JSON
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration "file://$TMP/lifecycle.json"
echo "S3 준비 완료: s3://$BUCKET  (이벤트 알림은 03-lambda.sh 가 설정)"
