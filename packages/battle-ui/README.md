# battle-ui (전투 화면)

Holo·Proelium 이 공유하는 배틀 화면(`ui.js`, `battle.css`). Rembrandt 를 호출해 그린다.

현재 `ui.js` 는 Holo 의 전역(`sealDatabase`, `getSealImageUrl`, `escapeHtml`, `showToast`, `lucide` …)과
저장 키(`pokemon_seal_battle_v1`, 기존 사용자 세이브 호환용)에 직접 의존한다.
→ 다음 단계: 이 의존을 호스트 어댑터(`host.candidates()`, `host.imageUrl()`, `host.toast()`, `host.storage`)로 바꿔 Proelium 에서도 쓰게 한다.
