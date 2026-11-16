# Proelium 1.1.1 (배틀 중심 앱)

배포 주소 `/proelium/`. 포켓몬 3마리와 각자의 **기술 4개 · 특성 · 도구**를 직접 고르는 배틀 아레나입니다. 엔진은 **Rembrandt 2.0**(`packages/rembrandt2`, Pokémon Showdown 시뮬레이터 기반)입니다. Holo 의 배틀 탭은 아직 옛 Rembrandt 1.3 을 씁니다.

## 디자인 방향
- **바탕은 순수한 검정**, 테마색은 **파랑(`#2a62ff`/`#9bb8ff`)과 금색(`#ffb21f`/`#ffe3a6`)** 두 가지입니다. 금색은 주요 버튼·강조·고리, 파랑은 조명·바닥 격자·보조 강조에 씁니다. 포켓몬 타입 색은 테마와 무관하게 유지합니다.
- **글꼴**: 강조(로고·제목·큰 글자)는 **Hahmlet**, 본문과 도감번호는 **Pretendard** (`tokens.css`의 `--display`, `--font`).
- **첫 화면**: 금색 고리가 돌고(빛줄기가 도는 고리, 반대로 도는 글자 고리, 궤도를 도는 빛 알갱이) 그 안에 로고와 팀 카드가 들어갑니다.
- **연출**: 화면 흔들림, 타격 파티클(타입 색 + 금색·파랑·흰색 등 여러 색), 데미지 숫자, K.O./효과 배너, 날씨 오버레이, 합성 효과음(WebAudio), 색종이.
- 토큰은 `src/styles/tokens.css`, 공용 부품은 `base.css`, 타입 색(18종)은 `dex.js`의 `TYPE_HEX`와 `tokens.css`의 `--t1..18`에 있습니다.

## 화면 흐름
홈 → 팀 편성(포켓몬 1,254종 선택 · 기술·특성·도구 선택) → 매칭(VS) → 배틀 → 결과

| 파일 | 역할 |
|---|---|
| `src/main.js` | 화면 이동(`go`), 엔진 불러오기(처음 한 번), 이미지 오류 대체, 효과음 |
| `src/dex.js` | **엔진 연결층**: `loadEngine()`, 전체 포켓몬 목록·검색(이름·초성·도감번호), 타입 번호, 기술 정보·풀, 세트(기술·특성·도구), 팀 검증 |
| `src/store.js` | 저장(`proelium:` 접두어): 팀(`team2`)·난이도·전적·효과음. 엔진을 불러온 뒤 `sanitize()` 로 규칙에 맞게 고친다 |
| `src/screens/*.js` | home · builder · matchup · battle · result |
| `src/sfx.js` · `src/fx.js` | 효과음 합성 · 색종이/토스트 |

## 엔진 연결 (Rembrandt 2.0)
- 엔진은 `import('rembrandt2')` 로 **나중에 불러옵니다**(번들 청크 약 6.7MB, gzip 약 1.1MB). 화면 코드는 약 50KB 입니다. `vite.config.ts` 의 alias 가 `rembrandt2` 를 `packages/rembrandt2/src/index.js` 로 연결합니다.
- **클래스 이름 보존이 필요합니다.** 시뮬레이터의 복제(직렬화)는 `[Pokemon:p1a]` 처럼 클래스 이름으로 참조를 되살리는데, 최소화가 이름을 줄이면 깨집니다. 그래서 `esbuild.keepNames` · `optimizeDeps.esbuildOptions.keepNames` 를 켰습니다(`vite.config.ts`). 이 설정을 빼면 AI 가 첫 판단에서 오류가 납니다.
- 배틀 화면은 엔진의 **이벤트**(`createTranslator`)를 받아 연출합니다. 상대 포켓몬의 체력은 퍼센트로만 오고, 상대의 기술·특성·도구는 대전에서 드러나기 전까지 보이지 않습니다(매칭 화면에도 `기술 ???`).
- 메가진화는 **메가스톤을 든 포켓몬**이 배틀 중 `🌀 메가진화` 버튼으로 씁니다(팀 편성에서 도구로 메가스톤을 고른다).
- 지옥은 대진 화면에서 내 팀을 보고 상대 팀을 짜는 데 몇 초 걸리고(진행 막대 표시), 배틀 중 판단에도 최대 약 1초 걸립니다. 지금은 메인 스레드에서 돌립니다(웹 워커로 옮기면 화면이 멈추지 않는다 — 후속 과제).
- 브라우저 전체 흐름 시험: `npm run build:proelium` 후 `npm run preview:proelium` 을 띄우고 `npm run e2e:proelium` (Playwright 필요).

## 데이터
- 포켓몬·기술·특성·도구 데이터는 Showdown 9세대 데이터이고 한국어 이름은 PokeAPI 입니다(`packages/rembrandt2/data/ko-names.js`, `art-ids.js` — `node tools/build-ko-names.mjs` 로 다시 만든다).
- 선택 가능한 기술 = 그 포켓몬이 9세대(없으면 가장 최근 세대)에서 레벨업·기술머신·교습·알로 배우는 기술 전부.
- 저장 키는 `proelium:` 접두어만 사용합니다 — Holo 와 도메인을 공유하기 때문. 옛 `proelium:team` 은 읽지 않고 새 `team2` 에 저장합니다(옛 팀은 새 규칙과 호환되지 않아 이어받지 않는다).

## 개발
`npm run dev:proelium` (3001번 포트). 이미지는 PokeAPI 공식 일러스트를 쓰며, 불러오지 못하면 도감번호 자리표시로 바뀝니다.
