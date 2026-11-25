# 공통: config.env 로드 + 실행 전 확인. 각 스크립트가 source 한다.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/config.env" ] || { echo "infra/config.env 가 없습니다. config.env.example 을 복사해 채우세요."; exit 1; }
# shellcheck disable=SC1091
source "$HERE/config.env"
export AWS_DEFAULT_REGION="$REGION"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "계정 $ACCOUNT_ID / 리전 $REGION / 버킷 $BUCKET"
TMP="$(mktemp -d)"
confirm() {
  [ "${YES:-}" = "1" ] && return 0
  read -r -p "$1 계속할까요? [y/N] " a
  case "$a" in y|Y) ;; *) echo "중단"; exit 1 ;; esac
}
