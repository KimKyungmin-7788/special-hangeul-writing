// 채점 결과(issues)를 학생에게 보여 줄 한국어 문장으로 바꾼다.
// 앱마다 말투를 바꾸고 싶으면 이 파일만 바꾸면 된다.

import { getTemplate } from './engine.js';

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

// ㄱ/ㄴ 받침 여부로 조사를 고르는 대신 위처럼 '은(는)'을 썼다. 앱에서 조사 처리가 필요하면 여기서 바꾼다.
