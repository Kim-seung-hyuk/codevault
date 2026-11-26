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

## 2. AWS 배포 진행 상황

계정·환경 제약 (확인된 사실)
- 리전: **us-east-1 (버지니아 북부)**
- 수업 계정의 IAM 사용자(콘솔 로그인: 계정 ID + IAM 사용자 + 비밀번호). 팀 이름 `kmu-proj-02`
- **CLI 액세스 키 발급 불가**(`iam:ListAccessKeys` 거부), `aws login` 도 브라우저에서 "잘못된 요청"으로 실패
  → 이 PC 에서 AWS CLI 로 직접 배포할 수 없다. 사용자가 콘솔에서 작업하고, 서버 작업은 SSH 로 진행한다
- AWS CLI v2.42.2 는 이 PC 에 설치됨(`C:\Program Files\Amazon\AWSCLIV2\aws.exe`), 자격 증명은 없음
- EC2 용 인스턴스 프로파일 `SafeInstanceProfile-kmu-proj-02` 가 있음. 권한 범위(S3 접근 등)는 아직 미확인
- Lambda "새 역할 생성"은 선택 시 오류 없음. 실제 생성·S3 권한 부여 가능 여부는 미확인

EC2 — 기존 인스턴스를 재사용하기로 함 (사용자 결정)
- AMI `nxtcloud-ami-v1.0.2` (수업 제공 이미지), vCPU 2, 11/11 생성 후 중지 상태였음, **키 페어 없음**
- 접속 방법: 이 PC 에서 만든 SSH 키 `C:\Users\kimse\.ssh\codevault_ed25519`(개인 키는 이 PC 에만 있음)의 공개 키를
  사용자가 Session Manager 브라우저 터미널에서 `authorized_keys` 에 등록 → 보안 그룹에 SSH 22(내 IP), HTTP 80(0.0.0.0/0) 추가
- 공개 키: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPm7RPjSy1Frx3CwsyNMt4WpbYqK/z0z+ycoy3nexT+u codevault-deploy`

로컬에만 있는 것 (git 에 없음)
- `infra/config.env` — `BUCKET=codevault-2a5ee0`, `CALLBACK_SECRET`, `WM_SECRET`, `REGION=us-east-1`. 비밀값은 이 파일에서만 확인
- `dist/codevault-lambda.zip` — `npm run build:lambda` 로 다시 만든다 (핸들러 `index.handler`, Node.js 22.x)

## 3. 남은 단계 (순서대로)

1. [사용자] 기존 EC2 시작 → Session Manager 로 공개 키 등록 → 보안 그룹 22/80 → 퍼블릭 IP 와 로그인 계정 이름(`ec2-user`/`ubuntu`) 알려 주기
2. [Claude] SSH 접속 → 점검(OS, 메모리, `aws sts get-caller-identity` 로 인스턴스 역할, S3 접근)
3. [사용자] S3 버킷 `codevault-2a5ee0` 생성 (CONSOLE_GUIDE 2단계, 수명 주기 규칙 4개)
4. [Claude] SSH 로 `infra/ec2-bootstrap.sh` 실행 — `REGION=us-east-1 BUCKET=codevault-2a5ee0` 와 config.env 의 비밀값을 넘긴다.
   부트스트랩 기본 리전이 ap-northeast-2 이므로 **REGION 을 꼭 넘길 것**. 스왑 1GB, PostgreSQL, systemd, 80 포트
5. 인스턴스 역할로 S3 를 못 쓰면: `/etc/codevault.env` 를 `STORAGE_MODE=local`, `PROCESSOR_MODE=inline` 으로 바꿔 EC2 단독 데모 (README 5절)
6. [사용자] Lambda 생성 (CONSOLE_GUIDE 4단계): 실행 역할 → zip 업로드 → 환경 변수 5개 → 비동기 재시도 2 → S3 트리거(uploads/, .zip)
   역할 문제로 막히면 `PROCESSOR_MODE=inline` (EC2 가 같은 Lambda 코드를 node 로 실행)
7. [사용자] S3 CORS 에 `http://<EC2 IP>` 추가 (CONSOLE_GUIDE 5단계)
8. [Claude] `http://<EC2 IP>/healthz` 확인 → 웹에서 업로드 → DONE → 유출본 검사까지 실환경 검증

## 4. 주의

- 비용이 드는 작업(EC2 시작, 탄력적 IP 등)은 실행 전에 사용자에게 확인. 발표 후 EC2 중지·정리(CONSOLE_GUIDE 마지막 절)
- 팀 계정이므로 다른 팀원 리소스를 수정·삭제하지 않는다
- 비밀값·키는 채팅이나 git 에 넣지 않는다
- 한글 경로에서 Node `fs.cpSync` 가 조용히 종료되는 문제가 있었다 — 직접 복사로 우회(`tools/build-lambda-zip.js`)
- 이 세션에서 막혀 진행하지 않은 것: 실제 AI 에게 지문 제거를 시키는 실험, "지우면 시스템이 망가지는 워터마크" 설계.
  다시 요청받으면 진행하지 않는다는 점을 사용자에게 알린다. AI 블라인드 재구현 실험은 사용자가 별도로 수행했다(`evidence/`)
