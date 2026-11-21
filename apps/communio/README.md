# Communio 2.0 (포켓몬과의 교감)

배포 주소 `/communio/`. 소스는 `index.html` 한 파일이며 외부 CSS 프레임워크 없이 직접 쓴 CSS 로 동작합니다(글꼴만 Jua·Pretendard).

- 화면: `#/` 사육장 · `#/play/<id>` 교감(새 화면) · `#/add` 데려오기(전국도감, 인원 제한 없음)
- 교감: 흰 장갑 손으로 쓰다듬기(+5)·때리기(-4)·말 걸기, 음식 아이콘을 끌어서 먹이기
- 저장 키: `communio:habitat_v1`, `communio:settings` (Holo 와 공유하지 않음)
- 재사용한 것: Holo 에서 온 도감 데이터·폼 도우미, 그림을 움직이는 퍼펫 엔진, 속마음 대사 엔진

```
npm run dev:communio       # 개발 서버 (3002)
npm run build:communio     # dist/communio/ 로 빌드
npm run e2e:communio       # 브라우저 전체 흐름 시험 (먼저 preview:communio 를 띄운다)
```
자세한 내용은 저장소 루트 `README.md` 의 *Communio 2.0* 절을 보세요.
