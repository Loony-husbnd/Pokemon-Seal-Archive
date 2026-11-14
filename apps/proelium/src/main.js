// Proelium 진입점 (기초 구조) — 엔진이 연결됐는지만 확인한다. 팀 빌더·전투 화면은 이후 단계에서 추가.
(function () {
  'use strict';
  const el = document.getElementById('status');
  const ready = window.BATTLE_DATA && window.BattleEngine && window.BattleAI && window.BattleParty;
  if (!ready) {
    el.innerHTML = '<span class="ng">Rembrandt 엔진을 불러오지 못했습니다.</span>';
    return;
  }
  const count = Object.keys(window.BATTLE_DATA.pokemon).length;
  el.innerHTML = `<span class="ok">Rembrandt 연결됨</span> · 포켓몬 데이터 ${count.toLocaleString('ko-KR')}종`;
})();
