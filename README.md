# 포켓몬 띠부씰 컬렉션 (v3.2 Lucent)

포켓몬 띠부씰의 세대·속성·등급 정보를 기록하고, 실시간 통계와 도감 완성 예측(쿠폰 수집가 문제)을 보여주는 웹앱입니다.
`index.html` 한 파일로 동작하며, 데이터는 브라우저 저장소(localStorage)에 보관됩니다. 외부 API 키는 필요 없습니다.

## 실행 방법

- **바로 열기:** `index.html`을 브라우저로 열면 됩니다.
- **개발 서버 (선택):** Node.js 설치 후
  1. `npm install`
  2. `npm run dev` → http://localhost:3000
- **배포용 빌드:** `npm run build` → `dist/` 폴더를 정적 호스팅에 올리면 됩니다.
