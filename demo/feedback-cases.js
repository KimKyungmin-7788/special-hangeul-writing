// 학생에게 줄 피드백 상황 목록. 개발자가 글씨마다 '이 학생에게 무엇을 말해야 하나'를 고르는 라벨이자,
// 엔진 피드백을 늘려 갈 목록이다. engine: true면 지금 엔진이 알아채는 상황(ISSUE 코드와 짝), false면 새로 만들어야 하는 상황.
// say는 소리로 들려줄 한 문장(짧게, 학생 눈높이), detect는 엔진이 알아챌 방법(새 상황은 구현 아이디어).
// 순서가 곧 우선순위: 한 글씨에 여러 상황이 겹치면 위의 것 하나만 말한다.
export const FEEDBACK_CASES = [
  // ── 쓰기 전에 바로잡을 것 ──
  { id: 'EMPTY', group: '태도', name: '안 씀', engine: true, issue: 'EMPTY',
    say: '칸 안에 글자를 써 봐요.', detect: '획이 없음' },
  { id: 'SCRIBBLE', group: '태도', name: '낙서', engine: false,
    say: '낙서는 안 돼요. 천천히 글자를 써 봐요.',
    detect: '그은 길이가 정답의 3배 이상이거나 획 수가 정답보다 많이 많고, 모양 점수가 아주 낮음. 빠르게 문지른 점(짧은 시간에 긴 길이)도 단서' },
  { id: 'TOO_FAST', group: '태도', name: '너무 급하게 씀', engine: false,
    say: '천천히 또박또박 써 봐요.',
    detect: '획 하나를 쓰는 시간이 또래 평균보다 아주 짧고 모양이 흐트러짐(쓴 시각 t 사용)' },
  { id: 'OUT_OF_BOX', group: '태도', name: '칸 밖으로 나감', engine: false,
    say: '칸 안에 써요.', detect: '획의 점이 칸(0~1) 밖으로 많이 나감' },

  // ── 글자 자체 ──
  { id: 'WRONG_CHAR', group: '글자', name: '다른 글자', engine: true, issue: 'WRONG_CHAR',
    say: '다른 글자처럼 보여요. 시범을 보고 다시 써 봐요.', detect: '다른 글자의 전체 모양이 더 닮음' },
  { id: 'MISSING_STROKE', group: '글자', name: '획 빠짐', engine: true, issue: 'MISSING_STROKE',
    say: '빠진 획이 있어요. 획을 세어 봐요.', detect: '정답 획과 짝이 안 맞는 획이 남음' },
  { id: 'EXTRA_STROKE', group: '글자', name: '획 더함', engine: true, issue: 'EXTRA_STROKE',
    say: '획을 더 그었어요.', detect: '짝이 없는 학생 획이 남음' },

  // ── 획을 긋는 방법 ──
  { id: 'STROKE_SPLIT', group: '긋는 법', name: '끊어 씀', engine: true, issue: 'STROKE_SPLIT',
    say: '끊지 말고 이어서 쓰세요.', detect: '한 획을 꺾이는 곳에서 끊어 두 번 이상에 그음' },
  { id: 'STROKES_JOINED', group: '긋는 법', name: '이어 씀', engine: true, issue: 'STROKES_JOINED',
    say: '이어 쓰지 말고, 획을 나눠서 써요.', detect: '여러 획을 한 붓에 그음' },
  { id: 'RETRACE', group: '긋는 법', name: '덧그림', engine: false,
    say: '한 번만 그어요. 덧그리지 않아요.',
    detect: '같은 자리를 두 번 이상 지나감(획이 자기 자신이나 앞 획을 길게 겹침)' },
  { id: 'WRONG_ORDER', group: '긋는 법', name: '획순', engine: true, issue: 'WRONG_ORDER',
    say: '획순이 달라요. 시범을 보고 따라 써요.', detect: '학생이 그은 차례가 정답 차례와 다름' },
  { id: 'WRONG_DIRECTION', group: '긋는 법', name: '방향', engine: true, issue: 'WRONG_DIRECTION',
    say: '반대로 그었어요. 시작점에서 시작해요.', detect: '획의 시작과 끝이 정답과 반대' },
  { id: 'START_POINT', group: '긋는 법', name: '시작점이 다름', engine: false,
    say: '파란 동그라미(시작점)에서 시작해요.',
    detect: '방향은 맞지만 첫 점이 정답 시작점에서 칸의 1/6 넘게 떨어짐(예: ㅇ을 아래에서 시작, 세로를 중간에서 시작)' },
  { id: 'NO_STOP', group: '긋는 법', name: '꺾지 않고 둥글게', engine: false,
    say: '꺾이는 곳에서 멈췄다가 꺾어요.',
    detect: 'ㄱ·ㄴ 같은 꺾임이 둥글게 돌아감(꺾임 부근 곡률이 완만)' },

  // ── 획이 만나는 곳 ──
  { id: 'OVERSHOOT', group: '만나는 곳', name: '넘어감', engine: true, issue: 'OVERSHOOT',
    say: '닿는 곳에서 멈춰요.', detect: '닿아서 멈출 곳을 지나 뚫고 나감' },
  { id: 'GAP', group: '만나는 곳', name: '안 닿음', engine: true, issue: 'GAP',
    say: '획이 닿을 때까지 그어요.', detect: '닿아야 할 획에서 떨어져 멈춤' },

  // ── 모양 ──
  { id: 'LENGTH', group: '모양', name: '획 길이', engine: false,
    say: '이 획을 조금 더 길게(짧게) 그어요.', detect: '짝 획의 길이가 정답보다 30% 넘게 길거나 짧음' },
  { id: 'SLANT', group: '모양', name: '기울어짐', engine: false,
    say: '가로는 반듯하게, 세로는 곧게 그어요.', detect: '가로·세로 획의 기울기가 정답과 15도 넘게 다름' },
  { id: 'WOBBLY', group: '모양', name: '떨림·구불', engine: false,
    say: '선을 곧게 그어 봐요.', detect: '곧은 획인데 정답 선에서 들쭉날쭉(직선에서 벗어난 정도가 큼)' },
  { id: 'SPACING', group: '모양', name: '획 사이 간격', engine: false,
    say: '두 획 사이를 알맞게 띄어요.', detect: 'ㅑ·ㅕ·ㅛ·ㅠ의 짧은 두 획이 붙거나 너무 벌어짐' },
  { id: 'SHAPE', group: '모양', name: '그 밖의 모양', engine: true, issue: 'SHAPE',
    say: '안내선에 맞춰 다시 써 봐요.', detect: '한 획이 정답 모양과 많이 다름' },

  // ── 크기·자리 ──
  { id: 'TOO_SMALL', group: '크기·자리', name: '너무 작음', engine: true, issue: 'TOO_SMALL',
    say: '조금 더 크게 써요.', detect: '글자 크기가 정답의 75% 미만' },
  { id: 'TOO_BIG', group: '크기·자리', name: '너무 큼', engine: true, issue: 'TOO_BIG',
    say: '조금 더 작게 써요.', detect: '글자 크기가 정답의 130% 초과' },
  { id: 'OFF_CENTER', group: '크기·자리', name: '치우침', engine: true, issue: 'OFF_CENTER',
    say: '칸 가운데에 써요.', detect: '글자 가운데가 칸 가운데에서 멀어짐' },

  // ── 칭찬(특수교육에서 특히 중요) ──
  { id: 'PRAISE', group: '칭찬', name: '잘함', engine: true,
    say: '참 잘했어요!', detect: '문제가 없고 높은 점수(지금은 소리 없이 화면에만 칭찬)' },
  { id: 'IMPROVED', group: '칭찬', name: '나아짐', engine: false,
    say: '아까보다 좋아졌어요!', detect: '같은 학생의 같은 글자 이전 시도보다 점수가 오르거나 문제가 줄어듦' },
  { id: 'TRY_AGAIN', group: '칭찬', name: '격려', engine: false,
    say: '괜찮아요. 한 번 더 해 봐요.', detect: '같은 글자를 여러 번 낮게 받음(좌절 방지, 지적 대신 격려)' },
];

export const CASE_BY_ID = Object.fromEntries(FEEDBACK_CASES.map((c) => [c.id, c]));
export const CASE_GROUPS = [...new Set(FEEDBACK_CASES.map((c) => c.group))];
