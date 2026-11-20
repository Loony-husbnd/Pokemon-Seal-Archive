# Communio 1.0 (포켓몬과의 교감)

배포 주소 `/communio/`. Holo 의 **띠부파를레**(사육장·1:1 교감실·포켓몬빵 먹이기·한마디 건네기)를 따로 떼어 만든 앱입니다. 소스는 `index.html` 한 파일이고 Tailwind(CDN)·Lucide(CDN)를 Holo 와 같게 씁니다.

- 띠부씰 도감과는 **연결되어 있지 않습니다.** 데려올 포켓몬은 엔트리 관리에서 전국도감(이름·초성·번호 검색, 세대 필터)으로 직접 고르고, 폼(메가·거다이맥스·지방폼·폼체인지)과 이로치를 정할 수 있습니다.
- 저장 키는 `communio:habitat_v1` 하나이며 Holo 의 `pokemon_seal_habitat_v2` 와 **공유하지 않습니다.**
- 엔진·배틀 패키지(`packages/`)를 쓰지 않으므로 빌드 때 따로 복사되는 것이 없습니다.

## 개발
```
npm run dev:communio       # 개발 서버 (3002)
npm run build:communio     # dist/communio/ 로 빌드
npm run e2e:communio       # 브라우저 전체 흐름 시험 (먼저 preview:communio 를 띄운다)
```
자세한 기능과 한계는 저장소 루트 `README.md` 의 *Communio 1.0* 절을 보세요.
