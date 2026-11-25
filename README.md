# CodeVault — 재배포 코드의 배포 경로 지문

고객사(예: 인디 스튜디오 **픽셀웍스**)가 재배포용 코드(여기서는 HTML5 픽셀 게임)를 올리면,
받아 갈 **협력사마다 보이지 않는 워터마크**를 넣은 빌드를 돌려준다.
나중에 유출본이 발견되면 그 파일만으로 **어느 협력사 경로에서 샜는지** 역조회한다.

> RE(역공학)를 막는 방패가 아니라 **지문**이다. 식별 대상은 RE 를 한 사람이 아니라
> "그 복사본을 받아 간 고객사(배포 경로)"다. 서명(HMAC)이 검증될 때만 지목하고, 아니면 아무도 지목하지 않는다.

---

## 1. 구성

```
games/            오리지널 픽셀 게임 3개 (canvas + 순수 JS, 외부 라이브러리 없음)
  comet-shower/   낙하물 피하기       — 함수 12개
  lantern-range/  표적 맞추기         — 함수 11개
  moss-hop/       한 화면 점프 플랫포머 — 함수 10개
                  각 폴더: index.html · game.js · manifest.json
lambda/           워터마크 Lambda (Node 20) — S3 uploads/ 이벤트로 실행
  index.js        핸들러: 협력사별 빌드 → outputs/, 실패 → failed/, EC2 콜백
  extract-cli.js  유출본 추출 CLI (EC2 웹앱이 subprocess 로 호출, 같은 lib 사용)
  local-invoke.js S3 이벤트를 흉내 내 핸들러 실행 (로컬 데모 / IAM 없을 때 대안)
  lib/            watermark.js(6층 삽입·추출) · pkg.js(zip) · storage.js(S3|로컬) · callback.js(HMAC 서명)
webapp/           EC2 웹 + API (FastAPI, Stateless) + PostgreSQL
infra/            AWS CLI 스크립트, EC2 부트스트랩, systemd 유닛, IAM 정책
tests/            공격 매트릭스(run-matrix.js), 게임 스모크, 데모 E2E
tools/            check-game(요구사항 검사) · pack-games(zip) · make-leak(유출본 생성)
poc/              이전 PoC 원본 (watermark.js, attacks.js, run-matrix.js, RESULTS.md)
RESULTS.md        최신 매트릭스 결과 (자동 생성)
```

### 아키텍처

```
 브라우저 ──(1) POST /api/jobs──────────▶ EC2 t3.small: FastAPI ── PostgreSQL(localhost)
    │      ◀─ presigned PUT URL ────────      │  customers / jobs / marks
    │                                         │  (2) jobs/<id>/spec.json 기록
    └─(3) PUT zip ──▶ S3 uploads/<id>/game.zip
                          │ ObjectCreated (prefix uploads/, suffix .zip)
                          ▼
                     Lambda codevault-watermark  (비동기 재시도 2회)
                          ├─ 성공 → S3 outputs/<id>/<mark>/files/*, *.zip  (수명주기로 만료)
                          ├─ 실패 → S3 failed/<id>/error.json (+원본)
                          └─(4) POST /api/internal/lambda-callback  (공유 비밀키 HMAC 서명)
 유출본 ──▶ POST /leak ──▶ EC2 가 node lambda/extract-cli.js 실행 ──▶ marks 조회 ──▶ 리포트
```

- Lambda 는 VPC 에 넣지 않고 DB 에 직접 붙지 않는다. 결과는 콜백으로만 EC2 에 알린다.
- EC2 는 상태를 갖지 않는다(파일은 S3, 메타데이터는 PostgreSQL). 재배포해도 데이터가 남는다.
- **실서비스 확장안(발표용, 미구현)**: S3 → SQS → Lambda 로 버퍼링·DLQ, RDS Multi-AZ, ALB + Auto Scaling, 페이로드 확장(8비트 → 32비트, ECC).

### 테이블

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `customers` | id, name, role, contact, nda_ref | 빌드를 받아 가는 협력사(배포 경로) |
| `jobs` | id, status, created_at, upload_key, result | `(status, created_at)` 인덱스. `PENDING_UPLOAD → UPLOADED → PROCESSING → DONE/FAILED` |
| `marks` | **mark_id PK** → customer_id, job_id, zip_key, sha256, revoked_at | mark_id(1~255)가 워터마크 페이로드. 빌드 1개당 1행 |

### 워터마크 8층 (코드 7층 + 화면 출력 1층)

페이로드 = 8비트 `mark_id` + 8비트 `HMAC-SHA256(WM_SECRET, mark_id)` 태그 = 16비트 코드워드.
층마다 태그로 스스로 검증하므로, 남은 층 하나만으로도 진짜 표식인지 가릴 수 있다.

| 층 | 위치 | 싣는 것 | 강점 / 약점 |
|---|---|---|---|
| L1 | zero-width 문자 주석 | 코드워드 | 그대로 유출되면 즉시 식별 / 주석 제거에 소실 |
| L2 | 최상위 함수 선언 순서 (Lehmer 순열) | 코드워드 | 공백·주석 제거에 생존 / minify·함수 이동에 붕괴 |
| L3 | `GAME_CONFIG` 키 순서 (8! 순열) | mark 8비트 + **7비트 태그** | minify 로 변수명이 바뀌어도 "값이 모두 리터럴인 8키 객체"를 찾아 읽음 / 키 재정렬에 소실 |
| L4 | `PALETTE` 8색 blue 하위 2비트 | 코드워드 | minify+mangle 에 생존 / 색 변경에 손상 |
| L5 | **소수 상수의 가수 최하위 24비트** (`2.2` → `2.2000000041…`) | 리터럴마다 코드워드 + 8비트 검사값 | 위치와 무관해 함수 이동·minify·**강한 난독화에도 생존** / 숫자를 반올림하면 소실, 소스에 긴 소수로 보임 |
| L6 | **줄 끝 공백 패턴** (줄 내용 해시 → 비트 슬롯, 공백=0·탭=1) | 코드워드 | 주석만 손으로 지운 사본에 생존, 줄 이동에 강함 / 포매터·minify 에 소실 |
| L8 | **게임플레이 데이터 표** (낙하 일정·비행 경로·발판/씨앗/딱정벌레 좌표, `lambda/lib/semantic.js`) | mark 별 비밀 ±1 패턴 (확산 스펙트럼) | **지우려면 게임 데이터를 바꿔야 함**. 원본 값을 모르는 공격자는 되돌릴 수 없고, 잡음을 우리 패턴보다 크게 넣어야 지워진다. minify·난독화(숫자를 식으로 바꿔도 값 복원)·행 섞기에 생존 / 검출에 빌드 때 저장한 원본 레퍼런스가 필요(비블라인드) |
| L7 | **게임이 그린 화면 픽셀** (렌더링 후처리, `lambda/lib/outputmark.js`) | 코드워드 (화이트닝) | **코드 없이 스크린샷(PNG)만으로 추적**. 코드 minify·난독화·A5 교란 후에도 화면에 남음 / JPEG·영상 압축, 부드러운 확대, 화면 일부만 자른 사진에 약함. 후처리 코드를 찾아 지우면 사라짐 |

L5 의 값 변화는 상대 2^-28(약 4×10⁻⁹) 이하다. 같은 시드·같은 입력으로 600프레임을 비교하면 점수·생명·수집 같은 게임 결과는 원본과 같았지만, 위치가 정수 경계(예: 138.0000000 vs 137.9999999)에 걸릴 때 `Math.floor` 결과가 갈려 **1px 차이가 나는 프레임**이 생겼다(comet-shower 133/600, moss-hop 586/600). 정확한 값 비교(`==`, 경계 착지)에 의존하는 코드라면 드물게 동작이 갈릴 수 있으므로, 실서비스에서는 L5 대상 상수를 고를 때 이 점을 검사해야 한다.

**L8 시맨틱 지문의 동작.** L1~L6 은 "바꿔도 동작이 같은 자리"에 숨겨서, 위치를 아는 공격자가 손실 없이 지울 수 있었다(측정: 지운 빌드가 원본과 600프레임 픽셀까지 같음).
L8 은 실제로 게임을 움직이는 데이터 표의 정수 55~64개를 협력사별 비밀 ±1 패턴만큼 옮긴다.
검출은 원본(빌드 때 저장) 대비 차이와 각 mark 패턴의 정규화 상관 z 를 계산해 z ≥ 5 일 때만 지목한다.
o 가 패턴과 무관하면 z 는 표준정규분포라, 공격자가 어떤 잡음을 넣어도 오지목 확률은 255개 mark 기준 약 7×10⁻⁵ 이하로 보장된다.
대가: 협력사 빌드끼리도 데이터가 ±1 다르다(낙하 위치·발판 좌표 1px, 비행 속도 1%). 사람이 플레이로 구분할 수준은 아니지만 "픽셀까지 같은 빌드"는 아니다.

**L7 출력 지문의 동작.** 빌드에 렌더링 후처리 코드를 붙인다. 매 프레임 게임이 그린 뒤 화면을 8×4 칸으로 나누고,
코드워드 비트에 따라 칸의 모든 픽셀 red 채널 최하위 비트를 뒤집는다(밝기 차이 1/255, 눈에 보이지 않음).
비트 하나를 왼쪽·오른쪽 두 칸이 반대 상태로 나눠 맡아서(Manchester) 화면 내용과 상관없이 읽힌다.
검출기는 스크린샷에서 "red 최하위 비트만 다른 색 쌍"을 찾아 캔버스 위치를 잡는다. 그래서 확대 배율, 화면 위치,
한 장에 여러 빌드가 있는 경우(나란히 플레이 화면)를 모두 처리한다. 코드에서 지문을 지워도, 그 전에 퍼진 방송 화면·스크린샷은 여전히 추적된다.
포토샵 같은 일반 소프트웨어라면 필터·보간 계수에 지문을 넣어, 그 프로그램이 만든 결과 이미지에 지문이 묻어나게 하는 것이 같은 원리다.

판정 규칙: 태그가 검증된 층들을 mark 별로 묶어 가중치를 더한다(8비트 태그 층 = 1, L3 = 0.5).
- 가장 무거운 묶음이 1 이상이고 다른 묶음보다 무거우면 `IDENTIFIED`
  - 합이 1.5 이상이고 반대 층이 없으면 **HIGH**, 그 밖은 **MEDIUM**
- 다른 mark 묶음이 같거나 더 무거우면 `CONFLICT`
- 그 밖은 `NO_RELIABLE_MARK`. L3 단독(0.5)으로는 지목하지 않는다.

웹앱은 추가로 mark 가 DB 에 등록된 빌드일 때만 협력사를 지목한다.

### 게임 작성 규칙 (업로드 시 Lambda 가 검사)

- 실제로 쓰이는 최상위 `function` 선언 10~12개, `(파라미터 수, 문장 수)` 지문이 모두 달라야 함
- 키 8개짜리 `var GAME_CONFIG = {...}`, `'#rrggbb'` 8색 `var PALETTE = [...]`
- 색 문자열은 PALETTE 에만 둔다 (다른 곳은 `PALETTE[i]` 참조)
- `GAME_CONFIG` 값은 모두 리터럴, 소수 상수(예: 속도 `2.2`)는 3개 이상 권장(L5)
- `manifest.json` 의 `watermark.targets` 에 워터마크 넣을 JS 를 적는다
- 검사: `npm run check`

---

## 2. 로컬 실행 (S3·Lambda 없이 로컬 폴더 모드)

필요: Node 18+ (개발은 24), Python 3.9+.

```powershell
npm install
npm run setup
pip install -r webapp/requirements.txt
```

```powershell
npm run dev
```

브라우저에서 http://localhost:8000 을 연다. 기본값은 `STORAGE_MODE=local`, `PROCESSOR_MODE=inline`, SQLite(`data/codevault.db`)다.
`data/bucket/` 폴더가 S3 버킷 역할을 하고, presigned URL 은 HMAC 서명 URL(`/local-s3/...`)로 흉내 낸다.
업로드가 끝나면 EC2 가 같은 Lambda 코드를 `node lambda/local-invoke.js` 로 실행하고, 콜백도 실제와 같은 HMAC 경로로 들어온다.

게임만 따로 실행하려면 `games/<이름>/index.html` 을 브라우저로 열면 된다.

### 테스트

```powershell
npm test
```

요구사항 검사, 게임 3개 × (원본·워터마크 빌드) 600프레임 스모크, 공격 매트릭스(게임 3 × 협력사 3 × 공격 6 + 오탐 검사)를 실행하고 `RESULTS.md` 를 갱신한다.

```powershell
npm run e2e
```

L8 대 "층을 아는 공격자"는 `node tests/semantic-attack.js`(결과 `RESULTS-L8.md`), L7 은 `node tests/output-mark.js` 로 따로 돌릴 수 있다(둘 다 `npm test` 에 포함). 게임을 소프트웨어 canvas 에서 실제로 렌더링하고,
스크린샷을 여러 형태로 꾸며 PNG 로 검출한다. 결과는 `RESULTS-L7.md` 에 남는다.

서버를 띄운 상태에서 데모 2~5장면과 7장면(강한 난독화본 → 여전히 B, 층을 아는 공격자 → 표식 없음)을 HTTP 로 끝까지 재현한다.

현재 결과 요약(`RESULTS.md`):

| 공격 | 정확 식별 (9개 빌드) | 신뢰도 HIGH | 오지목 | 살아남는 층 |
|---|---|---|---|---|
| 그대로 | 9 | 9 | 0 | L1~L6, L8 전부 |
| 주석·공백 제거 | 9 | 9 | 0 | L2 L3 L4 L5 L8 |
| terser minify+mangle | 9 | 9 | 0 | L3 L4 L5 L8 |
| beautify+수동 편집(함수 이동·색 변경) | 9 | 9 | 0 | L3 L5 L8 (+L4 일부) |
| 강한 난독화(javascript-obfuscator) | 9 | 9 | 0 | L5 L8 |
| A5: L1~L7 을 아는 공격자 | 9 | 6 | 0 | L8 |
| A6: L8 까지 아는 공격자(데이터 ±3 잡음) | 1 | 0 | 0 | — |
| 무표식 원본·무관한 JS·다른 게임 | 전부 거부 | — | — | — |

**층을 아는 공격자 측정 (`RESULTS-L8.md`, 게임 3 × 협력사 3 × 20회)**

| 공격 | 추적 성공 | 원본 대비 데이터 변화 (평균) |
|---|---|---|
| A5 (L1~L7 을 앎) | 9/9 | 1.00 (= 지문 빌드 그대로) |
| A6 데이터 ±1 잡음 | 100% | 1.00 |
| A6 데이터 ±2 잡음 | 54% | 1.27 |
| A6 데이터 ±3 잡음 | 7% | 1.68 |
| A6 데이터 ±5 잡음 | 0% | 2.64 |
| A6 4 단위 반올림 / 8 단위 | 44% / 0% | 1.18 / 1.93 |
| A6 ±1 잡음 + 표 행 섞기 | 86% | 1.13 |

데모 게임은 데이터가 55~64개뿐이라, 공격자가 값마다 평균 1.7 정도만 흔들어도(±3 잡음) 대부분 지워진다. 그 정도 변화는 플레이로 잘 드러나지 않으므로 **데모 규모에서는 공격 비용이 여전히 작다.**
z 는 데이터 개수의 제곱근에 비례하므로 데이터 표가 큰 제품일수록 필요한 잡음이 커진다(합성 데이터 표 측정).

| 데이터 값 개수 | 추적률이 50% 아래로 떨어지는 잡음 | 그때 원본 대비 평균 변화 |
|---|---|---|
| 64 | ±3 | 1.6 |
| 256 | ±8 | 4.1 |
| 1024 | ±12 | 6.1 |
| 4096 | ±30 | 15.2 |

예를 들어 밸런스 표·레벨 데이터가 수천 개인 상용 게임이라면, 지문을 지우려면 모든 값을 ±30 범위로 흔들어야 하고 이는 게임 밸런스가 달라지는 수준이다.

L7(화면) 결과: 게임 3개 모두 원본 크기·×3·×2.5 확대, 세 빌드 나란히 화면(3개 동시 식별), terser·난독화·A5 빌드의 화면에서 식별 성공, 무표식 화면·사진·잡음은 거부(필수 26건 통과, 오지목 0).
실제 Chrome 에서도 canvas PNG, 세 빌드 합성 스크린샷이 식별됐고, 부드러운 확대·JPEG 는 식별되지 않았다(한계).

4층 PoC 때는 수동 편집 3/9(우연), 난독화 0/9였다. L3 태그와 L5 를 더해 둘 다 9/9 가 됐다.
표식 없는 파일을 무작위로 바꿔 넣었을 때 우연히 서명이 맞는 비율은 약 0.7%(이론값 2/256)이고, 모두 MEDIUM 이었다.
그래서 리포트는 MEDIUM 을 "추가 증거와 함께 판단"으로 표시하고, 등록된 빌드가 아니면 지목하지 않는다.

---

## 3. 발표 데모 순서 (장면 2~7)

1. 대시보드에서 협력사 3곳을 등록한다: 퍼블리셔 A, 현지화 업체 B, 스트리머 C(NDA 번호 포함).
2. **새 배포 빌드**에서 샘플 `moss-hop.zip` 을 고르고 A/B/C 를 체크한 뒤 업로드한다. 작업 화면에서 상태가 `DONE` 이 되고 빌드 3개가 생긴다.
3. **세 빌드 나란히 플레이**에서 같은 게임이 똑같이 돌아가는 것을 보여 준다. mark 번호와 SHA-256 만 다르다.
4. B 빌드의 **zip 다운로드**를 받은 뒤 유출본을 만든다.
   ```powershell
   node tools/make-leak.js "$HOME\Downloads\moss-hop-buildNN.zip" terser -o leaked.js
   ```
5. **유출본 검사**에 `leaked.js` 를 올린다. 결과는 "현지화 업체 B 경로, 서명 검증 통과"(신뢰도 높음)이고, 층별 표에서 L1·L2·L6 은 지워졌지만 L3·L4·L5 가 남은 것이 보인다.
   - **화면 지문 버전(스트리머 C 시나리오):** 플레이 화면의 게임 canvas 를 우클릭 → "이미지를 다른 이름으로 저장"(PNG)하거나, Win+Shift+S 로 캡처해 PNG 로 저장해 올린다. 결과는 "○○ 경로, 서명 검증 통과 (화면 출력 지문)"이다. **나란히 플레이 화면 전체를 캡처하면 세 빌드가 한 번에 각각 식별된다.** 실제 캡처 없이 하려면 `node tools/screenshot.js <빌드.zip> -o shot.png` 로 만든다.
6. (대응) 리포트의 권장 대응에서 **공급 중단**을 누르면 해당 빌드 다운로드가 410 으로 막힌다.
7. (한계)
   - `obfuscate`(강한 난독화)와 `scrub`(L1~L7 을 아는 공격자) 유출본도 L8 이 남아 B 를 가리킨다.
   - `datascrub`(L8 까지 알고 게임 데이터를 ±5 흔든 사본)은 "표식 없음 — 어느 협력사도 지목하지 않음"이 나온다. 이때 게임 데이터가 원본에서 평균 2.6 만큼 달라졌다는 점이 공격자가 치른 비용이다. 데모 게임은 데이터가 적어 이 비용이 작고, 데이터가 많은 제품일수록 커진다.

---

## 4. 배포: 로컬 → GitHub → EC2, S3·Lambda 연동

> 아래 단계는 AWS 리소스를 만들고 **비용이 발생**한다(EC2 t3.small 시간당 과금, S3·Lambda 는 데모 규모에서 소액).
> 각 스크립트는 실행 전에 `[y/N]` 으로 다시 묻는다.

### 4-1. GitHub

```powershell
git remote add origin https://github.com/<계정>/codevault.git
```

```powershell
git push -u origin main
```

private 저장소라면 EC2 에서 clone 할 때 deploy key 나 토큰이 필요하다.

### 4-2. 인프라 설정값

AWS CLI 가 설정된 곳(로컬 Git Bash/WSL 또는 **AWS CloudShell**)에서 실행한다.

```bash
cp infra/config.env.example infra/config.env
openssl rand -hex 24   # CALLBACK_SECRET 용
openssl rand -hex 24   # WM_SECRET 용
```

`BUCKET`, `EC2_PUBLIC_URL`(탄력적 IP 권장), 비밀값 2개를 채운다.

### 4-3. EC2 (t3.small, Amazon Linux 2023 또는 Ubuntu)

1. 인스턴스를 만든다. 보안그룹 인바운드는 **22(내 IP)**, **80(0.0.0.0/0)** 두 개다. 80 은 Lambda 콜백이 인터넷 경유로 들어오기 때문에 열어야 한다. 5432 는 열지 않는다.
2. 탄력적 IP 를 붙이고 그 주소를 `EC2_PUBLIC_URL` 에 적는다.
3. SSH 로 접속해 부트스트랩을 실행한다. 스왑 1GB, PostgreSQL(localhost), Node 20, Python venv, systemd 를 설정한다.
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/<계정>/codevault/main/infra/ec2-bootstrap.sh
   sudo REPO_URL=https://github.com/<계정>/codevault.git BUCKET=<버킷> \
        CALLBACK_SECRET=<config.env 값> WM_SECRET=<config.env 값> bash ec2-bootstrap.sh
   ```
   비밀값을 생략하면 새로 만들어 `/etc/codevault.env` 에 저장하고 출력한다. 그 값을 `infra/config.env` 에 옮겨 적는다.

### 4-4. S3 → IAM → Lambda

```bash
bash infra/01-s3.sh       # 버킷, 퍼블릭 차단, 암호화, CORS, 수명주기(uploads 3일 / outputs 7일 / failed·jobs 30일)
bash infra/02-iam.sh      # Lambda 실행 역할 + EC2 인스턴스 프로파일 (권한이 있을 때)
aws ec2 associate-iam-instance-profile --instance-id i-xxxx --iam-instance-profile Name=codevault-ec2-profile
bash infra/03-lambda.sh   # 패키징, 생성/갱신, 재시도 2회, AddPermission, uploads/*.zip 이벤트 알림
```

### 4-5. 확인과 이후 배포

```bash
curl http://<EC2_IP>/healthz                       # {"storage":"s3","processor":"lambda"}
aws logs tail /aws/lambda/codevault-watermark --follow
```

코드를 고친 뒤에는 로컬에서 `git push` 하고, EC2 에서 `sudo bash /opt/codevault/infra/deploy.sh` 를 실행한다(git pull → 의존성 → 재시작).
Lambda 코드가 바뀌었으면 `bash infra/03-lambda.sh` 를 다시 실행한다.

---

## 5. IAM 역할을 쓸 수 없을 때의 대안

권한 상황에 따라 다음 중 하나를 고른다.

| 상황 | 대안 |
|---|---|
| **기존 역할만 있음** (예: AWS Academy `LabRole`) | `config.env` 의 `LAMBDA_ROLE_ARN` 에 그 ARN 을 넣고 `02-iam.sh` 는 건너뛴다. EC2 에도 같은 계열 인스턴스 프로파일(`LabInstanceProfile`)을 붙인다. |
| **EC2 인스턴스 프로파일 불가, IAM 사용자 키는 가능** | `infra/iam/ec2-policy.json` 권한만 가진 IAM 사용자를 만들고 그 키를 `/etc/codevault.env` 의 `AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY` 에 넣는다(권한 640, git 에 넣지 않음). boto3 가 자동으로 읽는다. |
| **Lambda 실행 역할을 만들 수 없음** (Lambda 생성 불가) | `/etc/codevault.env` 에서 `PROCESSOR_MODE=inline` 으로 바꾸고 재시작한다. 브라우저가 업로드 완료를 알리면 EC2 가 **같은 Lambda 코드**를 `node lambda/local-invoke.js` 로 실행해 S3 `outputs/`·`failed/` 에 쓰고 같은 콜백 경로로 상태를 갱신한다. S3 이벤트 알림은 설정하지 않는다. 발표에서는 "이벤트 기반 Lambda 가 목표 구성이고, 권한 제약 때문에 같은 코드를 EC2 워커로 돌린다"고 설명한다. |
| **S3 접근 자체가 막힘** | `STORAGE_MODE=local` 로 EC2 디스크(`/var/lib/codevault/bucket`)를 쓴다. 데모는 그대로 동작하지만 Stateless 는 아니다. |

---

## 6. 환경변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `STORAGE_MODE` | `local` | `s3` 또는 `local` |
| `PROCESSOR_MODE` | local 이면 `inline`, s3 이면 `lambda` | `lambda` 는 S3 이벤트, `inline` 은 EC2 에서 node 로 직접 처리 |
| `BUCKET`, `AWS_REGION` | —, `ap-northeast-2` | S3 |
| `DATABASE_URL` | `sqlite:///data/codevault.db` | EC2 는 `postgresql+psycopg2://codevault:...@127.0.0.1:5432/codevault` |
| `CALLBACK_SECRET` | 개발용 값 | Lambda→EC2 콜백 HMAC (Lambda 환경변수와 같아야 함) |
| `WM_SECRET` | 데모 기본값 | 워터마크 태그 키 (Lambda 와 EC2 가 같아야 함, **바꾸면 기존 빌드 추적 불가**) |
| `PORT` | 8000 (EC2 는 80) | |

---

## 7. 한계 (발표 7장면)

- L1~L7 은 위치를 아는 공격자가 손실 없이 지운다(A5). 남는 것은 L8 하나다.
- L8 까지 아는 공격자는 게임 데이터에 잡음을 넣어 지울 수 있다(A6). 데모 게임은 데이터가 55~64개뿐이라 평균 1.7 정도의 변화로 지워진다. 비용은 데이터 규모에 비례해 커진다(위 표).
- L8 검출에는 빌드 때 저장한 원본 레퍼런스가 필요하다. 레퍼런스가 없는 게임의 유출본은 L8 로 판정할 수 없다.
- 협력사 빌드끼리 게임 데이터가 ±1 다르다(L8 의 대가).
- 어떤 공격에서도 잘못된 협력사를 지목하지 않았다(코드 63건 + L8 측정 + 화면 26건).
- L5 는 소스에 `2.2000000041…` 같은 긴 소수로 드러나므로, 코드를 읽는 사람이 눈치챌 수 있다. 숨김 층은 공격 비용을 올릴 뿐 비밀이 아니다(키는 비밀).
- L7 은 무손실 PNG 에서만 읽힌다. JPEG·방송 영상 압축, 부드러운 확대, 화면 일부만 자른 스크린샷에서는 실패한다(이때도 지목하지 않음). 압축을 견디려면 더 강한 확산 스펙트럼 방식이 필요하다(확장안).
- L7 후처리 코드도 코드를 읽는 공격자(AI 포함)는 찾아서 지울 수 있다. 다만 지우기 전에 이미 퍼진 화면은 추적된다.
- 페이로드가 8비트라 동시에 발급할 수 있는 빌드는 255개다. 실서비스에서는 페이로드를 늘리고 ECC 를 붙여야 한다.
- 태그가 8비트라 단일 층(MEDIUM) 식별은 우연 일치 확률이 약 1/256 이다. 계약 분쟁의 단독 증거로 쓰지 않고, 조사를 시작하는 근거로 쓴다.
- 워터마크는 코드 열람이나 수정을 막지 못한다. 목적은 억지력과 사후 추적이다.
