#!/usr/bin/env bash
# Lambda 패키징·생성(또는 코드 갱신) + 비동기 재시도 2회 + S3 AddPermission + uploads/ 이벤트 알림
source "$(dirname "$0")/_common.sh"
ROOT="$(cd "$HERE/.." && pwd)"
ROLE="${LAMBDA_ROLE_ARN:-arn:aws:iam::$ACCOUNT_ID:role/codevault-lambda-role}"
[ -n "$CALLBACK_SECRET" ] && [ -n "$WM_SECRET" ] || { echo "config.env 의 CALLBACK_SECRET / WM_SECRET 을 채우세요"; exit 1; }
confirm "Lambda $LAMBDA_NAME 을 배포하고 s3://$BUCKET/uploads/ 이벤트를 연결합니다 (호출량만큼 과금, 데모 규모는 프리티어 수준)."

# 1) 패키징 — 런타임 의존성만. @aws-sdk/client-s3 는 optional(EC2 inline 대안용)이고 Lambda 런타임에 내장이라 뺀다
#    작업 폴더를 임시로 복사해서 묶는다 (저장소의 lambda/node_modules 는 건드리지 않음)
PKG="$TMP/pkg" && mkdir -p "$PKG"
cp -r "$ROOT/lambda/index.js" "$ROOT/lambda/extract-cli.js" "$ROOT/lambda/lib"       "$ROOT/lambda/package.json" "$ROOT/lambda/package-lock.json" "$PKG/"
( cd "$PKG" && npm ci --omit=dev --omit=optional --no-audit --no-fund )
ZIP="$TMP/codevault-lambda.zip"
( cd "$PKG" && zip -qr "$ZIP" index.js extract-cli.js lib node_modules package.json )
ENV="Variables={WM_SECRET=$WM_SECRET,CALLBACK_SECRET=$CALLBACK_SECRET,CALLBACK_URL=$EC2_PUBLIC_URL/api/internal/lambda-callback,STORAGE_MODE=s3,BUCKET=$BUCKET}"

# 2) 생성 또는 갱신
if aws lambda get-function --function-name "$LAMBDA_NAME" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$LAMBDA_NAME" --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated --function-name "$LAMBDA_NAME"
  aws lambda update-function-configuration --function-name "$LAMBDA_NAME" \
    --environment "$ENV" --timeout 60 --memory-size 512 >/dev/null
else
  aws lambda create-function --function-name "$LAMBDA_NAME" --runtime nodejs20.x --handler index.handler \
    --role "$ROLE" --zip-file "fileb://$ZIP" --timeout 60 --memory-size 512 \
    --environment "$ENV" --description "CodeVault watermark builder" >/dev/null
fi
aws lambda wait function-active-v2 --function-name "$LAMBDA_NAME"

# 3) 비동기 호출 재시도 2회, 이벤트 최대 보관 1시간
aws lambda put-function-event-invoke-config --function-name "$LAMBDA_NAME" \
  --maximum-retry-attempts 2 --maximum-event-age-in-seconds 3600 >/dev/null

# 4) S3 가 이 Lambda 를 호출하도록 AddPermission (이 계정의 이 버킷으로 한정)
aws lambda add-permission --function-name "$LAMBDA_NAME" --statement-id s3-invoke-uploads \
  --action lambda:InvokeFunction --principal s3.amazonaws.com \
  --source-arn "arn:aws:s3:::$BUCKET" --source-account "$ACCOUNT_ID" >/dev/null 2>&1 || echo "(호출 권한 이미 있음)"

# 5) uploads/*.zip ObjectCreated → Lambda
FN_ARN="$(aws lambda get-function --function-name "$LAMBDA_NAME" --query Configuration.FunctionArn --output text)"
cat > "$TMP/notify.json" <<JSON
{"LambdaFunctionConfigurations":[{"Id":"codevault-uploads","LambdaFunctionArn":"$FN_ARN",
  "Events":["s3:ObjectCreated:*"],
  "Filter":{"Key":{"FilterRules":[{"Name":"prefix","Value":"uploads/"},{"Name":"suffix","Value":".zip"}]}}}]}
JSON
aws s3api put-bucket-notification-configuration --bucket "$BUCKET" --notification-configuration "file://$TMP/notify.json"
echo "Lambda 배포 완료: $FN_ARN"
echo "로그 보기: aws logs tail /aws/lambda/$LAMBDA_NAME --follow"
