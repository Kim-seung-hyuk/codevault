# CodeVault 워터마크 매트릭스 결과 (자동 생성: `node tests/run-matrix.js`)

생성 시각: 2026-11-25T14:36:26.893Z  ·  Node v24.14.1  ·  비밀키: 데모 기본값

대상: 오리지널 게임 3개(comet-shower, lantern-range, moss-hop) × 협력사 3곳(mark 17/42/203). 페이로드 = 8비트 mark_id + 8비트 HMAC 태그(L3 는 7비트).

## 1) 공격별 식별 결과 (9개 빌드 기준)

| 공격 | 정확 식별 | HIGH | 오지목 | L1 | L2 | L3 | L4 | L5 | L6 | L8 | 기대 |
|---|---|---|---|---|---|---|---|---|---|---|
| A0 그대로 | 9/9 | 9 | 0 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 식별해야 함 |
| A1 주석·공백 제거 | 9/9 | 9 | 0 | 0 | 9 | 9 | 9 | 9 | 0 | 9 | 식별해야 함 |
| A2 terser minify+mangle | 9/9 | 9 | 0 | 0 | 0 | 9 | 9 | 9 | 0 | 9 | 식별해야 함 |
| A3 beautify+수동편집 | 9/9 | 9 | 0 | 0 | 0 | 9 | 3 | 9 | 0 | 9 | 오지목만 없으면 됨 |
| A4 강한 난독화 | 9/9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 9 | 오지목만 없으면 됨 |
| A5 L1~L7 을 아는 공격자 | 9/9 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 식별해야 함 |
| A6 L8 까지 아는 공격자(데이터 ±3) | 0/9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 오지목만 없으면 됨 |

(층 생존 = 그 층이 읽혔고 태그 검증을 통과해 정답 mark 를 가리킨 빌드 수. L3 는 7비트 태그라 가중치 0.5 — 단독으로는 지목하지 않는다. A3 에서 L4 가 3건 살아남은 것은 공격이 바꾼 색의 하위비트가 우연히 mark 42 와 맞은 경우)

## 2) 오탐 검사

| 입력 | 판정 | 결과 |
|---|---|---|
| comet-shower 원본(무워터마크) | NO_RELIABLE_MARK | ✔ 거부 |
| lantern-range 원본(무워터마크) | NO_RELIABLE_MARK | ✔ 거부 |
| moss-hop 원본(무워터마크) | NO_RELIABLE_MARK | ✔ 거부 |
| comet-shower 원본 terser | NO_RELIABLE_MARK | ✔ 거부 |
| lantern-range 원본 terser | NO_RELIABLE_MARK | ✔ 거부 |
| moss-hop 원본 terser | NO_RELIABLE_MARK | ✔ 거부 |
| 무관한 JS | NO_RELIABLE_MARK | ✔ 거부 |
| poc/sample-game.js (다른 게임) | NO_RELIABLE_MARK | ✔ 거부 |

## 3) 무작위 변형 우연 식별률 (참고)

무표식 게임의 함수 순서·키 순서·팔레트 하위비트·소수 상수 하위비트를 층마다 독립적으로 무작위화한 3000개 중 우연히 태그가 맞은 비율: **0.73%** (HIGH 0건). 이론값 ≈ 2/256 (L2·L4 태그가 각각 1/256 확률로 우연 일치. L3 는 단독 지목 불가, L5 는 리터럴 검사값까지 맞아야 해서 무시할 수준).
→ 단일 층(MEDIUM) 식별은 '추가 증거 필요'로 표시하고, 웹앱은 등록된 mark_id·해당 게임과 일치할 때만 협력사를 지목한다.

## 4) 상세

| 게임 | 협력사 | 공격 | L1 | L2 | L3 | L4 | L5 | L6 | L8 | 판정 | 신뢰도 | 결과 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| comet-shower | 퍼블리셔 A(17) | A0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| comet-shower | 퍼블리셔 A(17) | A1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| comet-shower | 퍼블리셔 A(17) | A2 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| comet-shower | 퍼블리셔 A(17) | A3 | ✗ | · | ✓ | · | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| comet-shower | 퍼블리셔 A(17) | A4 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| comet-shower | 퍼블리셔 A(17) | A5 | ✗ | · | · | · | ✗ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| comet-shower | 퍼블리셔 A(17) | A6 | ✗ | · | · | · | ✗ | ✗ | · | NO_RELIABLE_MARK | NONE | PASS |
| comet-shower | 현지화 업체 B(42) | A0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| comet-shower | 현지화 업체 B(42) | A1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| comet-shower | 현지화 업체 B(42) | A2 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| comet-shower | 현지화 업체 B(42) | A3 | ✗ | · | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| comet-shower | 현지화 업체 B(42) | A4 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| comet-shower | 현지화 업체 B(42) | A5 | ✗ | · | · | · | ✗ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| comet-shower | 현지화 업체 B(42) | A6 | ✗ | · | · | · | ✗ | ✗ | · | NO_RELIABLE_MARK | NONE | PASS |
| comet-shower | 스트리머 C(203) | A0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| comet-shower | 스트리머 C(203) | A1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| comet-shower | 스트리머 C(203) | A2 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| comet-shower | 스트리머 C(203) | A3 | ✗ | · | ✓ | · | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| comet-shower | 스트리머 C(203) | A4 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| comet-shower | 스트리머 C(203) | A5 | ✗ | · | · | · | ✗ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| comet-shower | 스트리머 C(203) | A6 | ✗ | · | · | · | ✗ | ✗ | · | NO_RELIABLE_MARK | NONE | PASS |
| lantern-range | 퍼블리셔 A(17) | A0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| lantern-range | 퍼블리셔 A(17) | A1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| lantern-range | 퍼블리셔 A(17) | A2 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| lantern-range | 퍼블리셔 A(17) | A3 | ✗ | · | ✓ | · | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| lantern-range | 퍼블리셔 A(17) | A4 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| lantern-range | 퍼블리셔 A(17) | A5 | ✗ | · | · | · | ✗ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| lantern-range | 퍼블리셔 A(17) | A6 | ✗ | · | · | · | ✗ | ✗ | · | NO_RELIABLE_MARK | NONE | PASS |
| lantern-range | 현지화 업체 B(42) | A0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| lantern-range | 현지화 업체 B(42) | A1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| lantern-range | 현지화 업체 B(42) | A2 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| lantern-range | 현지화 업체 B(42) | A3 | ✗ | · | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| lantern-range | 현지화 업체 B(42) | A4 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| lantern-range | 현지화 업체 B(42) | A5 | ✗ | · | · | · | ✗ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| lantern-range | 현지화 업체 B(42) | A6 | ✗ | · | · | · | ✗ | ✗ | · | NO_RELIABLE_MARK | NONE | PASS |
| lantern-range | 스트리머 C(203) | A0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| lantern-range | 스트리머 C(203) | A1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| lantern-range | 스트리머 C(203) | A2 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| lantern-range | 스트리머 C(203) | A3 | ✗ | · | ✓ | · | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| lantern-range | 스트리머 C(203) | A4 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| lantern-range | 스트리머 C(203) | A5 | ✗ | · | · | · | ✗ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| lantern-range | 스트리머 C(203) | A6 | ✗ | · | · | · | ✗ | ✗ | · | NO_RELIABLE_MARK | NONE | PASS |
| moss-hop | 퍼블리셔 A(17) | A0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| moss-hop | 퍼블리셔 A(17) | A1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| moss-hop | 퍼블리셔 A(17) | A2 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| moss-hop | 퍼블리셔 A(17) | A3 | ✗ | · | ✓ | · | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| moss-hop | 퍼블리셔 A(17) | A4 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| moss-hop | 퍼블리셔 A(17) | A5 | ✗ | · | · | · | ✗ | ✗ | ✓ | IDENTIFIED(17) | MEDIUM | PASS |
| moss-hop | 퍼블리셔 A(17) | A6 | ✗ | · | · | · | ✗ | ✗ | · | NO_RELIABLE_MARK | NONE | PASS |
| moss-hop | 현지화 업체 B(42) | A0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| moss-hop | 현지화 업체 B(42) | A1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| moss-hop | 현지화 업체 B(42) | A2 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| moss-hop | 현지화 업체 B(42) | A3 | ✗ | · | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| moss-hop | 현지화 업체 B(42) | A4 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| moss-hop | 현지화 업체 B(42) | A5 | ✗ | · | · | · | ✗ | ✗ | ✓ | IDENTIFIED(42) | MEDIUM | PASS |
| moss-hop | 현지화 업체 B(42) | A6 | ✗ | · | · | · | ✗ | ✗ | · | NO_RELIABLE_MARK | NONE | PASS |
| moss-hop | 스트리머 C(203) | A0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| moss-hop | 스트리머 C(203) | A1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| moss-hop | 스트리머 C(203) | A2 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| moss-hop | 스트리머 C(203) | A3 | ✗ | · | ✓ | · | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| moss-hop | 스트리머 C(203) | A4 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| moss-hop | 스트리머 C(203) | A5 | ✗ | · | · | · | ✗ | ✗ | ✓ | IDENTIFIED(203) | MEDIUM | PASS |
| moss-hop | 스트리머 C(203) | A6 | ✗ | · | · | · | ✗ | ✗ | · | NO_RELIABLE_MARK | NONE | PASS |

범례: ✓ 읽힘·정답 일치, · 읽혔으나 불일치(잡음), ✗ 소실

## 결론

- 총 63건, 실패 0건, **오지목 0건**.
- 코드 층: L1 zero-width 주석, L2 함수 순서, L3 설정 키 순서(+7비트 태그), L4 팔레트 하위비트, L5 소수 상수 미세값, L6 줄 끝 공백, **L8 게임 데이터 표(시맨틱)**. 화면 층 L7 은 RESULTS-L7.md.
- 주석 제거·minify·수동 편집까지 전 빌드를 HIGH 로 추적한다. minify 후에는 L3·L4·L5 가 함께 버틴다.
- 강한 난독화(javascript-obfuscator)에서도 L5(소수 상수)가 살아남아 MEDIUM 으로 추적된다.
- L1~L7 을 아는 공격자(A5)는 동작과 무관한 층을 모두 지우지만, 게임 데이터에 실린 L8 이 남아 전 빌드를 추적한다.
- L8 까지 아는 공격자(A6)는 원본 값을 모르므로 데이터에 잡음을 넣어야 한다. 데모 게임(데이터 55~64개)은 ±3 잡음이면 대부분 지워지고, 데이터가 많은 제품일수록 필요한 잡음이 커진다 — RESULTS-L8.md.
- 어떤 경우에도 잘못된 협력사를 지목하지 않는다.
- PoC 원본 결과는 `poc/RESULTS.md` 참고.
