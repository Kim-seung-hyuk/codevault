"""S3 / 로컬 폴더 저장소. 로컬 모드는 presigned URL 을 HMAC 서명 URL 로 흉내 낸다."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from pathlib import Path
from typing import Optional
from urllib.parse import quote, urlencode

from . import config


def _sign(method: str, key: str, exp: int) -> str:
    msg = f"{method}\n{key}\n{exp}".encode()
    return hmac.new(config.URL_SIGNING_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def verify_local_sig(method: str, key: str, exp: int, sig: str) -> bool:
    return exp >= int(time.time()) and hmac.compare_digest(_sign(method, key, exp), sig or "")


class LocalStorage:
    mode = "local"

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root not in p.parents and p != self.root:
            raise ValueError("bad key")
        return p

    def presign_put(self, key: str, content_type: str) -> dict:
        exp = int(time.time()) + config.PRESIGN_EXPIRES
        qs = urlencode({"exp": exp, "sig": _sign("PUT", key, exp)})
        return {"url": f"/local-s3/{quote(key)}?{qs}", "method": "PUT", "headers": {"Content-Type": content_type}}

    def presign_get(self, key: str, filename: Optional[str] = None) -> str:
        exp = int(time.time()) + config.PRESIGN_EXPIRES
        q = {"exp": exp, "sig": _sign("GET", key, exp)}
        if filename:
            q["filename"] = filename
        return f"/local-s3/{quote(key)}?{urlencode(q)}"

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def local_path(self, key: str) -> Path:
        return self._path(key)


class S3Storage:
    mode = "s3"

    def __init__(self, bucket: str):
        import boto3
        from botocore.config import Config
        self.bucket = bucket
        # 인스턴스 프로파일(권장) 또는 /etc/codevault.env 의 AWS_ACCESS_KEY_ID/SECRET 로 자격 증명
        self.s3 = boto3.client("s3", region_name=config.AWS_REGION,
                               config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))

    def presign_put(self, key: str, content_type: str) -> dict:
        url = self.s3.generate_presigned_url(
            "put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=config.PRESIGN_EXPIRES)
        return {"url": url, "method": "PUT", "headers": {"Content-Type": content_type}}

    def presign_get(self, key: str, filename: Optional[str] = None) -> str:
        params = {"Bucket": self.bucket, "Key": key}
        if filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        return self.s3.generate_presigned_url("get_object", Params=params, ExpiresIn=config.PRESIGN_EXPIRES)

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key: str) -> bytes:
        return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False


_store = None


def store():
    global _store
    if _store is None:
        _store = S3Storage(config.BUCKET) if config.STORAGE_MODE == "s3" else LocalStorage(config.LOCAL_STORAGE_DIR)
    return _store


def put_json(key: str, obj) -> None:
    store().put(key, json.dumps(obj, ensure_ascii=False, indent=2).encode(), "application/json")
