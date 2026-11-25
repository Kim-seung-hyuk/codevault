"""데모 2~5장면(+7장면 한계) 엔드투엔드 재현. 서버가 떠 있어야 한다.
    python tests/e2e_demo.py [http://127.0.0.1:8000]
2 업로드 → A/B/C 빌드 생성  3 세 빌드 플레이 파일 확인  4 B 빌드를 terser 로 압축한 유출본  5 유출본 검사 → B 경로
7 강한 난독화본 → 여전히 B (L5), 층을 아는 공격자(scrub) → 표식 없음(오지목 없음)
"""
import io
import json
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import httpx

sys.stdout.reconfigure(encoding="utf-8")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[1]
c = httpx.Client(base_url=BASE, timeout=60, follow_redirects=True)
ok = True


def check(cond, msg):
    global ok
    print(("  PASS " if cond else "  FAIL ") + msg)
    ok &= bool(cond)


print("[1] 협력사 등록")
wanted = [("퍼블리셔 A", "퍼블리셔", "NDA-2026-001"), ("현지화 업체 B", "현지화", "NDA-2026-002"), ("스트리머 C", "스트리머", "NDA-2026-003")]
existing = {x["name"]: x for x in c.get("/api/customers").json()}
ids = {}
for name, role, nda in wanted:
    if name not in existing:
        existing[name] = c.post("/api/customers", json={"name": name, "role": role, "nda_ref": nda}).json()
    ids[name] = existing[name]["id"]
check(len(ids) == 3, f"협력사 3곳 {ids}")

for game in ["comet-shower", "lantern-range", "moss-hop"]:
    print(f"\n[2] {game}: presigned 업로드 → 빌드 생성")
    r = c.post("/api/jobs", json={"customer_ids": list(ids.values()), "filename": f"{game}.zip"})
    check(r.status_code == 201, f"작업 생성 {r.status_code}")
    job = r.json()
    zbytes = (ROOT / "games" / "dist" / f"{game}.zip").read_bytes()
    up = job["upload"]
    r = c.request(up["method"], up["url"], content=zbytes, headers=up["headers"])
    check(r.status_code == 200, f"presigned PUT {r.status_code}")
    c.post(f"/api/jobs/{job['job_id']}/uploaded")
    t0 = time.time()
    while time.time() - t0 < 60:
        d = c.get(f"/api/jobs/{job['job_id']}").json()
        if d["status"] in ("DONE", "FAILED"):
            break
        time.sleep(0.5)
    check(d["status"] == "DONE", f"상태 {d['status']} {d.get('error') or ''} ({time.time() - t0:.1f}s)")
    builds = {b["customer"]: b for b in d["builds"]}

    print("[3] 세 빌드 플레이 파일")
    shas = set()
    for name, b in builds.items():
        html = c.get(b["play_url"])
        js = c.get(b["play_url"] + "game.js")
        check(html.status_code == 200 and "game.js" in html.text and js.status_code == 200, f"{name} 플레이 index.html/game.js")
        shas.add(b["sha256"])
    check(len(shas) == 3, "세 빌드 해시가 모두 다름")
    check(c.get(f"/jobs/{job['job_id']}/play").status_code == 200, "나란히 플레이 화면")

    print("[4] B 빌드 다운로드 → terser 유출본")
    b = builds["현지화 업체 B"]
    z = c.get(b["download_url"])
    check(z.status_code == 200 and zipfile.is_zipfile(io.BytesIO(z.content)), "zip 다운로드")
    with tempfile.TemporaryDirectory() as td:
        zp = Path(td) / "b.zip"
        zp.write_bytes(z.content)
        for attack, expect in [("terser", "TRACED"), ("obfuscate", "TRACED"), ("scrub", "NONE")]:
            out = Path(td) / f"leak-{attack}.js"
            subprocess.run(["node", str(ROOT / "tools" / "make-leak.js"), str(zp), attack, "-o", str(out)], check=True, capture_output=True)
            print(f"[5/7] 유출본 검사 ({attack})")
            rep = c.post("/api/leak", files={"file": (out.name, out.read_bytes(), "text/javascript")}).json()
            who = (rep.get("customer") or {}).get("name")
            check(rep["verdict"] == expect and (expect != "TRACED" or who == "현지화 업체 B"),
                  f"{attack}: {rep['headline']} (신뢰도 {rep.get('confidence')}, mark {rep.get('markId')})")
            # HTML 리포트 화면
            page = c.post("/leak", files={"file": (out.name, out.read_bytes(), "text/javascript")})
            check(page.status_code == 200 and rep["headline"] in page.text, "리포트 화면 렌더링")
        rep = c.post("/api/leak", files={"file": ("b.zip", z.content, "application/zip")}).json()
        check(rep["verdict"] == "TRACED" and rep["exact_build"] == b["mark_id"], "원본 빌드 zip 그대로 → 바이트 일치 + B 경로")

print("\n결과:", "ALL PASS" if ok else "FAILURES")
sys.exit(0 if ok else 1)
