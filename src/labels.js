// 교사가 글씨에 붙이는 평가 항목(라벨). 채점실·연습 화면 표본·도구·테스트가 모두 이 정의 하나를 쓴다.
// 기준 문서: docs/labels.md
//
// 저장 형식(문자열 배열):
//   'OVERSHOOT'        항목만(정도가 있는 항목이면 '살짝')
//   'OVERSHOOT!'       정도 '뚜렷'
//   'SHAPE.SLANT'      모양의 세부 이유(선택 태그, 점수에는 쓰지 않음)
//   []                 문제 없음, null 표시 안 함
// 학생에게 먼저 말할 항목(★)은 따로 dev_feedback에 항목 코드로 둔다. 없으면 우선순위로 정한다.

// 4갈래 11개 + 채점 제외. 순서가 곧 피드백 우선순위(위일수록 먼저 말함)
export const LABELS = [
  { code: 'WRONG_CHAR', name: '다른 글자', group: 'know', def: '다른 글자로 읽힌다', engine: ['WRONG_CHAR'] },
  { code: 'STROKE_COUNT', name: '획 수', group: 'know', def: '획이 빠지거나 더 있다(덧그림, 다른 꼴 포함)', engine: ['MISSING_STROKE', 'EXTRA_STROKE', 'ALT_FORM'] },
  { code: 'WRONG_ORDER', name: '획순', group: 'know', def: '그은 차례가 다르다', engine: ['WRONG_ORDER'] },
  { code: 'WRONG_DIRECTION', name: '방향', group: 'know', def: '반대쪽 끝에서 시작했다(시작점이 다른 것 포함)', engine: ['WRONG_DIRECTION'] },
  { code: 'STROKE_SPLIT', name: '끊어 씀', group: 'stroke', def: '한 획을 펜을 떼었다가 이어 썼다', engine: ['STROKE_SPLIT'] },
  { code: 'STROKES_JOINED', name: '이어 씀', group: 'stroke', def: '여러 획을 한 번에 그었다', engine: ['STROKES_JOINED'] },
  { code: 'OVERSHOOT', name: '넘어감', group: 'stroke', def: '닿아서 멈출 곳을 지나쳤다', engine: ['OVERSHOOT'], severity: true },
  { code: 'GAP', name: '안 닿음', group: 'stroke', def: '닿아야 할 곳에 못 닿았다', engine: ['GAP'], severity: true },
  { code: 'SHAPE', name: '획 모양', group: 'shape', def: '획의 길이·기울기·곧기가 안내선과 다르다', engine: ['SHAPE'], severity: true },
  { code: 'SIZE', name: '크기', group: 'place', def: '너무 작거나 크다(칸 밖으로 나간 것 포함)', engine: ['TOO_SMALL', 'TOO_BIG'], severity: true },
  { code: 'OFF_CENTER', name: '치우침', group: 'place', def: '칸 한쪽으로 몰렸다', engine: ['OFF_CENTER'] },
];
// 채점 제외: 낙서·장난·실수로 찍힘. 점수 학습에서 뺀다(다른 항목과 함께 고르지 않음)
export const EXCLUDE = { code: 'EXCLUDE', name: '채점 제외', def: '낙서·장난·실수로 찍혀 평가할 수 없다' };

export const GROUPS = [
  { key: 'know', name: '글자를 아는가', note: '배워야 할 오류' },
  { key: 'stroke', name: '획을 바르게 긋는가', note: '운동 조절' },
  { key: 'shape', name: '모양', note: '운동 조절' },
  { key: 'place', name: '자리·크기', note: '운동 조절' },
];

// '획 모양'의 세부 이유(선택). 엔진이 세부 피드백을 배울 때 쓴다
export const SHAPE_TAGS = [
  { code: 'LENGTH', name: '길이' }, { code: 'SLANT', name: '기울기' }, { code: 'WOBBLY', name: '떨림' },
  { code: 'CORNER', name: '꺾임' }, { code: 'SPACING', name: '간격' },
];

export const LABEL_BY_CODE = Object.fromEntries([...LABELS, EXCLUDE].map((l) => [l.code, l]));

// 'OVERSHOOT!' → { code: 'OVERSHOOT', strong: true }, 'SHAPE.SLANT' → { code: 'SHAPE', tag: 'SLANT' }
export function parseLabel(s) {
  const strong = s.endsWith('!');
  const [code, tag] = s.replace(/!$/, '').split('.');
  return { code, strong, tag: tag || null };
}
export const labelCodes = (labels) => [...new Set((labels || []).map((s) => parseLabel(s).code))];

// 엔진 문제 코드 → 평가 항목 코드
const ENGINE_TO_LABEL = Object.fromEntries(LABELS.flatMap((l) => l.engine.map((e) => [e, l.code])));
export function engineToLabels(issues) {
  return [...new Set((issues || []).map((i) => ENGINE_TO_LABEL[typeof i === 'string' ? i : i.code]).filter(Boolean))];
}

// 예전 표시(문제 버튼 14개·피드백 상황 27개)를 새 항목으로 옮긴다
const OLD_TO_NEW = {
  MISSING_STROKE: 'STROKE_COUNT', EXTRA_STROKE: 'STROKE_COUNT', ALT_FORM: 'STROKE_COUNT', RETRACE: 'STROKE_COUNT',
  START_POINT: 'WRONG_DIRECTION', TOO_SMALL: 'SIZE', TOO_BIG: 'SIZE', OUT_OF_BOX: 'SIZE',
  LENGTH: 'SHAPE.LENGTH', SLANT: 'SHAPE.SLANT', WOBBLY: 'SHAPE.WOBBLY', NO_STOP: 'SHAPE.CORNER', SPACING: 'SHAPE.SPACING', TOO_FAST: 'SHAPE.WOBBLY',
  SCRIBBLE: 'EXCLUDE', EMPTY: 'EXCLUDE',
};
const DROP = new Set(['PRAISE', 'IMPROVED', 'TRY_AGAIN']); // 칭찬은 앱이 정한다
export function migrateLabels(old) {
  if (old == null) return null;
  const out = [];
  for (const c of old) {
    if (DROP.has(c)) continue;
    const n = OLD_TO_NEW[c] || c;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
export function migrateFeedback(id) {
  if (!id || DROP.has(id)) return null;
  return parseLabel(OLD_TO_NEW[id] || id).code;
}

// 학생에게 먼저 말할 항목: ★로 고른 것, 없으면 고른 항목 중 우선순위가 가장 높은 것
export function primaryLabel(labels, star) {
  const codes = labelCodes(labels);
  if (star && codes.includes(star)) return star;
  return LABELS.find((l) => codes.includes(l.code))?.code || null;
}
