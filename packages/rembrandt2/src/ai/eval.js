/**
 * 가려진 세계의 평가: side 쪽에서 본 유불리. 클수록 내가 유리. 체력·생존·능력 변화·상태이상·함정을 합친 값이다.
 * 끝난 배틀은 ±4 (진행 중 평가의 범위가 대략 ±3 이라, 너무 크면 몇 번의 승패가 평균을 지배한다). (탐색은 이 값의 평균으로 선택지를 비교한다)
 */
const STATUS_PEN = { slp: 0.2, par: 0.1, brn: 0.12, psn: 0.08, tox: 0.12, frz: 0.25 };
const HAZARD = { stealthrock: 0.12, spikes: 0.06, toxicspikes: 0.06, stickyweb: 0.08 };
const GOOD_SIDE = { reflect: 0.1, lightscreen: 0.1, auroraveil: 0.12, tailwind: 0.1, safeguard: 0.03 };

function sideScore(b, s) {
  const side = b.sides[s]; let hp = 0, alive = 0, st = 0;
  for (const p of side.pokemon) {
    if (p.fainted) continue;
    alive++; hp += p.hp / p.maxhp;
    if (p.status) st += STATUS_PEN[p.status] || 0.05;
  }
  const a = side.active[0]; let boost = 0;
  if (a && !a.fainted) boost = ((a.boosts.atk || 0) * 0.035 + (a.boosts.spa || 0) * 0.035 + (a.boosts.spe || 0) * 0.04 + (a.boosts.def || 0) * 0.02 + (a.boosts.spd || 0) * 0.02);
  let cond = 0; const reserves = Math.max(0, alive - 1);
  for (const [id, v] of Object.entries(side.sideConditions || {})) {
    if (HAZARD[id]) cond -= HAZARD[id] * (v.layers || 1) * Math.min(1, reserves / 2);
    else if (GOOD_SIDE[id]) cond += GOOD_SIDE[id];
  }
  return { hp, alive, v: hp + alive * 0.2 + boost - st + cond };
}

export function evalWorld(world, side) {
  const b = world.battle;
  if (b.ended) {
    if (!b.winner) return 0;
    return b.winner === (side === 0 ? 'p1' : 'p2') ? 4 : -4;
  }
  return sideScore(b, side).v - sideScore(b, 1 - side).v;
}
