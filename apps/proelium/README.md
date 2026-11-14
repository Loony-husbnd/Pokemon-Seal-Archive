# Proelium (배틀 중심 앱)

배포 주소 `/proelium/`. 포켓몬 3마리와 각자의 기술 4개를 **직접** 고르는 배틀 아레나입니다. 엔진은 `packages/rembrandt`.

## 디자인 방향: "네온 아레나"
아카이브(Holo)가 정리된 도구라면 Proelium은 **쇼**입니다. 어두운 밤 경기장에 네온 조명과 투시 바닥, 홀로그램 포일 카드,
격투 게임식 HP 판, 화면 흔들림·타격 파티클·데미지 숫자·K.O. 연출·색종이, 합성 효과음(WebAudio)을 씁니다.
토큰은 `src/styles/tokens.css`, 공용 부품은 `base.css`에 있고, 타입 색(18종)은 `dex.js`의 `TYPE_HEX`와 `tokens.css`의 `--t1..18`에 있습니다.

## 화면 흐름
홈 → 팀 편성(포켓몬 1,351마리 선택 · 기술 선택) → 매칭(VS) → 배틀 → 결과

| 파일 | 역할 |
|---|---|
| `src/main.js` | 화면 이동(`go`), 이미지 오류 대체, 효과음 |
| `src/dex.js` | 전체 포켓몬 목록·검색(이름·초성·도감번호), 폼 이름, 기술 풀, 추천 기술 |
| `src/store.js` | 저장(`proelium:` 접두어): 팀·난이도·전적·효과음 |
| `src/screens/*.js` | home · builder · matchup · battle · result |
| `src/sfx.js` · `src/fx.js` | 효과음 합성 · 색종이/토스트 |

## 데이터
- 기술 선택에는 포켓몬별로 배울 수 있는 공격기 전체가 필요해서, `packages/rembrandt/data/battle-learnsets.js`(`BATTLE_LEARN`)를 따로 만듭니다 (Holo는 불러오지 않음).
- 선택 가능한 기술 = 배우는 공격기 + 대표 공격기 + 변화기(150개).
- 저장 키는 `proelium:` 접두어만 사용합니다 — Holo 와 도메인을 공유하기 때문.

## 개발
`npm run dev:proelium` (3001번 포트). 이미지는 PokeAPI 공식 일러스트를 쓰며, 불러오지 못하면 도감번호 자리표시로 바뀝니다.
