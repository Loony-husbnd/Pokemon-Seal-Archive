# Rembrandt (배틀 엔진)

화면이 없는 순수 로직: 데이터(종족값·기술·상성), 배틀 엔진, AI, 파티 규칙.
**판단 기준: Node 에서 화면 없이 돌릴 수 있으면 여기, 아니면 앱(Proelium/Holo) 또는 battle-ui.**

- DOM·localStorage·앱 전역 변수 사용 금지 → `npm run check:boundaries` 가 검사한다.
- 테스트 `npm run test:battle`, 데이터 재생성 `npm run battle:data`, 검증 `npm run battle:validate`.
- 사용법은 `engine.js` 파일 상단 주석 참고.
