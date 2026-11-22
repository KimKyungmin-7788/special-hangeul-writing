// 채점 결과(issues)를 학생에게 보여 줄 한국어 문장으로 바꾼다.
// 앱마다 말투를 바꾸고 싶으면 이 파일만 바꾸면 된다.

import { getTemplate, explainScore } from './engine.js';

const nth = (i) => `${i + 1}번째 획`;
const KOR_COUNT = { 2: '두', 3: '세', 4: '네', 5: '다섯' };

function directionHint(stroke) {
  if (stroke.closed) return '위에서 시작해 왼쪽으로 돌려요';
  const a = stroke.points[0], b = stroke.points[stroke.points.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy) * 2) return dx > 0 ? '왼쪽에서 오른쪽으로 그어요' : '오른쪽에서 왼쪽으로 그어요';
  if (Math.abs(dy) > Math.abs(dx) * 2) return '위에서 아래로 그어요';
  return dx < 0 ? '오른쪽 위에서 왼쪽 아래로 그어요' : '왼쪽 위에서 오른쪽 아래로 그어요';
}

// 문제 코드의 짧은 이름. 교사가 표본에 '어떤 문제가 보이는지' 표시할 때와 검수 화면에서 쓴다.
// 순서가 곧 표시 순서다(EMPTY는 표시할 일이 없어 뺀다).
export const ISSUE_NAMES_KO = {
  WRONG_CHAR: '다른 글자',
  MISSING_STROKE: '획 빠짐',
  EXTRA_STROKE: '획 더함',
  WRONG_ORDER: '획순',
  WRONG_DIRECTION: '방향',
  STROKES_JOINED: '이어 씀',
  STROKE_SPLIT: '나눠 씀',
  ALT_FORM: '다른 꼴',
  OVERSHOOT: '넘어감',
  GAP: '안 닿음',
  SHAPE: '획 모양',
  TOO_SMALL: '너무 작음',
  TOO_BIG: '너무 큼',
  OFF_CENTER: '치우침',
};

export function feedbackKo(result) {
  const tpl = getTemplate(result.char);
  const n = tpl.strokes.length;
  const msgs = [];
  // 다른 글자를 썼거나 획을 이어·나눠 썼으면 세부 지적은 빼고 그것만 알려 준다
  const FIRST = ['WRONG_CHAR', 'STROKES_JOINED', 'STROKE_SPLIT', 'ALT_FORM'];
  const top = FIRST.find((c) => result.issues.some((i) => i.code === c));
  const issues = top ? result.issues.filter((i) => i.code === top) : result.issues;
  for (const it of issues) {
    switch (it.code) {
      case 'EMPTY': msgs.push('칸 안에 글자를 써 봐요.'); break;
      case 'WRONG_CHAR': msgs.push(`'${it.looksLike}'처럼 보여요. '${result.char}'를 써 봐요. '획순 보기'로 모양을 확인해요.`); break;
      case 'OVERSHOOT': msgs.push(`${nth(it.stroke)}이 ${it.into + 1}번째 획을 넘어갔어요. 닿는 곳에서 멈춰요.`); break;
      case 'ALT_FORM': msgs.push(`${result.char}은(는) ${it.expected}획으로 써요. '획순 보기'로 순서를 확인해 봐요.`); break;
      case 'GAP': msgs.push(`${nth(it.stroke)}이 ${it.to + 1}번째 획에 닿지 않았어요. 닿을 때까지 그어요.`); break;
      case 'STROKES_JOINED': msgs.push('한 번에 이어서 쓰지 말고, 순서에 맞게 나눠서 쓰세요.'); break;
      case 'STROKE_SPLIT': {
        // 여러 획을 나눠 썼으면 횟수 대신 일반 안내
        if (it.split.length > 1) msgs.push('획을 나눠 쓰지 말고, 한 획은 한 번에 써야 해요.');
        else msgs.push(`${KOR_COUNT[it.split[0].pieces] || it.split[0].pieces} 번에 나눠 쓰지 말고 한 번에 써야 해요.`);
        break;
      }
      case 'MISSING_STROKE': msgs.push(`획이 ${it.count}개 빠졌어요. ${result.char}은(는) ${n}획이에요.`); break;
      case 'EXTRA_STROKE': msgs.push(`획을 ${it.count}번 더 그었어요. ${result.char}은(는) ${n}획이에요.`); break;
      case 'WRONG_ORDER': msgs.push(`획 순서가 달라요. '획순 보기'로 1번 획부터 차례대로 확인해 봐요.`); break;
      case 'WRONG_DIRECTION':
        for (const i of it.strokes) msgs.push(`${nth(i)}은 반대로 그었어요. ${directionHint(tpl.strokes[i])}.`);
        break;
      case 'TOO_SMALL': msgs.push('글자가 작아요. 칸을 넉넉하게 채워 봐요.'); break;
      case 'TOO_BIG': msgs.push('글자가 칸보다 커요. 안내선 안에 맞춰 봐요.'); break;
      case 'OFF_CENTER': msgs.push('글자가 한쪽으로 치우쳤어요. 칸 가운데에 써 봐요.'); break;
      case 'SHAPE': msgs.push(`${nth(it.stroke)} 모양을 안내선에 더 가깝게 맞춰 봐요.`); break;
    }
  }
  if (!msgs.length) msgs.push(result.score >= 90 ? '획순도 모양도 훌륭해요!' : '잘 썼어요! 안내선에 조금만 더 맞춰 봐요.');
  return msgs;
}

// 점수가 왜 이렇게 나왔는지 키워드로(교사·개발자용). 채점 기준표의 문제 이름을 그대로 쓴다.
// kind: 'cap' 점수를 정한 문제(상한) · 'minus' 실제로 깎인 항목 · 'muted' 있었지만 점수에 반영 안 됨(겹침/상한에 묻힘) · 'ok' 감점 없음
const PART_KO = { order: '획순', direction: '방향', shape: '모양', placement: '자리·크기' };
const PART_ISSUES = { placement: ['TOO_SMALL', 'TOO_BIG', 'OFF_CENTER'], shape: ['SHAPE'], order: ['WRONG_ORDER', 'MISSING_STROKE', 'EXTRA_STROKE'], direction: ['WRONG_DIRECTION'] };
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
export function explainKo(result) {
  const ex = explainScore(result);
  const codes = result.issues.map((i) => i.code);
  const partLabel = (key) => {
    const rel = (PART_ISSUES[key] || []).filter((c) => codes.includes(c)).map((c) => ISSUE_NAMES_KO[c]);
    return rel.length ? `${PART_KO[key]}(${rel.join('·')})` : PART_KO[key];
  };
  const out = [];
  if (ex.binding) {
    out.push({ kind: 'cap', text: `🔒 ${ISSUE_NAMES_KO[ex.binding.code] || ex.binding.code} → 최고 ${ex.binding.cap}` });
    for (const c of ex.overlapped) out.push({ kind: 'muted', text: `겹침: ${ISSUE_NAMES_KO[c.code] || c.code}(최고 ${c.cap}) 추가 감점 없음` });
    for (const d of ex.deductions) out.push({ kind: 'muted', text: `${partLabel(d.key)} −${num(d.lost)} 상한에 묻힘` });
  } else {
    for (const d of ex.deductions) out.push({ kind: 'minus', text: `${partLabel(d.key)} −${num(d.lost)}` });
    for (const c of ex.caps) out.push({ kind: 'muted', text: `${ISSUE_NAMES_KO[c.code] || c.code}(최고 ${c.cap}) 점수가 이미 더 낮음` });
  }
  if (!out.length) out.push({ kind: 'ok', text: '감점 없음' });
  return out;
}

// 소리로 들려줄 짧은 한 문장. 가장 중요한 문제 하나만 말한다.
// 문제가 없고 점수도 괜찮으면 null(말하지 않음). 숫자는 소리로 읽기 쉽게 우리말로 쓴다(1번째 → 첫 번째).
const ORDINAL = ['첫', '두', '세', '네', '다섯', '여섯'];
const nthSpoken = (i) => `${ORDINAL[i] || i + 1} 번째 획`;
const SPEAK_FIRST = ['WRONG_CHAR', 'STROKES_JOINED', 'STROKE_SPLIT', 'ALT_FORM', 'MISSING_STROKE', 'EXTRA_STROKE',
  'WRONG_ORDER', 'WRONG_DIRECTION', 'OVERSHOOT', 'GAP', 'SHAPE', 'TOO_SMALL', 'TOO_BIG', 'OFF_CENTER'];
export const SPEAK_BELOW = 70; // 문제 코드가 없어도 이 점수보다 낮으면 말해 준다

export function speechKo(result) {
  const it = SPEAK_FIRST.map((c) => result.issues.find((i) => i.code === c)).find(Boolean);
  const name = getTemplate(result.char).name;
  const n = getTemplate(result.char).strokes.length;
  if (!it) return result.issues.some((i) => i.code === 'EMPTY') ? '칸 안에 글자를 써 봐요.'
    : result.score < SPEAK_BELOW ? '안내선을 보고 다시 써 봐요.' : null;
  switch (it.code) {
    case 'WRONG_CHAR': return `다른 글자처럼 보여요. ${name}을 다시 써 봐요.`;
    case 'STROKES_JOINED': return '이어 쓰지 말고, 획을 나눠서 써요.';
    case 'STROKE_SPLIT': return '끊지 말고 이어서 쓰세요.';
    case 'ALT_FORM': return `${name}은 ${KOR_COUNT[n] || n} 획으로 써요.`;
    case 'MISSING_STROKE': return '빠진 획이 있어요.';
    case 'EXTRA_STROKE': return '획을 더 그었어요.';
    case 'WRONG_ORDER': return '획순이 달라요. 시범을 보고 따라 써요.';
    case 'WRONG_DIRECTION': return `${nthSpoken(it.strokes[0])}을 반대로 그었어요.`;
    case 'OVERSHOOT': return `${nthSpoken(it.stroke)}이 넘어갔어요. 닿는 곳에서 멈춰요.`;
    case 'GAP': return `${nthSpoken(it.stroke)}이 닿지 않았어요.`;
    case 'SHAPE': return `${nthSpoken(it.stroke)} 모양을 안내선에 맞춰요.`;
    case 'TOO_SMALL': return '조금 더 크게 써요.';
    case 'TOO_BIG': return '조금 더 작게 써요.';
    case 'OFF_CENTER': return '칸 가운데에 써요.';
  }
  return null;
}

// ㄱ/ㄴ 받침 여부로 조사를 고르는 대신 위처럼 '은(는)'을 썼다. 앱에서 조사 처리가 필요하면 여기서 바꾼다.
