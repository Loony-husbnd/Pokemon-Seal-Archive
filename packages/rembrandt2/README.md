# Rembrandt 2 (배틀 엔진, Showdown 기반)

Pokémon Showdown 의 시뮬레이터(`@pkmn/sim`, MIT) 위에 만든 새 배틀 층. 옛 `packages/rembrandt` 는 앱이 새 패키지로 넘어갈 때까지 그대로 둔다.
화면이 없는 순수 로직이라 `npm run check:boundaries` 가 DOM·저장소 사용을 검사한다.

## 규칙 (결정 사항)
- **9세대** 기준, **메가진화만**(테라스탈·다이맥스 없음), **상대 정보 가리기**.
- 형식은 `gen9anythinggoes@@@Terastal Clause` (`src/format.js`). 디버그 형식이 아니라 상대 체력이 퍼센트로만 보인다.
- 3대3. 팀 미리보기는 기본 순서로 넘긴다.

## 사용법
```js
import { createMatch } from 'rembrandt2';
const m = createMatch({ teams: [setsA, setsB], seed: [1, 2, 3, 4] });   // sets: Showdown 의 PokemonSet 배열
m.choices(0);                      // 합법 선택지 [{type:'move', index, mega?}, {type:'switch', to}]
m.submit([m.choices(0)[0], m.choices(1)[0]]);   // 양쪽 선택으로 한 턴 진행 (대기 중인 쪽은 null)
m.view(0);                         // 내 시점 프로토콜 줄 (상대 정보 가려짐)
const c = m.clone([a, b, c, d]);   // 탐색용 복제 (깊은 복사 + 새 난수 시드)
```

## 지켜야 할 약속 (`spike/showdown/README.md` 의 시험에서 확인)
1. 복제는 **깊은 복사 + 시드 교체**. `fromJSON(toJSON())` 만 쓰면 원본이 오염되고, 시드를 그대로 두면 AI 가 급소·빗나감을 미리 본다.
2. AI·화면은 요청(request)을 직접 읽지 않고 `choices()` 를 쓴다. 기믹이 늘어도 후보 생성 코드를 고치지 않기 위해서다.
3. AI 는 `view(side)` 만 본다. `omniscient()` 는 테스트·디버그 전용이다. (탐색용 복제의 상대 정보 추정은 AI 단계에서 다룬다.)

## 화면 이벤트 (`createTranslator`)
```js
import { createMatch, createTranslator } from 'rembrandt2';
const T = createTranslator(match, 0);       // 0번 플레이어 시점
match.submit([a, b]);
const events = T.pull();                    // 새로 생긴 줄을 이벤트로. 문구(text)는 이미 한국어
```
이벤트 이름은 옛 Rembrandt 와 같다(`turn switch move miss damage effective crit hits heal status stage faint text end` + `field vol types forme mega`). 스키마는 `src/events.js` 머리말.
- 내 시점의 상대 체력은 퍼센트(`maxHp: 100`)로만 온다. 내 포켓몬은 정확한 값.
- `switch.to` 는 처음 파티 기준 번호, `move.cls` 는 `phys|spec|status`.
- 변환하지 못한 줄은 `translator.unmapped`, 이름표에 없어 영문으로 나간 것은 `missingNames()` 로 확인한다. 테스트가 무작위 대전 120판으로 이 비율을 감시한다.

## 도감·팀 데이터 (`createDex`)
```js
const D = createDex();                      // 기본 'all' = 전국도감 전체(1,254종) · { roster: 'sv' } = 9세대(스칼렛·바이올렛)에 나오는 종만
D.roster();  D.learnable('garchomp');  D.itemsFor('charizard');  D.megaStonesOf('charizard');
D.makeSet({ species, moves, ability, item, nature, evs, ivs });   // Showdown PokemonSet (기본 Lv.100·개체값 31·노력치 0)
D.validateTeam(sets);                       // { ok, errors }  3마리·종 중복·습득 기술·특성·메가스톤·노력치
```
- **로스터 1,254종**(도감번호 1~1025 전부 + 지방·특수 폼 229). 9세대에 나오지 않는 291종은 그 종이 가진 가장 최근 세대(8→7)의 습득 기술을 쓴다. `{ roster: 'sv' }` 는 9세대에 나오는 871종만.
- 아르세우스 플레이트·실버디 메모리처럼 폼에 따라 도구가 정해진 종(44폼)은 `fixedItem` 으로 고정된다. 자시안·자마젠타의 왕 폼, 테라파고스 테라스탈 등 전투 중에만 되는 폼은 따로 두지 않는다.
- **메가진화는 종이 아니라 도구로 표현**한다(원작 6·7세대 방식). 리자몽 + 리자몽나이트X → 배틀 중 메가리자몽X. 메가 가능 종 91종.
- 습득 기술은 9세대의 레벨업·기술머신·교습·알 기술이며 진화 전 단계까지 포함한다. 메가는 원래 종 기준.
- 도구 목록(`itemsFor`)은 전투에 영향이 있는 도구를 거칠게 거른 임시 목록이다. 도구 체계를 정할 때 다시 다듬는다.
- 이름표는 `data/ko-names.js`(PokeAPI 한국어). 다시 만들려면 `node tools/build-ko-names.mjs`.

## AI (`createAI`)
```js
import { createMatch, createAI, createDex } from 'rembrandt2';
const ai = createAI({ dex: createDex(), seed: 1 });
const { choice } = ai.choose(match.player(0), 'hard');          // 'easy' | 'normal' | 'hard' | 'hell'
match.submitWith(() => [0, 1].map(s => ais[s].choose(players[s], level[s]).choice));
```
- **정보 가리기**: AI 는 진짜 배틀이 아니라 `match.player(side)` 가 주는 것만 본다 — 내 선택지, 내 시점의 공개 로그, 그리고 `world(추정, 시드)`. 이 *가려진 세계*는 내 쪽은 정확하고, 상대의 숨은 정보(기술·특성·도구·능력치·`side.team`)는 추정값으로 바꾼 복제 배틀이다. 공개된 것(체력 퍼센트·상태이상·능력 변화·메가진화·써서 드러난 기술·특성·도구)만 진짜에서 옮겨 온다.
- 추정(`belief.js`): 안 쓴 기술은 STAB·위력 위주로, 특성은 종의 특성 중에서, 도구는 대부분 없음으로 채운다. 능력치는 이 게임의 기본(Lv.100·개체값 31·노력치 0·무보정)으로 둔다. 노력치 체계가 들어오면 여기를 고친다.
- 난이도: **쉬움**(45% 무작위·교체 안 함) · **보통**(최선 + 가끔 실수·불리할 때만 교체) · **어려움**(항상 최선·선공/KO/상성 교체까지 계산) — 셋 다 피해 어림 계산과 변화기 가치(`policy.js`). **지옥**은 가려진 세계를 여러 개 만들어 후보 행동마다 실제 시뮬레이터로 3턴 굴려 보고 평가 함수(`eval.js`)의 평균이 가장 좋은 수를 고른다(`search.js`). 예산 `budgetMs`(기본 900ms).
- 복제마다 난수 시드가 새로라서 급소·빗나감을 미리 볼 수 없다. 진짜 상대의 이번 턴 선택도 볼 수 없다(동시 선택). 옛 지옥의 '플레이어 행동 미리 보기'는 넣지 않았다.
- 테스트(`test/ai.test.mjs`)가 확인하는 것: 합법 수만 고름 · 강도 순서 · **상대의 숨은 정보가 달라도 판단이 똑같음**(보통·어려움·지옥) · 가려진 세계에 진짜 셋이 남지 않음 · AI 소스가 진짜 배틀에 접근하지 않음(정적 검사).
- 측정(무작위 합법 팀, 같은 팀 좌우 교대): 어려움 대 쉬움 62% (50판) · 보통 대 쉬움 56% · 어려움 대 보통 58% · 지옥 대 어려움 약 61% (예산 200~700ms, 64판) · 지옥 대 쉬움 65%. 무작위 팀은 기술 구성이 나빠 판단의 차이가 덜 드러난다. **팀 빌더가 들어오면 격차가 커질 것으로 본다.**
- 알려진 한계: 변화기 가치는 어림값이고, 지옥의 탐색은 3턴·5후보라 라운드가 적으면 흔들린다(예산을 늘리면 안정). 상대 팀 생성·팀 빌더는 아직 없다.

## 현재 범위와 다음 단계
- 완료: 규칙·합법 선택지·시점별 로그 · 프로토콜→화면 이벤트와 한국어 문구 · 한국어 이름표와 도감(전국도감 전체)·팀 검증 · AI 4단계 (`npm run test:rembrandt2`).
- 아직 없음: ① 상대 팀 생성·팀 빌더(지옥은 가장 강한 팀을 짜야 한다) ② 앱(Proelium/Holo) 연결 — 화면은 아직 옛 Rembrandt 를 쓴다 ③ 노력치·특성·도구·메가 선택 화면.
- 숨은 특성으로 교체가 막힐 수 있다(`submitWith` 참고). 선택이 거부되면 선택지가 갱신되므로 다시 고른다.
