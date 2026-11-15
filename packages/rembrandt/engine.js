/**
 * 포켓몬 배틀 엔진 (3단계) — 화면과 무관한 순수 로직
 *
 * 로드 순서: packages/rembrandt/data/battle-data.js → packages/rembrandt/engine.js
 *   브라우저: window.BattleEngine (기본 데이터로 만든 엔진), window.createBattleEngine(data)
 *   Node(vm): tools/lib/load-battle.mjs 참고
 *
 * 사용 흐름
 *   const E = BattleEngine;
 *   const battle = E.createBattle({
 *     parties: [[E.makeMon(6), E.makeMon(25), E.makeMon(9)], [ ... ]],   // 0 = 나, 1 = 상대
 *     names: ['나', '상대'], seed: 123,
 *   });
 *   battle.start();                                          // 첫 포켓몬 등장 이벤트
 *   battle.legalActions(0);                                  // { moves:[...], switches:[...], mustStruggle }
 *   const events = battle.playTurn({type:'move', index:0}, {type:'move', index:2});
 *   if (battle.phase === 'switch') battle.replace(side, partyIndex);   // 기절 후 교체
 *   battle.phase === 'ended' → battle.winner (0 | 1 | 'draw')
 *
 * 이벤트: { t, text, ... } 배열을 돌려준다. UI 는 t 로 연출을, text 로 한국어 메시지를 쓴다.
 *   turn switch move(cls: phys|spec|status) miss damage(cause: confusion|recoil|cost|상태이상) effective crit hits heal recoil status stage faint text needSwitch end
 *   (3단계 추가) revive(쓰러진 포켓몬 부활) sync(상태이상 교환)
 *
 * 구현 범위(1차): 데미지 공식(Gen 9, Lv100), 상성, 자속, 급소, 명중/회피, 다단 히트,
 *   풀죽음, 상태이상(화상·마비·독·맹독·잠듦·얼음), 혼란, 능력 단계, 흡수/반동, 발버둥, 교체.
 *   변화기 1단계(cls 'status'): 상대에게 상태이상·능력 하락, 자신의 능력 상승, 체력 회복(잠자기·뱃대띠 포함).
 *   변화기 2단계: 날씨·필드·함정·벽·지속 효과·보호·대타. 변화기 3단계(270개 완성): 교체 기술(배턴터치·유턴류), 흉내·복사,
 *   타입 변경, 능력 교환·분배, 방어 변종(킹실드 등), 중력·원더룸 등 필드, 길동무·저주 등.
 *   특성·도구는 없다 (그것이 필요한 기술은 비슷한 효과로 바꿔 구현했고, 효과는 describeEffect 에 그대로 적혀 있다).
 *   기술 도중 교체(턴 중간 교체): playTurn 이 phase 'switch' 로 멈추면 battle.replace(side, 파티 인덱스) 로 이어 간다.
 *
 * 난수 소비 순서(테스트에서 rng 를 고정할 때 참고): 선공 동률 → [행동 전 판정] → 명중 →
 *   (히트마다: 급소 → 데미지 난수) → 추가효과(풀죽음 → 상태이상 → 능력 변화 순, 확률 판정마다 1회)
 */
(function (global) {
  'use strict';

  const STAT_KO = { atk: '공격', def: '방어', spa: '특수공격', spd: '특수방어', spe: '스피드', acc: '명중률', eva: '회피율' };
  const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
  const NORMAL = 1, FIGHTING = 2, DARK = 17, FAIRY = 18, FLYING = 3, POISON = 4, GROUND = 5, ROCK = 6, GHOST = 8, STEEL = 9, FIRE = 10, WATER = 11, GRASS = 12, ELECTRIC = 13, PSYCHIC = 14, ICE = 15, DRAGON = 16;
  const STAT_SHORT = { atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드', acc: '명중', eva: '회피' };
  const AIL_KO = { par: '마비', slp: '잠듦', brn: '화상', psn: '독', tox: '맹독', frz: '얼음', cnf: '혼란' };

  /** 회복량 (분수로 계산해 오차가 없게 한다). 달빛류는 날씨에 따라, 모래모으기는 모래바람일 때 늘어난다 */
  function healAmountFor(fx, maxHp, weather, terrain) {
    let n = fx.heal, d = 100;
    if (fx.terrainHeal && terrain === fx.terrainHeal) { n = 2; d = 3; }
    if (fx.weatherHeal) { if (weather === 'sun') { n = 2; d = 3; } else if (weather) { n = 1; d = 4; } else { n = 1; d = 2; } }
    if (fx.sandHeal) { if (weather === 'sand') { n = 2; d = 3; } else { n = 1; d = 2; } }
    return Math.max(1, Math.floor(maxHp * n / d));
  }

  /** 타입 때문에 걸리지 않는 상태이상 (전기=마비, 불꽃=화상, 얼음=얼음, 독·강철=독) */
  function statusImmune(mon, kind) {
    if (kind === 'par') return mon.types.includes(ELECTRIC);
    if (kind === 'brn') return mon.types.includes(FIRE);
    if (kind === 'frz') return mon.types.includes(ICE);
    if (kind === 'psn' || kind === 'tox') return mon.types.includes(POISON) || mon.types.includes(STEEL);
    return false;
  }

  const WEATHER_KO = { sun: '쾌청', rain: '비', sand: '모래바람', snow: '눈' };
  const TERRAIN_KO = { electric: '일렉트릭필드', grassy: '그래스필드', misty: '미스트필드', psychic: '사이코필드' };
  const HAZARD_KO = { rocks: '상대 쪽에 스텔스록', spikes: '상대 쪽에 압정(최대 3겹)', tspikes: '상대 쪽에 독압정(최대 2겹)', web: '상대 쪽에 끈적네트' };
  const SCREEN_KO = { reflect: '물리 피해 절반 5턴', lightscreen: '특수 피해 절반 5턴', veil: '모든 피해 절반 5턴(눈일 때)' };
  const SIDE_KO = { tailwind: '스피드 2배 4턴', safeguard: '상태이상 방지 5턴', mist: '능력 하락 방지 5턴', lucky: '급소 방지 5턴' };
  const PROTECT_KO = {
    protect: '이번 턴 공격 막기', endure: '이번 턴 1만 남기고 버티기', maxguard: '이번 턴 모든 기술 막기',
    king: '공격 막기 · 접촉한 상대 공격 −1', spiky: '공격 막기 · 접촉한 상대 체력 1/8 피해', bunker: '이번 턴 기술 막기 · 접촉한 상대 독',
    obstruct: '공격 막기 · 접촉한 상대 방어 −2', silk: '공격 막기 · 접촉한 상대 스피드 −1', burning: '공격 막기 · 접촉한 상대 화상',
    quick: '우선도 높은 공격 막기', crafty: '상대의 변화기 막기', wide: '다단 히트 공격 막기', mat: '등장한 첫 턴에만 · 공격 막기',
  };
  const PIVOT_KO = { out: '쓴 뒤 바로 교체', baton: '능력 변화를 넘기고 교체', shed: '체력 절반으로 대타를 만들어 넘기고 교체' };
  const FAINT_KO = { wish: '자신은 쓰러지고 다음 포켓몬 체력·상태 완전 회복', dance: '자신은 쓰러지고 다음 포켓몬 체력·상태·PP 완전 회복', memento: '자신이 쓰러진다' };
  const TYPECHANGE_KO = { move: '자신의 기술 중 하나의 타입으로 변경', resist: '상대의 마지막 기술을 반감하는 타입으로 변경', terrain: '필드에 맞는 타입으로 변경', mirror: '상대와 같은 타입으로 변경' };
  const MISC_KO = {
    seed: '씨뿌리기(매 턴 흡수)', taunt: '도발(변화기 봉인)', encore: '앙코르(같은 기술 강제)', disable: '마지막 기술 봉인', torment: '같은 기술 연속 사용 봉인',
    yawn: '다음 턴 잠듦', aquaRing: '매 턴 체력 회복', ingrain: '매 턴 회복 · 교체 불가', wish: '다음 턴 체력 회복', focus: '급소율 크게 상승',
    attract: '헤롱헤롱(절반 확률로 행동 불가)', nightmare: '잠든 상대에게 매 턴 피해', perish: '3턴 뒤 양쪽 쓰러짐', sub: '체력 25%로 대타',
    painSplit: '서로의 체력을 평균', phaze: '상대를 강제 교체', transform: '상대로 변신', splash: '아무 일도 일어나지 않음', haze: '모든 능력 변화 초기화',
    metronome: '무작위 기술 사용', sleepTalk: '잠든 동안 무작위 기술', trap: '상대 교체 불가', spite: '상대 기술 PP 감소', soak: '상대를 물 타입으로',
    room: '느린 쪽이 먼저(5턴)', defog: '함정·벽 제거', cureFoe: '상대 상태이상 제거', randStat: '무작위 능력 크게 상승',
    revive: '쓰러진 동료 1마리를 체력 절반으로 부활', gravity: '중력(5턴): 모두 땅에 붙고 명중 ×5/3', wonder: '원더룸(5턴): 방어와 특수방어 뒤바뀜', magicRoom: '매직룸(5턴): 턴 종료 회복 효과 정지',
    ion: '이번 턴 노말 기술이 전기 타입으로', electrify: '상대의 다음 기술이 전기 타입으로', fairyLock: '다음 턴 양쪽 모두 교체 불가', courtChange: '양쪽 진영의 함정·벽을 맞바꿈',
    mimic: '상대의 마지막 기술을 이 칸에 복사(교체 전까지)', sketch: '상대의 마지막 기술을 이 칸에 영구 복사', mirrorMove: '상대의 마지막 기술을 그대로 사용', copycat: '직전에 쓰인 기술을 그대로 사용',
    meFirst: '상대가 고른 공격기를 먼저 빼앗아 1.5배로 사용', assist: '동료의 기술을 무작위로 사용', naturePower: '필드에 맞는 공격기를 사용', repeat: '방금 쓴 자신의 기술을 한 번 더 사용',
    copyStages: '상대의 능력 변화를 복사', invertStages: '상대의 능력 변화를 뒤집음', swapTypes: '서로의 타입을 맞바꿈', rolePlay: '상대의 첫 타입을 자신에게 추가', giveTypes: '상대를 자신과 같은 타입으로',
    doodle: '상대의 타입과 능력 변화를 복사', psychoShift: '자신의 상태이상을 상대에게 옮김', statusSwap: '서로의 상태이상을 맞바꿈', clearBoosts: '상대의 올라간 능력을 초기화',
    embargo: '상대가 5턴간 능력을 올릴 수 없음', healBlock: '상대가 5턴간 회복할 수 없음', simple: '상대의 능력 변화가 2배가 됨', insomnia: '상대는 잠들지 않고, 자고 있으면 깨어남',
    recycle: '마지막으로 쓴 기술의 PP 5 회복', strengthSap: '상대의 공격 능력치만큼 회복', stockpile: '비축(최대 3): 방어·특방 상승', swallow: '비축한 만큼 회복(25/50/100%)',
    charge2: '첫 턴은 힘을 모으고 다음 턴에 효과', tidy: '양쪽의 함정과 대타 제거', selfTrap: '이후 교체할 수 없음', levitate: '5턴간 공중에 떠서 땅 기술 무효', telekinesis: '상대를 3턴간 띄움(땅 기술 무효 · 필중)',
    lockOn: '다음 기술이 반드시 명중', laserFocus: '다음 턴까지 급소에 반드시 명중', curse: '고스트: 체력 절반으로 상대 저주 / 그 외: 공격·방어 +1 스피드 −1',
    destinyBond: '이 기술 뒤 쓰러지면 상대도 함께 쓰러짐', grudge: '이 기술 뒤 쓰러지면 상대 기술의 PP가 0', imprison: '내가 가진 기술을 상대가 쓰지 못함', snatch: '상대의 강화·회복 기술을 가로챔',
    coat: '이번 턴 상대의 변화기를 되받아침', dust: '이번 턴 상대의 불꽃 기술 실패 + 체력 1/4 피해', octolock: '상대를 가두고 매 턴 방어·특방 −1', tar: '불꽃 기술이 상대에게 2배', boostNext: '다음 턴 자신의 공격 위력 1.5배',
    nextOrder: '', terrainHeal: '', dead: '',
  };

  const TYPE_NAMES = ['', '노말', '격투', '비행', '독', '땅', '바위', '벌레', '고스트', '강철', '불꽃', '물', '풀', '전기', '에스퍼', '얼음', '드래곤', '악', '페어리'];
  const typeName = id => TYPE_NAMES[id] || '?';

  /** 변화기 효과를 한 줄로 요약한다 (화면용). 예: '상대 마비' · '공격 +2' · '체력 50% 회복' */
  function describeEffect(move) {
    const fx = move.fx || {}, out = [];
    if (fx.dead) return fx.dead === 'ally' ? '싱글 배틀에서는 효과 없음(아군이 필요)' : '효과 없음(건넬 도구가 없다)';
    if (fx.weather) out.push(`날씨: ${WEATHER_KO[fx.weather]} 5턴`);
    if (fx.terrain) out.push(`${TERRAIN_KO[fx.terrain]} 5턴`);
    if (fx.hazard) out.push(HAZARD_KO[fx.hazard]);
    if (fx.screen) out.push(SCREEN_KO[fx.screen]);
    if (fx.side) out.push(SIDE_KO[fx.side]);
    if (fx.protect) out.push(PROTECT_KO[fx.protect]);
    if (fx.pivot) out.push(PIVOT_KO[fx.pivot]);
    if (fx.faintSelf) out.push(FAINT_KO[fx.faintSelf]);
    if (fx.typeChange) out.push(TYPECHANGE_KO[fx.typeChange]);
    if (fx.addType) out.push(`상대에게 ${typeName(fx.addType)} 타입 추가`);
    if (fx.setType) out.push(`상대를 ${typeName(fx.setType)} 타입으로`);
    if (fx.sport) out.push(fx.sport === 'mud' ? '흙놀이(5턴): 전기 기술 위력 1/3' : '물놀이(5턴): 불꽃 기술 위력 1/3');
    if (fx.foresight) out.push(fx.foresight === 'ghost' ? '상대의 회피 무시 · 고스트에도 노말·격투 적중' : '상대의 회피 무시 · 악에도 에스퍼 적중');
    if (fx.swapStages) out.push(fx.swapStages === 'all' ? '서로의 능력 변화를 모두 맞바꿈' : `서로의 ${fx.swapStages.map(k => STAT_SHORT[k]).join('·')} 변화를 맞바꿈`);
    if (fx.swapStat) out.push(`서로의 ${STAT_SHORT[fx.swapStat]} 능력치를 맞바꿈`);
    if (fx.ownSwap) out.push(`자신의 ${josa(STAT_SHORT[fx.ownSwap[0]], '과/와')} ${STAT_SHORT[fx.ownSwap[1]]} 능력치를 맞바꿈`);
    if (fx.splitStats) out.push(`서로의 ${fx.splitStats.map(k => STAT_SHORT[k]).join('·')} 능력치를 평균으로`);
    if (fx.nextOrder) out.push(fx.nextOrder > 0 ? '다음 턴 먼저 움직임' : '상대가 다음 턴 가장 늦게 움직임');
    if (fx.terrainHeal) out.push('그래스필드에서는 회복량 증가');
    for (const k of Object.keys(MISC_KO)) if (fx[k] && MISC_KO[k]) out.push(MISC_KO[k]);
    if (fx.rest) out.push('체력 전부 회복 · 잠듦');
    if (fx.heal) out.push(`체력 ${fx.weatherHeal ? '날씨별 ' : ''}${fx.heal}% 회복`);
    if (fx.cure === 'self') out.push('상태이상 회복');
    if (fx.cure === 'party') out.push('파티 상태이상 회복');
    if (fx.hpCost) out.push(`체력 ${fx.hpCost}% 소모`);
    (fx.tgt || []).forEach(c => out.push(`상대 ${STAT_SHORT[c.stat]} ${c.change > 0 ? '+' : ''}${c.change}`));
    if (fx.ail) out.push(`상대 ${AIL_KO[fx.ail.kind]}`);
    (fx.self || []).forEach(c => out.push(`${STAT_SHORT[c.stat]} ${c.change > 0 ? '+' : ''}${c.change}`));
    return out.join(' · ');
  }

  const DYN_KO = {
    wtTarget: '상대가 무거울수록 강함', wtRatio: '상대보다 무거울수록 강함', hp150: '내 체력이 많을수록 강함', flail: '내 체력이 적을수록 강함', hardPress: '상대 체력이 많을수록 강함',
    crushGrip: '상대 체력이 많을수록 강함', gyro: '상대보다 느릴수록 강함', electroBall: '상대보다 빠를수록 강함', stored: '올라간 능력 단계마다 +20', weatherBall: '날씨에 따라 타입 변경·위력 2배',
    terrainPulse: '필드에 따라 타입 변경·위력 2배', risingVoltage: '일렉트릭필드에서 땅 위의 상대에게 2배', expandingForce: '사이코필드에서 1.5배', rageFist: '맞은 횟수만큼 강해짐',
    lastRespects: '쓰러진 동료 수만큼 강해짐', echoed: '연속으로 쓰일수록 강해짐', furyCutter: '연속으로 맞힐수록 2배(최대 160)', rollout: '연속으로 쓸수록 2배(최대 5턴)',
    spitUp: '비축한 만큼 강함 · 방어 원상태', mistyBoost: '미스트필드에서 1.5배',
  };
  const X2_KO = {
    userStatus: '상태이상이면 2배', foePoison: '상대가 독이면 2배', foeStatus: '상대가 상태이상이면 2배', foeHalf: '상대 체력이 절반 이하면 2배', foeHurt: '상대가 이미 다쳤으면 2배',
    actedAfter: '상대보다 늦게 움직이면 2배', hurtByFoe: '맞은 뒤라면 2배', allyFaintedPrev: '직전 턴 동료가 쓰러졌으면 2배', lowered: '능력이 내려갔으면 2배', prevFailed: '직전 기술이 실패했으면 2배',
    always: '도구가 없어 2배',
  };
  const FIXED_KO = { level: '고정 피해 100', half: '상대 체력의 절반', endeavor: '상대 체력을 내 체력과 같게', userHp: '내 체력만큼 피해 · 자신은 쓰러짐' };
  const INVUL_KO = { air: '공중', ground: '땅속', water: '물속', ghost: '그림자 속' };
  /** 위력이 상황에 따라 정해지는 공격기인가 (화면에서 위력 대신 '가변'으로 표시) */
  const variablePower = move => { const f = move.fx || {}; return move.cls !== 'status' && !!(f.dyn || f.fixed || f.ohko || f.counter || f.beatUp || f.present); };
  /** 공격기의 특수 처리를 한 줄로 요약한다 (화면용). 일반적인 추가 효과(상태이상·능력 변화 등)는 포함하지 않는다 */
  function describeAttack(move) {
    const fx = move.fx || {}, out = [];
    if (fx.dyn && DYN_KO[fx.dyn]) out.push(DYN_KO[fx.dyn]);
    if (fx.x2If) out.push(X2_KO[fx.x2If]);
    if (fx.fixed) out.push(FIXED_KO[fx.fixed]);
    if (fx.ohko) out.push('맞으면 일격에 쓰러뜨림');
    if (fx.counter) out.push(fx.counter === 'phys' ? '받은 물리 피해의 2배로 반격' : fx.counter === 'spec' ? '받은 특수 피해의 2배로 반격' : '받은 피해의 1.5배로 반격');
    if (fx.charge2) out.push(`첫 턴 충전${fx.invul ? `(${INVUL_KO[fx.invul]}에 숨음)` : ''}${fx.chargeSkip ? ` · ${fx.chargeSkip === 'sun' ? '쾌청' : '비'}이면 바로 발사` : ''}`);
    if (fx.recharge) out.push('쓴 뒤 다음 턴 반동');
    if (fx.rampage) out.push(fx.rampage.confuse ? '2~3턴 연속 사용 후 혼란' : fx.uproar ? '3턴 연속 · 그동안 아무도 잠들지 않음' : '연속으로 사용');
    if (fx.delay) out.push('2턴 뒤에 공격');
    if (fx.bind) out.push('4~5턴 붙들어 매 턴 피해 · 교체 불가');
    if (fx.pivot) out.push('때린 뒤 바로 교체');
    if (fx.forceOut) out.push('때린 뒤 상대를 강제 교체');
    if (fx.selfKO) out.push('쓰고 나면 쓰러짐');
    if (fx.crash) out.push('빗나가면 체력 절반 피해');
    if (fx.selfDamagePct) out.push(`맞히면 최대 체력의 ${fx.selfDamagePct}% 반동`);
    if (fx.cantRepeat) out.push('연속 사용 불가');
    if (fx.firstTurn) out.push('등장한 첫 턴에만');
    if (fx.needFoeAttack) out.push('상대가 공격기를 골랐을 때만');
    if (fx.needFoePriority) out.push('상대가 우선도 기술을 골랐을 때만');
    if (fx.focusPunch) out.push('먼저 맞으면 실패');
    if (fx.beakBlast) out.push('접촉한 상대에게 화상');
    if (fx.onlySleep) out.push('잠든 동안에만');
    if (fx.lastResort) out.push('다른 기술을 모두 쓴 뒤에만');
    if (fx.escalate) out.push('타수마다 위력 상승');
    if (fx.multiAcc) out.push('매 타 명중 판정');
    if (fx.breakProtect) out.push('방어를 무시');
    if (fx.salt) out.push('소금절이(매 턴 피해)');
    if (fx.mortalSpin) out.push('함정·구속 제거');
    if (fx.breakScreens) out.push('벽을 깨고 공격');
    if (fx.loseType) out.push('전기 타입을 잃음');
    if (fx.glaive) out.push('쓴 뒤 무방비(필중 · 피해 2배)');
    if (fx.leaveOne) out.push('체력 1은 남김');
    if (fx.trapFoe) out.push('상대를 가둠'); if (fx.trapBoth) out.push('서로 교체 불가');
    if (fx.clearFoeStages) out.push('상대 능력 변화 초기화');
    if (fx.freezeDry) out.push('물 타입에 효과 굉장'); if (fx.dual) out.push(`${typeName(fx.dual)} 타입 상성도 함께 계산`);
    if (fx.autoCls) out.push('공격·특공 중 높은 쪽으로 계산');
    if (fx.beatUp) out.push('건강한 동료마다 한 번씩 공격'); if (fx.present) out.push('피해 또는 회복');
    if (fx.needTerrain) out.push('필드가 있을 때만 · 필드를 없앰');
    if (fx.priTerrain) out.push('그래스필드에서 우선도 +1');
    if (fx.ifFoeBoosted) out.push('능력이 오른 상대에게 상태이상');
    if (fx.useDefAsAtk) out.push('방어 능력치로 공격'); if (fx.useTargetAtk) out.push('상대의 공격 능력치로 공격');
    if (fx.syrup) out.push('3턴간 매 턴 스피드 −1'); if (fx.ppCut) out.push('상대 기술 PP 감소');
    if (fx.cureFoeStatus) out.push('상대의 화상을 치료'); if (fx.typeBy) out.push('자신의 타입으로 공격');
    return out.join(' · ');
  }

  // ───────────── 한국어 조사 ─────────────
  function hasBatchim(word) {
    const ch = String(word).trim().slice(-1);
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
    return false;
  }
  function jongRieul(word) {
    const code = String(word).trim().slice(-1).charCodeAt(0);
    return code >= 0xAC00 && code <= 0xD7A3 && (code - 0xAC00) % 28 === 8;
  }
  /** josa('불꽃', '은/는') → '불꽃은' */
  function josa(word, pair) {
    const [a, b] = pair.split('/');
    if (pair === '으로/로') return word + (hasBatchim(word) && !jongRieul(word) ? a : b);
    return word + (hasBatchim(word) ? a : b);
  }

  // ───────── 난수 (시드 고정 가능) ─────────
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const stageMult = n => (n >= 0 ? (2 + n) / 2 : 2 / (2 - n));
  const accStageMult = n => (n >= 0 ? (3 + n) / 3 : 3 / (3 - n));
  const CRIT_RATE = [1 / 24, 1 / 8, 1 / 2, 1];

  /** 배틀 중에만 있는 임시 상태 (교체·기절하면 사라진다) */
  function freshVolatile() {
    return {
      seeded: false, taunt: 0, encore: 0, encoreMove: -1, disable: 0, disableMove: -1, torment: false, yawn: 0,
      aquaRing: false, ingrain: false, roost: false, focus: false, sub: 0, protect: false, protectStreak: 0, endure: false,
      trapped: false, attract: false, nightmare: false, perish: 0, lastMove: -1,
      // 3단계
      prevMove: -1, stock: 0, turnsOut: 0, lockOn: 0, laserFocus: 0, fsG: false, fsD: false, cursed: false, destinyBond: false, grudge: false, imprison: false,
      snatching: false, coat: false, powdered: false, electrified: false, octolock: false, tarred: false, levitate: 0, float: 0, embargo: 0, healBlock: 0,
      simple: false, insomnia: false, added: 0, syrup: 0, ov: null,
      invul: null, recharge: false, rampage: null, rollN: 0, uproar: 0, bound: 0, salted: false, glaive: false,
      hitsTaken: 0, hurtTurn: -1, lastHit: null, boostedTurn: -1, loweredTurn: -1, failedLast: false, furyN: 0, used: [], beakHeat: false, charging: null, nextOrder: 0, boostNext: 0, noRetreat: false, mimicOrig: null,
    };
  }

  const STRUGGLE = Object.freeze({
    id: 0, name: '발버둥', type: 0, cls: 'phys', power: 50, acc: null, pp: 1, maxPp: 1, pri: 0, fx: Object.freeze({}),
  });

  function createEngine(data) {
    const CHART = data.chart;

    // ───────────── 기본 계산 ─────────────
    function typeMultiplier(moveType, defTypes, c) {
      if (!moveType) return 1; // 무속성(발버둥 등)
      let m = 1;
      for (const t of defTypes) {
        let v = CHART[moveType - 1][t - 1];
        if (v === 0 && c) {                      // 꿰뚫어보기·미라클아이·중력이 무효를 풀어 준다
          if (c.fsG && t === GHOST && (moveType === NORMAL || moveType === FIGHTING)) v = 1;
          else if (c.fsD && t === DARK && moveType === PSYCHIC) v = 1;
          else if (c.gravity && t === FLYING && moveType === GROUND) v = 1;
        }
        m *= v;
      }
      if (c) {
        if (moveType === GROUND && c.defLevitate && !c.gravity) return 0;     // 전자부유·텔레키네시스
        if (moveType === FIRE && c.tar) m *= 2;                                // 타르샷
        if (c.freezeDry && defTypes.includes(WATER)) m *= defTypes.filter(t => t === WATER).length ? 4 : 1;   // 프리즈드라이: 물 타입에 효과가 굉장 (반감 → 2배)
      }
      return m;
    }
    /** 기술 자체의 특수 상성(프리즈드라이·플라잉프레스)까지 반영한 효과 배율 */
    function moveEff(move, def, c) {
      const c2 = move.fx && move.fx.freezeDry ? Object.assign({}, c, { freezeDry: true }) : c;
      let m = typeMultiplier(move.type, def.types, c2);
      if (move.fx && move.fx.dual) m *= typeMultiplier(move.fx.dual, def.types, c);
      return m;
    }

    /** 능력치 원본 (파워트릭·스피드스왑 등으로 바뀐 값 포함) */
    const baseStat = (mon, key) => (mon.ov && mon.ov[key] !== undefined ? mon.ov[key] : mon.stats[key]);

    function effectiveStat(mon, key, opts) {
      let stage = mon.stages[key];
      if (opts && opts.crit) stage = opts.attacking ? Math.max(0, stage) : Math.min(0, stage);
      let v = Math.floor(baseStat(mon, key) * stageMult(stage));
      if (key === 'spe' && mon.status === 'par') v = Math.floor(v / 2);
      return Math.max(1, v);
    }

    /**
     * 데미지 계산 (Gen 9 공식, Lv100).
     * @param o.crit 급소 여부  @param o.roll 난수 85~100 (기본 100)
     * @param o.ctx  날씨·필드·벽 정보 { weather, terrain, attGrounded, defGrounded, screens } (battle.ctx(side) 로 얻는다)
     */
    function calcDamage(att, def, move, o) {
      o = o || {};
      if (move.cls === 'status') return { damage: 0, eff: 1, crit: false };   // 변화기는 데미지가 없다
      const phys = move.cls === 'phys';
      const atkKey = move.fx.useDefAsAtk ? 'def' : phys ? 'atk' : 'spa';       // 바디프레스: 방어 능력치로 공격
      const c = o.ctx;
      let defKey = (phys || move.fx.useDef) ? 'def' : 'spd';
      if (c && c.wonder) defKey = defKey === 'def' ? 'spd' : 'def';       // 원더룸
      const A = effectiveStat(move.fx.useTargetAtk ? def : att, atkKey, o.crit ? { crit: true, attacking: true } : null);   // 속임수: 상대의 공격 능력치
      let D = effectiveStat(def, defKey, o.crit ? { crit: true, attacking: false } : null);
      const eff = moveEff(move, def, c);
      if (eff === 0) return { damage: 0, eff: 0, crit: !!o.crit };
      let power = move.power;
      if (c) {
        if (c.helping) power = Math.floor(power * 1.5);                      // 도우미
        if ((c.mud && move.type === ELECTRIC) || (c.waterSport && move.type === FIRE)) power = Math.floor(power / 3);   // 흙놀이·물놀이
        if (c.terrain && c.attGrounded && ((c.terrain === 'electric' && move.type === ELECTRIC) || (c.terrain === 'grassy' && move.type === GRASS) ||
            (c.terrain === 'psychic' && move.type === PSYCHIC))) power = Math.floor(power * 1.3);
        if (c.terrain === 'misty' && c.defGrounded && move.type === DRAGON) power = Math.floor(power * 0.5);
        if (c.weather === 'snow' && defKey === 'def' && def.types.includes(ICE)) D = Math.floor(D * 1.5);
        if (c.weather === 'sand' && defKey === 'spd' && def.types.includes(ROCK)) D = Math.floor(D * 1.5);
      }
      if (move.fx.solarWeak && c && (c.weather === 'rain' || c.weather === 'sand' || c.weather === 'snow')) power = Math.floor(power / 2);     // 솔라빔은 흐린 날씨에 약하다
      let dmg = Math.floor(Math.floor(42 * power * A / D) / 50) + 2;
      if (c && c.weather) {
        if ((c.weather === 'sun' && move.type === FIRE) || (c.weather === 'rain' && move.type === WATER)) dmg = Math.floor(dmg * 1.5);
        else if ((c.weather === 'sun' && move.type === WATER) || (c.weather === 'rain' && move.type === FIRE)) dmg = Math.floor(dmg * 0.5);
      }
      if (o.crit) dmg = Math.floor(dmg * 1.5);
      dmg = Math.floor(dmg * (o.roll || 100) / 100);
      if (att.types.includes(move.type)) dmg = Math.floor(dmg * 1.5);
      dmg = Math.floor(dmg * eff);
      if (att.status === 'brn' && phys && move.fx.x2If !== 'userStatus') dmg = Math.floor(dmg * 0.5);     // 객기는 화상의 공격 감소를 받지 않는다
      if (c && c.screens && !o.crit) {              // 리플렉터·빛의장막·오로라베일 (급소에는 효과가 없다)
        const sc = c.screens;
        if ((phys && (sc.reflect > 0 || sc.veil > 0)) || (!phys && (sc.lightscreen > 0 || sc.veil > 0))) dmg = Math.floor(dmg * 0.5);
      }
      if (c && c.glaive) dmg *= 2;                                            // 글레이브러시 뒤에는 받는 피해가 2배
      return { damage: Math.max(1, dmg), eff, crit: !!o.crit };
    }

    const kgOf = mon => Math.max(0.1, (mon.wt || 100) / 10);
    const WB_TYPE = { sun: FIRE, rain: WATER, sand: ROCK, snow: ICE };
    const TP_TYPE = { electric: ELECTRIC, grassy: GRASS, misty: FAIRY, psychic: PSYCHIC };
    /** 가변 위력 기술의 위력(과 웨더볼류의 타입) 계산 — 배틀 상태 없이 두 포켓몬과 날씨·필드만으로 정해진다 */
    function applyDyn(att, def, m, c) {
      const fx = m.fx, hpR = mon => mon.hp / mon.maxHp;
      let p = m.power, type = m.type;
      if (fx.x2If) {                                              // 조건이 맞으면 위력 2배 (객기·베놈쇼크·병상첨병·브라인 …)
        const cc = c || {}, poison = def.status === 'psn' || def.status === 'tox';
        const cond = {
          userStatus: ['par', 'brn', 'psn', 'tox'].includes(att.status), foePoison: poison, foeStatus: !!def.status, foeHalf: def.hp * 2 <= def.maxHp,
          foeHurt: cc.foeHurt, actedAfter: cc.actedAfter, hurtByFoe: cc.meHurt, allyFaintedPrev: cc.allyFaintedPrev, lowered: cc.meLowered, prevFailed: cc.prevFailed, always: true,
        }[fx.x2If];
        if (cond) p *= 2;
      }
      switch (fx.dyn) {
        case 'rollout': p = 30 * Math.pow(2, Math.min(4, att.rollN || 0)); break;
        case 'mistyBoost': if (c && c.terrain === 'misty' && c.attGrounded) p = Math.floor(p * 1.5); break;
        case 'rageFist': p = 50 + 50 * Math.min(6, att.hitsTaken || 0); break;
        case 'lastRespects': p = 50 + 50 * ((c && c.faints) || 0); break;
        case 'echoed': p = 40 * ((c && c.echoN) || 1); break;
        case 'furyCutter': p = Math.min(160, 40 * Math.pow(2, att.furyN || 0)); break;
        case 'wtTarget': { const kg = kgOf(def); p = kg < 10 ? 20 : kg < 25 ? 40 : kg < 50 ? 60 : kg < 100 ? 80 : kg < 200 ? 100 : 120; break; }
        case 'wtRatio': { const r = kgOf(att) / kgOf(def); p = r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40; break; }
        case 'hp150': p = Math.max(1, Math.floor(150 * hpR(att))); break;
        case 'flail': { const f = Math.floor(48 * att.hp / att.maxHp); p = f <= 1 ? 200 : f <= 4 ? 150 : f <= 9 ? 100 : f <= 16 ? 80 : f <= 32 ? 40 : 20; break; }
        case 'hardPress': p = Math.max(1, Math.floor(100 * hpR(def))); break;
        case 'crushGrip': p = Math.max(1, Math.floor(120 * hpR(def))); break;
        case 'gyro': p = Math.min(150, Math.floor(25 * effectiveStat(def, 'spe') / effectiveStat(att, 'spe')) + 1); break;
        case 'electroBall': { const r = effectiveStat(att, 'spe') / effectiveStat(def, 'spe'); p = r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40; break; }
        case 'stored': p = 20 + 20 * STAT_KEYS.reduce((a, k) => a + Math.max(0, att.stages[k]), 0); break;
        case 'spitUp': p = 100 * Math.max(1, att.stock || 0); break;
        case 'weatherBall': if (c && c.weather) { p = 100; type = WB_TYPE[c.weather]; } else p = 50; break;
        case 'terrainPulse': if (c && c.terrain && c.attGrounded) { p = 100; type = TP_TYPE[c.terrain]; } else p = 50; break;
        case 'risingVoltage': if (c && c.terrain === 'electric' && c.defGrounded) p *= 2; break;
        case 'expandingForce': if (c && c.terrain === 'psychic' && c.attGrounded) p = Math.floor(p * 1.5); break;
        default: break;
      }
      return Object.assign({}, m, { power: p, type });
    }
    /** 고정 피해 (지구던지기류·분노의앞니·죽기살기·카타스트로피) */
    function fixedDamage(att, def, kind) {
      if (kind === 'level') return 100;
      if (kind === 'half') return Math.max(1, Math.floor(def.hp / 2));
      if (kind === 'endeavor') return Math.max(0, def.hp - att.hp);
      if (kind === 'userHp') return att.hp;
      return 0;
    }

    /**
     * 이번에 쓰는 기술의 실제 모습: 타입(잠재댄스)·분류(셸암즈·테라버스트)·위력(가변 위력 기술)을 정한 복사본.
     * 배틀 상태가 필요 없는 값만 쓰므로 AI 의 데미지 추정(estimateDamage)과 실제 실행(runAttack)이 같은 결과를 낸다.
     */
    function resolveMove(att, def, move, ctx) {
      const fx = move.fx;
      if (move.cls === 'status' || !fx) return move;
      let m = move;
      if (fx.typeBy === 'user') m = Object.assign({}, m, { type: att.types[0] });
      if (fx.dyn || fx.x2If) m = applyDyn(att, def, m, ctx);
      if (fx.autoCls) {                                          // 공격·특공 중 더 큰 피해가 나오는 쪽
        const a = calcDamage(att, def, Object.assign({}, m, { cls: 'phys' }), { roll: 100, ctx }).damage;
        const b = calcDamage(att, def, Object.assign({}, m, { cls: 'spec' }), { roll: 100, ctx }).damage;
        m = Object.assign({}, m, { cls: a >= b ? 'phys' : 'spec' });
      }
      return m;
    }

    /** AI/UI 용 데미지 추정 (급소 제외, 평균 난수) */
    function estimateDamage(att, def, move0, ctx) {
      if (move0.cls === 'status') return { min: 0, max: 0, avg: 0, expected: 0, eff: 1 };
      const move = resolveMove(att, def, move0, ctx);
      if (move.fx.fixed || move.fx.ohko) {                         // 고정 피해 · 일격필살
        const eff0 = moveEff(move, def, ctx);
        const d = eff0 === 0 ? 0 : move.fx.ohko ? def.hp : fixedDamage(att, def, move.fx.fixed);
        const a0 = move.fx.neverMiss || move.acc === null ? 1 : move.acc / 100;
        return { min: d, max: d, avg: d, expected: d * a0, eff: eff0 };
      }
      const lo = calcDamage(att, def, move, { roll: 85, ctx }).damage;
      const hi = calcDamage(att, def, move, { roll: 100, ctx }).damage;
      const eff = moveEff(move, def, ctx);
      const fx = move.fx;
      const acc = fx.neverMiss || move.acc === null ? 1 : move.acc / 100;
      let hits = fx.hits ? (fx.hits[0] === 2 && fx.hits[1] === 5 ? 3.1 : (fx.hits[0] + fx.hits[1]) / 2) : 1;
      let mult = hits;
      if (fx.multiAcc) {                                          // 매 타 명중 판정: 빗나가면 멈춘다 (삼연킥·찍찍베기)
        mult = 0; let alive = 1;
        for (let i = 0; i < hits; i++) { mult += alive * (fx.escalate ? i + 1 : 1); alive *= acc; }
        hits = mult;
      } else if (fx.escalate) mult = hits * (hits + 1) / 2;
      // min/max/avg: 맞았을 때의 데미지, expected: 명중률까지 반영한 기대값
      return { min: lo * (fx.multiAcc ? 1 : mult), max: hi * mult, avg: (lo + hi) / 2 * mult, expected: (lo + hi) / 2 * mult * acc, eff };
    }

    // ───────────── 포켓몬/기술 생성 ─────────────
    function makeMove(id) {
      const m = data.moves[id];
      if (!m) throw new Error(`알 수 없는 기술 ID: ${id}`);
      return { id: Number(id), name: m.k, type: m.t, cls: m.c === 'p' ? 'phys' : m.c === 'n' ? 'status' : 'spec', power: m.pw, acc: m.ac, pp: m.pp, maxPp: m.pp, pri: m.pr, fx: m.fx || {}, ident: m.e,
        contact: !!m.ct, reflectable: !!m.rf, snatchable: !!m.sn };
    }

    function makeCustomMon(spec) {
      const st = Array.isArray(spec.stats)
        ? { hp: spec.stats[0], atk: spec.stats[1], def: spec.stats[2], spa: spec.stats[3], spd: spec.stats[4], spe: spec.stats[5] }
        : Object.assign({}, spec.stats);
      const stages = {};
      STAT_KEYS.forEach(k => { stages[k] = 0; });
      return Object.assign({
        name: spec.name, dataId: spec.dataId || null, tag: spec.tag || null, wt: spec.wt || 100,
        types: spec.types.slice(), natTypes: spec.types.slice(), stats: st, maxHp: st.hp, hp: st.hp,
        moves: spec.moves.map(m => Object.assign({}, m, { maxPp: m.maxPp || m.pp, fx: m.fx || {} })),
        status: null, sleepTurns: 0, toxCount: 0, confusion: 0, flinch: false, fainted: false, stages, base: null,
      }, freshVolatile());
    }

    /** 데이터(PokeAPI 폼 ID 포함)로 포켓몬 생성. opts.name 으로 표시 이름 변경, opts.tag 로 씰 ID 등 보관 */
    function makeMon(dataId, opts) {
      opts = opts || {};
      const p = data.pokemon[dataId];
      if (!p) throw new Error(`알 수 없는 포켓몬 ID: ${dataId}`);
      return makeCustomMon({
        name: opts.name || p.k, dataId: Number(dataId), tag: opts.tag || null,
        types: p.t, stats: p.s, wt: p.wt, moves: (opts.moves || p.m).map(makeMove),
      });
    }

    // ───────────── 배틀 ─────────────
    function createBattle(opts) {
      const rng = opts.rng || mulberry32(opts.seed === undefined ? Date.now() : opts.seed);
      const names = opts.names || ['나', '상대'];
      const maxTurns = opts.maxTurns || 500;
      if (!opts.parties || opts.parties.length !== 2 || opts.parties.some(p => !p.length)) throw new Error('양쪽 파티가 필요합니다.');

      // 한쪽 진영에 걸리는 효과(함정·벽·순풍 …) / 양쪽에 걸리는 필드(날씨·필드·트릭룸)
      const newCond = () => ({ rocks: false, spikes: 0, tspikes: 0, web: false, reflect: 0, lightscreen: 0, veil: 0, tailwind: 0, safeguard: 0, mist: 0, lucky: 0, wish: null, hw: null, future: null });
      const sides = opts.parties.map((party, i) => ({ index: i, name: names[i], party, active: 0, cond: newCond() }));
      const field = { weather: null, weatherTurns: 0, terrain: null, terrainTurns: 0, room: 0, gravity: 0, wonder: 0, magicRoom: 0, mud: 0, waterSport: 0, ion: false, fairyLock: 0 };
      const B = {
        sides, field, turn: 0, phase: 'init', winner: null, pending: [], log: [],
        rng, pivot: null, lastUsed: null, faintTurn: [-9, -9], echo: null,
      };
      let events = [];
      let curActed = [false, false];
      let T = null;          // 진행 중인 턴 { queue, qi, acted } — 턴 도중 교체로 멈췄다가 이어 가기 위해 보관한다

      const emit = ev => { events.push(ev); B.log.push(ev); return ev; };
      const text = (msg, extra) => emit(Object.assign({ t: 'text', text: msg }, extra));
      const active = si => sides[si].party[sides[si].active];
      const alive = si => sides[si].party.filter(m => !m.fainted).length;
      const J = josa;

      const sideLabel = si => (si === 0 ? '' : '상대 ');
      const nm = (si, mon) => sideLabel(si) + mon.name;
      const sideName = si => (si === 0 ? '우리 쪽' : '상대 쪽');

      function drain() { const e = events; events = []; return e; }

      // ───────── 상태 조회 / 화면 갱신용 이벤트 ─────────
      // 중력이면 모두 땅에 붙는다. 날개쉬기·전자부유·텔레키네시스 중에는 땅에서 떠 있다
      const grounded = mon => field.gravity > 0 || mon.ingrain || !((mon.types.includes(FLYING) && !mon.roost) || mon.levitate > 0 || mon.float > 0);
      const isTrapped = mon => (!!(mon.trapped || mon.ingrain || mon.noRetreat || mon.bound > 0) && !mon.types.includes(GHOST)) || field.fairyLock > 0;
      /** 강제로 이어서 써야 하는 기술 (충전 중·난동 중) */
      const forcedMove = mon => mon.charging || (mon.rampage ? mon.rampage.move : null);
      const condView = c => ({ rocks: c.rocks, spikes: c.spikes, tspikes: c.tspikes, web: c.web, reflect: c.reflect, lightscreen: c.lightscreen, veil: c.veil, tailwind: c.tailwind, safeguard: c.safeguard, mist: c.mist, lucky: c.lucky });
      const fieldView = () => ({ weather: field.weather, terrain: field.terrain, room: field.room, gravity: field.gravity, wonder: field.wonder, magicRoom: field.magicRoom, mud: field.mud, waterSport: field.waterSport, fairyLock: field.fairyLock });
      const emitField = () => emit(Object.assign({ t: 'field' }, fieldView(), { sides: [condView(sides[0].cond), condView(sides[1].cond)] }));
      const volView = mon => ({
        seeded: mon.seeded, taunt: mon.taunt > 0, encore: mon.encore > 0, disable: mon.disable > 0, torment: mon.torment, yawn: mon.yawn > 0,
        aquaRing: mon.aquaRing, ingrain: mon.ingrain, sub: mon.sub > 0, trapped: !!mon.trapped, attract: mon.attract, nightmare: mon.nightmare,
        perish: mon.perish, focus: mon.focus, protect: !!(mon.protect || mon.endure),
        cursed: mon.cursed, octolock: mon.octolock, lockOn: mon.lockOn > 0, laserFocus: mon.laserFocus > 0, foresight: mon.fsG || mon.fsD, levitate: mon.levitate > 0 || mon.float > 0,
        embargo: mon.embargo > 0, healBlock: mon.healBlock > 0, simple: mon.simple, insomnia: mon.insomnia, tarred: mon.tarred, noRetreat: mon.noRetreat, imprison: mon.imprison,
        destinyBond: mon.destinyBond || mon.grudge, boostNext: mon.boostNext > 0, charging: !!mon.charging, stock: mon.stock,
        bound: mon.bound > 0, salted: mon.salted, rampage: !!mon.rampage, recharge: mon.recharge, invul: !!mon.invul,
      });
      const emitVol = (si, mon) => emit({ t: 'vol', side: si, flags: volView(mon) });
      const speedOf = si => effectiveStat(active(si), 'spe') * (sides[si].cond.tailwind > 0 ? 2 : 1);
      const reservesOf = si => sides[si].party.map((m, i) => (!m.fainted && i !== sides[si].active ? i : -1)).filter(i => i >= 0);
      /** 같은 우선도일 때 si 쪽이 먼저 움직이는가 (트릭룸이면 느린 쪽이 먼저) */
      const outspeeds = si => (field.room > 0 ? speedOf(si) <= speedOf(1 - si) : speedOf(si) >= speedOf(1 - si));
      /** 데미지 계산에 필요한 날씨·필드·벽 정보 (si = 공격하는 쪽) */
      const ctxFor = si => {
        const me = active(si), foe = active(1 - si);
        return {
          weather: field.weather, terrain: field.terrain, attGrounded: grounded(me), defGrounded: grounded(foe), screens: sides[1 - si].cond,
          gravity: field.gravity > 0, wonder: field.wonder > 0, mud: field.mud > 0, waterSport: field.waterSport > 0,
          fsG: foe.fsG, fsD: foe.fsD, tar: foe.tarred, defLevitate: foe.levitate > 0 || foe.float > 0, helping: me.boostNext > 0,
          // 조건부 위력 기술이 보는 이번 턴의 사정
          foeHurt: foe.hurtTurn === B.turn, meHurt: me.hurtTurn === B.turn, actedAfter: !!curActed[1 - si], allyFaintedPrev: B.faintTurn[si] === B.turn - 1,
          meLowered: me.loweredTurn === B.turn, prevFailed: me.failedLast, foeBoosted: foe.boostedTurn === B.turn,
          glaive: foe.glaive, faints: sides[si].party.filter(m => m.fainted).length, echoN: B.echo && B.echo.turn >= B.turn - 1 ? Math.min(5, B.echo.n + 1) : 1,
        };
      };

      // ───────── 합법 행동 ─────────
      function legalActions(si) {
        const mon = active(si), foeMon = active(1 - si);
        const moves = mon.moves.map((m, index) => {
          let usable = m.pp > 0 && !mon.fainted, why = null;
          if (usable && mon.taunt > 0 && m.cls === 'status') { usable = false; why = '도발'; }
          else if (usable && mon.disable > 0 && mon.disableMove === index) { usable = false; why = '사슬묶기'; }
          else if (usable && mon.torment && mon.lastMove === index) { usable = false; why = '트집'; }
          else if (usable && (m.fx.sleepTalk || m.fx.onlySleep) && mon.status !== 'slp') { usable = false; why = '잠든 동안만'; }
          else if (usable && mon.healBlock > 0 && (m.fx.heal || m.fx.rest || m.fx.swallow || m.fx.wish)) { usable = false; why = '회복봉인'; }
          else if (usable && foeMon && foeMon.imprison && !foeMon.fainted && foeMon.moves.some(x => x.id === m.id && m.id)) { usable = false; why = '봉인'; }
          return { index, name: m.name, pp: m.pp, maxPp: m.maxPp, usable, why };
        });
        // 연속 사용 불가(거대해머·블러드문)
        moves.forEach((m, i) => { if (m.usable && mon.moves[i].fx.cantRepeat && mon.lastMove === i) { m.usable = false; m.why = '연속 사용 불가'; } });
        // 충전 중·난동 중: 이어서 그 기술을 써야 한다
        const fm = forcedMove(mon);
        if (fm) {
          const ci = mon.moves.indexOf(fm);
          if (ci >= 0) moves.forEach((m, i) => { if (i !== ci) { m.usable = false; m.why = mon.charging ? '충전 중' : '난동 중'; } else { m.usable = true; m.why = null; } });
        }
        // 앙코르: 마지막에 쓴 기술만 쓸 수 있다
        if (mon.encore > 0 && moves[mon.encoreMove] && moves[mon.encoreMove].usable) {
          moves.forEach((m, i) => { if (i !== mon.encoreMove && m.usable) { m.usable = false; m.why = '앙코르'; } });
        }
        const mustStruggle = !mon.fainted && moves.every(m => !m.usable);
        const switches = [];
        if (!isTrapped(mon)) sides[si].party.forEach((m, i) => { if (!m.fainted && i !== sides[si].active) switches.push(i); });
        return { moves, switches, mustStruggle, trapped: isTrapped(mon) };
      }

      function validate(si, a) {
        if (!a || (a.type !== 'move' && a.type !== 'switch')) throw new Error(`잘못된 행동(${si}): ${JSON.stringify(a)}`);
        const la = legalActions(si);
        if (a.type === 'switch') {
          if (!la.switches.includes(a.to)) throw new Error(`교체할 수 없는 대상(${si}): ${a.to}`);
        } else if (la.mustStruggle) {
          return { type: 'move', index: -1 };
        } else if (forcedMove(active(si)) && active(si).moves.indexOf(forcedMove(active(si))) >= 0) {
          return { type: 'move', index: active(si).moves.indexOf(forcedMove(active(si))) };
        } else if (!la.moves[a.index] || !la.moves[a.index].usable) {
          throw new Error(`사용할 수 없는 기술(${si}): ${a.index}`);
        }
        return a;
      }

      // ───────── 피해/회복 ─────────
      function applyDamage(si, mon, amount) {
        const before = mon.hp;
        mon.hp = Math.max(0, mon.hp - amount);
        const dealt = before - mon.hp;
        return dealt;
      }
      function revertTransform(mon) {
        if (!mon.base) return;
        mon.types = mon.base.types; mon.stats = mon.base.stats; mon.moves = mon.base.moves; mon.base = null;
      }
      function restoreMimic(mon) {
        if (mon.mimicOrig) { mon.moves[mon.mimicOrig.index] = mon.mimicOrig.move; mon.mimicOrig = null; }
        if (mon.natTypes) mon.types = mon.natTypes.slice();          // 타입 변경(텍스처·핼러윈·물에빠뜨리기 등)은 교체하면 원래대로
      }
      function faintCheck(si, mon) {
        if (mon.hp <= 0 && !mon.fainted) {
          mon.fainted = true;
          B.faintTurn[si] = B.turn;
          mon.status = null; mon.confusion = 0;
          revertTransform(mon);
          restoreMimic(mon);
          Object.assign(mon, freshVolatile());
          const foeMon = active(1 - si);
          if (foeMon && (foeMon.trapped || foeMon.octolock || foeMon.bound)) { foeMon.trapped = false; foeMon.octolock = false; foeMon.bound = 0; }
          emit({ t: 'faint', side: si, mon: sides[si].active, text: `${J(nm(si, mon), '은/는')} 쓰러졌다!` });
        }
      }
      function heal(si, mon, amount, msg) {
        if (mon.healBlock > 0 && amount > 0) { emit({ t: 'text', text: `${J(nm(si, mon), '은/는')} 회복봉인 때문에 회복할 수 없다!` }); return; }
        const before = mon.hp;
        mon.hp = Math.min(mon.maxHp, mon.hp + amount);
        if (mon.hp > before) emit({ t: 'heal', side: si, amount: mon.hp - before, hp: mon.hp, maxHp: mon.maxHp, text: msg });
      }
      function emitDamage(si, mon, dealt, extra) {
        emit(Object.assign({ t: 'damage', side: si, amount: dealt, hp: mon.hp, maxHp: mon.maxHp }, extra));
      }
      /** 고정 피해(함정·날씨·독 등)를 주고 쓰러졌는지 확인 */
      function hurt(si, mon, amount, cause, msg) {
        const dealt = applyDamage(si, mon, amount);
        emitDamage(si, mon, dealt, { cause, text: msg });
        faintCheck(si, mon);
      }

      // ───────── 상태이상 / 능력 단계 ─────────
      const immuneToStatus = statusImmune;
      const STATUS_TEXT = {
        par: m => `${J(m, '은/는')} 마비되어 기술이 나오기 어려워졌다!`,
        brn: m => `${J(m, '은/는')} 화상을 입었다!`,
        slp: m => `${J(m, '은/는')} 잠들어 버렸다!`,
        frz: m => `${J(m, '은/는')} 얼어붙었다!`,
        psn: m => `${J(m, '은/는')} 독에 걸렸다!`,
        tox: m => `${J(m, '은/는')} 맹독에 걸렸다!`,
        cnf: m => `${J(m, '은/는')} 혼란에 빠졌다!`,
      };
      /** 신비의부적·필드 때문에 상태이상이 걸리지 않으면 이유(문장)를, 아니면 null */
      function statusBlockReason(si, mon, kind) {
        if (kind === 'slp' && (active(0).uproar > 0 || active(1).uproar > 0)) return `소란스러워서 ${J(nm(si, mon), '은/는')} 잠들 수 없다!`;
        if (kind === 'slp' && mon.insomnia) return `${J(nm(si, mon), '은/는')} 잠들지 않는다!`;
        if (sides[si].cond.safeguard > 0) return `${J(nm(si, mon), '은/는')} 신비의부적으로 보호받고 있다!`;
        if (grounded(mon)) {
          if (field.terrain === 'misty') return `${J(nm(si, mon), '은/는')} 미스트필드로 보호받고 있다!`;
          if (field.terrain === 'electric' && kind === 'slp') return `${J(nm(si, mon), '은/는')} 일렉트릭필드 덕분에 잠들지 않는다!`;
        }
        if (kind === 'frz' && field.weather === 'sun') return '';
        return null;
      }
      function inflict(si, mon, kind, quiet) {
        if (mon.fainted) return false;
        const blocked = statusBlockReason(si, mon, kind);
        if (kind === 'cnf') {
          if (mon.confusion > 0) return false;
          if (blocked !== null) { if (blocked && !quiet) text(blocked); return false; }
          mon.confusion = 2 + Math.floor(rng() * 4); // 2~5턴
          emit({ t: 'status', side: si, kind, text: STATUS_TEXT.cnf(nm(si, mon)) });
          return true;
        }
        if (mon.status || immuneToStatus(mon, kind)) return false;
        if (blocked !== null) { if (blocked && !quiet) text(blocked); return false; }
        mon.status = kind;
        if (kind === 'slp') mon.sleepTurns = 2 + Math.floor(rng() * 3); // 행동 불가 1~3턴
        if (kind === 'tox') mon.toxCount = 1;
        emit({ t: 'status', side: si, kind, text: STATUS_TEXT[kind](nm(si, mon)) });
        return true;
      }
      /** fromFoe: 상대가 일으킨 능력 하락이면 미스트가 막아 준다 */
      function changeStage(si, mon, stat, change, fromFoe) {
        const cur = mon.stages[stat];
        const label = J(STAT_KO[stat], '이/가');
        if (change > 0 && mon.embargo > 0) { emit({ t: 'text', text: `${nm(si, mon)}의 ${label} 금제 때문에 오르지 않는다!` }); return; }
        if (mon.simple) change *= 2;                                   // 심플빔
        if (change < 0 && fromFoe && sides[si].cond.mist > 0) {
          emit({ t: 'text', text: `${nm(si, mon)}의 ${label} 미스트에 보호받아 떨어지지 않는다!` });
          return;
        }
        if ((change > 0 && cur >= 6) || (change < 0 && cur <= -6)) {
          emit({ t: 'text', text: `${nm(si, mon)}의 ${label} 더 이상 ${change > 0 ? '올라가지' : '내려가지'} 않는다!` });
          return;
        }
        const next = clamp(cur + change, -6, 6);
        mon.stages[stat] = next;
        if (next > cur) mon.boostedTurn = B.turn; else if (next < cur) mon.loweredTurn = B.turn;
        const d = next - cur, mag = Math.abs(d);
        const adv = mag >= 3 ? '매우 크게 ' : mag === 2 ? '크게 ' : '';
        emit({ t: 'stage', side: si, stat, change: d, text: `${nm(si, mon)}의 ${label} ${adv}${d > 0 ? '올라갔다!' : '내려갔다!'}` });
      }
      function resetStages(si, mon) {
        STAT_KEYS.forEach(k => { mon.stages[k] = 0; });
        emit({ t: 'stages', side: si, stages: {} });
      }
      function cureStatus(si, mon) {
        if (!mon.status && !mon.confusion) return false;
        mon.status = null; mon.confusion = 0; mon.toxCount = 1;
        emit({ t: 'cure', side: si, indexes: [sides[si].party.indexOf(mon)], text: `${J(nm(si, mon), '은/는')} 상태이상이 나았다!` });
        return true;
      }

      // ───────── 날씨 · 필드 ─────────
      const WEATHER_START = { sun: '햇살이 강해졌다!', rain: '비가 내리기 시작했다!', sand: '모래바람이 불기 시작했다!', snow: '눈이 내리기 시작했다!' };
      const WEATHER_END = { sun: '햇살이 약해졌다.', rain: '비가 그쳤다.', sand: '모래바람이 가라앉았다.', snow: '눈이 그쳤다.' };
      const TERRAIN_START = { electric: '발밑에 전기가 흐르기 시작했다!', grassy: '발밑에 풀이 무성해졌다!', misty: '주변에 안개가 자욱해졌다!', psychic: '발밑이 이상한 기운으로 가득 찼다!' };
      const TERRAIN_END = { electric: '전기가 사라졌다.', grassy: '풀이 시들었다.', misty: '안개가 걷혔다.', psychic: '이상한 기운이 사라졌다.' };

      // ───────── 교체 (함정 적용 포함) ─────────
      function applyHazards(si, mon) {
        const c = sides[si].cond, g = grounded(mon);
        if (c.rocks && !mon.fainted) {
          hurt(si, mon, Math.max(1, Math.floor(mon.maxHp * typeMultiplier(ROCK, mon.types) / 8)), 'hazard', `${J(nm(si, mon), '은/는')} 뾰족한 바위에 찔렸다!`);
        }
        if (c.spikes && g && !mon.fainted) {
          hurt(si, mon, Math.max(1, Math.floor(mon.maxHp / [0, 8, 6, 4][c.spikes])), 'hazard', `${J(nm(si, mon), '은/는')} 압정에 찔렸다!`);
        }
        if (c.tspikes && g && !mon.fainted) {
          if (mon.types.includes(POISON)) { c.tspikes = 0; emitField(); text(`${J(nm(si, mon), '은/는')} 독압정을 흡수했다!`); }
          else if (!mon.types.includes(STEEL)) inflict(si, mon, c.tspikes >= 2 ? 'tox' : 'psn', false);
        }
        if (c.web && g && !mon.fainted) {
          text(`${J(nm(si, mon), '은/는')} 끈적끈적네트에 걸렸다!`);
          changeStage(si, mon, 'spe', -1, true);
        }
      }
      function resetOnLeave(si, mon) {
        STAT_KEYS.forEach(k => { mon.stages[k] = 0; });
        mon.confusion = 0; mon.flinch = false;
        if (mon.status === 'tox') mon.toxCount = 1;
        revertTransform(mon);
        restoreMimic(mon);
        Object.assign(mon, freshVolatile());
        const foeMon = active(1 - si);
        if (foeMon && (foeMon.trapped || foeMon.octolock || foeMon.bound)) { foeMon.trapped = false; foeMon.octolock = false; foeMon.bound = 0; emitVol(1 - si, foeMon); }
      }
      /** 배턴터치로 다음 포켓몬에게 넘겨 주는 상태 */
      const BATON_KEYS = ['sub', 'focus', 'aquaRing', 'ingrain', 'seeded', 'lockOn', 'laserFocus', 'levitate', 'float', 'cursed', 'embargo', 'healBlock', 'stock'];
      function collectBaton(mon) {
        const o = { stages: Object.assign({}, mon.stages), confusion: mon.confusion };
        BATON_KEYS.forEach(k => { o[k] = mon[k]; });
        return o;
      }
      function applyBaton(mon, o) {
        STAT_KEYS.forEach(k => { mon.stages[k] = o.stages[k]; });
        mon.confusion = o.confusion;
        BATON_KEYS.forEach(k => { mon[k] = o[k]; });
      }
      function sendOut(si, to, fromName, dragged, passed) {
        const side = sides[si];
        const old = active(si);
        if (!old.fainted) resetOnLeave(si, old);
        side.active = to;
        const mon = active(si);
        if (passed) {
          if (passed.baton) applyBaton(mon, passed.baton);
          if (passed.sub) mon.sub = passed.sub;
        }
        const msg = dragged
          ? `${J(nm(si, mon), '이/가')} 끌려 나왔다!`
          : si === 0
            ? `${fromName ? `돌아와, ${fromName}! ` : ''}가라, ${mon.name}!`
            : `${fromName ? `상대는 ${J(fromName, '을/를')} 불러들였다! ` : ''}상대는 ${J(mon.name, '을/를')} 내보냈다!`;
        emit({ t: 'switch', side: si, to, name: mon.name, hp: mon.hp, maxHp: mon.maxHp, types: mon.types.slice(), text: msg });
        if (passed) {
          emit({ t: 'stages', side: si, stages: Object.assign({}, mon.stages) });
          emitVol(si, mon);
        }
        if (side.cond.hw) {                                           // 치유소원·초승달춤
          const kind = side.cond.hw; side.cond.hw = null;
          mon.hp = mon.maxHp; mon.status = null; mon.confusion = 0; mon.toxCount = 1;
          if (kind === 'dance') mon.moves.forEach(m => { m.pp = m.maxPp; });
          emit({ t: 'heal', side: si, amount: 0, hp: mon.hp, maxHp: mon.maxHp, text: `${J(nm(si, mon), '은/는')} ${kind === 'dance' ? '달빛의 춤으로' : '소원의 힘으로'} 완전히 회복되었다!` });
          emit({ t: 'cure', side: si, indexes: [to], text: '' });
        }
        applyHazards(si, mon);
      }

      // ───────── 행동 전 판정 ─────────
      function canAct(si, mon, move) {
        if (mon.recharge) {                                                       // 파괴광선류의 반동
          mon.recharge = false; emitVol(si, mon);
          emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 반동으로 움직일 수 없다!` });
          return false;
        }
        if (mon.status === 'frz') {
          if (rng() < 0.2) { mon.status = null; emit({ t: 'status', side: si, kind: 'thaw', text: `${nm(si, mon)}의 얼음이 녹았다!` }); }
          else { emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 얼어붙어서 움직일 수 없다!` }); return false; }
        }
        if (mon.status === 'slp') {
          mon.sleepTurns--;
          if (mon.sleepTurns > 0) {
            if (move && (move.fx.sleepTalk || move.fx.onlySleep)) { /* 잠꼬대·코골기는 잠든 채로 쓴다 */ }
            else { emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 쿨쿨 잠들어 있다.` }); return false; }
          } else {
            mon.status = null;
            emit({ t: 'status', side: si, kind: 'wake', text: `${J(nm(si, mon), '은/는')} 눈을 떴다!` });
          }
        }
        if (mon.flinch) {
          emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 풀이 죽어 움직일 수 없었다!` });
          return false;
        }
        if (mon.confusion > 0) {
          mon.confusion--;
          if (mon.confusion === 0) {
            emit({ t: 'status', side: si, kind: 'cnfEnd', text: `${nm(si, mon)}의 혼란이 풀렸다!` });
          } else {
            emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 혼란에 빠져 있다!` });
            if (rng() < 1 / 3) {
              const self = { name: '혼란', type: 0, cls: 'phys', power: 40, acc: null, fx: {} };
              const roll = 85 + Math.floor(rng() * 16);
              const dmg = calcDamage(mon, mon, self, { roll }).damage;
              const dealt = applyDamage(si, mon, dmg);
              emitDamage(si, mon, dealt, { cause: 'confusion', text: '영문도 모르고 자신을 공격했다!' });
              faintCheck(si, mon);
              return false;
            }
          }
        }
        if (mon.attract) {
          emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 헤롱헤롱해져 있다!` });
          if (rng() < 0.5) { emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 헤롱헤롱해서 움직일 수 없다!` }); return false; }
        }
        if (mon.status === 'par' && rng() < 0.25) {
          emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 몸이 저려서 움직일 수 없다!` });
          return false;
        }
        return true;
      }

      // ───────── 기술 사용 ─────────
      function pickHits(fx) {
        if (!fx.hits) return 1;
        const [lo, hi] = fx.hits;
        if (lo === 2 && hi === 5) { const r = rng(); return r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5; }
        return lo + Math.floor(rng() * (hi - lo + 1));
      }
      const fail = msg => emit({ t: 'text', text: msg || '하지만 실패했다...' });

      /** 이미 걸려 있던 도발·사슬묶기 때문에 이번 턴에 쓸 수 없는 기술인가 (턴 중간에 걸린 경우) */
      function moveBlocked(si, mon, move, index) {
        if (mon.taunt > 0 && move.cls === 'status') { text(`${J(nm(si, mon), '은/는')} 도발당해서 ${move.name}을(를) 쓸 수 없다!`); return true; }
        if (mon.disable > 0 && mon.disableMove === index) { text(`${J(nm(si, mon), '은/는')} 사슬묶기 때문에 ${move.name}을(를) 쓸 수 없다!`); return true; }
        return false;
      }

      /** 다른 기술을 복사해 쓸 수 없는 기술 (무한 반복·방어·교체 계열) */
      const noCopy = fx => !!(fx.copycat || fx.mimic || fx.sketch || fx.meFirst || fx.assist || fx.mirrorMove || fx.transform || fx.sleepTalk || fx.protect || fx.charge2 || fx.pivot
        || fx.faintSelf || fx.repeat || fx.metronome || fx.endure);
      /** 충전·난동·무적 상태를 풀어 준다 (움직이지 못했거나 교체됐을 때) */
      function clearLocks(mon) { mon.charging = null; mon.invul = null; mon.rampage = null; mon.rollN = 0; }
      function runMove(si, move, struggle, acted) {
        const user = active(si);
        const index = struggle ? -1 : user.moves.indexOf(move);
        if (active(1 - si).fainted) { clearLocks(user); return; }              // 상대가 이미 쓰러져 있으면 쓸 대상이 없다 (길동무·자폭 뒤 등)
        if (!canAct(si, user, move)) { clearLocks(user); return; }
        if (!struggle && moveBlocked(si, user, move, index)) { clearLocks(user); return; }
        const fx = move.fx || {};
        const finishing = !!(fx.charge2 && user.charging === move);
        const continuing = !!(user.rampage && user.rampage.move === move);       // 난동 중 이어서 쓰는 중
        if (!struggle && !finishing && !continuing) move.pp--;
        if (finishing) { user.charging = null; user.invul = null; }
        if (!fx.protect) user.protectStreak = 0;
        user.prevMove = user.lastMove;
        user.lastMove = index;
        if (index >= 0) user.used[index] = true;                               // 비장의무기용
        user.beakHeat = false; user.glaive = false;
        if (!(fx.dyn === 'furyCutter')) user.furyN = 0;
        user.destinyBond = false; user.grudge = false;                          // 길동무·원념은 다음에 움직일 때까지
        emit({ t: 'move', side: si, name: move.name, type: move.type, cls: move.cls, text: `${nm(si, user)}의 ${move.name}!` });
        if (!struggle && !noCopy(fx)) B.lastUsed = move;
        if (!struggle && fx.charge2 && !finishing) {                              // 2턴 기술의 첫 턴 (날씨가 맞으면 건너뛴다)
          const skipW = fx.chargeSkip && field.weather === fx.chargeSkip;
          if (!skipW) {
            user.charging = move; user.invul = fx.invul || null;
            text(`${J(nm(si, user), '은/는')} ${fx.chargeText || '에너지를 모으고 있다!'}`);
            (fx.chargeSelf || []).forEach(c => changeStage(si, user, c.stat, c.change));
            emitVol(si, user); return;
          }
          text(`${J(nm(si, user), '은/는')} ${fx.chargeSkip === 'sun' ? '강한 햇살 덕분에' : '빗속에서'} 곧바로 쏘아 냈다!`);
        }
        if (user.powdered && move.type === FIRE) {                                // 분진
          user.powdered = false;
          text(`${J(nm(si, user), '은/는')} 분진에 불이 붙어 폭발했다!`);
          hurt(si, user, Math.max(1, Math.floor(user.maxHp / 4)), 'powder', '');
          return;
        }
        const foeMon = active(1 - si);
        if (move.cls === 'status' && move.snatchable && foeMon.snatching && !foeMon.fainted) {      // 가로채기
          foeMon.snatching = false;
          text(`${J(nm(1 - si, foeMon), '은/는')} ${nm(si, user)}의 ${move.name}을(를) 가로챘다!`);
          return execMove(1 - si, move, false, acted);
        }
        execMove(si, move, struggle, acted);
        if (move.cls === 'status') return;
        // ── 공격 뒤처리: 난동·자폭 ──
        if (fx.rampage) {
          if (!user.rampage) {                                                  // 첫 사용: 이어서 쓸 횟수를 정한다
            if (!user.failedLast && !user.fainted) {
              const total = fx.rampage.min + Math.floor(rng() * (fx.rampage.max - fx.rampage.min + 1));
              if (total > 1) { user.rampage = { move, left: total - 1, confuse: !!fx.rampage.confuse }; user.rollN = 1; if (fx.uproar) user.uproar = total; emitVol(si, user); }
            }
          } else if (user.rampage.move === move) {
            if (user.failedLast || user.fainted) { user.rampage = null; user.rollN = 0; user.uproar = 0; }
            else {
              user.rampage.left--; user.rollN++;
              if (user.rampage.left <= 0) {
                const conf = user.rampage.confuse;
                user.rampage = null; user.rollN = 0; user.uproar = 0;
                if (conf) { text(`${J(nm(si, user), '은/는')} 날뛰다 지쳐 정신이 혼미해졌다!`); inflict(si, user, 'cnf', true); }
                emitVol(si, user);
              }
            }
          }
        }
        if (fx.selfKO && !user.fainted) hurt(si, user, user.hp, 'faint', `${J(nm(si, user), '은/는')} 힘을 다 쏟고 쓰러졌다!`);
      }
      function execMove(si, move, struggle, acted) {
        if (move.cls === 'status') return runStatusMove(si, move, active(si));
        return runAttack(si, move, struggle, acted || curActed);
      }

      /** 명중 판정. 록온·텔레키네시스는 필중, 꿰뚫어보기는 상대 회피 무시, 중력은 명중 ×5/3 */
      function hitCheck(user, target, acc, sure) {
        if (sure) return true;
        if (user.lockOn > 0) { user.lockOn = 0; return true; }
        if (target.float > 0 || target.glaive) return true;
        const eva = (target.fsG || target.fsD) ? Math.min(0, target.stages.eva) : target.stages.eva;
        const stage = clamp(user.stages.acc - eva, -6, 6);
        return rng() * 100 < acc * accStageMult(stage) * (field.gravity > 0 ? 5 / 3 : 1);
      }
      /** 접촉 기술을 막은 방어 변종의 반격 */
      function protectCounter(si, user, kind) {
        if (user.fainted) return;
        const u = nm(si, user);
        if (kind === 'king') changeStage(si, user, 'atk', -1, true);
        else if (kind === 'spiky') hurt(si, user, Math.max(1, Math.floor(user.maxHp / 8)), 'spiky', `${J(u, '은/는')} 니들가드의 가시에 찔렸다!`);
        else if (kind === 'bunker') inflict(si, user, 'psn', true);
        else if (kind === 'obstruct') changeStage(si, user, 'def', -2, true);
        else if (kind === 'silk') changeStage(si, user, 'spe', -1, true);
        else if (kind === 'burning') inflict(si, user, 'brn', true);
      }
      /** 방어 종류별로 공격기를 막는가 */
      const protectBlocksAttack = (kind, move) => (kind === 'quick' ? move.pri > 0 : kind === 'wide' ? !!move.fx.hits : kind !== 'crafty');
      /** 방어 종류별로 상대에게 거는 변화기를 막는가 */
      const protectBlocksStatus = kind => kind === 'protect' || kind === 'maxguard' || kind === 'bunker' || kind === 'crafty';
      /** 이온샤워·송전: 기술의 타입을 전기로 바꾼 복사본 */
      function retype(si, move, struggle) {
        if (struggle || move.type === ELECTRIC) return move;
        if (active(si).electrified || (field.ion && move.type === NORMAL)) return Object.assign({}, move, { type: ELECTRIC });
        return move;
      }

      const AIL_RANDOM = { tri: ['par', 'brn', 'frz'], dire: ['psn', 'par', 'slp'] };
      // 공중·땅속·물속에 있는 상대에게도 맞는 기술 (x2: 위력 2배)
      const INVUL_HIT = {
        air: { hit: ['gust', 'twister', 'thunder', 'hurricane', 'sky-uppercut', 'smack-down', 'thousand-arrows'], x2: ['gust', 'twister'] },
        ground: { hit: ['earthquake', 'magnitude', 'fissure'], x2: ['earthquake', 'magnitude'] },
        water: { hit: ['surf', 'whirlpool'], x2: ['surf', 'whirlpool'] },
        ghost: { hit: [], x2: [] },
      };
      /** 쓰기 전에 실패하는 조건 (조건부 기술) */
      function attackFails(si, user, target, fx) {
        const foe = 1 - si;
        if (fx.cantRepeat && user.prevMove === user.lastMove && user.prevMove >= 0) return true;   // 거대해머·블러드문
        if (fx.loseType && !user.types.includes(fx.loseType)) return true;                  // 전광쌍격: 전기 타입만
        if (fx.firstTurn && user.turnsOut > 0) return true;                                 // 속이기·만나자마자: 등장한 첫 턴에만
        if (fx.onlySleep && user.status !== 'slp') return true;                             // 코골기
        if (fx.reqFoeStatus && !fx.reqFoeStatus.includes(target.status)) return true;       // 꿈먹기
        if (fx.focusPunch && user.hurtTurn === B.turn) return true;
        if (fx.lastResort) {                                                                // 비장의무기: 다른 기술을 모두 한 번씩 쓴 뒤에만
          const others = user.moves.filter(m => m.fx !== fx);
          if (!others.length || !user.moves.every((m, i) => m.fx === fx || user.used[i])) return true;
        }
        if (fx.needFoeAttack || fx.needFoePriority) {                                       // 기습·질풍신뢰 / 기선제압: 상대가 고른 기술을 본다
          const q = T && T.queue.slice(T.qi).find(e => e.si === foe);
          if (!q || q.a.type === 'switch' || !q.move || q.move.cls === 'status') return true;
          if (fx.needFoePriority && !(q.move.pri > 0)) return true;
        }
        if (fx.counter) {                                                                   // 카운터·미러코트·메탈버스트·앙갚음
          const h = user.lastHit;
          if (!h || h.turn !== B.turn || (fx.counter === 'phys' && h.cls !== 'phys') || (fx.counter === 'spec' && h.cls !== 'spec')) return true;
        }
        if (fx.needTerrain && !field.terrain) return true;                                  // 아이언롤러
        if (fx.dyn === 'spitUp' && !user.stock) return true;                                // 토해내기
        if (fx.fixed === 'endeavor' && target.hp <= user.hp) return true;                   // 죽기살기
        return false;
      }
      function runAttack(si, orig, struggle, acted) {
        const foe = 1 - si;
        const user = active(si);
        const target = active(foe);
        user.failedLast = true;                                             // 끝까지 맞히면 false 로 바꾼다 (분함의발구르기·열불내기)
        if (target.fainted) { fail(); return; }
        if (orig.fx.delay) {                                                // 미래예지·파멸의소원: 2턴 뒤에 맞는다
          const fc = sides[foe].cond;
          if (fc.future) { fail(); return; }
          const snap = Object.assign({}, user, { stats: Object.assign({}, user.stats), stages: Object.assign({}, user.stages), types: user.types.slice(), ov: user.ov && Object.assign({}, user.ov) });
          fc.future = { turns: 3, att: snap, move: orig, from: si };
          user.failedLast = false;
          return text(`${J(nm(si, user), '은/는')} 미래의 공격을 예지했다!`);
        }
        const ctx = ctxFor(si);
        let move = resolveMove(user, target, retype(si, orig, struggle), ctx);
        const fx = move.fx;
        if (attackFails(si, user, target, fx)) { user.failedLast = true; fail(fx.focusPunch ? `${J(nm(si, user), '은/는')} 집중이 깨져서 움직일 수 없었다!` : null); return; }
        if (target.protect && fx.breakProtect) { target.protect = false; emitVol(foe, target); text(`${J(nm(foe, target), '은/는')} 방어가 무너졌다!`); }          // 섀도다이브류는 방어를 깬다
        const crash = () => { if (fx.crash && !user.fainted) hurt(si, user, Math.max(1, Math.floor(user.maxHp / 2)), 'crash', `${J(nm(si, user), '은/는')} 기세가 지나쳐 땅에 부딪혔다!`); };
        if (target.protect && !fx.breakProtect && protectBlocksAttack(target.protect, move)) {
          text(`${J(nm(foe, target), '은/는')} 공격으로부터 몸을 지켰다!`);
          if (move.contact) protectCounter(si, user, target.protect);
          if (fx.dyn === 'furyCutter') user.furyN = 0;
          crash();
          return;
        }
        if (target.invul) {                                                 // 공중·땅속·물속·그림자 속에 있는 상대
          const tbl = INVUL_HIT[target.invul] || { hit: [], x2: [] };
          if (!tbl.hit.includes(move.ident)) { emit({ t: 'miss', side: si, text: `${nm(si, user)}의 공격은 닿지 않았다!` }); if (fx.dyn === 'furyCutter') user.furyN = 0; crash(); return; }
          if (tbl.x2.includes(move.ident)) move = Object.assign({}, move, { power: move.power * 2 });
        }
        if (move.pri > 0 && field.terrain === 'psychic' && grounded(target)) { text(`${J(nm(foe, target), '은/는')} 사이코필드로 보호받고 있다!`); return; }
        // 명중
        if (!fx.neverMiss && move.acc !== null) {
          if (!hitCheck(user, target, move.acc, false)) {
            emit({ t: 'miss', side: si, text: `${nm(si, user)}의 공격은 빗나갔다!` });
            if (fx.dyn === 'furyCutter') user.furyN = 0;
            crash();
            return;
          }
        }

        const eff = moveEff(move, target, ctx);
        if (eff === 0) {
          emit({ t: 'effective', side: foe, eff: 0, text: `${nm(foe, target)}에게는 효과가 없는 것 같다...` });
          crash();
          return;
        }
        if (fx.breakScreens) {                                                  // 레이징불: 벽을 깨고 때린다
          const c = sides[foe].cond;
          if (c.reflect > 0 || c.lightscreen > 0 || c.veil > 0) { c.reflect = c.lightscreen = c.veil = 0; text('벽이 깨져 나갔다!'); emitField(); }
        }
        if (fx.dyn === 'echoed') B.echo = { turn: B.turn, n: ctx.echoN };           // 에코보이스: 연속으로 쓰일수록 강해진다
        if (fx.present) {                                                          // 프레젠트: 피해 또는 회복
          const r = rng();
          if (r >= 0.8) { text(`${J(nm(foe, target), '은/는')} 선물을 받았다!`); heal(foe, target, Math.max(1, Math.floor(target.maxHp / 4)), `${J(nm(foe, target), '은/는')} 체력을 회복했다!`); user.failedLast = false; return; }
          move = Object.assign({}, move, { power: r < 0.4 ? 40 : r < 0.7 ? 80 : 120 });
        }
        let beatList = null;
        if (fx.beatUp) beatList = sides[si].party.filter(m => !m.fainted && (!m.status || m === user));      // 집단구타: 건강한 동료마다 한 대씩

        const hits = fx.beatUp ? beatList.length : pickHits(fx);
        if (user.boostNext > 0) user.boostNext = 0;                       // 도우미는 한 번만
        let total = 0, landed = 0;
        const critStage = Math.min(3, (fx.crit === 1 ? 1 : 0) + (user.focus ? 2 : 0));
        const noCrit = sides[foe].cond.lucky > 0;                         // 주술
        const bond = target.destinyBond, grudge = target.grudge;          // 쓰러지면 volatile 이 지워지므로 미리 기억
        for (let i = 0; i < hits && !target.fainted; i++) {
          if (i > 0 && fx.multiAcc && !fx.neverMiss && move.acc !== null && !hitCheck(user, target, move.acc, false)) break;   // 삼연킥류: 빗나가면 거기서 끝
          const fixed = fx.fixed || fx.ohko || fx.counter;
          const crit = fixed || noCrit ? false : (fx.crit === 2 || user.laserFocus > 0 || rng() < CRIT_RATE[critStage]);
          const roll = fixed ? 100 : 85 + Math.floor(rng() * 16);
          let hm = fx.escalate ? Object.assign({}, move, { power: move.power * (i + 1) }) : move;       // 1타 ×1, 2타 ×2, 3타 ×3
          if (fx.beatUp) hm = Object.assign({}, move, { power: Math.floor((beatList[i].stats.atk - 36) / 2 / 10) + 5 });
          const dh = user.lastHit;
          const res = fx.ohko ? { damage: target.hp } : fx.fixed ? { damage: fixedDamage(user, target, fx.fixed) }
            : fx.counter ? { damage: Math.max(1, Math.floor((dh ? dh.dmg : 1) * (fx.counter === 'phys' || fx.counter === 'spec' ? 2 : 1.5))) }
            : calcDamage(user, target, hm, { crit, roll, ctx });
          if (target.sub > 0) {                       // 대타가 대신 맞는다
            const take = Math.min(target.sub, res.damage);
            target.sub -= take; total += take;
            text(`${nm(foe, target)}의 대타가 대신 공격을 받았다!`);
            if (target.sub <= 0) { target.sub = 0; text('대타는 쓰러졌다!'); }
            emitVol(foe, target);
            continue;
          }
          let amount = res.damage;
          if (fx.leaveOne && amount >= target.hp) amount = Math.max(0, target.hp - 1);                     // 칼등치기: 체력 1 은 남긴다
          if (target.endure && amount >= target.hp) { amount = Math.max(0, target.hp - 1); text(`${J(nm(foe, target), '은/는')} 공격을 버텼다!`); }
          const dealt = applyDamage(foe, target, amount);
          total += dealt; landed++;
          if (dealt > 0) { target.hurtTurn = B.turn; target.hitsTaken++; target.lastHit = { turn: B.turn, dmg: dealt, cls: move.cls }; }      // 카운터·분노의주먹·승부굳히기용 기록
          if (target.beakHeat && move.contact && landed === 1) { text(`${J(nm(si, user), '은/는')} 달궈진 부리에 데였다!`); inflict(si, user, 'brn', true); }
          emitDamage(foe, target, dealt, { move: move.name, crit, eff });
          if (target.status === 'frz' && move.type === FIRE) { target.status = null; emit({ t: 'status', side: foe, kind: 'thaw', text: `${nm(foe, target)}의 얼음이 녹았다!` }); }
          if (crit) emit({ t: 'crit', side: foe, text: '급소에 맞았다!' });
          if (i === 0 && eff !== 1 && !fixed) {
            emit({ t: 'effective', side: foe, eff, text: eff > 1 ? '효과가 굉장했다!' : '효과가 별로인 듯하다...' });
          }
          if (fx.ohko) text('일격필살!');
          faintCheck(foe, target);
        }
        if (landed > 1) emit({ t: 'hits', count: landed, text: `${landed}번 맞았다!` });
        if (target.fainted && !user.fainted) {                           // 길동무 · 원념
          if (bond) { text(`${J(nm(foe, target), '은/는')} 길동무가 되었다!`); hurt(si, user, user.hp, 'bond', ''); }
          else if (grudge && orig.pp > 0) { orig.pp = 0; text(`${nm(si, user)}의 ${orig.name}은(는) 원념으로 PP가 0이 되었다!`); }
        }

        // 흡수 / 반동
        if (fx.drain && total > 0) {
          heal(si, user, Math.max(1, Math.floor(total * fx.drain / 100)), `${nm(foe, target)}의 체력을 흡수했다!`);
        }
        if (fx.recoil && total > 0) {
          const dealt = applyDamage(si, user, Math.max(1, Math.floor(total * fx.recoil / 100)));
          emitDamage(si, user, dealt, { cause: 'recoil', text: `${J(nm(si, user), '은/는')} 반동으로 데미지를 입었다!` });
          faintCheck(si, user);
        }
        if (struggle) {
          const dealt = applyDamage(si, user, Math.max(1, Math.floor(user.maxHp / 4)));
          emitDamage(si, user, dealt, { cause: 'recoil', text: `${J(nm(si, user), '은/는')} 반동으로 데미지를 입었다!` });
          faintCheck(si, user);
        }

        // 추가 효과 (대상: 풀죽음 → 상태이상 → 능력 변화 / 자신: 능력 변화)
        if (!target.fainted && landed > 0) {
          if (fx.flinch && !acted[foe] && rng() * 100 < fx.flinch) target.flinch = true;
          if (fx.ifFoeBoosted && target.boostedTurn === B.turn) inflict(foe, target, fx.ifFoeBoosted, true);       // 질투의불꽃·매혹의보이스
          if (fx.ail && rng() * 100 < fx.ail.chance) {
            const pool = AIL_RANDOM[fx.ail.kind];             // 트라이어택(마비·화상·얼음) · 페이탈클로(독·마비·잠듦)
            inflict(foe, target, pool ? pool[Math.floor(rng() * pool.length)] : fx.ail.kind, true);
          }
          (fx.tgt || []).forEach(s => { if (!target.fainted && rng() * 100 < s.chance) changeStage(foe, target, s.stat, s.change, true); });
        }
        if (landed > 0 && !user.fainted) {
          (fx.self || []).forEach(s => { if (rng() * 100 < s.chance) changeStage(si, user, s.stat, s.change); });
        }
        if (landed > 0 || total > 0) {                                            // 제대로 맞혔다
          user.failedLast = false;
          if (fx.dyn === 'furyCutter') user.furyN = Math.min(3, (user.furyN || 0) + 1);
        }
        attackAfter(si, user, target, move, fx, landed, total);
      }

      /** 공격이 맞은 뒤에 일어나는 기술별 부가 효과 */
      function attackAfter(si, user, target, move, fx, landed, total) {
        const foe = 1 - si;
        if (fx.dyn === 'spitUp' && user.stock > 0) {                       // 토해내기: 비축을 쏟아내고 방어·특방이 원래대로
          const n = user.stock; user.stock = 0;
          if (!user.fainted) { changeStage(si, user, 'def', -n); changeStage(si, user, 'spd', -n); emitVol(si, user); }
        }
        if (fx.finalGambit && !user.fainted && landed > 0) hurt(si, user, user.hp, 'faint', `${J(nm(si, user), '은/는')} 모든 것을 걸고 쓰러졌다!`);     // 목숨걸기
        const hitAny = landed > 0 || total > 0;
        if (fx.glaive && !user.fainted) { user.glaive = true; text(`${J(nm(si, user), '은/는')} 방어를 잊고 돌격했다! 다음 턴까지 무방비다!`); emitVol(si, user); }
        if (hitAny && !user.fainted) {
          if (fx.recharge) { user.recharge = true; emitVol(si, user); }                                // 파괴광선류: 다음 턴 쉰다
          if (fx.pivot) queuePivot(si, user, 'out');                                                    // 유턴·볼트체인지·퀵턴
          if (fx.mortalSpin) {                                                                          // 킬러스핀: 내 쪽 함정·구속·씨뿌리기를 걷어 낸다
            const c = sides[si].cond;
            if (c.rocks || c.spikes || c.tspikes || c.web || user.bound > 0 || user.seeded) { c.rocks = false; c.spikes = 0; c.tspikes = 0; c.web = false; user.bound = 0; user.seeded = false; text('회전하며 함정과 속박을 털어 냈다!'); emitField(); emitVol(si, user); }
          }
        }
        if (landed > 0 && !user.fainted && fx.selfDamagePct) hurt(si, user, Math.max(1, Math.floor(user.maxHp * fx.selfDamagePct / 100)), 'recoil', `${J(nm(si, user), '은/는')} 반동으로 큰 피해를 입었다!`);
        if (landed > 0 && !user.fainted && fx.loseType && user.types.includes(fx.loseType)) { user.types = user.types.filter(t => t !== fx.loseType); if (!user.types.length) user.types = [NORMAL]; text(`${J(nm(si, user), '은/는')} 전기를 모두 써서 타입이 바뀌었다!`); emit({ t: 'types', side: si, types: user.types.slice() }); }
        if (landed <= 0) return;
        if (fx.needTerrain && field.terrain) { text(TERRAIN_END[field.terrain]); field.terrain = null; field.terrainTurns = 0; emitField(); }       // 아이언롤러
        if (!target.fainted) {
          if (fx.clearFoeStages) { STAT_KEYS.forEach(k => { target.stages[k] = 0; }); text(`${tn(foe, target)}의 능력 변화가 원래대로 돌아왔다!`); emit({ t: 'stages', side: foe, stages: Object.assign({}, target.stages) }); }
          if (fx.cureFoeStatus && target.status === fx.cureFoeStatus) cureStatus(foe, target);
          if (fx.ppCut) {
            const last = target.moves[target.lastMove];
            if (last && last.pp > 0) { const cut = Math.min(fx.ppCut, last.pp); last.pp -= cut; text(`${nm(foe, target)}의 ${last.name}의 PP가 ${cut} 줄었다!`); }
          }
          if (fx.bind && !target.bound) { target.bound = 4 + Math.floor(rng() * 2); text(`${J(tn(foe, target), '은/는')} 꽉 붙들렸다!`); emitVol(foe, target); }       // 조이기류: 4~5턴 매 턴 1/8 피해 · 교체 불가
          if (fx.salt && !target.salted) { target.salted = true; text(`${J(tn(foe, target), '은/는')} 소금에 절여졌다!`); emitVol(foe, target); }                    // 소금절이
          if (fx.forceOut && !target.fainted && !target.ingrain && target.sub <= 0) {                                                                       // 드래곤테일·배대뒤치기
            const options = reservesOf(foe);
            if (options.length) sendOut(foe, options[Math.floor(rng() * options.length)], target.name, true);
          }
          if (fx.syrup && !target.syrup) { target.syrup = 3; text(`${J(tn(foe, target), '은/는')} 끈적한 시럽을 뒤집어썼다!`); }
          if ((fx.trapFoe || fx.trapBoth) && !target.types.includes(GHOST) && !target.trapped) { target.trapped = true; text(`${J(tn(foe, target), '은/는')} 이제 도망칠 수 없다!`); emitVol(foe, target); }
        }
        if (fx.trapBoth && !user.fainted && !user.trapped && !user.types.includes(GHOST)) { user.trapped = true; emitVol(si, user); }
      }
      const tn = (s2, m2) => nm(s2, m2);

      // ───────── 변화기 ─────────
      const FOE_TARGETED = ['ail', 'tgt', 'seed', 'taunt', 'encore', 'disable', 'torment', 'yawn', 'attract', 'nightmare', 'trap', 'spite', 'soak', 'phaze', 'painSplit', 'transform', 'reqFoeStatus',
        'foresight', 'mimic', 'sketch', 'mirrorMove', 'dust', 'octolock', 'telekinesis', 'electrify', 'copyStages', 'swapStages', 'invertStages', 'swapStat', 'splitStats', 'psychoShift', 'statusSwap',
        'clearBoosts', 'embargo', 'healBlock', 'simple', 'insomnia', 'addType', 'setType', 'swapTypes', 'giveTypes', 'doodle', 'rolePlay'];
      function runStatusMove(si, move, user) {
        const fx = move.fx;
        if (FOE_TARGETED.some(k => fx[k]) || fx.nextOrder < 0) return statusOnFoe(si, move, user, active(1 - si));
        return statusOnSelf(si, move, user);
      }
      // 대타가 있어도 통하는 변화기
      const SUB_BYPASS = ['phaze', 'defog', 'copyStages', 'swapStages', 'swapStat', 'splitStats', 'doodle', 'dust', 'mimic', 'sketch', 'swapTypes', 'rolePlay'];
      // 효과가 일어난 뒤 따로 처리하는 것(자신 쓰러짐·교체)
      function afterEffect(si, move, user) {
        const fx = move.fx;
        if (fx.faintSelf === 'memento') hurt(si, user, user.hp, 'faint', `${J(nm(si, user), '은/는')} 쓰러졌다!`);
        if (fx.pivot) queuePivot(si, user, fx.pivot);
      }
      /** 쓴 뒤 교체하기로 예약한다 (교체할 동료가 없거나 가두기 상태면 하지 않는다) */
      function queuePivot(si, user, mode) {
        if (!reservesOf(si).length || isTrapped(user) || user.fainted) return false;
        B.pivot = { si, mode: mode === 'baton' ? 'baton' : mode === 'shed' ? 'shed' : 'out', sub: mode === 'shed' ? Math.floor(user.maxHp / 4) : 0 };
        return true;
      }
      const setTypes = (si, mon, types, msg) => { mon.types = types; if (msg) text(msg); emit({ t: 'types', side: si, types: types.slice() }); };

      function statusOnFoe(si, move, user, target, reflected) {
        const foe = 1 - si, fx = move.fx;
        const noEffect = () => emit({ t: 'effective', side: foe, eff: 0, text: `${nm(foe, target)}에게는 효과가 없는 것 같다...` });
        if (target.fainted) return fail();
        if (target.coat && move.reflectable && !reflected) {                       // 매직코트
          text(`${J(nm(foe, target), '은/는')} ${move.name}을(를) 되받아쳤다!`);
          return statusOnFoe(foe, move, target, user, true);
        }
        if (target.protect && protectBlocksStatus(target.protect)) return text(`${J(nm(foe, target), '은/는')} 몸을 지켰다!`);
        if (target.invul && !reflected) return emit({ t: 'miss', side: si, text: `${nm(si, user)}의 공격은 닿지 않았다!` });
        if (move.pri > 0 && field.terrain === 'psychic' && grounded(target)) return text(`${J(nm(foe, target), '은/는')} 사이코필드로 보호받고 있다!`);
        if (target.sub > 0 && !SUB_BYPASS.some(k => fx[k])) return fail();        // 대타가 막는다
        // 명중 (독 타입이 쓴 맹독은 필중)
        const sure = reflected || move.acc === null || (fx.ail && fx.ail.kind === 'tox' && user.types.includes(POISON));
        if (!sure) {
          if (!hitCheck(user, target, move.acc, false)) {
            emit({ t: 'miss', side: si, text: `${nm(si, user)}의 공격은 빗나갔다!` });
            return;
          }
        }
        if ((fx.powder || fx.dust) && target.types.includes(GRASS)) return noEffect();
        if (fx.typeImmune && typeMultiplier(move.type, target.types) === 0) return noEffect();
        if (fx.reqFoeStatus && !fx.reqFoeStatus.includes(target.status)) return fail();

        // ───── 3단계: 상대를 대상으로 하는 기술 ─────
        const tn = nm(foe, target), un = nm(si, user);
        const stagesEv = (s2, m2) => emit({ t: 'stages', side: s2, stages: Object.assign({}, m2.stages) });
        if (fx.foresight) {
          const k = fx.foresight === 'ghost' ? 'fsG' : 'fsD';
          if (target[k]) return fail();
          target[k] = true; text(`${J(tn, '은/는')} 정체를 간파당했다!`); emitVol(foe, target); return;
        }
        if (fx.mimic || fx.sketch) {
          const last = target.moves[target.lastMove], idx = user.moves.indexOf(move);
          if (user.base || !last || idx < 0 || last.fx.mimic || last.fx.sketch || last.fx.transform || user.moves.some(m => m.id && m.id === last.id)) return fail();
          const copy = Object.assign({}, last, { pp: last.maxPp, maxPp: last.maxPp });
          if (fx.mimic && !user.mimicOrig) user.mimicOrig = { index: idx, move };
          user.moves[idx] = copy;
          return text(`${J(un, '은/는')} ${J(last.name, '을/를')} ${fx.mimic ? '흉내 냈다!' : '배웠다!'}`);
        }
        if (fx.mirrorMove) {
          const last = target.moves[target.lastMove];
          if (!last || noCopy(last.fx)) return fail();
          emit({ t: 'move', side: si, name: last.name, type: last.type, cls: last.cls, text: `${J(un, '은/는')} ${J(last.name, '을/를')} 따라 했다!` });
          return execMove(si, Object.assign({}, last), false, curActed);
        }
        if (fx.dust) {
          if (target.powdered) return fail();
          target.powdered = true; return text(`${J(tn, '은/는')} 분진을 뒤집어썼다!`);
        }
        if (fx.octolock) {
          if (target.octolock) return fail();
          if (target.types.includes(GHOST)) return noEffect();
          target.octolock = true; target.trapped = true; text(`${J(tn, '은/는')} 문어굳히기에 붙잡혔다!`); emitVol(foe, target); return;
        }
        if (fx.telekinesis) {
          if (field.gravity > 0 || target.float > 0 || target.ingrain || target.levitate > 0) return fail();
          target.float = 3; text(`${J(tn, '은/는')} 텔레키네시스로 공중에 떠올랐다!`); emitVol(foe, target); return;
        }
        if (fx.electrify) {
          if (curActed[foe] || target.electrified) return fail();
          target.electrified = true; return text(`${J(tn, '은/는')} 전기를 띠었다!`);
        }
        if (fx.nextOrder < 0) {                                                // 순서미루기
          if (curActed[foe] || target.nextOrder < 0) return fail();
          target.nextOrder = -1; return text(`${J(tn, '은/는')} 다음 턴 가장 늦게 움직이게 되었다!`);
        }
        if (fx.copyStages || fx.doodle) {
          STAT_KEYS.forEach(k => { user.stages[k] = target.stages[k]; });
          text(`${J(un, '은/는')} ${tn}의 능력 변화를 복사했다!`); stagesEv(si, user);
          if (fx.doodle && JSON.stringify(user.types) !== JSON.stringify(target.types)) setTypes(si, user, target.types.slice(), `${J(un, '은/는')} ${tn}와(과) 같은 타입이 되었다!`);
          return;
        }
        if (fx.swapStages) {
          const keys = fx.swapStages === 'all' ? STAT_KEYS : fx.swapStages;
          keys.forEach(k => { const t0 = user.stages[k]; user.stages[k] = target.stages[k]; target.stages[k] = t0; });
          text('서로의 능력 변화를 맞바꿨다!'); stagesEv(si, user); stagesEv(foe, target); return;
        }
        if (fx.invertStages) {
          if (STAT_KEYS.every(k => target.stages[k] === 0)) return fail();
          STAT_KEYS.forEach(k => { target.stages[k] = -target.stages[k]; });
          text(`${tn}의 능력 변화가 뒤집혔다!`); stagesEv(foe, target); return;
        }
        if (fx.clearBoosts) {
          if (!STAT_KEYS.some(k => target.stages[k] > 0)) return fail();
          STAT_KEYS.forEach(k => { if (target.stages[k] > 0) target.stages[k] = 0; });
          text(`${tn}의 올라간 능력이 녹아내렸다!`); stagesEv(foe, target); return;
        }
        if (fx.swapStat) {
          const k = fx.swapStat, a = baseStat(user, k), b = baseStat(target, k);
          user.ov = Object.assign({}, user.ov, { [k]: b }); target.ov = Object.assign({}, target.ov, { [k]: a });
          return text(`서로의 ${STAT_KO[k]}을(를) 맞바꿨다!`);
        }
        if (fx.splitStats) {
          fx.splitStats.forEach(k => {
            const avg = Math.floor((baseStat(user, k) + baseStat(target, k)) / 2);
            user.ov = Object.assign({}, user.ov, { [k]: avg }); target.ov = Object.assign({}, target.ov, { [k]: avg });
          });
          return text(`서로의 ${fx.splitStats.map(k => STAT_KO[k]).join('·')}을(를) 나눠 가졌다!`);
        }
        if (fx.psychoShift) {
          if (!user.status || target.status || statusImmune(target, user.status)) return fail();
          const kind = user.status;
          if (!inflict(foe, target, kind, false)) return fail();
          user.status = null; user.toxCount = 1; user.sleepTurns = 0;
          emit({ t: 'cure', side: si, indexes: [sides[si].party.indexOf(user)], text: `${J(un, '은/는')} 상태이상이 나았다!` });
          return;
        }
        if (fx.statusSwap) {
          if (!user.status && !target.status) return fail();
          if ((user.status && statusImmune(target, user.status)) || (target.status && statusImmune(user, target.status))) return fail();
          const a = { st: user.status, sl: user.sleepTurns, tx: user.toxCount }, b = { st: target.status, sl: target.sleepTurns, tx: target.toxCount };
          user.status = b.st; user.sleepTurns = b.sl; user.toxCount = b.tx;
          target.status = a.st; target.sleepTurns = a.sl; target.toxCount = a.tx;
          text('서로의 상태이상을 맞바꿨다!');
          emit({ t: 'sync', side: si, status: user.status }); emit({ t: 'sync', side: foe, status: target.status });
          return;
        }
        if (fx.embargo) {
          if (target.embargo > 0) return fail();
          target.embargo = 5; text(`${J(tn, '은/는')} 5턴 동안 능력을 올릴 수 없게 되었다!`); emitVol(foe, target); return;
        }
        if (fx.healBlock) {
          if (target.healBlock > 0) return fail();
          target.healBlock = 5; text(`${J(tn, '은/는')} 5턴 동안 회복할 수 없게 되었다!`); emitVol(foe, target); return;
        }
        if (fx.simple) {
          if (target.simple) return fail();
          target.simple = true; text(`${J(tn, '은/는')} 단순해졌다! 능력 변화가 2배가 된다!`); emitVol(foe, target); return;
        }
        if (fx.insomnia) {
          if (target.insomnia) return fail();
          target.insomnia = true; text(`${J(tn, '은/는')} 잠들 수 없게 되었다!`);
          if (target.status === 'slp') { target.status = null; target.sleepTurns = 0; emit({ t: 'cure', side: foe, indexes: [sides[foe].party.indexOf(target)], text: `${J(tn, '은/는')} 눈을 떴다!` }); }
          emitVol(foe, target); return;
        }
        if (fx.addType) {
          if (target.types.includes(fx.addType)) return fail();
          const base = target.types.filter(t => t !== target.added).slice(0, 2);       // 새로 더한 타입은 하나뿐 (먼저 더한 타입은 교체된다)
          target.added = fx.addType;
          return setTypes(foe, target, base.concat(fx.addType), `${J(tn, '은/는')} ${typeName(fx.addType)} 타입이 추가되었다!`);
        }
        if (fx.setType) {
          if (target.types.length === 1 && target.types[0] === fx.setType) return fail();
          return setTypes(foe, target, [fx.setType], `${J(tn, '은/는')} ${typeName(fx.setType)} 타입이 되었다!`);
        }
        if (fx.swapTypes) {
          if (JSON.stringify(user.types) === JSON.stringify(target.types)) return fail();
          const ut = user.types.slice();
          setTypes(si, user, target.types.slice()); setTypes(foe, target, ut, '서로의 타입을 맞바꿨다!'); return;
        }
        if (fx.rolePlay) {
          const add = target.types[0], nt = user.types.includes(add) ? user.types.slice() : [user.types[0], add];
          if (JSON.stringify(nt) === JSON.stringify(user.types)) return fail();
          return setTypes(si, user, nt, `${J(un, '은/는')} ${tn}의 ${typeName(add)} 타입을 따라 했다!`);
        }
        if (fx.giveTypes) {
          if (JSON.stringify(user.types) === JSON.stringify(target.types)) return fail();
          return setTypes(foe, target, user.types.slice(), `${J(tn, '은/는')} ${un}와(과) 같은 타입이 되었다!`);
        }
        if (fx.strengthSap) heal(si, user, effectiveStat(target, 'atk'), `${J(un, '은/는')} 상대의 힘을 빨아들였다!`);

        if (fx.phaze) {                                                       // 울부짖기 / 날려버리기
          if (target.ingrain) return fail();
          const options = [];
          sides[foe].party.forEach((m, i) => { if (!m.fainted && i !== sides[foe].active) options.push(i); });
          if (!options.length) return fail();
          sendOut(foe, options[Math.floor(rng() * options.length)], target.name, true);
          return;
        }
        if (fx.painSplit) {                                                   // 아픔나누기
          const avg = Math.floor((user.hp + target.hp) / 2);
          [[si, user], [foe, target]].forEach(([s, m]) => {
            if (avg > m.hp) heal(s, m, avg - m.hp, `${J(nm(s, m), '은/는')} 체력을 나눠 받았다!`);
            else if (avg < m.hp) { const d = applyDamage(s, m, m.hp - avg); emitDamage(s, m, d, { cause: 'split', text: `${J(nm(s, m), '은/는')} 체력을 나눠 주었다!` }); }
          });
          return;
        }
        if (fx.transform) {                                                   // 변신
          if (user.base || target.base) return fail();
          user.base = { types: user.types, stats: user.stats, moves: user.moves };
          user.types = target.types.slice();
          user.stats = Object.assign({}, user.stats, { atk: target.stats.atk, def: target.stats.def, spa: target.stats.spa, spd: target.stats.spd, spe: target.stats.spe });
          user.moves = target.moves.map(m => Object.assign({}, m, { pp: Math.min(5, m.maxPp), maxPp: Math.min(5, m.maxPp) }));
          STAT_KEYS.forEach(k => { user.stages[k] = target.stages[k]; });
          user.lastMove = -1;
          text(`${J(nm(si, user), '은/는')} ${J(target.name, '으로/로')} 변신했다!`);
          emit({ t: 'types', side: si, types: user.types.slice() });
          emit({ t: 'stages', side: si, stages: Object.assign({}, user.stages) });
          return;
        }
        if (fx.seed) {
          if (target.types.includes(GRASS)) return noEffect();
          if (target.seeded) return fail();
          target.seeded = true; text(`${nm(foe, target)}에게 씨앗을 심었다!`); emitVol(foe, target); return;
        }
        if (fx.taunt) {
          if (target.taunt > 0) return fail();
          target.taunt = 3; text(`${J(nm(foe, target), '은/는')} 도발에 넘어갔다!`); emitVol(foe, target); return;
        }
        if (fx.encore) {
          if (target.encore > 0 || target.lastMove < 0 || !target.moves[target.lastMove] || target.moves[target.lastMove].pp <= 0) return fail();
          target.encore = 3; target.encoreMove = target.lastMove;
          text(`${J(nm(foe, target), '은/는')} 앙코르를 받았다!`); emitVol(foe, target); return;
        }
        if (fx.disable) {
          if (target.disable > 0 || target.lastMove < 0 || !target.moves[target.lastMove] || target.moves[target.lastMove].pp <= 0) return fail();
          target.disable = 4; target.disableMove = target.lastMove;
          text(`${J(nm(foe, target), '은/는')} ${target.moves[target.lastMove].name}을(를) 쓸 수 없게 되었다!`); emitVol(foe, target); return;
        }
        if (fx.torment) {
          if (target.torment) return fail();
          target.torment = true; text(`${J(nm(foe, target), '은/는')} 트집을 잡혔다!`); emitVol(foe, target); return;
        }
        if (fx.yawn) {
          if (target.status || target.yawn > 0 || statusBlockReason(foe, target, 'slp') !== null) return fail();
          target.yawn = 2; text(`${J(nm(foe, target), '은/는')} 졸린 듯하다...`); emitVol(foe, target); return;
        }
        if (fx.attract) {
          if (target.attract) return fail();
          target.attract = true; text(`${J(nm(foe, target), '은/는')} 헤롱헤롱해졌다!`); emitVol(foe, target); return;
        }
        if (fx.nightmare) {
          if (target.status !== 'slp' || target.nightmare) return fail();
          target.nightmare = true; text(`${J(nm(foe, target), '은/는')} 악몽을 꾸기 시작했다!`); emitVol(foe, target); return;
        }
        if (fx.trap) {
          if (target.trapped) return fail();
          target.trapped = true; text(`${J(nm(foe, target), '은/는')} 이제 도망칠 수 없다!`); emitVol(foe, target); return;
        }
        if (fx.spite) {
          const last = target.moves[target.lastMove];
          if (!last || last.pp <= 0) return fail();
          const cut = Math.min(4, last.pp); last.pp -= cut;
          text(`${nm(foe, target)}의 ${last.name}의 PP가 ${cut} 줄었다!`); return;
        }
        if (fx.soak) {
          if (target.types.length === 1 && target.types[0] === WATER) return fail();
          target.types = [WATER]; text(`${J(nm(foe, target), '은/는')} 물 타입이 되었다!`);
          emit({ t: 'types', side: foe, types: [WATER] }); return;
        }

        // 상태이상 / 능력 하락
        if (fx.ail && !fx.tgt) {                     // 상태이상만 거는 기술은 이미 걸려 있거나 면역이면 실패
          const kind = fx.ail.kind;
          if (kind === 'cnf' ? target.confusion > 0 : target.status) return fail();
          if (kind !== 'cnf' && immuneToStatus(target, kind)) return noEffect();
        }
        if (fx.defog) {
          for (const s of sides) { const c = s.cond; c.rocks = false; c.spikes = 0; c.tspikes = 0; c.web = false; }
          const fc = sides[foe].cond; fc.reflect = fc.lightscreen = fc.veil = fc.mist = 0;
          text('하얀 안개가 함정과 벽을 날려 버렸다!'); emitField();
        }
        (fx.tgt || []).forEach(c => changeStage(foe, target, c.stat, c.change, true));
        if (fx.ail) inflict(foe, target, fx.ail.kind, false);
        if (fx.tar) { target.tarred = true; text(`${J(tn, '은/는')} 타르를 뒤집어썼다! 불꽃에 약해졌다!`); emitVol(foe, target); }
        afterEffect(si, move, user);
      }

      const healAmount = (fx, user) => healAmountFor(fx, user.maxHp, field.weather, field.terrain);

      /** 메트로놈·잠꼬대가 고를 수 없는 기술 */
      const notCallable = fx => !!(fx.copycat || fx.assist || fx.mirrorMove || fx.mimic || fx.sketch || fx.meFirst || fx.repeat || fx.metronome || fx.sleepTalk || fx.charge2
        || fx.dead || fx.pivot || fx.faintSelf || fx.revive);
      const NATURE_POWER = { electric: 'thunderbolt', grassy: 'energy-ball', misty: 'moonblast', psychic: 'psychic' };
      const TERRAIN_TYPE = { electric: ELECTRIC, grassy: GRASS, misty: FAIRY, psychic: PSYCHIC };
      const SWAP_KEYS = ['rocks', 'spikes', 'tspikes', 'web', 'reflect', 'lightscreen', 'veil', 'tailwind', 'safeguard', 'mist', 'lucky'];

      function statusOnSelf(si, move, user) {
        const foe = 1 - si, fx = move.fx;
        const target = active(foe);
        const un = nm(si, user);
        if (fx.dead) return fail(fx.dead === 'ally' ? '하지만 싱글 배틀에서는 도와줄 아군이 없다!' : '하지만 건네줄 도구가 없다!');
        if (user.healBlock > 0 && (fx.heal || fx.rest || fx.swallow || fx.wish)) return text(`${J(un, '은/는')} 회복봉인 때문에 ${move.name}을(를) 쓸 수 없다!`);

        if (fx.sleepTalk) {                                       // 잠꼬대: 잠든 동안 다른 기술을 무작위로 쓴다
          if (user.status !== 'slp') return fail();
          const pool = user.moves.filter(m => m !== move && m.pp > 0 && !notCallable(m.fx));
          if (!pool.length) return fail();
          const pick = pool[Math.floor(rng() * pool.length)];
          emit({ t: 'move', side: si, name: pick.name, type: pick.type, cls: pick.cls, text: `${nm(si, user)}의 ${pick.name}!` });
          return execMove(si, pick, false, curActed);
        }
        if (fx.metronome) {                                       // 메트로놈: 아무 기술이나 무작위로
          const ids = Object.keys(data.moves).filter(id => !notCallable(data.moves[id].fx));
          const pick = makeMove(ids[Math.floor(rng() * ids.length)]);
          emit({ t: 'move', side: si, name: pick.name, type: pick.type, cls: pick.cls, text: `${J(nm(si, user), '은/는')} 손가락을 흔들어 ${pick.name}을(를) 냈다!` });
          return execMove(si, pick, false, curActed);
        }
        if (fx.repeat) {                                           // 지휘: 방금 쓴 자신의 기술을 한 번 더
          const prev = user.moves[user.prevMove];
          if (!prev || prev.pp <= 0 || noCopy(prev.fx)) return fail();
          prev.pp--;
          emit({ t: 'move', side: si, name: prev.name, type: prev.type, cls: prev.cls, text: `${J(un, '은/는')} ${prev.name}을(를) 다시 썼다!` });
          return execMove(si, prev, false, curActed);
        }
        if (fx.copycat) {                                          // 흉내쟁이: 직전에 쓰인 기술
          const last = B.lastUsed;
          if (!last || noCopy(last.fx)) return fail();
          emit({ t: 'move', side: si, name: last.name, type: last.type, cls: last.cls, text: `${J(un, '은/는')} ${J(last.name, '을/를')} 따라 했다!` });
          return execMove(si, Object.assign({}, last), false, curActed);
        }
        if (fx.assist) {                                           // 조수: 동료의 기술을 무작위로
          const pool = [];
          sides[si].party.forEach((m, i) => { if (i !== sides[si].active) m.moves.forEach(mv => { if (!noCopy(mv.fx)) pool.push(mv); }); });
          if (!pool.length) return fail();
          const pick = pool[Math.floor(rng() * pool.length)];
          emit({ t: 'move', side: si, name: pick.name, type: pick.type, cls: pick.cls, text: `${J(un, '은/는')} 동료의 ${J(pick.name, '을/를')} 빌려 썼다!` });
          return execMove(si, Object.assign({}, pick), false, curActed);
        }
        if (fx.naturePower) {                                      // 자연의힘: 필드에 맞는 공격기
          const ident = NATURE_POWER[field.terrain];
          const id = ident && Object.keys(data.moves).find(i => data.moves[i].e === ident);
          const pick = id ? makeMove(id) : { id: 0, name: '트라이어택', type: NORMAL, cls: 'spec', power: 80, acc: 100, pp: 10, maxPp: 10, pri: 0, fx: {} };
          emit({ t: 'move', side: si, name: pick.name, type: pick.type, cls: pick.cls, text: `${J(un, '은/는')} 자연의 힘으로 ${J(pick.name, '을/를')} 냈다!` });
          return execMove(si, pick, false, curActed);
        }
        if (fx.meFirst) {                                          // 선취: 상대가 고른 공격기를 먼저 빼앗아 쓴다
          const q = T && T.queue.slice(T.qi).find(e => e.si === foe && e.move && !e.struggle && e.move.cls !== 'status' && !noCopy(e.move.fx));
          if (!q || curActed[foe]) return fail();
          const pick = Object.assign({}, q.move, { power: Math.floor(q.move.power * 1.5) });
          emit({ t: 'move', side: si, name: pick.name, type: pick.type, cls: pick.cls, text: `${J(un, '은/는')} 상대보다 먼저 ${J(pick.name, '을/를')} 냈다!` });
          return execMove(si, pick, false, curActed);
        }
        if (fx.protect) {                                          // 방어 / 판별 / 버티기 / 킹실드 …
          if (fx.protect === 'mat' && user.turnsOut > 0) return fail();
          const chance = user.protectStreak > 0 ? Math.pow(1 / 3, user.protectStreak) : 1;
          if (rng() >= chance) { user.protectStreak = 0; return fail(); }
          user.protectStreak++;
          if (fx.protect === 'endure') { user.endure = true; text(`${J(un, '은/는')} 버틸 태세를 갖췄다!`); }
          else { user.protect = fx.protect; text(`${J(un, '은/는')} 몸을 지키는 태세를 갖췄다!`); }
          emitVol(si, user); return;
        }
        if (fx.revive) {                                           // 회생의기도
          const dead = sides[si].party.map((m, i) => (m.fainted ? i : -1)).filter(i => i >= 0).sort((a, b) => sides[si].party[b].maxHp - sides[si].party[a].maxHp);
          if (!dead.length) return fail();
          const m = sides[si].party[dead[0]];
          m.fainted = false; m.hp = Math.max(1, Math.floor(m.maxHp / 2)); m.status = null; m.confusion = 0;
          emit({ t: 'revive', side: si, index: dead[0], hp: m.hp, maxHp: m.maxHp, text: `${J(nm(si, m), '은/는')} 기도의 힘으로 되살아났다!` });
          return;
        }
        if (fx.faintSelf === 'wish' || fx.faintSelf === 'dance') {   // 치유소원 · 초승달춤
          if (!reservesOf(si).length) return fail();
          sides[si].cond.hw = fx.faintSelf;
          return hurt(si, user, user.hp, 'faint', `${J(un, '은/는')} 소원을 빌며 쓰러졌다...`);
        }
        if (fx.pivot && !fx.weather) {                             // 순간이동 · 배턴터치 · 꼬리자르기
          if (!reservesOf(si).length || isTrapped(user)) return fail();
          if (fx.pivot === 'shed') {
            if (user.sub > 0 || user.hp <= Math.ceil(user.maxHp / 2)) return fail();
            const cost = Math.ceil(user.maxHp / 2), dealt = applyDamage(si, user, cost);
            emitDamage(si, user, dealt, { cause: 'cost', text: `${J(un, '은/는')} 꼬리를 잘라 대타를 만들었다!` });
          }
          queuePivot(si, user, fx.pivot);
          if (fx.pivot !== 'shed') text(`${J(un, '은/는')} 교체하려고 한다!`);
          return;
        }
        if (fx.gravity) {
          if (field.gravity > 0) return fail();
          field.gravity = 5;
          [0, 1].forEach(s2 => { const m = active(s2); if (m.levitate || m.float) { m.levitate = 0; m.float = 0; emitVol(s2, m); } });
          text('중력이 강해졌다!'); emitField(); return;
        }
        if (fx.wonder) {
          if (field.wonder > 0) { field.wonder = 0; text('원더룸이 원래대로 돌아왔다!'); } else { field.wonder = 5; text('방어와 특수방어가 뒤바뀌는 이상한 방이 펼쳐졌다!'); }
          emitField(); return;
        }
        if (fx.magicRoom) {
          if (field.magicRoom > 0) { field.magicRoom = 0; text('매직룸이 원래대로 돌아왔다!'); } else { field.magicRoom = 5; text('턴 종료 회복이 멈추는 이상한 방이 펼쳐졌다!'); }
          emitField(); return;
        }
        if (fx.sport) {
          const key = fx.sport === 'mud' ? 'mud' : 'waterSport';
          if (field[key] > 0) return fail();
          field[key] = 5; text(fx.sport === 'mud' ? '전기 기술의 위력이 약해졌다!' : '불꽃 기술의 위력이 약해졌다!'); emitField(); return;
        }
        if (fx.ion) {
          if (field.ion) return fail();
          field.ion = true; return text('전자기의 샤워가 쏟아졌다! 노말 기술이 전기 타입이 된다!');
        }
        if (fx.fairyLock) {
          if (field.fairyLock > 0) return fail();
          field.fairyLock = 2; text('다음 턴에는 아무도 도망칠 수 없다!'); emitField(); return;
        }
        if (fx.courtChange) {
          const a = sides[0].cond, b = sides[1].cond;
          SWAP_KEYS.forEach(k => { const t0 = a[k]; a[k] = b[k]; b[k] = t0; });
          text('양쪽 진영의 효과가 맞바뀌었다!'); emitField(); return;
        }
        if (fx.lockOn) {
          if (user.lockOn > 0) return fail();
          user.lockOn = 2; text(`${J(un, '은/는')} 상대를 록온했다!`); emitVol(si, user); return;
        }
        if (fx.laserFocus) {
          if (user.laserFocus > 0) return fail();
          user.laserFocus = 2; text(`${J(un, '은/는')} 정신을 집중했다! 다음 공격은 반드시 급소에 맞는다!`); emitVol(si, user); return;
        }
        if (fx.curse) {
          if (user.types.includes(GHOST)) {                        // 고스트: 체력 절반을 내고 상대를 저주한다
            if (target.cursed || target.fainted) return fail();
            const cost = Math.floor(user.maxHp / 2), dealt = applyDamage(si, user, cost);
            emitDamage(si, user, dealt, { cause: 'cost', text: `${J(un, '은/는')} 체력을 깎아 ${nm(foe, target)}에게 저주를 걸었다!` });
            target.cursed = true; emitVol(foe, target); faintCheck(si, user); return;
          }
          changeStage(si, user, 'spe', -1); changeStage(si, user, 'atk', 1); changeStage(si, user, 'def', 1); return;
        }
        if (fx.destinyBond) { user.destinyBond = true; text(`${J(un, '은/는')} 상대를 길동무로 삼으려 한다!`); emitVol(si, user); return; }
        if (fx.grudge) { user.grudge = true; text(`${J(un, '은/는')} 원념을 품었다!`); emitVol(si, user); return; }
        if (fx.imprison) {
          if (user.imprison) return fail();
          user.imprison = true; text(`${J(un, '은/는')} 자신이 가진 기술을 상대가 쓰지 못하게 봉인했다!`); emitVol(si, user); return;
        }
        if (fx.snatch) { user.snatching = true; return text(`${J(un, '은/는')} 상대의 기술을 가로챌 태세를 갖췄다!`); }
        if (fx.coat) { user.coat = true; return text(`${J(un, '은/는')} 마법의 막으로 몸을 감쌌다!`); }
        if (fx.recycle) {
          const last = user.moves[user.prevMove];
          if (!last || last.pp >= last.maxPp) return fail();
          last.pp = Math.min(last.maxPp, last.pp + 5); return text(`${J(un, '은/는')} ${nm(si, user)}의 ${last.name}의 PP를 되살렸다!`);
        }
        if (fx.levitate) {
          if (field.gravity > 0 || user.levitate > 0 || user.ingrain) return fail();
          user.levitate = 5; text(`${J(un, '은/는')} 전자기의 힘으로 떠올랐다!`); emitVol(si, user); return;
        }
        if (fx.nextOrder > 0) {
          if (user.nextOrder > 0) return fail();
          user.nextOrder = 1; return text(`${J(un, '은/는')} 다음 턴 먼저 움직일 준비를 했다!`);
        }
        if (fx.boostNext) {
          if (user.boostNext > 0) return fail();
          user.boostNext = 2; text(`${J(un, '은/는')} 힘을 북돋웠다! 다음 공격의 위력이 오른다!`); emitVol(si, user); return;
        }
        if (fx.ownSwap) {
          const [a, b] = fx.ownSwap, va = baseStat(user, a), vb = baseStat(user, b);
          user.ov = Object.assign({}, user.ov, { [a]: vb, [b]: va });
          return text(`${J(un, '은/는')} 자신의 ${STAT_KO[a]}과(와) ${J(STAT_KO[b], '을/를')} 맞바꿨다!`);
        }
        if (fx.typeChange) {
          const k = fx.typeChange;
          let nt = null;
          const pickOf = list => list[Math.floor(rng() * list.length)];
          if (k === 'move') {
            const cand = [...new Set(user.moves.filter(m => m !== move && m.type).map(m => m.type))].filter(t => !user.types.includes(t));
            if (!cand.length) return fail();
            nt = [pickOf(cand)];
          } else if (k === 'resist') {
            const last = target.moves[target.lastMove];
            if (!last || !last.type) return fail();
            const cand = []; for (let t = 1; t <= 18; t++) if (CHART[last.type - 1][t - 1] < 1 && !user.types.includes(t)) cand.push(t);
            if (!cand.length) return fail();
            nt = [pickOf(cand)];
          } else if (k === 'terrain') {
            nt = [TERRAIN_TYPE[field.terrain] || NORMAL];
          } else if (k === 'mirror') {
            nt = target.types.slice();
          }
          if (JSON.stringify(nt) === JSON.stringify(user.types)) return fail();
          return setTypes(si, user, nt, `${J(un, '은/는')} ${nt.map(typeName).join('·')} 타입이 되었다!`);
        }
        if (fx.selfTrap) {                                         // 배수의진
          if (user.noRetreat) return fail();
          user.noRetreat = true; text(`${J(un, '은/는')} 배수의진을 쳤다! 이제 교체할 수 없다!`); emitVol(si, user);
        }
        if (fx.tidy) {                                             // 정리정돈
          let any = false;
          for (const s2 of sides) { const c = s2.cond; if (c.rocks || c.spikes || c.tspikes || c.web) any = true; c.rocks = false; c.spikes = 0; c.tspikes = 0; c.web = false; }
          [0, 1].forEach(s2 => { const m = active(s2); if (m.sub > 0) { m.sub = 0; any = true; emitVol(s2, m); } });
          if (any) { text('주변이 깨끗이 정리되었다!'); emitField(); }
        }
        if (fx.stockpile) {                                        // 비축하기
          if (user.stock >= 3) return fail();
          user.stock++; text(`${J(un, '은/는')} ${user.stock}개를 비축했다!`); emitVol(si, user);
        }
        if (fx.swallow) {                                          // 꿀꺽
          const n = user.stock;
          if (!n) return fail();
          user.stock = 0;
          heal(si, user, Math.max(1, Math.floor(user.maxHp * [0, 25, 50, 100][n] / 100)), `${J(un, '은/는')} 비축한 힘을 삼켜 체력을 회복했다!`);
          changeStage(si, user, 'def', -n); changeStage(si, user, 'spd', -n); emitVol(si, user); return;
        }

        if (fx.sub) {                                              // 대타출동
          const cost = Math.floor(user.maxHp / 4);
          if (user.sub > 0 || user.hp <= cost) return fail(user.sub > 0 ? `${nm(si, user)}의 대타는 이미 나와 있다!` : '체력이 부족해서 대타를 만들 수 없다!');
          const dealt = applyDamage(si, user, cost);
          emitDamage(si, user, dealt, { cause: 'cost', text: `${J(nm(si, user), '은/는')} 체력을 깎아 대타를 만들었다!` });
          user.sub = cost; emitVol(si, user); return;
        }
        if (fx.splash) return text('하지만 아무 일도 일어나지 않았다!');
        if (fx.haze) {
          [[si, user], [foe, target]].forEach(([s, m]) => resetStages(s, m));
          return text('모든 능력 변화가 원래대로 돌아왔다!');
        }
        if (fx.perish) {
          const both = [[si, user], [foe, target]].filter(([, m]) => !m.fainted && !m.perish);
          if (!both.length) return fail();
          both.forEach(([s, m]) => { m.perish = 4; emitVol(s, m); });
          return text('멸망의노래가 울려 퍼졌다! 3턴 뒤 모두 쓰러진다...');
        }
        if (fx.weather) {
          if (field.weather === fx.weather) fail();
          else { field.weather = fx.weather; field.weatherTurns = 5; text(WEATHER_START[fx.weather]); emitField(); }
          if (fx.pivot) queuePivot(si, user, fx.pivot);                // 썰렁개그: 날씨를 바꾸고 교체
          return;
        }
        if (fx.terrain) {
          if (field.terrain === fx.terrain) return fail();
          field.terrain = fx.terrain; field.terrainTurns = 5;
          text(TERRAIN_START[fx.terrain]); emitField(); return;
        }
        if (fx.room) {
          if (field.room > 0) { field.room = 0; text('뒤틀린 시공이 원래대로 돌아왔다!'); }
          else { field.room = 5; text(`${J(nm(si, user), '은/는')} 시공을 뒤틀어 버렸다!`); }
          emitField(); return;
        }
        if (fx.hazard) {                                           // 상대 쪽에 까는 함정
          const c = sides[foe].cond, k = fx.hazard;
          if (k === 'rocks') { if (c.rocks) return fail(); c.rocks = true; text(`${sideName(foe)}에 뾰족한 바위가 떠올랐다!`); }
          else if (k === 'spikes') { if (c.spikes >= 3) return fail(); c.spikes++; text(`${sideName(foe)} 발밑에 압정이 뿌려졌다!`); }
          else if (k === 'tspikes') { if (c.tspikes >= 2) return fail(); c.tspikes++; text(`${sideName(foe)} 발밑에 독압정이 뿌려졌다!`); }
          else if (k === 'web') { if (c.web) return fail(); c.web = true; text(`${sideName(foe)} 발밑에 끈적끈적한 네트가 펼쳐졌다!`); }
          emitField(); return;
        }
        if (fx.screen) {                                           // 우리 쪽에 치는 벽
          const c = sides[si].cond, k = fx.screen;
          if (k === 'veil' && field.weather !== 'snow') return fail();
          if (c[k] > 0) return fail();
          c[k] = 5;
          text(k === 'reflect' ? '리플렉터로 물리 공격이 약해졌다!' : k === 'lightscreen' ? '빛의장막으로 특수 공격이 약해졌다!' : '오로라베일로 모든 공격이 약해졌다!');
          emitField(); return;
        }
        if (fx.side) {                                             // 순풍 / 신비의부적 / 미스트
          const c = sides[si].cond, k = fx.side;
          if (c[k] > 0) return fail();
          c[k] = k === 'tailwind' ? 4 : 5;
          text(k === 'tailwind' ? '우리 쪽에 순풍이 불기 시작했다!' : k === 'safeguard' ? '우리 쪽이 신비의 베일에 감싸였다!' : k === 'lucky' ? '우리 쪽이 행운의 주문으로 감싸였다! 급소에 맞지 않는다!' : '우리 쪽이 안개에 감싸였다!');
          emitField(); return;
        }
        if (fx.focus) {
          if (user.focus) return fail();
          user.focus = true; text(`${J(nm(si, user), '은/는')} 기합을 넣었다!`); emitVol(si, user); return;
        }
        if (fx.aquaRing) {
          if (user.aquaRing) return fail();
          user.aquaRing = true; text(`${J(nm(si, user), '은/는')} 물의 베일로 몸을 감쌌다!`); emitVol(si, user); return;
        }
        if (fx.ingrain) {
          if (user.ingrain) return fail();
          user.ingrain = true; text(`${J(nm(si, user), '은/는')} 땅속 깊이 뿌리를 내렸다!`); emitVol(si, user); return;
        }
        if (fx.wish) {
          const c = sides[si].cond;
          if (c.wish) return fail();
          c.wish = { turns: 2, amount: Math.floor(user.maxHp / 2) };
          return text(`${J(nm(si, user), '은/는')} 소원을 빌었다!`);
        }
        if (fx.cureFoe) {                                          // 정화: 상대의 상태이상을 낫게 하고 내가 회복
          if (!target.status) return fail();
          cureStatus(foe, target);
          heal(si, user, Math.floor(user.maxHp / 2), `${J(nm(si, user), '은/는')} 체력을 회복했다!`);
          return;
        }
        if (fx.cure === 'party') {                                 // 치유의방울 / 아로마테라피: 파티 전원의 상태이상
          const idx = [];
          sides[si].party.forEach((m, i) => { if (!m.fainted && (m.status || m.confusion)) { m.status = null; m.confusion = 0; m.toxCount = 1; idx.push(i); } });
          if (!idx.length) return fail();
          return emit({ t: 'cure', side: si, indexes: idx, text: '파티 전원의 상태이상이 나았다!' });
        }

        if (fx.rest) {
          if (user.hp >= user.maxHp || user.status === 'slp') return fail();
          heal(si, user, user.maxHp - user.hp, `${nm(si, user)}의 체력이 전부 회복되었다!`);
          user.status = 'slp'; user.sleepTurns = 3; user.toxCount = 1;   // 잠듦 2턴 (3번째 턴에 눈을 뜬다)
          emit({ t: 'status', side: si, kind: 'slp', text: `${J(nm(si, user), '은/는')} 잠들어서 건강해졌다!` });
          return;
        }
        if (fx.hpCost) {
          const cost = Math.floor(user.maxHp * fx.hpCost / 100);
          if (user.hp <= cost || (fx.self || []).some(c => c.change > 0 && user.stages[c.stat] >= 6)) return fail();
          const dealt = applyDamage(si, user, cost);
          emitDamage(si, user, dealt, { cause: 'cost', text: `${J(nm(si, user), '은/는')} 체력을 깎아서 힘을 끌어올렸다!` });
        }
        if (fx.heal) {
          if (user.hp >= user.maxHp && !(fx.cure && (user.status || user.confusion))) return fail();
          if (fx.roost) { user.roost = true; }
          heal(si, user, healAmount(fx, user), `${J(nm(si, user), '은/는')} 체력을 회복했다!`);
        }
        if (fx.cure === 'self') {
          if (!cureStatus(si, user) && !fx.heal && !fx.self) return fail();
        }
        if (fx.randStat) {                                         // 날카로운침: 무작위 능력 1개를 크게 올린다
          const open = STAT_KEYS.filter(k => user.stages[k] < 6);
          if (!open.length) return fail();
          changeStage(si, user, open[Math.floor(rng() * open.length)], fx.randStat);
        }
        (fx.self || []).forEach(c => changeStage(si, user, c.stat, c.change));
      }

      // ───────── 승패 ─────────
      function checkEnd(attackerSide) {
        const a0 = alive(0), a1 = alive(1);
        if (a0 > 0 && a1 > 0) return false;
        B.phase = 'ended';
        if (a0 === 0 && a1 === 0) B.winner = attackerSide === null || attackerSide === undefined ? 'draw' : 1 - attackerSide;
        else B.winner = a0 === 0 ? 1 : 0;
        const msg = B.winner === 'draw' ? '무승부!' : B.winner === 0 ? '승리했다!' : '패배했다...';
        emit({ t: 'end', winner: B.winner, text: msg });
        return true;
      }

      // ───────── 턴 종료 처리 ─────────
      function endOfTurn() {
        const order = [0, 1].sort((x, y) => (field.room > 0 ? speedOf(x) - speedOf(y) : speedOf(y) - speedOf(x)));
        const each = fn => { for (const si of order) { const mon = active(si); if (!mon.fainted) fn(si, mon); } };

        // 1) 모래바람 피해
        if (field.weather === 'sand') {
          each((si, mon) => {
            if (mon.types.some(t => t === ROCK || t === GROUND || t === STEEL)) return;
            hurt(si, mon, Math.max(1, Math.floor(mon.maxHp / 16)), 'weather', `${J(nm(si, mon), '은/는')} 모래바람에 휩쓸렸다!`);
          });
        }
        const noHeal = field.magicRoom > 0;      // 매직룸: 턴 종료 회복 정지
        // 1.5) 미래예지 · 파멸의소원
        for (const si of order) {
          const c = sides[si].cond, f = c.future;
          if (f && --f.turns <= 0) {
            c.future = null;
            const mon = active(si);
            if (!mon.fainted) {
              const mv0 = f.move, eff0 = typeMultiplier(mv0.type, mon.types);
              if (eff0 === 0) text(`${nm(si, mon)}에게는 ${mv0.name}이(가) 효과가 없는 것 같다...`);
              else { const res = calcDamage(f.att, mon, mv0, { roll: 85 + Math.floor(rng() * 16) }); hurt(si, mon, res.damage, 'future', `${J(nm(si, mon), '은/는')} ${mv0.name}의 공격을 받았다!`); }
            }
          }
        }
        // 2) 소원
        for (const si of noHeal ? [] : order) {
          const c = sides[si].cond;
          if (c.wish && --c.wish.turns <= 0) {
            const mon = active(si);
            if (!mon.fainted) heal(si, mon, c.wish.amount, `소원이 이루어졌다! ${J(nm(si, mon), '은/는')} 체력을 회복했다!`);
            c.wish = null;
          }
        }
        // 3) 그래스필드 / 뿌리박기 / 아쿠아링 회복
        each((si, mon) => {
          if (noHeal) return;
          if (field.terrain === 'grassy' && grounded(mon)) heal(si, mon, Math.max(1, Math.floor(mon.maxHp / 16)), `${J(nm(si, mon), '은/는')} 풀의 힘으로 체력을 회복했다!`);
          if (mon.ingrain) heal(si, mon, Math.max(1, Math.floor(mon.maxHp / 16)), `${J(nm(si, mon), '은/는')} 뿌리로 양분을 빨아들였다!`);
          if (mon.aquaRing) heal(si, mon, Math.max(1, Math.floor(mon.maxHp / 16)), `${J(nm(si, mon), '은/는')} 물의 베일로 체력을 회복했다!`);
        });
        // 4) 씨뿌리기
        each((si, mon) => {
          if (!mon.seeded) return;
          const dmg = Math.max(1, Math.floor(mon.maxHp / 8));
          const gain = Math.min(dmg, mon.hp);
          hurt(si, mon, dmg, 'seed', `${J(nm(si, mon), '은/는')} 씨앗에게 체력을 빼앗겼다!`);
          const other = active(1 - si);
          if (!other.fainted && !noHeal) heal(1 - si, other, gain, `${J(nm(1 - si, other), '은/는')} 체력을 흡수했다!`);
        });
        // 5) 상태이상 피해
        each((si, mon) => {
          let dmg = 0, label = null;
          if (mon.status === 'brn') { dmg = Math.max(1, Math.floor(mon.maxHp / 16)); label = '화상'; }
          else if (mon.status === 'psn') { dmg = Math.max(1, Math.floor(mon.maxHp / 8)); label = '독'; }
          else if (mon.status === 'tox') { dmg = Math.max(1, Math.floor(mon.maxHp * mon.toxCount / 16)); mon.toxCount = Math.min(15, mon.toxCount + 1); label = '독'; }
          if (!label) return;
          hurt(si, mon, dmg, mon.status, `${J(nm(si, mon), '은/는')} ${label} 데미지를 입고 있다!`);
        });
        // 5.3) 구속(조이기류) · 소금절이
        each((si, mon) => {
          if (mon.bound > 0) { hurt(si, mon, Math.max(1, Math.floor(mon.maxHp / 8)), 'bind', `${J(nm(si, mon), '은/는')} 조여 오는 힘에 괴로워하고 있다!`); if (!mon.fainted && --mon.bound === 0) { text(`${nm(si, mon)}은(는) 속박에서 풀려났다!`); emitVol(si, mon); } }
          if (!mon.fainted && mon.salted) hurt(si, mon, Math.max(1, Math.floor(mon.maxHp / (mon.types.includes(WATER) || mon.types.includes(STEEL) ? 4 : 8))), 'salt', `${J(nm(si, mon), '은/는')} 소금에 절여져 아프다!`);
        });
        // 5.4) 시럽봄: 3턴 동안 매 턴 스피드 −1
        each((si, mon) => {
          if (mon.syrup > 0) { mon.syrup--; changeStage(si, mon, 'spe', -1, true); }
        });
        // 5.5) 저주 / 문어굳히기
        each((si, mon) => {
          if (mon.cursed) hurt(si, mon, Math.max(1, Math.floor(mon.maxHp / 4)), 'curse', `${J(nm(si, mon), '은/는')} 저주를 받고 있다!`);
        });
        each((si, mon) => {
          if (mon.octolock) { changeStage(si, mon, 'def', -1, true); changeStage(si, mon, 'spd', -1, true); }
        });
        // 6) 악몽 / 하품 / 멸망의노래
        each((si, mon) => {
          if (mon.nightmare) {
            if (mon.status === 'slp') hurt(si, mon, Math.max(1, Math.floor(mon.maxHp / 4)), 'nightmare', `${J(nm(si, mon), '은/는')} 악몽에 시달리고 있다!`);
            else { mon.nightmare = false; emitVol(si, mon); }
          }
        });
        each((si, mon) => {
          if (mon.yawn > 0 && --mon.yawn === 0) { emitVol(si, mon); inflict(si, mon, 'slp', true); }
        });
        each((si, mon) => {
          if (mon.perish > 0) {
            mon.perish--;
            if (mon.perish === 0) { hurt(si, mon, mon.hp, 'perish', `${J(nm(si, mon), '은/는')} 멸망의노래로 쓰러졌다!`); }
            else { text(`${nm(si, mon)}의 멸망 카운트가 ${mon.perish}이(가) 되었다!`); emitVol(si, mon); }
          }
        });
        // 7) 기간 만료
        let changed = false;
        for (const si of [0, 1]) {
          const mon = active(si);
          mon.roost = false;
          if (mon.fainted) continue;
          mon.turnsOut++;
          mon.beakHeat = false;
          if (mon.uproar > 0) mon.uproar--;
          mon.electrified = false; mon.powdered = false; mon.snatching = false; mon.coat = false;
          let vol = mon.lockOn > 0 || mon.laserFocus > 0 || mon.boostNext > 0;     // 이번 턴으로 끝나는 표시를 화면에 알린다
          if (mon.lockOn > 0) mon.lockOn--;
          if (mon.laserFocus > 0) mon.laserFocus--;
          if (mon.boostNext > 0) mon.boostNext--;
          if (mon.levitate > 0 && --mon.levitate === 0) { text(`${nm(si, mon)}의 부유가 풀렸다!`); vol = true; }
          if (mon.float > 0 && --mon.float === 0) { text(`${nm(si, mon)}의 텔레키네시스가 풀렸다!`); vol = true; }
          if (mon.embargo > 0 && --mon.embargo === 0) { text(`${nm(si, mon)}의 금제가 풀렸다!`); vol = true; }
          if (mon.healBlock > 0 && --mon.healBlock === 0) { text(`${nm(si, mon)}의 회복봉인이 풀렸다!`); vol = true; }
          if (mon.taunt > 0 && --mon.taunt === 0) { text(`${nm(si, mon)}의 도발이 풀렸다!`); vol = true; }
          if (mon.encore > 0 && --mon.encore === 0) { text(`${nm(si, mon)}의 앙코르가 풀렸다!`); vol = true; }
          if (mon.disable > 0 && --mon.disable === 0) { text(`${nm(si, mon)}의 사슬묶기가 풀렸다!`); vol = true; }
          if (vol) emitVol(si, mon);
          const c = sides[si].cond;
          const ends = { reflect: '리플렉터의 효과가 사라졌다.', lightscreen: '빛의장막의 효과가 사라졌다.', veil: '오로라베일의 효과가 사라졌다.', tailwind: '순풍이 그쳤다.', safeguard: '신비의부적의 효과가 사라졌다.', mist: '안개가 걷혔다.', lucky: '주술의 효과가 사라졌다.' };
          for (const k of Object.keys(ends)) if (c[k] > 0 && --c[k] === 0) { text(`${sideName(si)} ${ends[k]}`); changed = true; }
        }
        if (field.room > 0 && --field.room === 0) { text('뒤틀린 시공이 원래대로 돌아왔다!'); changed = true; }
        field.ion = false;
        if (field.fairyLock > 0) { field.fairyLock--; changed = true; }
        const fieldEnds = { gravity: '중력이 원래대로 돌아왔다.', wonder: '원더룸이 원래대로 돌아왔다.', magicRoom: '매직룸이 원래대로 돌아왔다.', mud: '흙놀이의 효과가 사라졌다.', waterSport: '물놀이의 효과가 사라졌다.' };
        for (const k of Object.keys(fieldEnds)) if (field[k] > 0 && --field[k] === 0) { text(fieldEnds[k]); changed = true; }
        if (field.weather && --field.weatherTurns <= 0) { text(WEATHER_END[field.weather]); field.weather = null; changed = true; }
        if (field.terrain && --field.terrainTurns <= 0) { text(TERRAIN_END[field.terrain]); field.terrain = null; changed = true; }
        if (changed) emitField();
      }

      // ───────── 공개 API ─────────
      B.legalActions = legalActions;
      B.active = active;
      B.alive = alive;
      B.speedOf = speedOf;
      B.outspeeds = outspeeds;
      B.ctx = ctxFor;
      B.grounded = grounded;

      /** 첫 포켓몬 등장 (양쪽 파티의 선두) */
      B.start = function () {
        if (B.phase !== 'init') throw new Error('이미 시작된 배틀입니다.');
        events = [];
        emit({ t: 'text', text: '배틀 시작!' });
        for (let si = 0; si < 2; si++) {
          const mon = active(si);
          emit({ t: 'switch', side: si, to: sides[si].active, name: mon.name, hp: mon.hp, maxHp: mon.maxHp, types: mon.types.slice(), initial: true,
            text: si === 0 ? `가라, ${mon.name}!` : `상대는 ${J(mon.name, '을/를')} 내보냈다!` });
        }
        B.phase = 'move';
        return drain();
      };

      /** 턴 큐를 이어서 실행한다. 턴 도중 교체(pivot)가 예약되면 멈추고 false 를 돌려준다. */
      function runQueue() {
        const acted = T.acted;
        curActed = acted;
        while (T.qi < T.queue.length) {
          if (B.phase === 'ended') return true;
          const q = T.queue[T.qi++];
          const mon = active(q.si);
          if (mon !== q.mon || mon.fainted) continue; // 기절한 포켓몬은 행동하지 못한다
          if (q.a.type === 'switch') sendOut(q.si, q.a.to, mon.name);
          else runMove(q.si, q.move, q.struggle, acted);
          acted[q.si] = true;
          if (checkEnd(q.si)) return true;
          if (B.pivot) {                                  // 쓰고 나서 바로 교체하는 기술
            if (active(B.pivot.si).fainted || !reservesOf(B.pivot.si).length) B.pivot = null;
            else {
              B.phase = 'switch'; B.pending = [B.pivot.si];
              emit({ t: 'needSwitch', sides: [B.pivot.si], pivot: true, text: '교체할 포켓몬을 골라야 한다!' });
              return false;
            }
          }
        }
        return true;
      }

      /** 턴 종료 처리 → 기절 교체 대기 / 무승부 판정 */
      function finishTurn() {
        T = null;
        if (B.phase !== 'ended') {
          endOfTurn();
          checkEnd(null);
        }
        if (B.phase !== 'ended') {
          B.pending = [0, 1].filter(si => active(si).fainted);
          if (B.pending.length) {
            B.phase = 'switch';
            emit({ t: 'needSwitch', sides: B.pending.slice(), text: '다음 포켓몬을 골라야 한다!' });
          } else if (B.turn >= maxTurns) {
            B.phase = 'ended'; B.winner = 'draw';
            emit({ t: 'end', winner: 'draw', text: '무승부!' });
          } else B.phase = 'move';
        }
      }

      B.playTurn = function (action0, action1) {
        if (B.phase !== 'move') throw new Error(`지금은 턴을 진행할 수 없습니다. (phase=${B.phase})`);
        const acts = [validate(0, action0), validate(1, action1)];
        events = [];
        B.turn++;
        emit({ t: 'turn', turn: B.turn, text: `— ${B.turn}턴 —` });

        // 지난 턴의 방어 효과는 새 턴이 시작되면 풀린다
        for (const si of [0, 1]) {
          const m = active(si);
          if (m.protect || m.endure) { m.protect = false; m.endure = false; emitVol(si, m); }
        }

        // 행동 순서 결정 (턴 시작 시점의 속도 기준)
        const queue = acts.map((a, si) => {
          const mon = active(si);
          mon.flinch = false;
          const struggle = a.type === 'move' && a.index === -1;
          const move = a.type === 'move' ? (struggle ? STRUGGLE : mon.moves[a.index]) : null;
          const ord = mon.nextOrder; mon.nextOrder = 0;       // 당신먼저 / 순서미루기
          return {
            si, a, struggle, move, mon, ord,
            pri: a.type === 'switch' ? 100 : (move.pri || 0) + (move.fx.priTerrain && field.terrain === move.fx.priTerrain && grounded(mon) ? 1 : 0),
            speed: speedOf(si),
            tie: rng(),
          };
        }).sort((x, y) => y.pri - x.pri || y.ord - x.ord || (field.room > 0 ? x.speed - y.speed : y.speed - x.speed) || y.tie - x.tie);

        for (const q of queue) if (q.move && q.move.fx.beakBlast) { q.mon.beakHeat = true; text(`${J(nm(q.si, q.mon), '은/는')} 부리를 달구기 시작했다!`); }
        T = { queue, qi: 0, acted: [false, false] };
        if (runQueue()) finishTurn();
        return drain();
      };

      /** 쓰러진 뒤(또는 턴 도중 교체 기술 뒤) 교체 선택 */
      B.replace = function (si, to) {
        if (B.phase !== 'switch' || !B.pending.includes(si)) throw new Error('교체할 차례가 아닙니다.');
        if (!sides[si].party[to] || sides[si].party[to].fainted) throw new Error('교체할 수 없는 대상입니다.');
        if (to === sides[si].active && !sides[si].party[to].fainted) throw new Error('이미 나와 있는 포켓몬입니다.');
        events = [];
        if (B.pivot && B.pivot.si === si) {                // 턴 도중 교체: 끝나면 남은 행동을 이어서 진행한다
          const pv = B.pivot; B.pivot = null;
          const old = active(si);
          const passed = pv.mode === 'baton' ? { baton: collectBaton(old) } : pv.mode === 'shed' ? { sub: pv.sub } : null;
          sendOut(si, to, old.name, false, passed);
          B.pending = B.pending.filter(x => x !== si);
          if (checkEnd(null)) return drain();
          B.phase = 'move';
          if (T && runQueue()) finishTurn();
          return drain();
        }
        sendOut(si, to, null);
        B.pending = B.pending.filter(x => x !== si);
        if (!checkEnd(null)) {
          if (active(si).fainted) {                  // 나오자마자 함정에 쓰러졌다
            B.pending.push(si);
            emit({ t: 'needSwitch', sides: B.pending.slice(), text: '다음 포켓몬을 골라야 한다!' });
          }
          if (!B.pending.length) B.phase = 'move';
        }
        return drain();
      };

      /** 지금 교체로 내보낼 수 있는 파티 인덱스 (쓰러지지 않았고 현재 나와 있지 않은 포켓몬) */
      B.replaceOptions = reservesOf;

      B.snapshot = function () {
        return {
          turn: B.turn, phase: B.phase, winner: B.winner, pending: B.pending.slice(),
          field: fieldView(),
          sides: sides.map(s => ({
            name: s.name, active: s.active, cond: condView(s.cond),
            party: s.party.map(m => ({
              name: m.name, dataId: m.dataId, tag: m.tag, types: m.types.slice(), hp: m.hp, maxHp: m.maxHp, status: m.status,
              fainted: m.fainted, stages: Object.assign({}, m.stages), confusion: m.confusion, vol: volView(m),
              moves: m.moves.map(mv => ({ id: mv.id, name: mv.name, type: mv.type, cls: mv.cls, power: mv.power, pp: mv.pp, maxPp: mv.maxPp })),
            })),
          })),
        };
      };

      return B;
    }

    return {
      createBattle, makeMon, makeCustomMon, makeMove, calcDamage, estimateDamage, resolveMove,
      typeMultiplier, effectiveStat, describeEffect, describeAttack, variablePower, statusImmune, healAmountFor, STRUGGLE, josa, mulberry32, data,
    };
  }

  global.createBattleEngine = createEngine;
  global.BattleEngine = global.BATTLE_DATA ? createEngine(global.BATTLE_DATA) : null;
})(typeof window !== 'undefined' ? window : globalThis);
