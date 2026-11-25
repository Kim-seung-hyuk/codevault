# CodeVault 워터마크 매트릭스 결과 (자동 생성: `node tests/run-matrix.js`)

생성 시각: 2026-11-25T12:51:53.305Z  ·  Node v24.14.1  ·  비밀키: 데모 기본값

대상: 오리지널 게임 3개(comet-shower, lantern-range, moss-hop) × 협력사 3곳(mark 17/42/203). 페이로드 = 8비트 mark_id + 8비트 HMAC 태그.

## 1) 공격별 식별 결과 (9개 빌드 기준)

| 공격 | 정확 식별 | 오지목 | L1 생존 | L2 생존 | L3 생존 | L4 생존 | 기대 |
|---|---|---|---|---|---|---|---|
| A0 그대로 | 9/9 | 0 | 9 | 9 | 9 | 9 | 식별해야 함 |
| A1 주석·공백 제거 | 9/9 | 0 | 0 | 9 | 9 | 9 | 식별해야 함 |
| A2 terser minify+mangle | 9/9 | 0 | 0 | 0 | 0 | 9 | 식별해야 함 |
| A3 beautify+수동편집 | 3/9 | 0 | 0 | 0 | 9 | 3 | 오지목만 없으면 됨 |
| A4 강한 난독화 | 0/9 | 0 | 0 | 0 | 0 | 0 | 오지목만 없으면 됨 |

(층 생존 = 그 층이 읽혔고 정답 mark 를 가리킨 빌드 수. L3 는 태그가 없어 단독으로는 지목 근거가 되지 않는다. A3 의 3건 식별은 공격이 바꾼 색의 하위비트가 우연히 mark 42 와 맞은 경우)

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

무표식 게임의 함수 순서·키 순서·팔레트 하위비트를 층마다 독립적으로 무작위화한 3000개 중 우연히 태그가 맞은 비율: **0.70%** (HIGH 0건). 이론값 ≈ 2/256 (L2·L4 태그가 각각 1/256 확률로 우연 일치).
→ 단일 층(MEDIUM) 식별은 '추가 증거 필요'로 표시하고, 웹앱은 등록된 mark_id·해당 게임과 일치할 때만 협력사를 지목한다.

## 4) 상세

| 게임 | 협력사 | 공격 | L1 | L2 | L3 | L4 | 판정 | 신뢰도 | 결과 |
|---|---|---|---|---|---|---|---|---|---|
| comet-shower | 퍼블리셔 A(17) | A0 | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| comet-shower | 퍼블리셔 A(17) | A1 | ✗ | ✓ | ✓ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| comet-shower | 퍼블리셔 A(17) | A2 | ✗ | ✗ | ✗ | ✓ | IDENTIFIED(17) | MEDIUM | PASS |
| comet-shower | 퍼블리셔 A(17) | A3 | ✗ | · | ✓ | · | NO_RELIABLE_MARK | NONE | PASS |
| comet-shower | 퍼블리셔 A(17) | A4 | ✗ | ✗ | ✗ | ✗ | NO_RELIABLE_MARK | NONE | PASS |
| comet-shower | 현지화 업체 B(42) | A0 | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| comet-shower | 현지화 업체 B(42) | A1 | ✗ | ✓ | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| comet-shower | 현지화 업체 B(42) | A2 | ✗ | ✗ | ✗ | ✓ | IDENTIFIED(42) | MEDIUM | PASS |
| comet-shower | 현지화 업체 B(42) | A3 | ✗ | · | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| comet-shower | 현지화 업체 B(42) | A4 | ✗ | ✗ | ✗ | ✗ | NO_RELIABLE_MARK | NONE | PASS |
| comet-shower | 스트리머 C(203) | A0 | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| comet-shower | 스트리머 C(203) | A1 | ✗ | ✓ | ✓ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| comet-shower | 스트리머 C(203) | A2 | ✗ | ✗ | ✗ | ✓ | IDENTIFIED(203) | MEDIUM | PASS |
| comet-shower | 스트리머 C(203) | A3 | ✗ | · | ✓ | · | NO_RELIABLE_MARK | NONE | PASS |
| comet-shower | 스트리머 C(203) | A4 | ✗ | ✗ | ✗ | ✗ | NO_RELIABLE_MARK | NONE | PASS |
| lantern-range | 퍼블리셔 A(17) | A0 | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| lantern-range | 퍼블리셔 A(17) | A1 | ✗ | ✓ | ✓ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| lantern-range | 퍼블리셔 A(17) | A2 | ✗ | ✗ | ✗ | ✓ | IDENTIFIED(17) | MEDIUM | PASS |
| lantern-range | 퍼블리셔 A(17) | A3 | ✗ | · | ✓ | · | NO_RELIABLE_MARK | NONE | PASS |
| lantern-range | 퍼블리셔 A(17) | A4 | ✗ | ✗ | ✗ | ✗ | NO_RELIABLE_MARK | NONE | PASS |
| lantern-range | 현지화 업체 B(42) | A0 | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| lantern-range | 현지화 업체 B(42) | A1 | ✗ | ✓ | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| lantern-range | 현지화 업체 B(42) | A2 | ✗ | ✗ | ✗ | ✓ | IDENTIFIED(42) | MEDIUM | PASS |
| lantern-range | 현지화 업체 B(42) | A3 | ✗ | · | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| lantern-range | 현지화 업체 B(42) | A4 | ✗ | ✗ | ✗ | ✗ | NO_RELIABLE_MARK | NONE | PASS |
| lantern-range | 스트리머 C(203) | A0 | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| lantern-range | 스트리머 C(203) | A1 | ✗ | ✓ | ✓ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| lantern-range | 스트리머 C(203) | A2 | ✗ | ✗ | ✗ | ✓ | IDENTIFIED(203) | MEDIUM | PASS |
| lantern-range | 스트리머 C(203) | A3 | ✗ | · | ✓ | · | NO_RELIABLE_MARK | NONE | PASS |
| lantern-range | 스트리머 C(203) | A4 | ✗ | ✗ | ✗ | ✗ | NO_RELIABLE_MARK | NONE | PASS |
| moss-hop | 퍼블리셔 A(17) | A0 | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| moss-hop | 퍼블리셔 A(17) | A1 | ✗ | ✓ | ✓ | ✓ | IDENTIFIED(17) | HIGH | PASS |
| moss-hop | 퍼블리셔 A(17) | A2 | ✗ | ✗ | ✗ | ✓ | IDENTIFIED(17) | MEDIUM | PASS |
| moss-hop | 퍼블리셔 A(17) | A3 | ✗ | · | ✓ | · | NO_RELIABLE_MARK | NONE | PASS |
| moss-hop | 퍼블리셔 A(17) | A4 | ✗ | · | ✗ | ✗ | NO_RELIABLE_MARK | NONE | PASS |
| moss-hop | 현지화 업체 B(42) | A0 | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| moss-hop | 현지화 업체 B(42) | A1 | ✗ | ✓ | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| moss-hop | 현지화 업체 B(42) | A2 | ✗ | ✗ | ✗ | ✓ | IDENTIFIED(42) | MEDIUM | PASS |
| moss-hop | 현지화 업체 B(42) | A3 | ✗ | · | ✓ | ✓ | IDENTIFIED(42) | HIGH | PASS |
| moss-hop | 현지화 업체 B(42) | A4 | ✗ | ✗ | ✗ | ✗ | NO_RELIABLE_MARK | NONE | PASS |
| moss-hop | 스트리머 C(203) | A0 | ✓ | ✓ | ✓ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| moss-hop | 스트리머 C(203) | A1 | ✗ | ✓ | ✓ | ✓ | IDENTIFIED(203) | HIGH | PASS |
| moss-hop | 스트리머 C(203) | A2 | ✗ | ✗ | ✗ | ✓ | IDENTIFIED(203) | MEDIUM | PASS |
| moss-hop | 스트리머 C(203) | A3 | ✗ | · | ✓ | · | NO_RELIABLE_MARK | NONE | PASS |
| moss-hop | 스트리머 C(203) | A4 | ✗ | · | ✗ | ✗ | NO_RELIABLE_MARK | NONE | PASS |

범례: ✓ 읽힘·정답 일치, · 읽혔으나 불일치(잡음), ✗ 소실

## 결론

- 총 45건, 실패 0건, **오지목 0건**.
- 주석 제거·표준 minify(terser mangle)까지는 전 빌드 추적 성공. minify 후에는 L4(팔레트 하위비트) 단독으로 버틴다.
- 의도적 편집·강한 난독화는 추적 실패할 수 있으나 잘못된 협력사를 지목하지 않는다. (RE 방지가 아니라 '지문')
- PoC 원본 결과는 `poc/RESULTS.md` 참고.
