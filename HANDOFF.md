# 인수인계 — CodeVault (2026-11-26 기준)

새 세션에서 이어 갈 때 이 파일부터 읽는다. 저장소: https://github.com/Kim-seung-hyuk/codevault (main, 공개)

## 1. 무엇을 만들었나

고객사(인디 스튜디오 "픽셀웍스")가 재배포용 게임을 올리면, 받아 갈 협력사마다 보이지 않는 지문을 넣은 빌드를 돌려주고,
유출본이 나오면 그 파일만으로 어느 협력사 경로인지 역조회하는 서비스. 포지셔닝은 "RE 를 막는 방패가 아니라 지문".
자세한 설명·실측 결과는 `README.md`, `RESULTS*.md`, `evidence/`.

| 영역 | 위치 | 상태 |
|---|---|---|
| 오리지널 게임 3개 | `games/` (comet-shower, lantern-range, moss-hop) | 완료 |
| 지문 엔진 8층 | `lambda/lib/watermark.js`(L1~L6, L8 연결), `semantic.js`(L8), `outputmark.js`(L7 화면) | 완료 |
| Lambda 핸들러 | `lambda/index.js` (S3 uploads/ → outputs/, 실패 failed/, EC2 콜백) | 완료, AWS 미배포 |
| 웹앱 | `webapp/` FastAPI + PostgreSQL(로컬은 SQLite) | 로컬 E2E 통과, AWS 미배포 |
| 배포 자료 | `infra/` 스크립트, `infra/CONSOLE_GUIDE.md`(콘솔 수동 배포) | 작성 완료 |

검증 명령 (전부 통과 상태)
- `npm test` — 게임 요구사항, 스모크, 코드 매트릭스 63건, L8 공격자 측정, 화면(L7) 26건, 블라인드 재구현 재생 테스트. 오지목 0
- `npm run dev` 로 서버를 띄운 뒤 `npm run e2e` — 데모 장면 2~5, 7 재현

## 2. AWS 배포 현황 — 동작 중 (2026-11-26)

구성: **S3 저장 + EC2 처리(`STORAGE_MODE=s3`, `PROCESSOR_MODE=inline`)**. Lambda 는 쓰지 않는다(아래 이유).
브라우저 → S3 presigned 업로드 → EC2 가 `lambda/` 코드를 node 로 실행 → S3 `outputs/` → 화면 DONE.
외부 `http://52.91.90.157/healthz` 200, 대시보드 표시 확인. SSH 터널로 돌린 `tests/e2e_demo.py` ALL PASS.

| 자원 | 값 |
|---|---|
| 리전 | us-east-1 |
| EC2 | 이름 `codevault`, t3.small, Amazon Linux 2023, 퍼블릭 IP `52.91.90.157`(중지·시작하면 바뀜), 접속 `ec2-user` |
| SSH 키 | `C:\Users\kimse\.ssh\kmuproj-02-key-codevault.pem` (이 PC 에만 있음) |
| 보안 그룹 | SSH 22(내 IP), HTTP 80(0.0.0.0/0) |
| 인스턴스 역할 | `SafeInstanceProfile-kmu-proj-02` → `SafeRole-kmu-proj-02`. 버킷 읽기·쓰기·삭제·presign 확인 |
| S3 | `kmu-proj-02-s3`, 퍼블릭 차단 유지, CORS `http://52.91.90.157` (PUT/GET). 수명 주기 규칙은 아직 없음 |
| 서버 | `/opt/codevault`(main clone), `/etc/codevault.env`, systemd `codevault`, PostgreSQL 로컬 |

계정 제약 (확인된 사실)
- CLI 액세스 키 발급 불가 → 콘솔 작업은 사용자, 서버 작업은 SSH
- `iam:CreatePolicy` 는 `SafePowerUser` 정책이 명시적 거부 → Lambda 실행 역할에 S3 권한을 붙일 수 없어 inline 으로 결정(사용자 결정)
- 인스턴스 역할로는 IAM 조회(ListRoles/GetRole/GetPolicy) 불가

자주 쓰는 명령 (Git Bash)
- 접속: `ssh -i ~/.ssh/kmuproj-02-key-codevault.pem ec2-user@52.91.90.157`
- 코드 반영: 서버에서 `sudo bash /opt/codevault/infra/deploy.sh`
- 로그: `sudo journalctl -u codevault -n 50`
- 원격 E2E: `ssh -i ... -N -L 18080:127.0.0.1:80 ec2-user@52.91.90.157` 를 띄우고 `python tests/e2e_demo.py http://127.0.0.1:18080`
  (서버 DB 에 시험용 협력사·작업이 남는다)

로컬에만 있는 것 (git 에 없음): `infra/config.env` (BUCKET=kmu-proj-02-s3, 비밀값)

## 3. 남은 단계

1. (선택) S3 수명 주기 규칙 4개 — CONSOLE_GUIDE 2단계
2. 발표 전 IP 고정이 필요하면 탄력적 IP (IP 가 바뀌면 S3 CORS 도 바꿔야 함)
3. 발표 전 DB 정리가 필요하면 요청받아 진행 (E2E 시험 데이터가 있음)
4. 발표 후 EC2 중지·정리. 콘솔에서 만들다 만 Lambda `codevault-watermark` 와 그 역할이 있으면 삭제

## 4. 주의

- 비용이 드는 작업(EC2 시작, 탄력적 IP 등)은 실행 전에 사용자에게 확인. 발표 후 EC2 중지·정리(CONSOLE_GUIDE 마지막 절)
- 팀 계정이므로 다른 팀원 리소스를 수정·삭제하지 않는다
- 비밀값·키는 채팅이나 git 에 넣지 않는다
- 한글 경로에서 Node `fs.cpSync` 가 조용히 종료되는 문제가 있었다 — 직접 복사로 우회(`tools/build-lambda-zip.js`)
- 이 세션에서 막혀 진행하지 않은 것: 실제 AI 에게 지문 제거를 시키는 실험, "지우면 시스템이 망가지는 워터마크" 설계.
  다시 요청받으면 진행하지 않는다는 점을 사용자에게 알린다. AI 블라인드 재구현 실험은 사용자가 별도로 수행했다(`evidence/`)
