# chat-system 계획 보완점

기준 문서:
- PRD: `PRD.md`
- 계획서: `.omc/plans/chat-system.md`

작성일: 2026-02-23

## 목적

`PRD.md` 대비 `.omc/plans/chat-system.md`의 정합성을 높이기 위한 보완 사항을 정리한다. 본 문서는 범위 확장 요소를 통제하고, 누락된 핵심 요구를 명시적으로 반영하는 데 목적이 있다.

## 핵심 보완점 요약

1. Kafka `acks=all` 설정을 계획에 명시
2. ACK 미수신 후 재전송 시나리오를 테스트 항목으로 명시
3. PRD 범위를 초과한 품질 요구를 `필수/권장`으로 재분류
4. README 산출물(설계 의사결정 기록)을 명시적 작업으로 추가

## 상세 보완안

### 1) Kafka `acks=all` 명시 (우선순위: 높음)

배경:
- `PRD.md`는 "Kafka에 기록 성공 후 ACK(at-least-once)"와 함께 `ack=all` 권장 사항을 제시한다.
- 현재 계획서에는 producer 연결/발행은 있으나 `acks=all`이 수용 기준으로 명확히 적혀 있지 않다.

권장 수정 위치:
- `.omc/plans/chat-system.md`의 `Phase 3 > Task 3.1` 또는 `Task 3.2`

추가 문구 예시:
- 작업 내용: `Kafka producer 기본 설정에 acks=all 적용, retries 및 idempotent producer 옵션 검토`
- 수용 기준: `producer 설정값에서 acks=all 확인, publish ACK 기준으로만 클라이언트 ACCEPTED 응답`

### 2) ACK 미수신 재전송 시나리오 테스트 추가 (우선순위: 높음)

배경:
- `PRD.md` 테스트 시나리오 1번은 "네트워크 끊김으로 ACK 못 받은 경우 재전송 시 중복 저장 없어야 함"이다.
- 현재 계획서에는 dedup 검증은 있으나 해당 시나리오가 명시적으로 분리되어 있지 않다.

권장 수정 위치:
- `.omc/plans/chat-system.md`의 `테스트 전략` 또는 `Phase 4/5 수용 기준`

추가 문구 예시:
- `E2E: 첫 전송 후 ACK 수신 전 연결 종료를 시뮬레이션하고 동일 clientMsgId로 재전송 시 DB 1건 저장 검증`

### 3) 범위 확장 요구 재분류 (우선순위: 중간)

배경:
- 계획서의 일부 항목은 PRD 대비 품질 확장이다.
- 예: `TDD 고정`, `coverage 80%+`, `Immutable 패턴`, `console.log 금지`, `terminus health`.
- 품질 강화 자체는 유효하지만, MVP 일정 위험을 높일 수 있다.

권장 조치:
- `Must Have`를 `필수(MVP)`와 `권장(운영성 강화)`로 분리
- PRD 직접 요구는 `필수`로, 확장 요구는 `권장`으로 이관

분류 예시:
- 필수(MVP): Kafka ACK 기반 수락, DB dedup unique, Redis TTL presence, cursor 동기화
- 권장(운영성): 80%+ coverage, Terminus health, 로그 정책 강화

### 4) README 산출물 작업 추가 (우선순위: 중간)

배경:
- `PRD.md`는 포트폴리오 산출물로 README에 설계 이유를 남길 것을 제시한다.
- 계획서에는 해당 항목이 독립 태스크로 잡혀 있지 않다.

권장 수정 위치:
- `Phase 5` 후속 또는 별도 `Phase 6 (문서화/운영 인수)` 추가

추가 문구 예시:
- `Task: README 아키텍처/메시지 보장 모델/중복 제거 전략/재접속 동기화 흐름/토픽 키 설계 문서화`
- 수용 기준: `README에 시퀀스 다이어그램 또는 단계별 흐름 설명 포함`

## 반영 제안안 (간단 패치 순서)

1. `Phase 3`에 `acks=all` 설정 + 수용 기준 추가
2. `테스트 전략`에 ACK 미수신 재전송 E2E 케이스 추가
3. `Guardrails`를 `필수/권장`으로 재구성
4. `README 산출물` 태스크를 마지막 phase에 추가

## 완료 조건

아래 4가지가 계획서에 반영되면, PRD 정합성 기준의 주요 누락은 해소된 것으로 본다.

1. Kafka `acks=all` 명시
2. ACK 미수신 재전송 테스트 명시
3. 범위 확장 항목의 필수/권장 분리
4. README 산출물 태스크 명시
