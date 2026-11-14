import {defineConfig} from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 한 저장소, 두 앱 (GitHub Pages 하위 경로 배포)
 *
 *   vite --mode holo       → apps/holo      (배포: /            )  띠부씰 아카이브
 *   vite --mode proelium   → apps/proelium  (배포: /proelium/   )  배틀 중심 앱
 *
 * 두 앱은 packages/ 의 Rembrandt(엔진)·battle-ui(전투 화면)를 일반 <script> 로 불러온다.
 *  - 개발 서버: /packages/* 요청을 저장소의 packages/ 로 연결한다.
 *  - 빌드     : holo 빌드가 dist/packages/ 로 복사하고, proelium(dist/proelium/)도 ../packages/ 로 함께 쓴다.
 *    (holo 를 먼저 빌드해야 한다 → npm run build)
 */
const ROOT = __dirname;
const PACKAGES = path.resolve(ROOT, 'packages');
const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sharedPackages(appName: string, copyOnBuild: boolean) {
  return {
    name: 'shared-packages',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const url = decodeURIComponent((req.url || '').split('?')[0]);
        if (!url.startsWith('/packages/')) return next();
        const file = path.resolve(ROOT, '.' + url);
        if (!file.startsWith(PACKAGES + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
        res.end(fs.readFileSync(file));
      });
    },
    closeBundle() {
      // 일반 <script src> 로 불러오는 앱 자체 소스(apps/*/src)는 번들되지 않으므로 그대로 복사한다.
      const appSrc = path.resolve(ROOT, 'apps', appName, 'src');
      if (fs.existsSync(appSrc)) fs.cpSync(appSrc, path.resolve(ROOT, 'dist', appName === 'proelium' ? 'proelium' : '', 'src'), { recursive: true });
      if (!copyOnBuild) return;
      fs.cpSync(PACKAGES, path.resolve(ROOT, 'dist', 'packages'), {
        recursive: true,
        filter: (f: string) => !/\.test\.mjs$/.test(f) && !/package\.json$/.test(f),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const isProelium = mode === 'proelium';
  const appDir = path.resolve(ROOT, 'apps', isProelium ? 'proelium' : 'holo');
  return {
    root: appDir,
    base: './', // 하위 경로 배포·file:// 에서도 상대경로로 열리도록
    plugins: [sharedPackages(isProelium ? 'proelium' : 'holo', !isProelium)],
    build: {
      outDir: path.resolve(ROOT, 'dist', isProelium ? 'proelium' : ''),
      emptyOutDir: true,
    },
    server: { port: isProelium ? 3001 : 3000, host: '0.0.0.0' },
    preview: { port: isProelium ? 3001 : 3000, host: '0.0.0.0' },
  };
});
