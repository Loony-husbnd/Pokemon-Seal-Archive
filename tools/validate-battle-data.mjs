#!/usr/bin/env node
/**
 * packages/rembrandt/data/battle-data.js 무결성 검증
 *   node tools/validate-battle-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'packages', 'rembrandt', 'data', 'battle-data.js');
const sandbox = {};
vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox); // 브라우저와 같은 방식(전역 BATTLE_DATA)으로 로드
const d = sandbox.BATTLE_DATA;

// 엔진(engine.js)이 이해하는 변화기 효과 키. 새 효과를 엔진에 추가하면 여기에도 넣는다.
const STATUS_FX_KEYS = new Set(['ail', 'tgt', 'self', 'heal', 'rest', 'hpCost', 'powder', 'typeImmune', 'weather', 'terrain', 'room', 'hazard', 'defog', 'screen', 'side', 'seed', 'taunt',
  'encore', 'disable', 'torment', 'yawn', 'aquaRing', 'ingrain', 'wish', 'roost', 'sandHeal', 'weatherHeal', 'focus', 'attract', 'nightmare', 'perish', 'protect', 'sub', 'painSplit',
  'phaze', 'transform', 'splash', 'haze', 'metronome', 'sleepTalk', 'trap', 'spite', 'soak', 'randStat', 'reqFoeStatus', 'cure', 'cureFoe',
  // 3단계
  'selfTrap', 'tidy', 'charge2', 'strengthSap', 'tar', 'terrainHeal', 'dead', 'faintSelf', 'revive', 'pivot', 'stockpile', 'swallow', 'gravity', 'wonder', 'magicRoom', 'sport', 'ion', 'electrify',
  'fairyLock', 'courtChange', 'mimic', 'sketch', 'mirrorMove', 'copycat', 'meFirst', 'assist', 'naturePower', 'repeat', 'copyStages', 'typeChange', 'addType', 'setType', 'swapTypes', 'rolePlay',
  'giveTypes', 'doodle', 'swapStages', 'invertStages', 'swapStat', 'ownSwap', 'splitStats', 'psychoShift', 'statusSwap', 'clearBoosts', 'embargo', 'healBlock', 'simple', 'insomnia', 'recycle',
  'levitate', 'telekinesis', 'foresight', 'lockOn', 'laserFocus', 'curse', 'destinyBond', 'grudge', 'imprison', 'snatch', 'coat', 'dust', 'octolock', 'nextOrder', 'boostNext']);
// 공격기 효과 키 (기본 + 특수 공격기). 엔진이 모르는 키가 들어오면 검증이 실패한다.
const ATTACK_FX_KEYS = new Set(['hits', 'crit', 'flinch', 'ail', 'drain', 'recoil', 'tgt', 'self', 'neverMiss', 'useDef',
  'autoCls', 'breakProtect', 'clearFoeStages', 'freezeDry', 'multiAcc', 'escalate', 'dual', 'trapBoth', 'trapFoe', 'cureFoeStatus', 'ppCut', 'syrup', 'typeBy',
  'dyn', 'fixed', 'ohko', 'useDefAsAtk', 'useTargetAtk', 'priTerrain', 'needTerrain', 'x2If', 'ifFoeBoosted', 'counter', 'finalGambit', 'beatUp', 'present', 'reqFoeStatus', 'lastResort',
  'needFoeAttack', 'needFoePriority', 'firstTurn', 'focusPunch', 'beakBlast', 'onlySleep',
  'charge2', 'chargeText', 'chargeSkip', 'chargeSelf', 'invul', 'solarWeak', 'recharge', 'rampage', 'uproar', 'delay', 'bind', 'pivot', 'forceOut', 'selfKO', 'crash', 'selfDamagePct',
  'cantRepeat', 'salt', 'mortalSpin', 'breakScreens', 'loseType', 'glaive', 'leaveOne']);
const ATTACK_ENUMS = {
  dyn: ['wtTarget', 'wtRatio', 'hp150', 'flail', 'hardPress', 'crushGrip', 'gyro', 'electroBall', 'stored', 'spitUp', 'weatherBall', 'terrainPulse', 'risingVoltage', 'expandingForce',
    'rageFist', 'lastRespects', 'echoed', 'furyCutter', 'rollout', 'mistyBoost'],
  fixed: ['level', 'half', 'endeavor', 'userHp'], counter: ['phys', 'spec', 'any', 'any15'], typeBy: ['user'], pivot: ['out'], invul: ['air', 'ground', 'water', 'ghost'],
  chargeSkip: ['sun', 'rain'], priTerrain: ['grassy', 'electric', 'misty', 'psychic'], cureFoeStatus: ['brn', 'par', 'psn', 'slp', 'frz'],
  x2If: ['userStatus', 'foePoison', 'foeStatus', 'foeHalf', 'foeHurt', 'actedAfter', 'hurtByFoe', 'allyFaintedPrev', 'lowered', 'prevFailed', 'always'],
};
const errors = [];
const err = m => errors.push(m);
const isInt = v => Number.isInteger(v);

if (!d || !d.pokemon || !d.moves) { console.error('BATTLE_DATA 로드 실패'); process.exit(1); }
if (d.types.length !== 18 || d.chart.length !== 18 || d.chart.some(r => r.length !== 18)) err('타입/상성표 크기 오류');

for (const [id, m] of Object.entries(d.moves)) {
  if (!m.k || !m.e) err(`기술 ${id}: 이름 없음`);
  if (!(m.t >= 1 && m.t <= 18)) err(`기술 ${id}: 타입 오류`);
  if (!['p', 's', 'n'].includes(m.c)) err(`기술 ${id}: 분류 오류`);
  const isStatus = m.c === 'n';
  if (isStatus ? m.pw !== 0 : !(m.pw > 0)) err(`기술 ${id}: 위력 오류 (변화기는 0, 공격기는 양수)`);
  if (!(m.pp > (m.c === 'n' ? 0 : 1))) err(`기술 ${id}: PP 오류`);              // 스케치는 PP 1
  if (m.ac !== null && !(m.ac > 0 && m.ac <= 100)) err(`기술 ${id}: 명중 오류`);
  if (!m.fx || typeof m.fx !== 'object') err(`기술 ${id}: fx 없음`);
  if (isStatus) {
    const fx = m.fx;
    if (!Object.keys(fx).length) err(`변화기 ${id}(${m.e}): 효과 없음`);
    if (fx.ail && m.ac === null) err(`변화기 ${id}(${m.e}): 상태이상을 거는 기술인데 명중률이 없음`);
    for (const k of Object.keys(fx)) if (!STATUS_FX_KEYS.has(k)) err(`변화기 ${id}(${m.e}): 알 수 없는 효과 ${k}`);
    const enums = { weather: ['sun', 'rain', 'sand', 'snow'], terrain: ['electric', 'grassy', 'misty', 'psychic'], hazard: ['rocks', 'spikes', 'tspikes', 'web'],
      screen: ['reflect', 'lightscreen', 'veil'], side: ['tailwind', 'safeguard', 'mist', 'lucky'],
      protect: ['protect', 'endure', 'king', 'spiky', 'bunker', 'obstruct', 'silk', 'burning', 'maxguard', 'quick', 'crafty', 'wide', 'mat'], cure: ['self', 'party'],
      pivot: ['out', 'baton', 'shed'], faintSelf: ['wish', 'dance', 'memento'], sport: ['mud', 'water'], typeChange: ['move', 'resist', 'terrain', 'mirror'], foresight: ['ghost', 'dark'],
      dead: ['ally', 'item'], nextOrder: [1, -1], terrainHeal: ['grassy', 'electric', 'misty', 'psychic'] };
    for (const [k, list] of Object.entries(enums)) if (fx[k] !== undefined && !list.includes(fx[k])) err(`변화기 ${id}(${m.e}): ${k} 값 오류 (${fx[k]})`);
    if (m.w !== undefined && !(m.w >= 0 && m.w <= 3)) err(`변화기 ${id}(${m.e}): 비중(w) 범위 오류`);
    for (const c of [...(fx.tgt || []), ...(fx.self || [])]) {
      if (!['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'].includes(c.stat) || !Number.isInteger(c.change) || c.change === 0) err(`변화기 ${id}(${m.e}): 능력 변화 오류`);
    }
  } else if (m.w !== undefined) err(`기술 ${id}: 공격기에 w 가 있음`);
}
const statusIds = Object.keys(d.moves).filter(i => d.moves[i].c === 'n');

let noMove = 0, totalMoves = 0;
const dist = {};
for (const [id, p] of Object.entries(d.pokemon)) {
  if (!p.k) err(`#${id}: 이름 없음`);
  if (!p.t.length || p.t.length > 2 || p.t.some(t => !(t >= 1 && t <= 18))) err(`#${id}: 타입 오류`);
  if (p.b.length !== 6 || p.s.length !== 6 || p.b.some(v => !isInt(v) || v <= 0) || p.s.some(v => !isInt(v) || v <= 0)) err(`#${id}: 능력치 오류`);
  if (p.bst !== p.b.reduce((a, x) => a + x, 0)) err(`#${id}: 종족값합 불일치`);
  p.b.forEach((v, i) => {
    const expect = i === 0 ? (p.sp === 292 ? 1 : 2 * v + 141) : 2 * v + 36;
    if (p.s[i] !== expect) err(`#${id}: Lv100 능력치 계산 불일치 (idx ${i})`);
  });
  if (!p.m.length) { noMove++; err(`#${id}: 기술 없음`); }
  if (p.m.length > 4 || new Set(p.m).size !== p.m.length) err(`#${id}: 기술 중복/초과`);
  for (const mid of p.m) if (!d.moves[mid]) err(`#${id}: 존재하지 않는 기술 ${mid}`);
  for (const mid of p.m) if (d.moves[mid] && d.moves[mid].c === 'n') err(`#${id}: 공격기 목록(m)에 변화기 ${mid}`);
  if (!Array.isArray(p.sm) || !Array.isArray(p.ss)) err(`#${id}: sm/ss 없음`);
  else {
    for (const mid of p.sm) if (!statusIds.includes(String(mid))) err(`#${id}: sm 에 변화기가 아닌 기술 ${mid}`);
    for (const mid of p.ss) if (!p.sm.includes(mid)) err(`#${id}: ss 가 sm 의 부분집합이 아님 (${mid})`);
    if (new Set(p.sm).size !== p.sm.length) err(`#${id}: sm 중복`);
  }
  totalMoves += p.m.length;
  dist[p.m.length] = (dist[p.m.length] || 0) + 1;
}

// Proelium 용 학습 가능 공격기 파일 (battle-learnsets.js)
const learnFile = path.join(ROOT, 'packages', 'rembrandt', 'data', 'battle-learnsets.js');
if (fs.existsSync(learnFile)) {
  const sb2 = { BATTLE_DATA: d };
  vm.runInNewContext(fs.readFileSync(learnFile, 'utf8'), sb2);
  const L = sb2.BATTLE_LEARN || {};
  let learnCount = 0;
  for (const id of Object.keys(d.pokemon)) {
    if (!L[id]) { err(`#${id}: 학습 가능 공격기 목록 없음`); continue; }
    for (const mid of L[id]) {
      learnCount++;
      if (!d.moves[mid] || d.moves[mid].c === 'n') err(`#${id}: 학습 목록의 기술 ${mid} 가 공격기가 아니거나 없음`);
    }
  }
  console.log(`학습 가능 공격기 목록: ${Object.keys(L).length}종, 평균 ${(learnCount / Object.keys(L).length).toFixed(1)}개`);
  // 학습 전용 기술까지 합쳐진 뒤 공격기 효과를 검사한다 (엔진이 모르는 키·잘못된 값 방지)
  for (const [id, m] of Object.entries(d.moves)) {
    if (m.c === 'n') continue;
    for (const k of Object.keys(m.fx)) if (!ATTACK_FX_KEYS.has(k)) err(`공격기 ${id}(${m.e}): 알 수 없는 효과 ${k}`);
    for (const [k, list] of Object.entries(ATTACK_ENUMS)) if (m.fx[k] !== undefined && !list.includes(m.fx[k])) err(`공격기 ${id}(${m.e}): ${k} 값 오류 (${m.fx[k]})`);
    if (m.fx.ail && !['par', 'slp', 'frz', 'brn', 'psn', 'tox', 'cnf', 'tri', 'dire'].includes(m.fx.ail.kind)) err(`공격기 ${id}(${m.e}): 상태이상 종류 오류`);
  }
  const attackTotal = Object.values(d.moves).filter(m => m.c !== 'n').length;
  console.log(`공격기 ${attackTotal}개 (기본 ${attackTotal - Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'battle-attack-moves.json'), 'utf8')).moves).length} + 특수 공격기 ${Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'battle-attack-moves.json'), 'utf8')).moves).length})`);
} else err('battle-learnsets.js 가 없습니다 (npm run battle:data)');

const n = Object.keys(d.pokemon).length;
console.log(`포켓몬 ${n}종/폼, 기술 ${Object.keys(d.moves).length}개 (변화기 ${statusIds.length}개), 평균 대표 공격기 ${(totalMoves / n).toFixed(2)}개`);
if (statusIds.length !== 270) err(`변화기가 270개여야 합니다 (현재 ${statusIds.length})`);
console.log('보유 기술 수 분포:', JSON.stringify(dist));
const missing = Array.from({ length: 1025 }, (_, i) => i + 1).filter(i => !d.pokemon[i]);
if (missing.length) err(`1~1025 중 누락: ${missing.join(',')}`);
if (errors.length) {
  console.error(`검증 실패 ${errors.length}건`);
  errors.slice(0, 30).forEach(e => console.error(' - ' + e));
  process.exit(1);
}
console.log('검증 통과');
