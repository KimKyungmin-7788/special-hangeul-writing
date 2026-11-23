// 교사 채점 기준표. 교사가 매긴 표본(test/samples/, 2026-11-22 기준 62개)에서 문제별로 실제로 준 점수를 뽑아 만들었다.
// 표본이 늘면 tools로 다시 세고 이 숫자를 고친다. n은 그 줄의 근거가 된 표본 수(0이면 아직 근거 없음).
export const RUBRIC_DATE = '2026-11-22';
export const RUBRIC_SAMPLES = 62;

// 판단 순서: 위에서부터 먼저 걸리는 항목 하나가 점수 범위를 정하고, 그 범위 안에서 모양으로 더 깎는다.
// code: 평가 항목(src/labels.js), sev: 정도가 있는 항목의 '살짝'(light)·'뚜렷'(strong) 줄. 없으면 정도와 상관없이
export const RUBRIC = [
  { code: 'WRONG_CHAR', name: '다른 글자', band: [26, 39], typical: 30, n: 8, short: '다른 글자로 읽히면 F',
    rule: '다른 글자로 읽히면 모양이 좋아도 F.', look: 'ㅏ 자리에 ㅓ, ㅈ이 ㅊ처럼 보임' },
  { code: 'STROKES_JOINED', name: '이어 씀', band: [40, 60], typical: 60, n: 2, short: '1번 이음 60 · 2번 이상 40',
    rule: '한 번 이으면 60, 두 번 이상 이으면 40.', look: 'ㅁ을 한 붓에(2번 이음) 40, ㄷ을 한 붓에(1번) 60' },
  { code: 'OVERSHOOT', sev: 'strong', name: '넘어감 · 뚜렷', band: [40, 60], typical: 45, n: 14, short: '칸 1/10 넘게 뚫음 → 40~50',
    rule: '닿아서 멈출 곳을 칸의 약 1/10 넘게 뚫고 나가면 40~50. 자음·모음 같은 기준.', look: 'ㅔ 짧은 가로가 첫 세로를 뚫고 나감, ㅛ 세로가 가로 아래로 내려감' },
  { code: 'OVERSHOOT', sev: 'light', name: '넘어감 · 살짝', band: [80, 85], typical: 80, n: 3, short: '꺾임에서 살짝 지나침',
    rule: '꺾이는 곳에서 펜 끝이 조금(칸의 1/12 이하) 지나친 정도면 80~85.', look: 'ㄹ 꺾임에서 살짝 삐져나옴' },
  { code: 'GAP', sev: 'strong', name: '안 닿음 · 뚜렷', band: [40, 50], typical: 50, n: 2, short: '칸 1/5 넘게 떨어짐',
    rule: '닿아야 할 획에서 칸의 1/5 넘게 떨어지면 40~50.', look: 'ㅂ 가운데 가로가 세로에 닿지 않음' },
  { code: 'GAP', sev: 'light', name: '안 닿음 · 살짝', band: [null, null], typical: null, n: 0, short: '조금 떨어진 것은 봐줌 · 점수를 남겨 주세요',
    rule: '아직 표본이 없음. 엔진은 칸의 8%까지는 감점하지 않는다.', look: '' },
  { code: 'STROKE_COUNT', name: '획 수', band: [60, 65], typical: 65, n: 1, short: '다른 꼴(ㅈ을 ㅡ+ㅅ) 65 · 빠짐·더함은 점수를 남겨 주세요',
    rule: '획 수를 바꿔 쓴 다른 꼴은 최고 65. 획이 빠지거나 더 있는 경우는 아직 표본이 없다.', look: 'ㅈ·ㅊ을 가로 + ㅅ으로, ㅑ의 짧은 가로 하나가 없음' },
  { code: 'STROKE_SPLIT', name: '끊어 씀', band: [57, 85], typical: 70, n: 9, short: '보통 70 · 모양 좋으면 80대',
    rule: '한 획을 꺾이는 곳에서 끊어 두 번에 씀 → 약 70. 모양이 아주 좋으면 80대까지.', look: 'ㄱ을 가로·세로 두 번에' },
  { code: 'WRONG_ORDER', name: '획순', band: [null, 69], typical: null, n: 0, short: '엔진 최고 69 · 점수를 남겨 주세요',
    rule: '아직 교사 표본이 없음. 엔진은 최고 69(C)로 둠.', look: 'ㅏ를 가로 먼저' },
  { code: 'WRONG_DIRECTION', name: '방향', band: [null, 79], typical: null, n: 0, short: '엔진 최고 79 · 점수를 남겨 주세요',
    rule: '아직 교사 표본이 없음. 엔진은 최고 79(B)로 둠. 반대쪽 끝에서 시작한 것도 여기.', look: '가로를 오른쪽에서 왼쪽으로' },
  { code: 'SHAPE', sev: 'strong', name: '획 모양 · 뚜렷', band: [70, 80], typical: 75, n: 2, short: '여러 획이 어긋남 70대',
    rule: '여러 획의 길이·기울기·곧기가 어긋나면 70대.', look: '' },
  { code: 'SHAPE', sev: 'light', name: '획 모양 · 살짝', band: [80, 90], typical: 85, n: 2, short: '한 획만 어긋남 80대',
    rule: '한 획만 휘거나 길이가 어긋나면 80대.', look: 'ㅍ 아래 가로가 짧음' },
  { code: 'SIZE', name: '크기', band: [70, 88], typical: 80, n: 3, short: '모양이 바르면 5~15점만 깎음',
    rule: '칸 안의 크기는 크게 따지지 않음. 모양이 바르면 5~15점만 깎는다.', look: '칸의 절반도 안 되게 작게' },
  { code: 'OFF_CENTER', name: '치우침', band: [70, 75], typical: 75, n: 2, short: '모양이 바르면 조금만 깎음',
    rule: '한쪽으로 몰려도 모양이 바르면 조금만 깎는다.', look: '칸 한쪽 구석에' },
  { code: 'NONE', name: '문제 없음', band: [70, 99], typical: 85, n: 15, short: '같음 95+ · 흔들림 85~90 · 어색 70~80',
    rule: '모양으로만 매김: 안내선과 거의 같음 95~99 · 조금 흔들림 85~90 · 비율·기울기가 어색함 70~80.', look: '' },
];

// 등급 구간(엔진과 같음)
export const GRADES = [['S', 90], ['A', 80], ['B', 70], ['C', 60], ['F', 0]];

// 교사가 직접 '기준과 다르다'고 확인해 예외로 둔 표본. 비슷한 경우를 만나면 이 결정을 따른다.
export const PRECEDENTS = [
  { ch: 'ㅍ', score: 85, decision: '왼쪽 세로를 두 번에 나눠 그었는데 85점을 줬음 → 예외. 원칙은 "나눠 쓰면 70 안팎".' },
  { ch: 'ㅍ', score: 60, decision: '세로가 윗 가로를 칸의 15% 뚫었는데 60점 → 예외. 원칙은 "뚜렷한 넘어감은 자음·모음 모두 40~50".' },
  { ch: 'ㅈ', score: 60, decision: '둘째 획이 가로를 뚫어 ㅊ처럼 보였는데 60점 → 예외. 원칙은 "다른 글자로 읽히면 F".' },
];

// 고른 항목으로 기준 줄 찾기: 고른 항목마다 정도에 맞는 줄을 찾고(정도 미지정·살짝은 light, '!'는 strong),
// 그중 점수 범위가 가장 낮은(가장 무거운) 줄이 점수를 정한다. 피드백 순서(src/labels.js)와는 따로다
import { parseLabel } from '../src/labels.js';
export function rubricFor(labels) {
  if (!labels) return null;
  if (!labels.length) return RUBRIC.find((r) => r.code === 'NONE');
  const rows = labels.map(parseLabel).filter((p) => !p.tag).map((p) => {
    const sev = p.strong ? 'strong' : 'light';
    return RUBRIC.find((r) => r.code === p.code && (!r.sev || r.sev === sev));
  }).filter(Boolean);
  return rows.sort((a, b) => (a.band[1] ?? 100) - (b.band[1] ?? 100))[0] || null;
}
