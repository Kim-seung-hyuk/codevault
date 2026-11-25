#!/usr/bin/env bash
# EC2 에서 새 버전 배포: git pull → 의존성 → 샘플 zip → systemd 재시작
#   sudo bash /opt/codevault/infra/deploy.sh          (평소)
#   sudo bash /opt/codevault/infra/deploy.sh --no-pull (bootstrap 내부 호출)
set -euo pipefail
APP_DIR=/opt/codevault
BRANCH="${BRANCH:-main}"
PY="$(command -v python3.11 || command -v python3)"
run() { sudo -u codevault "$@"; }

if [ "${1:-}" != "--no-pull" ]; then
  run git -C "$APP_DIR" fetch --quiet origin
  run git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi
echo "배포 커밋: $(git -C "$APP_DIR" log -1 --oneline)"

[ -d "$APP_DIR/.venv" ] || run "$PY" -m venv "$APP_DIR/.venv"
run "$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
run "$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/webapp/requirements.txt"
# 유출본 추출 CLI 와 inline 대안 워커가 쓰는 Lambda 코드 의존성
( cd "$APP_DIR/lambda" && run npm ci --omit=dev --no-audit --no-fund )
( cd "$APP_DIR" && run node tools/pack-games.js )

install -m 644 "$APP_DIR/infra/codevault.service" /etc/systemd/system/codevault.service
systemctl daemon-reload
systemctl enable codevault >/dev/null
systemctl restart codevault
sleep 2
systemctl --no-pager --lines=5 status codevault || true
PORT="$(grep '^PORT=' /etc/codevault.env | cut -d= -f2)"
curl -fsS "http://127.0.0.1:${PORT:-80}/healthz" && echo
