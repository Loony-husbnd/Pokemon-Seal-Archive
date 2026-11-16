/**
 * AI 진입점.
 *
 *   const ai = createAI({ dex: createDex(), seed: 1 });
 *   const { choice } = ai.choose(match.player(0), 'hard');      // 'easy' | 'normal' | 'hard' | 'hell'
 *
 * AI 는 match.player(side) 가 주는 것만 본다: 내 선택지, 이 시점의 공개 로그, 그리고 '가려진 세계'(상대 숨은 정보를 추정값으로 바꾼 복제).
 * 상대가 이번 턴 무엇을 고르는지는 알 수 없다(동시 선택). 상대의 특성·도구·안 쓴 기술·능력치도 모른다.
 */
import { createObserver, sampleGuess } from './belief.js';
import { decide, LEVELS } from './policy.js';
import { searchChoose } from './search.js';

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createAI(opts) {
  const D = opts.dex, rng = opts.rng || mulberry(opts.seed === undefined ? 1 : opts.seed);
  const observers = new WeakMap();
  const observe = player => {
    let o = observers.get(player);
    if (!o) { o = createObserver(player.side); observers.set(player, o); }
    const lines = player.lines(o.cursor); o.cursor += lines.length; o.feed(lines);
    return o;
  };
  return {
    LEVELS,
    /** 지금 이 시점의 요청에 대한 선택. 대기 중이면 { choice: null } */
    choose(player, level = 'normal', o = {}) {
      const kind = player.kind();
      if (kind === 'wait') return { choice: null, reason: '대기' };
      const obs = observe(player);
      const choices = player.choices();
      if (kind === 'preview') return { choice: choices[0], reason: '미리보기' };
      if (LEVELS[level] && LEVELS[level].search) return searchChoose(player, obs, D, rng, Object.assign({ budgetMs: opts.budgetMs }, o));
      const world = player.world(sampleGuess(obs, D, rng, 0), [5, 6, 7, 8]);
      const d = decide(world, player.side, level, rng);
      return { choice: d.choice, reason: d.reason, score: d.score };
    },
  };
}
export { LEVELS };
