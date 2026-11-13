import {defineConfig} from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// index.html 한 장으로 동작하는 정적 웹앱 (외부 API 서버 없음)
// 배틀 모듈(battle/)은 일반 <script src> 로 불러오므로 Vite 가 번들하지 않는다 → 빌드 결과(dist)에 그대로 복사한다.
function copyBattleAssets() {
  return {
    name: 'copy-battle-assets',
    apply: 'build' as const,
    closeBundle() {
      const src = path.resolve(__dirname, 'battle');
      const dest = path.resolve(__dirname, 'dist', 'battle');
      if (!fs.existsSync(src)) return;
      fs.cpSync(src, dest, { recursive: true, filter: (f: string) => !/\.test\.mjs$/.test(f) });
    },
  };
}

export default defineConfig({
  base: './', // 하위 경로 배포·file:// 에서도 CSS/배틀 스크립트가 상대경로로 열리도록
  plugins: [copyBattleAssets()],
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
  },
});
