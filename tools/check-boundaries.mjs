#!/usr/bin/env node
/**
 * 패키지 경계 검사 — packages/rembrandt 는 화면·저장소·앱에 의존하면 안 된다.
 *   node tools/check-boundaries.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'packages', 'rembrandt');
const FORBIDDEN = /\b(document|localStorage|sessionStorage|alert|confirm|prompt|sealDatabase|showToast|escapeHtml|lucide)\b|window\.(?!BATTLE_DATA|Battle)/;

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.js$/.test(f.name) && !/battle-data\.js$/.test(f.name)) files.push(p);
  }
})(DIR);

let bad = 0;
for (const f of files) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // 주석 제외
    if (FORBIDDEN.test(line)) { console.error(`✗ ${path.relative(ROOT, f)}:${i + 1}  ${line.trim()}`); bad++; }
  });
}
console.log(bad ? `경계 위반 ${bad}건` : `경계 검사 통과 (${files.length}개 파일)`);
process.exit(bad ? 1 : 0);
