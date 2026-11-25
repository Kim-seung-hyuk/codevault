#!/usr/bin/env bash
# EC2(t3.small) 최초 1회 설정. Amazon Linux 2023 / Ubuntu 22.04·24.04 지원.
#   sudo REPO_URL=https://github.com/<you>/codevault.git bash ec2-bootstrap.sh
# 하는 일: 스왑 1GB → 패키지(PostgreSQL, Node, Python, git) → DB/계정 → 코드 clone → venv/npm
#          → /etc/codevault.env → systemd 등록·시작
# 비밀값(DB 비번, CALLBACK_SECRET, WM_SECRET)은 비어 있으면 새로 만들고 /etc/codevault.env 에만 남긴다.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "sudo 로 실행하세요"; exit 1; }

REPO_URL="${REPO_URL:?REPO_URL=https://github.com/<you>/<repo>.git 를 지정하세요}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/codevault
ENV_FILE=/etc/codevault.env
STORAGE_MODE="${STORAGE_MODE:-s3}"          # s3 | local
PROCESSOR_MODE="${PROCESSOR_MODE:-lambda}"  # lambda | inline (IAM/Lambda 가 없을 때)
BUCKET="${BUCKET:-}"
REGION="${REGION:-ap-northeast-2}"
PORT="${PORT:-80}"
rand() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 48; }

echo "== 1) 스왑 1GB (t3.small 메모리 2GB 보강)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-codevault.conf
fi

echo "== 2) 패키지"
if command -v dnf >/dev/null; then
  OS=al2023
  dnf install -y git python3.11 python3.11-pip postgresql15-server postgresql15 nodejs20 zip >/dev/null
  PY=python3.11
  command -v node >/dev/null || ln -sf "$(command -v node-20)" /usr/local/bin/node
  command -v npm >/dev/null || ln -sf "$(command -v npm-20)" /usr/local/bin/npm
  [ -f /var/lib/pgsql/data/PG_VERSION ] || postgresql-setup --initdb
  PG_HBA=/var/lib/pgsql/data/pg_hba.conf
  PG_SVC=postgresql
else
  OS=ubuntu
  apt-get update -y >/dev/null
  apt-get install -y git python3-venv python3-pip postgresql nodejs npm zip >/dev/null
  PY=python3
  PG_HBA="$(ls /etc/postgresql/*/main/pg_hba.conf | head -1)"
  PG_SVC=postgresql
fi
echo "OS=$OS node=$(node -v) python=$($PY -V)"

echo "== 3) PostgreSQL (localhost 전용)"
# 로컬 TCP 접속은 비밀번호(scram) 인증
sed -i -E 's/^(host\s+all\s+all\s+127\.0\.0\.1\/32\s+)\S+/\1scram-sha-256/; s/^(host\s+all\s+all\s+::1\/128\s+)\S+/\1scram-sha-256/' "$PG_HBA"
systemctl enable --now "$PG_SVC"
systemctl restart "$PG_SVC"
if [ -f "$ENV_FILE" ] && grep -q '^DB_PASSWORD=' "$ENV_FILE"; then
  DB_PASSWORD="$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
else
  DB_PASSWORD="$(rand)"
fi
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='codevault'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE codevault LOGIN PASSWORD '$DB_PASSWORD'"
sudo -u postgres psql -c "ALTER ROLE codevault PASSWORD '$DB_PASSWORD'" >/dev/null
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='codevault'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE codevault OWNER codevault"
# listen_addresses 기본값이 localhost 이므로 외부 노출 없음 (보안그룹에서도 5432 를 열지 않는다)

echo "== 4) 서비스 계정 + 코드"
id codevault >/dev/null 2>&1 || useradd --system --create-home --shell /sbin/nologin codevault
if [ -d "$APP_DIR/.git" ]; then
  sudo -u codevault git -C "$APP_DIR" fetch --quiet origin && sudo -u codevault git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  mkdir -p "$APP_DIR" && chown codevault: "$APP_DIR"
  sudo -u codevault git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "== 5) /etc/codevault.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
# CodeVault 설정 (systemd EnvironmentFile). 비밀값 포함 — 권한 600
PORT=$PORT
STORAGE_MODE=$STORAGE_MODE
PROCESSOR_MODE=$PROCESSOR_MODE
BUCKET=$BUCKET
AWS_REGION=$REGION
DB_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgresql+psycopg2://codevault:$DB_PASSWORD@127.0.0.1:5432/codevault
CALLBACK_SECRET=${CALLBACK_SECRET:-$(rand)}
WM_SECRET=${WM_SECRET:-$(rand)}
INTERNAL_BASE_URL=http://127.0.0.1:$PORT
LOCAL_STORAGE_DIR=/var/lib/codevault/bucket
SAMPLES_DIR=$APP_DIR/games/dist
LAMBDA_DIR=$APP_DIR/lambda
ORG_NAME=픽셀웍스 (Pixelworks)
# IAM 역할(인스턴스 프로파일)이 없을 때만: 최소 권한 IAM 사용자 키
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
ENV
fi
chmod 600 "$ENV_FILE" && chown root:codevault "$ENV_FILE" && chmod 640 "$ENV_FILE"
mkdir -p /var/lib/codevault/bucket && chown -R codevault: /var/lib/codevault

echo "== 6) 의존성 설치 + systemd"
bash "$APP_DIR/infra/deploy.sh" --no-pull

echo
echo "완료. 확인: curl -s http://127.0.0.1:$PORT/healthz"
echo "Lambda 에 넣을 비밀값(infra/config.env 와 같게):"
grep -E '^(CALLBACK_SECRET|WM_SECRET)=' "$ENV_FILE"
