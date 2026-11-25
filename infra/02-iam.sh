#!/usr/bin/env bash
# IAM 역할 2개 (IAM 권한이 있을 때만). 실패하면 README 의 "IAM 역할이 없을 때" 절을 따른다.
#   codevault-lambda-role : Lambda 실행 역할 (uploads/·jobs/ 읽기, outputs/·failed/ 쓰기, CloudWatch Logs)
#   codevault-ec2-role    : EC2 인스턴스 프로파일 (presigned 발급·명세 쓰기, outputs/ 읽기, inline 대안용 쓰기)
source "$(dirname "$0")/_common.sh"
confirm "IAM 역할 codevault-lambda-role / codevault-ec2-role 을 만듭니다 (무료)."
P="$HERE/iam"
render() { sed -e "s/__BUCKET__/$BUCKET/g" -e "s/__ACCOUNT__/$ACCOUNT_ID/g" -e "s/__REGION__/$REGION/g" "$1"; }

aws iam create-role --role-name codevault-lambda-role \
  --assume-role-policy-document "file://$P/lambda-trust.json" >/dev/null || echo "(lambda 역할 이미 있음)"
render "$P/lambda-policy.json" > "$TMP/lp.json"
aws iam put-role-policy --role-name codevault-lambda-role --policy-name codevault-lambda \
  --policy-document "file://$TMP/lp.json"

aws iam create-role --role-name codevault-ec2-role \
  --assume-role-policy-document "file://$P/ec2-trust.json" >/dev/null || echo "(ec2 역할 이미 있음)"
render "$P/ec2-policy.json" > "$TMP/ep.json"
aws iam put-role-policy --role-name codevault-ec2-role --policy-name codevault-ec2 \
  --policy-document "file://$TMP/ep.json"
aws iam create-instance-profile --instance-profile-name codevault-ec2-profile >/dev/null 2>&1 || true
aws iam add-role-to-instance-profile --instance-profile-name codevault-ec2-profile \
  --role-name codevault-ec2-role 2>/dev/null || true

echo "Lambda 역할 ARN: arn:aws:iam::$ACCOUNT_ID:role/codevault-lambda-role"
echo "EC2 에 붙이기: aws ec2 associate-iam-instance-profile --instance-id i-xxxx --iam-instance-profile Name=codevault-ec2-profile"
