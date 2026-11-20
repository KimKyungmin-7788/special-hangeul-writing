# 한글 쓰기 엔진 v0.3

화면 없이 계산만 하는 한글 손글씨 채점 엔진입니다. 어느 앱에 붙여도 디자인은 그 앱이 정하고, 채점은 같은 규칙으로 합니다.

## 범위 (v0.3)
- 기본 자음 14자 (ㄱ~ㅎ), 모음 21자 (ㅏ~ㅣ, 겹모음 포함)
- 채점 항목: **획순 10 · 방향 5 · 모양 75 · 자리·크기 10** (합 100). 모양은 가로·세로 비율 차이를 대부분 봐주고, 평균에 가장 못 쓴 획을 1/4 섞음
- 점수 상한
  - 다른 글자를 쓰면 최고 39점(F)
  - 획이 닿아 멈출 곳(접점)을 넘어가면 넘어간 길이에 따라 최고 40~100점(칸의 4%까지 봐줌, 12% 이상이면 40점)
  - 획순이 틀리거나 획을 이어·나눠 쓰면 최고 69점(C)
  - 방향이 틀리면 최고 79점(B)
- 기기별 허용 폭: `finger`(손가락) · `pen`(펜, 손가락과 같음) · `board`(전자칠판, 더 너그러움)
- 교사 채점 표본 31개 기준 평균 차이 4.8점

## 파일
| 파일 | 하는 일 |
|---|---|
| `src/strokes-consonants.js` | 자음별 획 데이터(순서·방향·위치, 칸 기준 0~1 좌표) |
| `src/strokes-vowels.js` | 모음별 획 데이터 |
| `src/engine.js` | 채점 엔진 `evaluate`, 획 하나 즉시 확인 `checkStroke` |
| `src/feedback-ko.js` | 채점 결과를 학생용 한국어 문장으로 |
| `demo/` | 엔진 확인용 연습 화면 |
| `test/engine.test.js` | 골든 테스트 |
| `test/samples/` | 교사가 점수를 매긴 실제 글씨 표본. 연습 화면에서 모아 내려받은 파일을 넣는다(평균 차이 8점 이하, 하나하나 15점 이하) |

## 쓰는 법
```js
import { evaluate, checkStroke, listChars } from './src/engine.js';
import { feedbackKo } from './src/feedback-ko.js';

listChars('vowel'); // ['ㅏ', 'ㅑ', ...]  'consonant' 또는 생략(전체)

// strokes: [[{x,y}, ...], ...]  쓰기 칸 기준 0~1 좌표
const r = evaluate('ㄷ', strokes, { device: 'finger' });
r.score;        // 0~100
r.grade;        // S A B C F
r.parts;        // { order, direction, shape, placement } 각 0~1
r.issues;       // [{ code: 'WRONG_ORDER', ... }, ...]
feedbackKo(r);  // ['획 순서가 달라요. ...']

// 획순 지키기 모드: 획 하나를 그을 때마다
checkStroke('ㄷ', 0, stroke); // { ok, wrongOrder, wrongDirection, bestIndex }
```

문제 코드: `WRONG_CHAR` `OVERSHOOT` `STROKES_JOINED` `STROKE_SPLIT` `EMPTY` `MISSING_STROKE` `EXTRA_STROKE` `WRONG_ORDER` `WRONG_DIRECTION` `TOO_SMALL` `TOO_BIG` `OFF_CENTER` `SHAPE`

## 확인
```bash
npm test
```
```bash
python3 tools/serve.py
```
그다음 맥북에서는 http://localhost:5178/demo/ 를 엽니다.

### 아이패드(펜슬)에서 쓰고 검수하기
1. 맥북과 아이패드를 같은 와이파이에 연결하고, 맥북에서 위 명령을 실행합니다. 화면에 아이패드용 주소(`http://192.168.x.x:5178/demo/`)가 나옵니다.
   학교 와이파이는 기기끼리 통신을 막아 두는 경우가 많아, 안 되면 집 와이파이나 휴대폰 핫스팟을 씁니다.
2. 아이패드 사파리에서 그 주소를 엽니다. 검수표는 `.../demo/review.html` 입니다.
3. 연습 화면에서 '펜슬만 받기'를 켜면 손바닥 터치가 획으로 들어가지 않습니다(설정은 아이패드에 기억됨).
4. 결과 보내기: '검수 결과 복사' 또는 '표본 복사'를 누른 뒤, 같은 Apple ID 맥북에서 붙여 넣습니다(유니버설 클립보드).
   자동 복사가 막히면 글이 담긴 창이 뜨니 길게 눌러 전체 선택 → 복사합니다. 표본은 '표본 내려받기' 후 AirDrop으로 보내도 됩니다.
5. 아이패드에 저장된 검수 표시와 표본은 아이패드 브라우저에만 있습니다(맥북과 따로).

## 남은 일
- 모음 21자 교사 검수 (자음 14자는 11/19 검수 반영)
- 음절(글자 꼴 6가지 배치) 확장
- 실제 학생 글씨로 허용 폭 조정

## 채점 보정 표본 모으기
1. 연습 화면에서 글씨를 쓰고 '다 썼어요'를 누릅니다.
2. 결과 아래 '선생님이 본 점수'에 0~100점을 넣고 '표본 저장'을 누릅니다. 글씨 좌표와 점수만 저장되며 이름 같은 개인정보는 받지 않습니다.
3. 아래 '모은 채점 표본' 표에서 선생님 점수와 엔진 점수 차이를 봅니다.
4. '표본 내려받기'로 받은 파일을 `test/samples/`에 넣고 `npm test`를 돌리면 차이를 검사합니다.
