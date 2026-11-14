/**
 * Proelium 저장소 — 모든 키는 'proelium:' 접두어를 쓴다.
 * Holo 와 같은 도메인(GitHub Pages)을 쓰므로, 접두어가 없으면 서로의 세이브를 덮어쓸 수 있다.
 * (Holo 의 기존 키는 호환을 위해 그대로 두고, 새 앱 쪽만 이 규칙을 지킨다.)
 */
(function (global) {
  'use strict';
  const NS = 'proelium:';
  global.ProeliumStorage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(NS + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(NS + key); } catch (e) { /* noop */ } },
  };
})(window);
