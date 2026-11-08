import {defineConfig} from 'vite';

// index.html 한 장으로 동작하는 정적 웹앱 (외부 API 서버 없음)
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
  },
});
