"""CodeVault 웹 + API (Stateless FastAPI). 상태는 PostgreSQL 과 S3 에만 둔다."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import mimetypes
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import List, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config
from .db import Customer, Job, Mark, SessionLocal, allocate_mark_ids, get_db, init_db, utcnow
from .storage import put_json, store, verify_local_sig

log = logging.getLogger("codevault")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

APP_DIR = Path(__file__).parent
app = FastAPI(title="CodeVault", version="1.0.0")
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")
templates = Jinja2Templates(directory=APP_DIR / "templates")
templates.env.globals.update(cfg=config)


@app.on_event("startup")
def _startup() -> None:
    init_db()
    log.info("storage=%s processor=%s db=%s", config.STORAGE_MODE, config.PROCESSOR_MODE,
             config.DATABASE_URL.split("@")[-1])


def node_env() -> dict:
    env = dict(os.environ)
    env.update({
        "WM_SECRET": config.WM_SECRET,
        "CALLBACK_SECRET": config.CALLBACK_SECRET,
        "CALLBACK_URL": f"{config.INTERNAL_BASE_URL}/api/internal/lambda-callback",
        "STORAGE_MODE": config.STORAGE_MODE,
        "LOCAL_STORAGE_DIR": str(config.LOCAL_STORAGE_DIR),
        "BUCKET": config.BUCKET,
        "AWS_REGION": config.AWS_REGION,
    })
    return env


# ======================================================================
# 협력사(customers)
# ======================================================================
class CustomerIn(BaseModel):
    name: str
    role: str = ""
    contact: str = ""
    nda_ref: str = ""


def customer_dict(c: Customer) -> dict:
    return {"id": c.id, "name": c.name, "role": c.role, "contact": c.contact, "nda_ref": c.nda_ref,
            "builds": len(c.marks)}


@app.get("/api/customers")
def api_customers(db: Session = Depends(get_db)):
    return [customer_dict(c) for c in db.scalars(select(Customer).order_by(Customer.id))]


@app.post("/api/customers", status_code=201)
def api_create_customer(body: CustomerIn, db: Session = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(400, "이름이 비어 있음")
    if db.scalar(select(Customer).where(Customer.name == body.name.strip())):
        raise HTTPException(409, "이미 등록된 협력사")
    c = Customer(name=body.name.strip(), role=body.role.strip(), contact=body.contact.strip(), nda_ref=body.nda_ref.strip())
    db.add(c)
    db.commit()
    return customer_dict(c)


@app.post("/customers")
def form_create_customer(name: str = Form(...), role: str = Form(""), contact: str = Form(""), nda_ref: str = Form(""),
                         db: Session = Depends(get_db)):
    try:
        api_create_customer(CustomerIn(name=name, role=role, contact=contact, nda_ref=nda_ref), db)
    except HTTPException as e:
        return RedirectResponse(f"/?err={e.detail}", status_code=303)
    return RedirectResponse("/", status_code=303)


# ======================================================================
# 작업(jobs): presigned 업로드 → (Lambda | inline) → 콜백
# ======================================================================
class JobIn(BaseModel):
    customer_ids: List[int]
    filename: str = "game.zip"


def job_dict(j: Job) -> dict:
    return {
        "id": j.id, "status": j.status, "filename": j.filename, "game_title": j.game_title, "error": j.error,
        "created_at": j.created_at.isoformat() + "Z", "updated_at": j.updated_at.isoformat() + "Z",
        "analysis": (j.result or {}).get("analysis"), "elapsed_ms": (j.result or {}).get("elapsed_ms"),
        "builds": [{
            "mark_id": m.mark_id, "customer": m.customer.name, "role": m.customer.role,
            "ready": bool(m.zip_key), "sha256": m.sha256, "size": m.size,
            "revoked": m.revoked_at is not None,
            "download_url": f"/builds/{m.mark_id}/download" if m.zip_key else None,
            "play_url": f"/play/{m.mark_id}/" if m.files_prefix else None,
        } for m in j.marks],
    }


@app.post("/api/jobs", status_code=201)
def api_create_job(body: JobIn, db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(body.customer_ids))
    if not ids:
        raise HTTPException(400, "협력사를 1곳 이상 선택해야 함")
    customers = db.scalars(select(Customer).where(Customer.id.in_(ids))).all()
    if len(customers) != len(ids):
        raise HTTPException(400, "존재하지 않는 협력사 id 포함")
    if not body.filename.lower().endswith(".zip"):
        raise HTTPException(400, "게임 패키지는 .zip (index.html, game.js, manifest.json)")
    job = Job(filename=os.path.basename(body.filename), upload_key="")
    db.add(job)
    db.flush()
    try:
        mark_ids = allocate_mark_ids(db, len(customers))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    by_id = {c.id: c for c in customers}
    builds = []
    for mid, cid in zip(mark_ids, ids):
        db.add(Mark(mark_id=mid, customer_id=cid, job_id=job.id))
        builds.append({"mark_id": mid, "label": by_id[cid].name})
    job.upload_key = f"uploads/{job.id}/game.zip"
    # Lambda 가 읽을 작업 명세 — 협력사 이름 대신 라벨만 (산출물 zip 파일명에 사용)
    put_json(f"jobs/{job.id}/spec.json", {"job_id": job.id, "builds": [
        {"mark_id": b["mark_id"], "label": f"build-{b['mark_id']}"} for b in builds]})
    db.commit()
    upload = store().presign_put(job.upload_key, "application/zip")
    return {"job_id": job.id, "upload": upload, "marks": builds, "processor": config.PROCESSOR_MODE}


def run_inline(job_id: str, key: str) -> None:
    """IAM 역할/Lambda 가 없을 때의 대안이자 로컬 데모 경로: 같은 Lambda 코드를 EC2 에서 node 로 실행."""
    cmd = [config.NODE_BIN, str(config.LAMBDA_DIR / "local-invoke.js"), key]
    try:
        r = subprocess.run(cmd, env=node_env(), capture_output=True, text=True, timeout=120, encoding="utf-8")
        log.info("inline worker job=%s rc=%s\n%s%s", job_id, r.returncode, r.stdout[-2000:], r.stderr[-2000:])
        if r.returncode != 0:
            with SessionLocal() as db:
                j = db.get(Job, job_id)
                if j and j.status not in ("DONE", "FAILED"):
                    j.status, j.error = "FAILED", (r.stderr or r.stdout)[-500:]
                    db.commit()
    except Exception as e:  # noqa: BLE001
        log.exception("inline worker 실패")
        with SessionLocal() as db:
            j = db.get(Job, job_id)
            if j:
                j.status, j.error = "FAILED", str(e)
                db.commit()


@app.post("/api/jobs/{job_id}/uploaded")
def api_job_uploaded(job_id: str, bg: BackgroundTasks, db: Session = Depends(get_db)):
    """브라우저가 presigned PUT 완료 후 호출. lambda 모드에서는 상태 표시용, inline 모드에서는 처리 시작."""
    j = db.get(Job, job_id)
    if not j:
        raise HTTPException(404)
    if not store().exists(j.upload_key):
        raise HTTPException(409, "업로드된 객체가 없음")
    if j.status == "PENDING_UPLOAD":
        j.status = "UPLOADED"
        db.commit()
    if config.PROCESSOR_MODE == "inline" and j.status in ("UPLOADED", "FAILED"):
        bg.add_task(run_inline, j.id, j.upload_key)
    return {"ok": True, "status": j.status}


@app.get("/api/jobs")
def api_jobs(db: Session = Depends(get_db)):
    return [job_dict(j) for j in db.scalars(select(Job).order_by(Job.created_at.desc()).limit(50))]


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str, db: Session = Depends(get_db)):
    j = db.get(Job, job_id)
    if not j:
        raise HTTPException(404)
    return job_dict(j)


@app.post("/api/internal/lambda-callback")
async def lambda_callback(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    ts = request.headers.get("X-CV-Timestamp", "0")
    sig = request.headers.get("X-CV-Signature", "")
    expect = hmac.new(config.CALLBACK_SECRET.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expect, sig) or abs(time.time() - int(ts or 0)) > 300:
        log.warning("콜백 서명 불일치/만료")
        raise HTTPException(401, "bad signature")
    p = json.loads(body)
    j = db.get(Job, p.get("job_id"))
    if not j:
        raise HTTPException(404, "unknown job")
    status = p.get("status")
    if status == "PROCESSING":
        if j.status not in ("DONE",):
            j.status = "PROCESSING"
    elif status == "DONE":
        j.status, j.error = "DONE", None
        j.result = {"analysis": p.get("analysis"), "elapsed_ms": p.get("elapsed_ms"), "game": p.get("game")}
        g = p.get("game") or {}
        j.game_title, j.game_name = g.get("title"), g.get("name")
        marks = {m.mark_id: m for m in j.marks}
        for b in p.get("builds", []):
            m = marks.get(b["mark_id"])
            if m:
                m.zip_key, m.files_prefix, m.sha256, m.size = b["zip_key"], b["files_prefix"], b["sha256"], b.get("size")
    elif status == "FAILED":
        if j.status != "DONE":
            j.status = "PROCESSING" if p.get("retrying") else "FAILED"
            j.error = p.get("error") + (" (Lambda 재시도 대기)" if p.get("retrying") else "")
    db.commit()
    return {"ok": True}


# ======================================================================
# 빌드 다운로드 / 공급 중단 / 나란히 플레이
# ======================================================================
@app.get("/builds/{mark_id}/download")
def download_build(mark_id: int, db: Session = Depends(get_db)):
    m = db.get(Mark, mark_id)
    if not m or not m.zip_key:
        raise HTTPException(404)
    if m.revoked_at:
        raise HTTPException(410, "공급 중단된 빌드")
    fname = f"{m.job.game_name or 'game'}-build{m.mark_id}.zip"  # S3 Content-Disposition 은 ASCII 로
    return RedirectResponse(store().presign_get(m.zip_key, fname), status_code=302)


@app.post("/builds/{mark_id}/revoke")
def revoke_build(mark_id: int, back: str = Form("/"), db: Session = Depends(get_db)):
    m = db.get(Mark, mark_id)
    if not m:
        raise HTTPException(404)
    m.revoked_at = None if m.revoked_at else utcnow()
    db.commit()
    return RedirectResponse(back if back.startswith("/") else "/", status_code=303)


@app.get("/play/{mark_id}/{path:path}")
def play_file(mark_id: int, path: str, db: Session = Depends(get_db)):
    m = db.get(Mark, mark_id)
    if not m or not m.files_prefix:
        raise HTTPException(404)
    path = path or ((m.job.result or {}).get("game") or {}).get("entry") or "index.html"
    if ".." in path:
        raise HTTPException(400)
    try:
        data = store().get(m.files_prefix + path)
    except Exception:
        raise HTTPException(404, "파일 없음 (수명주기로 만료되었을 수 있음)")
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype.endswith("javascript"):
        ctype += "; charset=utf-8"
    return Response(data, media_type=ctype, headers={"Cache-Control": "no-store"})


# ======================================================================
# 로컬 모드 presigned URL 흉내 (S3 대역)
# ======================================================================
@app.put("/local-s3/{key:path}")
async def local_put(key: str, request: Request, exp: int = 0, sig: str = ""):
    if config.STORAGE_MODE != "local" or not verify_local_sig("PUT", key, exp, sig):
        raise HTTPException(403, "bad or expired signature")
    data = await request.body()
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413)
    store().put(key, data, request.headers.get("content-type", "application/octet-stream"))
    return Response(status_code=200)


@app.get("/local-s3/{key:path}")
def local_get(key: str, exp: int = 0, sig: str = "", filename: Optional[str] = None):
    if config.STORAGE_MODE != "local" or not verify_local_sig("GET", key, exp, sig):
        raise HTTPException(403, "bad or expired signature")
    p = store().local_path(key)
    if not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, filename=filename or p.name)


@app.get("/samples/{name}")
def sample_zip(name: str):
    p = (config.SAMPLES_DIR / name).resolve()
    if p.parent != config.SAMPLES_DIR.resolve() or not p.is_file() or p.suffix != ".zip":
        raise HTTPException(404)
    return FileResponse(p, media_type="application/zip", filename=name)


def list_samples() -> list:
    if not config.SAMPLES_DIR.is_dir():
        return []
    return sorted(p.name for p in config.SAMPLES_DIR.glob("*.zip"))


# ======================================================================
# 유출본 검사
# ======================================================================
VERDICT_TEXT = {
    "IDENTIFIED": "식별됨",
    "NO_RELIABLE_MARK": "표식 없음",
    "CONFLICT": "층 간 충돌",
}


def analyze_leak(data: bytes, filename: str, db: Session) -> dict:
    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(filename).suffix or ".bin") as tf:
        tf.write(data)
        tmp = tf.name
    try:
        r = subprocess.run([config.NODE_BIN, str(config.LAMBDA_DIR / "extract-cli.js"), tmp, filename],
                           env=node_env(), capture_output=True, text=True, timeout=60, encoding="utf-8")
    finally:
        os.unlink(tmp)
    if r.returncode != 0:
        raise HTTPException(500, "추출기 실행 실패: " + r.stderr[-300:])
    rep = json.loads(r.stdout)
    sha = hashlib.sha256(data).hexdigest()
    rep.update({"filename": filename, "bytes": len(data), "sha256": sha})

    exact = db.scalar(select(Mark).where(Mark.sha256 == sha))
    rep["exact_build"] = exact.mark_id if exact else None

    if rep.get("kind") == "image":
        # 스크린샷: 캔버스마다 따로 판정 (나란히 플레이 화면이면 여러 빌드가 한 장에 있을 수 있음)
        for c in rep.get("canvases", []):
            m = db.get(Mark, c["markId"]) if c.get("markId") else None
            c["customer"] = m.customer.name if m else None
            c["registered"] = m is not None
        traced = [c for c in rep.get("canvases", []) if c.get("registered")]
        names = list(dict.fromkeys(c["customer"] for c in traced))  # 화면 왼쪽→오른쪽 순서
        if len(names) == 1:
            m = db.get(Mark, traced[0]["markId"])
            rep["verdict"] = "TRACED"
            rep["customer"] = customer_dict(m.customer)
            rep["build"] = {"mark_id": m.mark_id, "job_id": m.job_id, "game": m.job.game_title,
                            "issued_at": m.created_at.isoformat() + "Z", "revoked": m.revoked_at is not None, "sha256": m.sha256}
            rep["headline"] = f"{m.customer.name} 경로, 서명 검증 통과 (화면 출력 지문)"
        elif len(names) > 1:
            rep["verdict"] = "MULTIPLE"
            rep["headline"] = f"한 장에 빌드 {len(traced)}개: " + ", ".join(names)
        elif rep.get("canvases"):
            rep["verdict"] = "NONE"
            rep["headline"] = "화면 지문을 읽지 못함 — 어느 협력사도 지목하지 않음"
        else:
            rep["verdict"] = "NONE"
            rep["headline"] = "화면 지문 없음 — 어느 협력사도 지목하지 않음"
        rep["confidence_text"] = "중간 — 화면 출력 지문 1개 층(8비트 태그)으로 검증" if traced else "없음"
        rep["chance_text"] = "약 1/256" if traced else None
        return rep

    mark: Optional[Mark] = db.get(Mark, rep["markId"]) if rep.get("markId") else None
    if rep["decision"] == "IDENTIFIED" and mark is None:
        rep["verdict"] = "UNREGISTERED"
        rep["headline"] = f"서명은 맞지만 등록되지 않은 표식(mark {rep['markId']}) — 지목하지 않음"
    elif rep["decision"] == "IDENTIFIED":
        rep["verdict"] = "TRACED"
        rep["customer"] = customer_dict(mark.customer)
        rep["build"] = {"mark_id": mark.mark_id, "job_id": mark.job_id, "game": mark.job.game_title,
                        "issued_at": mark.created_at.isoformat() + "Z", "revoked": mark.revoked_at is not None,
                        "sha256": mark.sha256}
        rep["headline"] = f"{mark.customer.name} 경로, 서명 검증 통과"
    elif rep["decision"] == "CONFLICT":
        rep["verdict"] = "CONFLICT"
        rep["headline"] = "층마다 다른 표식이 나옴 — 지목하지 않음 (의도적 조작 또는 짜깁기 의심)"
    else:
        rep["verdict"] = "NONE"
        rep["headline"] = "표식 없음 — 어느 협력사도 지목하지 않음"
    conf = rep.get("confidence")
    rep["confidence_text"] = {
        "HIGH": "높음 — 독립된 여러 층이 같은 표식을 가리킴",
        "MEDIUM": "중간 — 1개 층의 HMAC 태그만 검증됐거나 반대 층이 있음 (추가 증거와 함께 판단)",
    }.get(conf, "없음")
    if rep.get("chanceMatch"):
        rep["chance_text"] = f"약 1/{round(1 / rep['chanceMatch']):,}"
    return rep


@app.post("/api/leak")
async def api_leak(file: UploadFile = File(...), db: Session = Depends(get_db)):
    data = await file.read()
    return analyze_leak(data, file.filename or "leak.js", db)


@app.post("/leak", response_class=HTMLResponse)
async def leak_report(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)):
    data = await file.read()
    if not data:
        return RedirectResponse("/leak?err=empty", status_code=303)
    rep = analyze_leak(data, file.filename or "leak.js", db)
    return templates.TemplateResponse(request, "leak_report.html", {"r": rep})


# ======================================================================
# 화면
# ======================================================================
@app.get("/", response_class=HTMLResponse)
def page_home(request: Request, err: Optional[str] = None, db: Session = Depends(get_db)):
    customers = db.scalars(select(Customer).order_by(Customer.id)).all()
    jobs = db.scalars(select(Job).order_by(Job.created_at.desc()).limit(20)).all()
    return templates.TemplateResponse(request, "home.html", {"customers": customers, "jobs": jobs, "err": err})


@app.get("/jobs/new", response_class=HTMLResponse)
def page_new_job(request: Request, db: Session = Depends(get_db)):
    customers = db.scalars(select(Customer).order_by(Customer.id)).all()
    return templates.TemplateResponse(request, "job_new.html", {"customers": customers, "samples": list_samples()})


@app.get("/jobs/{job_id}", response_class=HTMLResponse)
def page_job(request: Request, job_id: str, db: Session = Depends(get_db)):
    j = db.get(Job, job_id)
    if not j:
        raise HTTPException(404)
    return templates.TemplateResponse(request, "job.html", {"j": j, "jd": job_dict(j)})


@app.get("/jobs/{job_id}/play", response_class=HTMLResponse)
def page_play(request: Request, job_id: str, db: Session = Depends(get_db)):
    j = db.get(Job, job_id)
    if not j:
        raise HTTPException(404)
    return templates.TemplateResponse(request, "play.html", {"j": j})


@app.get("/leak", response_class=HTMLResponse)
def page_leak(request: Request, err: Optional[str] = None):
    return templates.TemplateResponse(request, "leak.html", {"err": err})


@app.get("/healthz")
def healthz(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"ok": True, "storage": config.STORAGE_MODE, "processor": config.PROCESSOR_MODE}
