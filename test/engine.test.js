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

test('자음 14자, 모음 21자가 모두 있다', () => {
  assert.equal(listChars('consonant').length, 14);
  assert.equal(listChars('vowel').length, 21);
  assert.equal(listChars().length, 35);
});

test('모음 획은 가로는 왼→오, 세로는 위→아래', async () => {
  const { VOWELS } = await import('../src/strokes-vowels.js');
  for (const [ch, def] of Object.entries(VOWELS)) for (const s of def.strokes) {
    const [[x1, y1], [x2, y2]] = s.points;
    if (s.type === '가로') assert.ok(x2 > x1 && y1 === y2, `${ch} 가로`);
    else assert.ok(y2 > y1 && x1 === x2, `${ch} 세로`);
  }
});

test('모음 획순: ㅏ는 ㅣ 먼저, ㅓ는 가로 먼저, ㅘ는 ㅗ 다 쓰고 ㅏ', () => {
  const types = (ch) => getTemplate(ch).strokes.map((s) => s.type).join(',');
  assert.equal(types('ㅏ'), '세로,가로');
  assert.equal(types('ㅓ'), '가로,세로');
  assert.equal(types('ㅘ'), '세로,가로,세로,가로');
  assert.equal(types('ㅝ'), '가로,세로,가로,세로');
});

test('바르게 쓴 자음·모음은 모두 90점 이상', () => {
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

// 점 p가 꺾은선 위에 있는지(거리)
const distToLine = (p, line) => Math.min(...line.slice(1).map((b, i) => {
  const a = line[i], dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}));

test('ㅅ·ㅈ·ㅊ 둘째 내림획은 앞 삐침 위에서 시작한다', async () => {
  const { CONSONANTS } = await import('../src/strokes-consonants.js');
  for (const [ch, from, to] of [['ㅅ', 0, 1], ['ㅈ', 0, 1], ['ㅊ', 1, 2]]) {
    const s = CONSONANTS[ch].strokes;
    const d = distToLine(s[to].points[0], s[from].points);
    assert.ok(d < 0.02, `${ch}: ${d}`);
  }
});

test('ㅎ 꼭지는 짧은 세로·짧은 가로 모두 정답', () => {
  const s = perfect('ㅎ');
  const flat = jitter([{ x: 0.4, y: 0.24 }, { x: 0.45, y: 0.24 }, { x: 0.5, y: 0.24 }, { x: 0.55, y: 0.24 }, { x: 0.6, y: 0.24 }]);
  const r = evaluate('ㅎ', [flat, s[1], s[2]]);
  assert.ok(r.score >= 90, `${r.score} ${r.issues.map((i) => i.code)}`);
  assert.equal(r.strokes[0].reversed, false);
});

// 교사 검수(11/19) 결과를 지키는지
test('검수 반영: ㅌ 획순, ㅊ·ㅎ 꼭지 간격, ㅅ 기울기·대칭', async () => {
  const { CONSONANTS: C } = await import('../src/strokes-consonants.js');
  assert.deepEqual(C['ㅌ'].strokes.map((s) => s.type), ['가로', '꺾임', '가로']);
  assert.ok(C['ㅌ'].strokes[0].points[0][1] < C['ㅌ'].strokes[2].points[0][1], 'ㅌ 1획은 위 가로');
  for (const ch of ['ㅊ', 'ㅎ']) {
    const s = C[ch].strokes;
    const gap = s[1].points[0][1] - s[0].points[1][1];
    assert.ok(gap > 0 && gap <= 0.03, `${ch} 꼭지 간격 ${gap}`);
  }
  const [a, b] = C['ㅅ'].strokes.map((s) => s.points);
  const angle = (Math.atan2(a[1][1] - a[0][1], a[0][0] - a[1][0]) * 180) / Math.PI;
  assert.ok(angle > 57 && angle < 61, `ㅅ 1획 각도 ${angle}`);
  const lowerLeft = Math.hypot(b[0][0] - a[1][0], b[0][1] - a[1][1]);
  const right = Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]);
  assert.ok(Math.abs(lowerLeft - right) < 0.01, `ㅅ 대칭 ${lowerLeft} ${right}`);
});

test('다른 글자를 쓰면 WRONG_CHAR, F', () => {
  for (const [target, written] of [['ㅏ', 'ㅓ'], ['ㅗ', 'ㅜ'], ['ㅐ', 'ㅔ'], ['ㄱ', 'ㄴ']]) {
    const r = evaluate(target, perfect(written));
    const it = r.issues.find((i) => i.code === 'WRONG_CHAR');
    assert.ok(it, `${target}←${written}: ${r.issues.map((i) => i.code)}`);
    assert.equal(it.looksLike, written);
    assert.equal(r.grade, 'F');
  }
});

test('엉성해도 맞는 글자는 WRONG_CHAR가 아니다', () => {
  for (const ch of listChars()) {
    const r = evaluate(ch, perfect(ch).map((s) => jitter(s, 0.04)));
    assert.ok(!codes(r).includes('WRONG_CHAR'), `${ch}: ${r.issues[0]?.looksLike}`);
  }
});

// 교사 체감 점수 표본(test/samples/*.json): 표본 하나짜리 파일과 연습 화면에서 내려받은 묶음 파일 모두 읽는다.
// 기준: 평균 차이 8점 이하, 하나하나는 15점 이하
test('교사 채점 표본과 점수가 맞는다', async () => {
  const fs = await import('node:fs');
  const dir = new URL('./samples/', import.meta.url);
  const all = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
    for (const [k, s] of (data.samples || [data]).entries()) all.push({ id: `${f}#${k}`, ...s });
  }
  const diffs = all.map((s) => {
    const r = evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device || 'finger' });
    return { id: s.id, char: s.char, engine: r.score, teacher: s.teacherScore, d: r.score - s.teacherScore };
  });
  const mae = diffs.reduce((a, x) => a + Math.abs(x.d), 0) / diffs.length;
  const bad = diffs.filter((x) => Math.abs(x.d) > 15).map((x) => `${x.id} ${x.char}: 엔진 ${x.engine} / 교사 ${x.teacher}`);
  assert.ok(mae <= 8, `표본 ${diffs.length}개 평균 차이 ${mae.toFixed(1)}점`);
  assert.deepEqual(bad, [], '15점 넘게 어긋난 표본');
});

test('피드백 문구가 나온다', () => {
  const s = perfect('ㄷ');
  const msgs = feedbackKo(evaluate('ㄷ', [s[1], s[0]]));
  assert.ok(msgs.some((m) => m.includes('순서')));
});
