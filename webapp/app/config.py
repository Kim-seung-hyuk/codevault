"""환경변수 설정. EC2 에서는 /etc/codevault.env 를 systemd EnvironmentFile 로 읽는다."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # 저장소 루트


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


# --- 저장소 / 처리 방식 ---
STORAGE_MODE = _env("STORAGE_MODE", "local")          # local | s3
BUCKET = _env("BUCKET", "")
AWS_REGION = _env("AWS_REGION", _env("AWS_DEFAULT_REGION", "ap-northeast-2"))
LOCAL_STORAGE_DIR = Path(_env("LOCAL_STORAGE_DIR", str(ROOT / "data" / "bucket")))
# lambda : S3 이벤트 → Lambda 가 처리 (실서비스 구성)
# inline : 업로드 완료 통지를 받으면 EC2 가 같은 Lambda 코드를 node 로 직접 실행 (로컬 데모 / IAM 역할이 없을 때 대안)
PROCESSOR_MODE = _env("PROCESSOR_MODE", "inline" if STORAGE_MODE == "local" else "lambda")

# --- DB ---  EC2: postgresql+psycopg2://codevault:<pw>@127.0.0.1:5432/codevault
DATABASE_URL = _env("DATABASE_URL", f"sqlite:///{(ROOT / 'data' / 'codevault.db').as_posix()}")

# --- 비밀값 ---
CALLBACK_SECRET = _env("CALLBACK_SECRET", "dev-callback-secret")   # Lambda ↔ EC2 콜백 서명
WM_SECRET = _env("WM_SECRET", "codevault-demo-secret-v1")          # 워터마크 HMAC 키 (Lambda 와 동일해야 함)
URL_SIGNING_SECRET = _env("URL_SIGNING_SECRET", CALLBACK_SECRET + ":local-url")

# --- 실행 환경 ---
NODE_BIN = _env("NODE_BIN", "node")
LAMBDA_DIR = Path(_env("LAMBDA_DIR", str(ROOT / "lambda")))
SAMPLES_DIR = Path(_env("SAMPLES_DIR", str(ROOT / "games" / "dist")))
PORT = int(_env("PORT", "8000"))
# inline 모드에서 node 프로세스가 콜백할 주소
INTERNAL_BASE_URL = _env("INTERNAL_BASE_URL", f"http://127.0.0.1:{PORT}")
PRESIGN_EXPIRES = int(_env("PRESIGN_EXPIRES", "900"))
ORG_NAME = _env("ORG_NAME", "픽셀웍스 (Pixelworks)")
MAX_UPLOAD_MB = int(_env("MAX_UPLOAD_MB", "20"))
