# Rembrandt (배틀 엔진)

화면이 없는 순수 로직: 데이터(종족값·기술·상성), 배틀 엔진, AI, 파티 규칙.
**판단 기준: Node 에서 화면 없이 돌릴 수 있으면 여기, 아니면 앱(Proelium/Holo) 또는 battle-ui.**

- DOM·localStorage·앱 전역 변수 사용 금지 → `npm run check:boundaries` 가 검사한다.
- 테스트 `npm run test:battle`, 데이터 재생성 `npm run battle:data`, 검증 `npm run battle:validate`.
- 사용법은 `engine.js` 파일 상단 주석 참고.

## 변화기 (1단계)
- 분류 `cls: 'status'` (데이터에서는 `c: 'n'`). 정의는 `tools/battle-status-moves.json`, 효과 스키마는 `tools/build-battle-data.mjs` 상단 주석.
- 포켓몬 데이터의 `sm` = 배울 수 있는 변화기, `ss` = 그중 Showdown 랜덤배틀 세트에 나오는 것. `m` 은 대표 공격기 그대로.
- 기술 4개 구성: `BattleParty.pickMoveset(id, rng)` (무작위) 또는 `makeMon(id, { moves: [...] })` 로 직접 지정.
- 밸런스 확인: `npm run sim:status`, 기술별 측정: `npm run sim:status-moves`.
