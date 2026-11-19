// 골든 테스트: 템플릿에서 만든 '정답 글씨'와 일부러 틀린 글씨로 채점이 의도대로 나오는지 확인한다.
// 실행: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, checkStroke, listChars, getTemplate } from '../src/engine.js';
import { feedbackKo } from '../src/feedback-ko.js';

// 결정적 흔들림(난수 대신)
const jitter = (s, amt = 0.012) => s.map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * amt, y: p.y + Math.cos(i * 2.3) * amt }));
const perfect = (ch) => getTemplate(ch).strokes.map((s) => jitter(s.points));
const codes = (r) => r.issues.map((i) => i.code);

test('자음 14자가 모두 있다', () => {
  assert.equal(listChars().length, 14);
});

test('바르게 쓴 자음은 모두 90점 이상', () => {
  for (const ch of listChars()) {
    const r = evaluate(ch, perfect(ch));
    assert.ok(r.score >= 90, `${ch}: ${r.score} ${JSON.stringify(r.parts)}`);
    assert.deepEqual(codes(r), [], `${ch}: ${codes(r)}`);
  }
});

test('획순을 바꾸면 WRONG_ORDER, 점수가 떨어진다', () => {
  const s = perfect('ㄷ');
  const r = evaluate('ㄷ', [s[1], s[0]]);
  assert.ok(codes(r).includes('WRONG_ORDER'));
  assert.ok(r.parts.order < 1);
  assert.ok(r.score < 70, `획순이 틀리면 C 이하여야 함: ${r.score}`);
});

test('획 방향을 거꾸로 그으면 WRONG_DIRECTION', () => {
  const s = perfect('ㅂ');
  s[2] = [...s[2]].reverse();
  const r = evaluate('ㅂ', s);
  assert.deepEqual(r.issues.find((i) => i.code === 'WRONG_DIRECTION').strokes, [2]);
});

test('ㅇ을 시계 방향으로 돌리면 WRONG_DIRECTION, 아래에서 시작해도 반시계면 통과', () => {
  const s = perfect('ㅇ')[0];
  assert.ok(codes(evaluate('ㅇ', [[...s].reverse()])).includes('WRONG_DIRECTION'));
  const fromBottom = s.slice(16).concat(s.slice(0, 16));
  const r = evaluate('ㅇ', [fromBottom]);
  assert.ok(r.score >= 85, `${r.score}`);
});

test('획이 빠지면 MISSING_STROKE, 더 그으면 EXTRA_STROKE', () => {
  const s = perfect('ㅁ');
  assert.ok(codes(evaluate('ㅁ', s.slice(0, 2))).includes('MISSING_STROKE'));
  assert.ok(codes(evaluate('ㅁ', [...s, s[0]])).includes('EXTRA_STROKE'));
});

test('작게 쓰면 TOO_SMALL, 모양 점수는 유지', () => {
  const s = perfect('ㄱ').map((st) => st.map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.5, y: 0.5 + (p.y - 0.5) * 0.5 })));
  const r = evaluate('ㄱ', s);
  assert.ok(codes(r).includes('TOO_SMALL'));
  assert.ok(r.parts.shape > 0.9);
});

test('낙서는 40점 미만', () => {
  const scribble = [Array.from({ length: 40 }, (_, i) => ({ x: 0.5 + 0.3 * Math.sin(i), y: 0.2 + i / 60 }))];
  const r = evaluate('ㅂ', scribble);
  assert.ok(r.score < 40, `${r.score}`);
});

test('손가락이 펜보다 너그럽다', () => {
  const s = perfect('ㅅ').map((st) => jitter(st, 0.05));
  assert.ok(evaluate('ㅅ', s, { device: 'finger' }).score > evaluate('ㅅ', s, { device: 'pen' }).score);
});

test('checkStroke: 두 번째 획을 먼저 그으면 순서 틀림', () => {
  const s = perfect('ㄷ');
  const r = checkStroke('ㄷ', 0, s[1]);
  assert.equal(r.ok, false);
  assert.equal(r.wrongOrder, true);
  assert.equal(r.bestIndex, 1);
  assert.equal(checkStroke('ㄷ', 0, s[0]).ok, true);
  assert.equal(checkStroke('ㄷ', 0, [...s[0]].reverse()).wrongDirection, true);
});

test('피드백 문구가 나온다', () => {
  const s = perfect('ㄷ');
  const msgs = feedbackKo(evaluate('ㄷ', [s[1], s[0]]));
  assert.ok(msgs.some((m) => m.includes('순서')));
});
