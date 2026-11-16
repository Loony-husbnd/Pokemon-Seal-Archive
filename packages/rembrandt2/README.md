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
const D = createDex({ roster: 'sv' });      // 'sv' = 9세대(스칼렛·바이올렛)에 나오는 종 · 'all' = 전국도감 전체
D.roster();  D.learnable('garchomp');  D.itemsFor('charizard');  D.megaStonesOf('charizard');
D.makeSet({ species, moves, ability, item, nature, evs, ivs });   // Showdown PokemonSet (기본 Lv.100·개체값 31·노력치 0)
D.validateTeam(sets);                       // { ok, errors }  3마리·종 중복·습득 기술·특성·메가스톤·노력치
```
- **로스터 871종**(기본형 734 + 지방·특수 폼). 9세대에 나오지 않는 291종은 제외된다. `roster: 'all'` 로 넓힐 수 있다(습득 기술은 9세대 데이터가 없는 종이 비게 된다).
- **메가진화는 종이 아니라 도구로 표현**한다(원작 6·7세대 방식). 리자몽 + 리자몽나이트X → 배틀 중 메가리자몽X. 메가 가능 종 71종(로스터 기준).
- 습득 기술은 9세대의 레벨업·기술머신·교습·알 기술이며 진화 전 단계까지 포함한다. 메가는 원래 종 기준.
- 도구 목록(`itemsFor`)은 전투에 영향이 있는 도구를 거칠게 거른 임시 목록이다. 도구 체계를 정할 때 다시 다듬는다.
- 이름표는 `data/ko-names.js`(PokeAPI 한국어). 다시 만들려면 `node tools/build-ko-names.mjs`.

## 현재 범위와 다음 단계
- 완료: 규칙·합법 선택지·시점별 로그(`npm run test:rembrandt2`) · 프로토콜→화면 이벤트와 한국어 문구 · 한국어 이름표와 도감·팀 검증.
- 아직 없음: ① 상대 AI ② 상대 팀 생성·팀 빌더 ③ 앱(Proelium/Holo) 연결 — 화면은 아직 옛 Rembrandt 를 쓴다 ④ 노력치·특성·도구·메가 선택 화면.
- 숨은 특성으로 교체가 막힐 수 있다(`submitWith` 참고). 선택이 거부되면 선택지가 갱신되므로 다시 고른다.
