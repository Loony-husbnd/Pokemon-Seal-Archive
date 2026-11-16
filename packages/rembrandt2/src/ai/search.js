/**
 * 지옥: 가려진 세계를 여러 개 만들어(상대의 숨은 정보를 다르게 추정) 후보 행동마다 실제 시뮬레이터로 몇 턴 굴려 보고,
 * 평가 함수의 평균이 가장 좋은 행동을 고른다. 같은 세계·같은 난수로 후보를 비교하므로 차이는 행동에서만 나온다.
 * 복제마다 난수 시드가 새로라서 급소·빗나감을 미리 볼 수 없다.
 */
import { decide } from './policy.js';
import { evalWorld } from './eval.js';
import { sampleGuess } from './belief.js';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function rollout(w, side, depth, rng) {
  for (let t = 0; t < depth && !w.ended; t++) {
    try { w.submitWith(() => [0, 1].map(s => { const d = decide(w, s, s === side ? 'hard' : 'normal', rng); return d.choice; })); }
    catch (e) { break; }
  }
}

/**
 * @param player 플레이어 시점(match.player(side))
 * @param opts { budgetMs, minRounds, depth, maxCands }
 */
export function searchChoose(player, obs, D, rng, opts = {}) {
  const side = player.side, kind = player.kind(), choices = player.choices();
  if (!choices.length) return { choice: null, reason: '대기' };
  if (choices.length === 1 || kind === 'preview') return { choice: choices[0], reason: '유일한 선택' };
  const budget = opts.budgetMs ?? 900, minRounds = opts.minRounds ?? 4, depth = opts.depth ?? 3, maxCands = opts.maxCands ?? 5;

  // 후보 좁히기: 규칙 기반 점수 상위 몇 개. 메가진화는 거의 언제나 이득이라 쓸 수 있으면 쓰는 쪽만 후보로 둔다 (같은 시간에 라운드를 두 배로 돌린다)
  const g0 = sampleGuess(obs, D, rng, 0);
  const w0 = player.world(g0, [11, 22, 33, 44]);
  const first = decide(w0, side, 'hard', rng);
  let cands = choices;
  if (kind === 'move' && first.rows) {
    const ranked = first.rows.slice().sort((a, b) => b.score - a.score).map(r => r.choice);
    const megaOf = c => choices.find(x => x.type === 'move' && x.mega && x.index === c.index);
    cands = []; const seen = new Set();
    for (const c of ranked) {
      if (cands.length >= maxCands) break;
      const use = c.type === 'move' && megaOf(c) ? megaOf(c) : c;
      const key = use.type + (use.index ?? use.to) + (use.mega ? 'M' : ''); if (seen.has(key)) continue; seen.add(key); cands.push(use);
    }
    if (!cands.some(c => c.type === 'switch')) { const sw = choices.filter(c => c.type === 'switch'); if (sw.length) cands.push(sw[0]); }
  }
  const sum = cands.map(() => 0); let rounds = 0; const t0 = nowMs();
  for (let r = 0; r < 40; r++) {
    const guess = r === 0 ? g0 : sampleGuess(obs, D, rng, r);
    const snap = player.world(guess, [r * 13 + 1, 5, 9, 11]).snapshot();       // 한 번 직렬화해 후보마다 복원
    for (let i = 0; i < cands.length; i++) {
      const w = snap.restore([r * 17 + 3, 7, 11, 13]);               // 같은 시드를 모든 후보에 준다
      const foeSide = 1 - side; let foeChoice = null;
      if (w.kind(foeSide) !== 'wait') foeChoice = decide(w, foeSide, 'normal', rng).choice;
      try { w.submit(side === 0 ? [cands[i], foeChoice] : [foeChoice, cands[i]]); }
      catch (e) { try { w.submit(side === 0 ? [cands[i], null] : [null, cands[i]]); } catch (e2) { sum[i] += -5; continue; } }
      rollout(w, side, depth, rng);
      sum[i] += evalWorld(w, side);
    }
    rounds++;
    if (rounds >= minRounds && nowMs() - t0 > budget) break;
  }
  if (opts.trace) cands.forEach((c, i) => opts.trace.push({ choice: c, mean: sum[i] / rounds }));
  let bi = 0; for (let i = 1; i < cands.length; i++) if (sum[i] > sum[bi]) bi = i;
  return { choice: cands[bi], reason: `지옥: 탐색 ${rounds}라운드`, value: sum[bi] / rounds, rounds };
}
