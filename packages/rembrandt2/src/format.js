/**
 * 규칙 상수. 결정 사항: 9세대 기준 · 메가진화만(테라스탈·다이맥스 없음) · 상대 정보 가리기.
 *
 *  - 'gen9anythinggoes' 는 디버그 형식이 아니라서 상대 체력이 퍼센트(예: 74/100)로만 보인다.
 *    ('gen9customgame' 은 디버그 형식이라 정확한 체력이 나오므로 쓰지 않는다. spike/showdown/README.md 참고)
 *  - 'Terastal Clause' 로 테라스탈을 막는다. 메가진화는 9세대 규칙에서도 메가스톤을 들고 있으면 가능하다.
 */
export const FORMAT_ID = 'gen9anythinggoes@@@Terastal Clause';

/** 출전 포켓몬 수 (3대3) */
export const TEAM_SIZE = 3;
