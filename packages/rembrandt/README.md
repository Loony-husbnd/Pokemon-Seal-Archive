# Rembrandt (배틀 엔진)

화면이 없는 순수 로직: 데이터(종족값·기술·상성), 배틀 엔진, AI, 파티 규칙.
**판단 기준: Node 에서 화면 없이 돌릴 수 있으면 여기, 아니면 앱(Proelium/Holo) 또는 battle-ui.**

- DOM·localStorage·앱 전역 변수 사용 금지 → `npm run check:boundaries` 가 검사한다.
- 테스트 `npm run test:battle`, 데이터 재생성 `npm run battle:data`, 검증 `npm run battle:validate`.
- 사용법은 `engine.js` 파일 상단 주석 참고.

## 변화기 (1·2·3단계, 270개)
- 분류 `cls: 'status'` (데이터에서는 `c: 'n'`). 정의는 `tools/battle-status-moves.json`, 효과 스키마는 `tools/build-battle-data.mjs` 상단 주석.
- 포켓몬 데이터의 `sm` = 배울 수 있는 변화기, `ss` = 그중 Showdown 랜덤배틀 세트에 나오는 것. `m` 은 대표 공격기 그대로.
- 배틀 상태: `battle.field`(날씨·필드·트릭룸), `battle.sides[i].cond`(함정·벽·순풍), 포켓몬의 임시 상태(`freshVolatile`: 씨뿌리기·도발·대타 등).
- 화면용 이벤트: `field`(날씨·필드·함정 전체 상태), `vol`(포켓몬 임시 상태), `types`, `stages`, `cure`.
- AI/화면에서 쓰는 도우미: `battle.ctx(side)`(데미지 계산용 날씨·필드·벽), `battle.outspeeds(side)`, `battle.legalActions(side)`(도발·앙코르 등으로 잠긴 기술은 `usable:false` + `why`).
- 기술 4개 구성: `BattleParty.pickMoveset(id, rng)` (무작위) 또는 `makeMon(id, { moves: [...] })` 로 직접 지정.
- 밸런스 확인: `npm run sim:status`, 기술별 측정: `npm run sim:status-moves` (`-- --stage3` 는 3단계 120개만).

### 3단계 (120개, 총 270개)
- 새 효과 키 목록과 의미는 `tools/build-battle-data.mjs` 상단 주석이 원본입니다. 효과는 모두 `engine.js`에 구현됩니다.
- **턴 도중 교체**: 교체 기술(`fx.pivot`)을 쓰면 `battle.pivot`이 예약되고 `playTurn`이 phase `'switch'`(`pending=[side]`, `needSwitch.pivot=true`)로 멈춥니다. 화면은 기절 후 교체와 똑같이 `replace(side, 인덱스)`를 호출하면 되고, 엔진이 남은 행동과 턴 종료 처리를 이어서 돌려줍니다. 고를 수 있는 목록은 `battle.replaceOptions(side)`.
- 포켓몬의 임시 상태가 크게 늘었습니다(`freshVolatile` 참고). 모두 교체·기절하면 사라지며, 타입 변경과 흉내내기로 바뀐 기술 칸도 원래대로 돌아옵니다.
- 필드: `battle.field.{gravity, wonder, magicRoom, mud, waterSport, fairyLock}`, 진영: `cond.lucky`. 화면용 `field` 이벤트에 모두 실립니다.
- 특성·도구가 필요한 기술은 비슷한 효과로 대체했습니다(표는 루트 README 참고). 싱글 배틀에서 원작도 효과가 없는 8개는 `fx.dead`/`fx.splash`이며 무작위 구성에서 뽑히지 않습니다.

## 특수 공격기 (1.3, 168개 → 공격기 525개)
- 정의 `tools/battle-attack-moves.json`(`stage` 1~4, `pw` 대표 위력, `fx`). 새 효과 키는 `tools/build-battle-data.mjs` 상단 주석과 `tools/validate-battle-data.mjs` 의 `ATTACK_FX_KEYS` 에 함께 적습니다.
- 대표 공격기(`m`) 선정에는 쓰지 않고 `BATTLE_LEARN`(배울 수 있는 공격기)에만 들어갑니다. 테스트·시뮬레이터는 `tools/lib/load-battle.mjs` 가 `battle-learnsets.js` 까지 불러와 쓰므로 새 공격기를 그대로 쓸 수 있습니다.
- `E.resolveMove(att, def, move, ctx)`: 이번에 쓰는 기술의 타입·분류·위력(가변 위력)을 정합니다. `E.describeAttack(move)`: 특수 처리 설명, `E.variablePower(move)`: 위력이 가변인가.
- 이번 턴의 사정(맞은 기록·직전 기술 실패·능력 상승 등)은 포켓몬 임시 상태(`hurtTurn` `lastHit` `hitsTaken` `failedLast` `boostedTurn` `loweredTurn`)와 `battle.ctx(side)` 로 전달됩니다.
- 충전·난동 중에는 `legalActions` 가 나머지 기술을 `usable:false`(`why: '충전 중'|'난동 중'`)로 막고, 파괴광선류의 반동은 다음 행동 때 자동으로 소모됩니다.
