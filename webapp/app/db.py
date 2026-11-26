"""PostgreSQL(EC2 localhost) / SQLite(로컬 데모) 공용 모델.

테이블
  customers : 빌드를 받아 가는 협력사(배포 경로)
  jobs      : 업로드 1건 = 작업 1건. (status, created_at) 인덱스
  marks     : mark_id(1~255, 워터마크 페이로드) → customer_id. 빌드 1개당 1행
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Optional

from sqlalchemy import (JSON, DateTime, ForeignKey, Index, Integer, String, Text, create_engine, select)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from . import config


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    role: Mapped[str] = mapped_column(String(120), default="")       # 퍼블리셔 / 현지화 / 스트리머 ...
    contact: Mapped[str] = mapped_column(String(200), default="")
    nda_ref: Mapped[str] = mapped_column(String(120), default="")    # NDA 문서 번호
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    marks: Mapped[list["Mark"]] = relationship(back_populates="customer")


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: uuid.uuid4().hex[:12])
    filename: Mapped[str] = mapped_column(String(200))
    upload_key: Mapped[str] = mapped_column(String(300))
    # PENDING_UPLOAD → UPLOADED → PROCESSING → DONE | FAILED
    status: Mapped[str] = mapped_column(String(20), default="PENDING_UPLOAD")
    game_title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    game_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    result: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    marks: Mapped[list["Mark"]] = relationship(back_populates="job", order_by="Mark.mark_id")
    __table_args__ = (Index("ix_jobs_status_created", "status", "created_at"),)


class Mark(Base):
    __tablename__ = "marks"
    mark_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)  # 1~255
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), index=True)
    zip_key: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    files_prefix: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    revoked_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime, nullable=True)  # 공급 중단
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    customer: Mapped[Customer] = relationship(back_populates="marks")
    job: Mapped[Job] = relationship(back_populates="marks")


_connect_args = {"check_same_thread": False} if config.DATABASE_URL.startswith("sqlite") else {}
if config.DATABASE_URL.startswith("sqlite"):
    from pathlib import Path
    Path(config.DATABASE_URL.split("///", 1)[1]).parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(config.DATABASE_URL, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db() -> None:
    # uvicorn 워커 여러 개가 동시에 create_all 을 돌리면 PostgreSQL 에서 pg_type 중복 오류가 난다.
    # advisory lock 으로 한 워커씩 순서대로 실행한다(뒤 워커는 이미 있는 테이블을 건너뜀).
    if engine.dialect.name == "postgresql":
        from sqlalchemy import text
        with engine.begin() as conn:
            conn.execute(text("SELECT pg_advisory_xact_lock(727001)"))
            Base.metadata.create_all(conn)
    else:
        Base.metadata.create_all(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def allocate_mark_ids(db, n: int) -> list[int]:
    """비어 있는 mark_id(1~255) n개. 페이로드가 8비트라 동시에 255개 빌드까지 — 실서비스는 페이로드 확장."""
    used = set(db.scalars(select(Mark.mark_id)).all())
    free = [i for i in range(1, 256) if i not in used]
    if len(free) < n:
        raise RuntimeError("mark_id 공간(255) 소진 — 오래된 빌드를 정리하거나 페이로드를 늘려야 함")
    # 연속 번호를 피하려고 간격을 두고 뽑는다 (데모에서 A/B/C 가 1,2,3 처럼 보이지 않게)
    step = max(1, len(free) // (n + 1))
    picks = [free[(i + 1) * step - 1] for i in range(n)]
    return picks
