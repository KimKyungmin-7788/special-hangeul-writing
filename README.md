# 한글 쓰기 엔진 v0.2

화면 없이 계산만 하는 한글 손글씨 채점 엔진입니다. 어느 앱에 붙여도 디자인은 그 앱이 정하고, 채점은 같은 규칙으로 합니다.

## 범위 (v0.2)
- 기본 자음 14자 (ㄱ~ㅎ), 모음 21자 (ㅏ~ㅣ, 겹모음 포함)
- 채점 항목: **획순 10 · 방향 5 · 모양 60 · 자리·크기 25** (합 100). 모양은 평균과 가장 못 쓴 획을 반반 반영
- 다른 글자를 쓰면 최고 39점(F), 획순이 틀리거나 획을 이어·나눠 쓰면 최고 69점(C), 방향이 틀리면 최고 79점(B)
- 기기별 허용 폭: `finger`(손가락) · `pen`(펜) · `board`(전자칠판)

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

문제 코드: `WRONG_CHAR` `STROKES_JOINED` `STROKE_SPLIT` `EMPTY` `MISSING_STROKE` `EXTRA_STROKE` `WRONG_ORDER` `WRONG_DIRECTION` `TOO_SMALL` `TOO_BIG` `OFF_CENTER` `SHAPE`

## 확인
```bash
npm test
```
```bash
python3 -m http.server 5178
```
그다음 http://localhost:5178/demo/ 를 엽니다.

## 남은 일
- 모음 21자 교사 검수 (자음 14자는 11/19 검수 반영)
- 음절(글자 꼴 6가지 배치) 확장
- 실제 학생 글씨로 허용 폭 조정

## 채점 보정 표본 모으기
1. 연습 화면에서 글씨를 쓰고 '다 썼어요'를 누릅니다.
2. 결과 아래 '선생님이 본 점수'에 0~100점을 넣고 '표본 저장'을 누릅니다. 글씨 좌표와 점수만 저장되며 이름 같은 개인정보는 받지 않습니다.
3. 아래 '모은 채점 표본' 표에서 선생님 점수와 엔진 점수 차이를 봅니다.
4. '표본 내려받기'로 받은 파일을 `test/samples/`에 넣고 `npm test`를 돌리면 차이를 검사합니다.
