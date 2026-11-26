# 콘솔(웹 화면)으로 배포하기 — CLI 액세스 키가 없는 수업 계정용

`infra/*.sh` 스크립트가 하는 일을 AWS 콘솔 클릭으로 옮긴 안내서다. 리전은 **미국 동부(버지니아 북부) us-east-1**.
콘솔 오른쪽 위 리전이 "버지니아 북부"인지 매 단계 확인한다.

준비물 (이 PC)
- `infra/config.env` — 버킷 이름(`BUCKET`), 비밀값 `CALLBACK_SECRET`·`WM_SECRET` (git 에 올라가지 않는 파일)
- `dist/codevault-lambda.zip` — Lambda 에 올릴 코드 (없으면 개발 PC 에서 다시 만든다)

---

## 1단계. 권한 확인 (아무것도 만들지 않음, 무료)

역할(IAM)을 새로 만들 수 있는지에 따라 이후 경로가 갈린다.

1. **Lambda** 콘솔 → **함수 생성** → 아래쪽 **기본 실행 역할 변경**을 펼친다.
   - "기본 Lambda 권한을 가진 새 역할 생성"을 골라도 오류가 없는지
   - "기존 역할 사용"을 골랐을 때 드롭다운에 어떤 역할이 보이는지 (예: `LabRole`)
   - 확인만 하고 **취소**
2. **EC2** 콘솔 → **인스턴스 시작** → 맨 아래 **고급 세부 정보** → **IAM 인스턴스 프로파일** 드롭다운에 무엇이 있는지 확인하고 **취소**

결과에 따라
- 역할을 쓸 수 있음 → 아래 순서대로 (Lambda 처리 + EC2 가 역할로 S3 접근)
- 역할이 없음 → Lambda 는 만들 수 없다. EC2 하나로 `STORAGE_MODE=local`, `PROCESSOR_MODE=inline` 데모 구성으로 간다 (README 5절)

---

## 2단계. S3 버킷 (저장 용량만큼 소액)

**S3** → **버킷 만들기**
- 버킷 이름: `config.env` 의 `BUCKET` 값
- AWS 리전: 미국 동부(버지니아 북부) us-east-1
- 객체 소유권: ACL 비활성화(기본값)
- **모든 퍼블릭 액세스 차단: 체크 유지**(기본값)
- 기본 암호화: SSE-S3(기본값)
- **버킷 만들기**

**수명 주기 규칙** (버킷 → **관리** 탭 → **수명 주기 규칙 생성**) — 4번 반복

| 규칙 이름 | 접두사 | 현재 버전 만료 |
|---|---|---|
| expire-uploads | `uploads/` | 3일 |
| expire-outputs | `outputs/` | 7일 |
| expire-failed | `failed/` | 30일 |
| expire-jobs | `jobs/` | 30일 |

각 규칙: 범위 "필터를 사용하여 범위 제한" → 접두사 입력 → 작업에서 "객체의 현재 버전 만료" 체크 → 일수 입력 → 생성.

CORS 는 EC2 주소가 정해진 뒤 5단계에서 넣는다.

---

## 3단계. EC2 (t3.small — 켜져 있는 시간만큼 과금)

**EC2** → **인스턴스 시작**
- 이름: `codevault`
- AMI: **Amazon Linux 2023** (기본값)
- 인스턴스 유형: **t3.small**
- 키 페어: **새 키 페어 생성** → 이름 `codevault-key`, RSA, `.pem` → 내려받은 파일을 `C:\Users\<사용자>\.ssh\codevault-key.pem` 으로 옮긴다
- 네트워크 설정 → **편집**
  - 퍼블릭 IP 자동 할당: 활성화
  - 보안 그룹 생성, 인바운드 규칙
    - SSH 22: 소스 **내 IP**
    - HTTP 80: 소스 **위치 무관(0.0.0.0/0)** — 웹 화면과 Lambda 콜백이 들어오는 포트
- 스토리지: 8 GiB gp3 (기본값)
- 고급 세부 정보 → **IAM 인스턴스 프로파일**: 1단계에서 확인한 것 (없으면 비움)
- **인스턴스 시작**

인스턴스가 "실행 중"이 되면 **퍼블릭 IPv4 주소**를 적어 둔다.
발표 동안 주소가 바뀌지 않게 하려면 **탄력적 IP** → 할당 → 이 인스턴스에 연결 (퍼블릭 IPv4 요금이 시간당 소액 발생).

이후 서버 설정(스왑, PostgreSQL, 코드 배포)은 SSH 로 `infra/ec2-bootstrap.sh` 를 실행한다 — 개발 PC 에서 진행.

---

## 4단계. Lambda (호출량만큼 과금, 데모 규모는 프리 티어 수준)

**Lambda** → **함수 생성** → 새로 작성
- 함수 이름: `codevault-watermark`
- 런타임: **Node.js 22.x**, 아키텍처 x86_64
- 실행 역할: 1단계에서 확인한 역할
- **함수 생성**

코드: **코드** 탭 → **업로드 대상** → **.zip 파일** → `dist/codevault-lambda.zip`
- 런타임 설정의 핸들러가 `index.handler` 인지 확인

**구성** 탭
- 일반 구성 → 편집: 메모리 **512 MB**, 제한 시간 **1분**
- 환경 변수 → 편집 → 5개 추가

| 키 | 값 |
|---|---|
| `STORAGE_MODE` | `s3` |
| `BUCKET` | `config.env` 의 BUCKET |
| `WM_SECRET` | `config.env` 의 WM_SECRET |
| `CALLBACK_SECRET` | `config.env` 의 CALLBACK_SECRET |
| `CALLBACK_URL` | `http://<EC2 퍼블릭 IP>/api/internal/lambda-callback` |

- 비동기식 호출 → 편집: 최대 재시도 횟수 **2**, 이벤트 최대 사용 기간 1시간

**트리거 추가** (함수 개요 → 트리거 추가)
- 소스: **S3**, 버킷: 2단계 버킷
- 이벤트 유형: 모든 객체 생성 이벤트
- 접두사 `uploads/`, 접미사 `.zip`
- 재귀 호출 경고 확인란 체크 → **추가** (트리거를 추가하면 S3 의 호출 권한도 자동으로 붙는다)

---

## 5단계. S3 CORS (브라우저가 S3 로 직접 업로드하기 위해 필요)

버킷 → **권한** 탭 → **CORS(Cross-origin 리소스 공유)** → 편집 → 아래를 붙여 넣고 IP 를 바꾼다.

```json
[
  {
    "AllowedOrigins": ["http://<EC2 퍼블릭 IP>", "http://localhost:8000"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

---

## 6단계. 확인

- 브라우저에서 `http://<EC2 퍼블릭 IP>/healthz` → `{"ok":true,"storage":"s3","processor":"lambda"}`
- 웹 화면에서 협력사 등록 → 샘플 게임 업로드 → 상태가 `DONE` 이 되는지
- 안 되면 **CloudWatch** → 로그 그룹 `/aws/lambda/codevault-watermark` 에서 오류 확인

## 끝나고 정리 (과금 중지)

- EC2: 인스턴스 **중지**(디스크 요금만) 또는 **종료**(삭제), 탄력적 IP 는 **릴리스**
- S3: 버킷 비우기 → 삭제
- Lambda: 함수 삭제 (호출이 없으면 요금 없음)
