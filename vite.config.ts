import {defineConfig} from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 한 저장소, 세 앱 + 선택 화면 (GitHub Pages 하위 경로 배포)
 *
 *   vite --mode hub        → apps/hub       (배포: /            )  앱 선택 화면(허브), 패키지에 의존하지 않는 단일 파일
 *   vite --mode holo       → apps/holo      (배포: /holo/       )  띠부씰 아카이브
 *   vite --mode proelium   → apps/proelium  (배포: /proelium/   )  배틀 중심 앱
 *   vite --mode communio   → apps/communio  (배포: /communio/   )  포켓몬과의 교감(사육장) 앱, 패키지에 의존하지 않는 단일 파일
 *
 * holo·proelium 은 packages/ 의 Rembrandt(엔진)·battle-ui(전투 화면)를 일반 <script> 로 불러온다(둘 다 ../packages/).
 *  - 개발 서버: /packages/* 요청을 저장소의 packages/ 로 연결한다.
 *  - 빌드     : holo 빌드가 dist/packages/ 로 복사하고, proelium(dist/proelium/)도 ../packages/ 로 함께 쓴다.
 *    (hub 가 dist/ 를 비우므로 hub → holo 순서로 빌드해야 한다 → npm run build)
 */
const ROOT = __dirname;
const PACKAGES = path.resolve(ROOT, 'packages');
const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sharedPackages(copyOnBuild: boolean) {
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
    /**
     * 일반 <script src>/<link href> 로 불러오는 packages/ 파일은 이름이 고정이라 브라우저가 옛 버전을 들고 있을 수 있다
     * (새 화면 코드가 옛 엔진 위에서 돌아가는 문제). 파일 내용 해시를 ?v= 로 붙여 내용이 바뀌면 주소도 바뀌게 한다.
     */
    transformIndexHtml(html: string) {
      return html.replace(/(src|href)="((?:\.\.?\/)+packages\/[^"?]+)"/g, (m: string, attr: string, url: string) => {
        const file = path.resolve(ROOT, url.replace(/^(?:\.\.?\/)+/, ''));
        if (!fs.existsSync(file)) return m;
        const h = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
        return `${attr}="${url}?v=${h}"`;
      });
    },
    closeBundle() {
      if (!copyOnBuild) return;
      fs.cpSync(PACKAGES, path.resolve(ROOT, 'dist', 'packages'), {
        recursive: true,
        filter: (f: string) => !/\.test\.mjs$/.test(f) && !/package\.json$/.test(f) && !/[\\/]rembrandt2([\\/]|$)/.test(f),       // Rembrandt 2 는 Proelium 번들에 들어가므로 복사하지 않는다
      });
    },
  };
}

const PORT: Record<string, number> = { holo: 3000, proelium: 3001, communio: 3002, hub: 3003 };

export default defineConfig(({ mode }) => {
  const isProelium = mode === 'proelium';
  const isCommunio = mode === 'communio';
  const isHub = mode === 'hub';
  const appName = isHub ? 'hub' : isProelium ? 'proelium' : isCommunio ? 'communio' : 'holo';
  const appDir = path.resolve(ROOT, 'apps', appName);
  return {
    root: appDir,
    base: './', // 하위 경로 배포·file:// 에서도 상대경로로 열리도록
    plugins: isCommunio || isHub ? [] : [sharedPackages(!isProelium)],
    build: {
      outDir: path.resolve(ROOT, 'dist', isHub ? '' : appName),
      emptyOutDir: true,       // hub 는 dist/ 전체를 비우고 시작한다(다른 앱보다 먼저 빌드)
      chunkSizeWarningLimit: 8000,       // @pkmn/sim 이 크다 (gzip 약 1MB)
    },
    // @pkmn/sim 의 복제(직렬화)는 클래스 이름('[Pokemon:p1a]')으로 참조를 되살린다. 최소화가 이름을 줄이면 깨지므로 이름을 보존한다.
    esbuild: isProelium ? { keepNames: true } : undefined,
    optimizeDeps: isProelium ? { esbuildOptions: { keepNames: true } } : undefined,       // 개발 서버의 의존성 묶음에도 같은 이유
    resolve: isProelium ? { alias: { rembrandt2: path.resolve(ROOT, 'packages', 'rembrandt2', 'src', 'index.js') } } : undefined,       // Proelium 은 Rembrandt 2(ESM)를 번들에 넣는다
    server: { port: PORT[appName], host: '0.0.0.0', fs: { allow: [ROOT] } },
    preview: { port: PORT[appName], host: '0.0.0.0' },
  };
});
