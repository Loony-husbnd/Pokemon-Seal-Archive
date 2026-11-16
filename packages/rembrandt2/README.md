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

## 현재 범위와 다음 단계
- 완료: 규칙·합법 선택지·시점별 로그·안전한 복제 (`npm run test:rembrandt2`).
- 다음: ① 프로토콜 → 화면 이벤트 변환기와 한국어 로그(`spike/showdown/bridge.mjs` 가 출발점) ② 한국어 이름·팀 데이터 연결 ③ AI(선택지 생성 · 일반 평가 함수 탐색 · 시드 교체 복제) ④ 팀 빌더.
