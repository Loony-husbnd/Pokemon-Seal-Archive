/**
 * Node 에서 브라우저와 같은 방식(전역 BATTLE_DATA → BattleEngine)으로 배틀 데이터/엔진을 로드한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadBattle() {
  const sandbox = {};
  vm.createContext(sandbox);
  for (const f of ['battle/data/battle-data.js', 'battle/engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return { data: sandbox.BATTLE_DATA, engine: sandbox.BattleEngine, createEngine: sandbox.createBattleEngine };
}
