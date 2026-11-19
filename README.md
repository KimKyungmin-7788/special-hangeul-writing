# 한글 쓰기 엔진 v0.1

화면 없이 계산만 하는 한글 손글씨 채점 엔진입니다. 어느 앱에 붙여도 디자인은 그 앱이 정하고, 채점은 같은 규칙으로 합니다.

## 범위 (v0.1)
- 기본 자음 14자 (ㄱ~ㅎ)
- 채점 항목: **획순 25 · 방향 15 · 모양 40 · 자리·크기 20** (합 100)
- 획순이 틀리면 최고 69점(C), 방향이 틀리면 최고 79점(B)
- 기기별 허용 폭: `finger`(손가락) · `pen`(펜) · `board`(전자칠판)

## 파일
| 파일 | 하는 일 |
|---|---|
| `src/strokes-consonants.js` | 자음별 획 데이터(순서·방향·위치, 칸 기준 0~1 좌표) |
| `src/engine.js` | 채점 엔진 `evaluate`, 획 하나 즉시 확인 `checkStroke` |
| `src/feedback-ko.js` | 채점 결과를 학생용 한국어 문장으로 |
| `demo/` | 엔진 확인용 연습 화면 |
| `test/engine.test.js` | 골든 테스트 |

## 쓰는 법
```js
import { evaluate, checkStroke } from './src/engine.js';
import { feedbackKo } from './src/feedback-ko.js';

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

문제 코드: `EMPTY` `MISSING_STROKE` `EXTRA_STROKE` `WRONG_ORDER` `WRONG_DIRECTION` `TOO_SMALL` `TOO_BIG` `OFF_CENTER` `SHAPE`

## 확인
```bash
npm test
```
```bash
python3 -m http.server 5178
```
그다음 http://localhost:5178/demo/ 를 엽니다.

## 남은 일
- 획 데이터 교사 검수 (특히 ㅈ·ㅊ의 첫 획 모양, ㅎ·ㅊ 꼭지의 위치)
- 모음 21자, 음절(글자 꼴 6가지 배치) 확장
- 실제 학생 글씨로 허용 폭 조정
