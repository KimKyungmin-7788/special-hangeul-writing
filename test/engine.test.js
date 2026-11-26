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
  assert.equal(listChars('syllable').join(''), '가나다라마바사아자차카타파하');
  assert.equal(listChars().length, 49);
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

// 교사 표본에서 펜을 더 엄격하게 볼 근거가 없어 펜 = 손가락으로 맞췄다(2026-11-19)
test('전자칠판이 손가락보다 너그럽고, 펜과 손가락은 같다', () => {
  const s = perfect('ㅅ').map((st) => jitter(st, 0.05));
  const finger = evaluate('ㅅ', s, { device: 'finger' }).score;
  assert.ok(evaluate('ㅅ', s, { device: 'board' }).score > finger);
  assert.equal(evaluate('ㅅ', s, { device: 'pen' }).score, finger);
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
// 교사가 '판정 기준과 다름'으로 확인한 표본(disputed에 사유)은 지우지 않고 남기되 이 검사에서는 뺀다
test('교사 채점 표본과 점수가 맞는다', async () => {
  const fs = await import('node:fs');
  const dir = new URL('./samples/', import.meta.url);
  const all = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
    for (const [k, s] of (data.samples || [data]).entries()) if (!s.disputed) all.push({ id: `${f}#${k}`, ...s });
  }
  const diffs = all.map((s) => {
    const r = evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device || 'finger', motorSupport: !!s.motorSupport });
    return { id: s.id, char: s.char, engine: r.score, teacher: s.teacherScore, d: r.score - s.teacherScore };
  });
  const mae = diffs.reduce((a, x) => a + Math.abs(x.d), 0) / diffs.length;
  const bad = diffs.filter((x) => Math.abs(x.d) > 15).map((x) => `${x.id} ${x.char}: 엔진 ${x.engine} / 교사 ${x.teacher}`);
  assert.ok(mae <= 8, `표본 ${diffs.length}개 평균 차이 ${mae.toFixed(1)}점`);
  assert.deepEqual(bad, [], '15점 넘게 어긋난 표본');
});

test('한 붓에 이어 쓰면 STROKES_JOINED, 이은 횟수만큼 감점, 다른 글자로 보지 않음', () => {
  const T = (c) => getTemplate(c).strokes.map((s) => s.points);
  const m = T('ㅁ'), d = T('ㄷ');
  // ㅁ 3획을 1획으로(2번 이음) → 최고 40, ㄷ 2획을 1획으로(1번 이음) → 최고 60
  for (const [ch, st, cap] of [['ㅁ', [...m[0], ...m[2], ...[...m[1]].reverse()], 40], ['ㄷ', [...[...d[1]].reverse(), ...d[0]], 60]]) {
    const r = evaluate(ch, [jitter(st)]);
    assert.equal(r.issues[0].code, 'STROKES_JOINED', `${ch}: ${codes(r)}`);
    assert.ok(!codes(r).includes('WRONG_CHAR'), ch);
    assert.ok(r.score <= cap && r.score >= cap - 5, `${ch}: ${r.score}`);
    assert.equal(feedbackKo(r)[0], '한 번에 이어서 쓰지 말고, 순서에 맞게 나눠서 쓰세요.');
  }
});

test('한 획을 나눠 쓰면 STROKE_SPLIT, 최고 72점', () => {
  const g = getTemplate('ㄱ').strokes[0].points;
  const r = evaluate('ㄱ', [jitter(g.slice(0, 16)), jitter(g.slice(15))]);
  assert.equal(r.issues[0].code, 'STROKE_SPLIT', codes(r).join());
  assert.ok(!codes(r).includes('WRONG_CHAR'));
  assert.ok(r.score <= 72 && r.score >= 65, `${r.score}`);
  assert.equal(feedbackKo(r)[0], '두 번에 나눠 쓰지 말고 한 번에 써야 해요.');
});

test('바르게(조금 엉성하게) 쓴 글자는 이어 쓰기·나눠 쓰기로 보지 않는다', async () => {
  for (const ch of listChars()) for (const a of [0.012, 0.04]) {
    const r = evaluate(ch, perfect(ch).map((s) => jitter(s, a)));
    assert.ok(!codes(r).some((c) => c === 'STROKES_JOINED' || c === 'STROKE_SPLIT'), `${ch}(${a}): ${codes(r)}`);
  }
  // 교사 표본에는 일부러 이어·나눠 쓴 글씨도 있으므로, 획 수를 맞게 쓴 표본만 검사한다(실수로 찍힌 점은 빼고 셈)
  const fs = await import('node:fs');
  const dir = new URL('./samples/', import.meta.url);
  const len = (st) => st.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - st[i][0], p[1] - st[i][1]), 0);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
    for (const s of data.samples || [data]) {
      if (s.strokes.filter((st) => len(st) >= 0.02).length !== getTemplate(s.char).strokes.length) continue;
      const r = evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device || 'finger', motorSupport: !!s.motorSupport });
      assert.ok(!codes(r).some((c) => c === 'STROKES_JOINED' || c === 'STROKE_SPLIT'), `${f} ${s.char}: ${codes(r)}`);
    }
  }
});

test('획이 접점을 넘어가면 OVERSHOOT, 크게 감점', () => {
  // ㅔ: 짧은 가로가 첫 세로를 뚫고 둘째 세로까지 감
  const e = perfect('ㅔ');
  e[0] = jitter([{ x: 0.27, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.73, y: 0.5 }]);
  const r = evaluate('ㅔ', e);
  const it = r.issues.find((i) => i.code === 'OVERSHOOT');
  assert.ok(it, codes(r).join());
  assert.equal(it.stroke, 0);
  assert.equal(it.into, 1);
  assert.ok(r.score <= 45, `${r.score}`);
  assert.equal(feedbackKo(r)[0], '1번째 획이 2번째 획을 넘어갔어요. 닿는 곳에서 멈춰요.');
  // ㅛ: 세로가 가로획 아래로 뚫고 내려감
  const y = perfect('ㅛ');
  y[1] = jitter([{ x: 0.62, y: 0.32 }, { x: 0.62, y: 0.58 }, { x: 0.62, y: 0.75 }]);
  assert.ok(codes(evaluate('ㅛ', y)).includes('OVERSHOOT'));
});

test('바르게(조금 엉성하게) 쓴 글자는 OVERSHOOT로 보지 않는다', () => {
  for (const ch of listChars()) for (const a of [0.012, 0.03]) {
    const r = evaluate(ch, perfect(ch).map((s) => jitter(s, a)));
    assert.ok(!codes(r).includes('OVERSHOOT'), `${ch}(${a}): ${JSON.stringify(r.issues)}`);
  }
});

test('실수로 찍힌 점은 무시하고, 꺾이는 곳에서 이어 쓴 ㄱ은 나눠 쓰기로 본다', () => {
  const g = getTemplate('ㄱ').strokes[0].points;
  const dot = [{ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 }];
  assert.ok(evaluate('ㄱ', [jitter(g), dot]).score >= 90, '점 하나가 더 있어도 바른 ㄱ');
  // 가로를 긋고 펜을 뗐다가 꺾이는 곳에서 바로 이어 내림(끝·시작 간격 0.03)
  const h = g.slice(0, 16), v = g.slice(15).map((p, i) => (i === 0 ? { x: p.x + 0.02, y: p.y + 0.02 } : p));
  const r = evaluate('ㄱ', [jitter(h), jitter(v)]);
  assert.equal(r.issues[0].code, 'STROKE_SPLIT', codes(r).join());
});

test('ㅈ을 ㅡ+ㅅ 3획으로 쓰면 ALT_FORM, 최고 65점, 바른 획 수 안내', () => {
  const st = [[[0.15, 0.22], [0.85, 0.22]], [[0.52, 0.22], [0.2, 0.85]], [[0.42, 0.5], [0.82, 0.85]]]
    .map(([a, b]) => jitter(Array.from({ length: 12 }, (_, i) => ({ x: a[0] + (b[0] - a[0]) * i / 11, y: a[1] + (b[1] - a[1]) * i / 11 }))));
  const r = evaluate('ㅈ', st);
  assert.equal(r.issues[0].code, 'ALT_FORM', codes(r).join());
  assert.ok(r.score <= 65 && r.score >= 55, `${r.score}`);
  assert.equal(feedbackKo(r)[0], "ㅈ은(는) 2획으로 써요. '획순 보기'로 순서를 확인해 봐요.");
});

test('닿아야 할 획에서 멀리 떨어지면 GAP', () => {
  const s = perfect('ㅈ');
  s[1] = jitter([{ x: 0.7, y: 0.52 }, { x: 0.85, y: 0.7 }, { x: 0.95, y: 0.85 }]);
  assert.ok(codes(evaluate('ㅈ', s)).includes('GAP'));
});

test('피드백 문구가 나온다', () => {
  const s = perfect('ㄷ');
  const msgs = feedbackKo(evaluate('ㄷ', [s[1], s[0]]));
  assert.ok(msgs.some((m) => m.includes('순서')));
});

test('측정값(measures)은 모든 글자에서 같은 열을 유한한 숫자로 낸다', () => {
  const keys = Object.keys(evaluate('ㄱ', []).measures);
  for (const ch of listChars()) for (const st of [perfect(ch), perfect(ch).map((s) => jitter(s, 0.04)), []]) {
    const m = evaluate(ch, st).measures;
    assert.deepEqual(Object.keys(m), keys, ch);
    for (const [k, v] of Object.entries(m)) assert.ok(Number.isFinite(v), `${ch} ${k}=${v}`);
  }
});

// 교사가 표본에 고른 평가 항목(teacherIssues, src/labels.js)과 엔진이 찾은 문제를 같은 항목으로 바꿔 견준다.
// 아직 표본이 적어 실패로 보지 않고 숫자만 알린다.
test('교사가 고른 항목과 엔진 항목 비교 (보고만)', async (t) => {
  const fs = await import('node:fs');
  const { migrateLabels, labelCodes, engineToLabels } = await import('../src/labels.js');
  const dir = new URL('./samples/', import.meta.url);
  let labeled = 0, picked = 0, found = 0, extra = 0;
  const missed = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
    for (const s of data.samples || [data]) {
      const mine = migrateLabels(s.teacherIssues);
      if (!mine || s.disputed || mine.includes('EXCLUDE')) continue;
      const want = labelCodes(mine);
      const got = labelCodes(engineToLabels(evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device || 'finger', motorSupport: !!s.motorSupport }).issues));
      labeled++; picked += want.length;
      for (const c of want) if (got.includes(c)) found++; else missed[c] = (missed[c] || 0) + 1;
      extra += got.filter((c) => !want.includes(c)).length;
    }
  }
  t.diagnostic(labeled
    ? `항목 표시 표본 ${labeled}개: 교사가 고른 항목 ${picked}개 중 엔진이 찾음 ${found}개, 엔진만 짚음 ${extra}개, 놓친 항목 ${JSON.stringify(missed)}`
    : '항목 표시가 있는 표본이 아직 없음');
});

test('소리 피드백은 가장 중요한 문제 하나를 짧게, 문제 없고 점수 좋으면 말하지 않음', async () => {
  const { speechKo } = await import('../src/feedback-ko.js');
  assert.equal(speechKo(evaluate('ㄱ', perfect('ㄱ'))), null);
  const g = getTemplate('ㄱ').strokes[0].points;
  assert.equal(speechKo(evaluate('ㄱ', [jitter(g.slice(0, 16)), jitter(g.slice(15))])), '끊지 말고 이어서 쓰세요.');
  const e = perfect('ㅔ');
  e[0] = jitter([{ x: 0.27, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.73, y: 0.5 }]);
  assert.equal(speechKo(evaluate('ㅔ', e)), '첫 번째 획이 넘어갔어요. 닿는 곳에서 멈춰요.');
  assert.equal(speechKo(evaluate('ㄱ', [])), '칸 안에 글자를 써 봐요.');
  // 문제 코드마다 한 문장(40자 이내)
  for (const ch of listChars()) for (const st of [perfect(ch).reverse(), perfect(ch).map((s) => [...s].reverse()), perfect(ch).slice(1)]) {
    const r = evaluate(ch, st);
    const line = speechKo(r);
    if (r.issues.length) assert.ok(line && line.length <= 40, `${ch} ${r.issues.map((i) => i.code)}: ${line}`);
  }
});

test('점수 풀이: 상한이 점수를 정하면 그 문제를, 겹친 문제는 추가 감점 없음으로 알려 준다', async () => {
  const { explainScore } = await import('../src/engine.js');
  const { explainKo } = await import('../src/feedback-ko.js');
  const e = perfect('ㅔ');
  e[0] = jitter([{ x: 0.27, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.73, y: 0.5 }]);
  const r = evaluate('ㅔ', e);
  const ex = explainScore(r);
  assert.equal(ex.binding.code, 'OVERSHOOT');
  assert.equal(ex.binding.cap, r.score);
  assert.match(explainKo(r)[0].text, /넘어감 → 최고 \d+/);
  // 문제 없이 바르게 쓰면 '감점 없음' 또는 작은 감점만
  const ok = explainKo(evaluate('ㄱ', perfect('ㄱ')));
  assert.ok(ok.every((k) => k.kind !== 'cap'));
  // 모든 글자에서 풀이가 점수와 맞는다: 상한이 있으면 점수 = 상한, 없으면 점수 = 항목 합
  for (const ch of listChars()) for (const st of [perfect(ch), perfect(ch).map((s) => jitter(s, 0.05)), perfect(ch).reverse()]) {
    const rr = evaluate(ch, st), x = explainScore(rr);
    assert.equal(rr.score, x.binding ? x.binding.cap : Math.min(x.fromParts, x.caps[0]?.cap ?? 100), `${ch} ${rr.score} ${JSON.stringify(x)}`);
  }
});

// 채점실에서 제출되어 반영된 표본(test/server-samples). 엔진을 고치기 전까지는 실패로 보지 않고 정확도만 알린다.
test('채점실 표본과 엔진 차이 (보고만)', async (t) => {
  const fs = await import('node:fs');
  const f = new URL('./server-samples/labeled.json', import.meta.url);
  if (!fs.existsSync(f)) { t.diagnostic('채점실 표본이 아직 없음'); return; }
  const ss = JSON.parse(fs.readFileSync(f, 'utf8')).samples;
  const d = ss.map((s) => evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device || 'finger', motorSupport: !!s.motorSupport }).score - s.teacherScore);
  const mae = d.reduce((a, v) => a + Math.abs(v), 0) / (d.length || 1);
  t.diagnostic(`채점실 표본 ${ss.length}개: 평균 차이 ${mae.toFixed(1)}점, 15점 넘게 어긋남 ${d.filter((v) => Math.abs(v) > 15).length}개`);
});

test('운동 지원: 운동 조절 문제(끊어 씀·넘어감)는 너그럽게, 배워야 할 오류(획순·다른 글자)는 그대로', async () => {
  const { ISSUE_KIND } = await import('../src/engine.js');
  const g = getTemplate('ㄱ').strokes[0].points;
  const split = [jitter(g.slice(0, 16)), jitter(g.slice(15))];
  const a = evaluate('ㄱ', split), b = evaluate('ㄱ', split, { motorSupport: true });
  assert.equal(a.issues[0].kind, 'motor');
  assert.ok(b.score > a.score && b.score <= 88, `${a.score} → ${b.score}`);
  assert.equal(b.motorSupport, true);
  const order = perfect('ㅏ').reverse();
  assert.equal(evaluate('ㅏ', order).score, evaluate('ㅏ', order, { motorSupport: true }).score);
  for (const c of ['WRONG_CHAR', 'WRONG_ORDER', 'WRONG_DIRECTION', 'MISSING_STROKE']) assert.equal(ISSUE_KIND[c], 'error');
  // 바르게 쓴 글자는 운동 지원과 상관없이 높다
  for (const ch of listChars()) assert.ok(evaluate(ch, perfect(ch), { motorSupport: true }).score >= 90, ch);
});

test('가나다: 자음을 먼저 다 쓰고 ㅏ, ㅏ를 먼저 쓰면 획순, 자음만 쓰면 획 빠짐', () => {
  const ga = getTemplate('가');
  assert.deepEqual(ga.parts, ['ㄱ', 'ㅏ']);
  assert.equal(ga.strokes.length, 3);
  const p = perfect('가');
  assert.ok(evaluate('가', p).score >= 90);
  assert.ok(codes(evaluate('가', [p[1], p[2], p[0]])).includes('WRONG_ORDER'));
  assert.ok(codes(evaluate('가', [p[0]])).includes('MISSING_STROKE'));
  // 낱자 ㄱ을 '가'로 판정하지 않는다(낱자는 낱자끼리 견줌)
  assert.ok(!codes(evaluate('ㄱ', perfect('ㄱ'))).includes('WRONG_CHAR'));
});

// 평가 항목(src/labels.js)
test('평가 항목: 엔진 코드 변환·예전 표시 옮기기·먼저 말할 항목', async () => {
  const { engineToLabels, migrateLabels, migrateFeedback, primaryLabel, labelCodes, LABELS } = await import('../src/labels.js');
  const { rubricFor } = await import('../demo/rubric.js');
  assert.equal(LABELS.length, 11);
  assert.deepEqual(engineToLabels([{ code: 'MISSING_STROKE' }, { code: 'ALT_FORM' }, { code: 'TOO_BIG' }]), ['STROKE_COUNT', 'SIZE']);
  assert.deepEqual(migrateLabels(['START_POINT', 'SLANT', 'PRAISE', 'MISSING_STROKE', 'EXTRA_STROKE']), ['WRONG_DIRECTION', 'SHAPE.SLANT', 'STROKE_COUNT']);
  assert.equal(migrateLabels(null), null);
  assert.equal(migrateFeedback('PRAISE'), null);
  assert.equal(migrateFeedback('LENGTH'), 'SHAPE');
  assert.deepEqual(labelCodes(['OVERSHOOT!', 'SHAPE', 'SHAPE.SLANT']), ['OVERSHOOT', 'SHAPE']);
  assert.equal(primaryLabel(['SIZE', 'OVERSHOOT'], null), 'OVERSHOOT');
  assert.equal(primaryLabel(['SIZE', 'OVERSHOOT'], 'SIZE'), 'SIZE');
  assert.equal(rubricFor(['OVERSHOOT!', 'SIZE']).name, '넘어감 · 뚜렷');
  assert.equal(rubricFor(['OVERSHOOT']).name, '넘어감 · 살짝');
  assert.equal(rubricFor([]).code, 'NONE');
});

// 뭉갬 후보는 보고만: 점수에 영향이 없어야 한다(측정값만 남김)
test('뭉갬 후보: 측정값만 남기고 점수는 그대로', () => {
  const pts = (a) => a.map(([x, y]) => ({ x, y }));
  // ㅂ을 한 붓에 구불구불 그린 글씨
  const scribble = [pts([[0.3, 0.2], [0.3, 0.8], [0.7, 0.8], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.2], [0.7, 0.8], [0.3, 0.8], [0.7, 0.2]])];
  const r = evaluate('ㅂ', scribble, { device: 'finger' });
  assert.equal(typeof r.measures.mashCandidate, 'number');
  assert.ok(!r.caps?.some((c) => c.code === 'MASH'), '뭉갬 후보로 상한을 걸지 않음');
  const m = evaluate('ㅂ', scribble, { device: 'finger', motorSupport: true });
  assert.equal(m.measures.mashCandidate, 0, '운동 지원 학생은 후보로 보지 않음');
});

// 쓰기 준비 21종(src/prewrite.js): 모양이 활동지 안에 있고, 그대로 따라 그리면 어느 방향이든 별 3개
test('쓰기 준비: 21종 모양과 별', async () => {
  const { ITEMS, parsePath, observe, SHEET_W } = await import('../src/prewrite.js');
  assert.equal(ITEMS.length, 21);
  assert.deepEqual(ITEMS.map((i) => i.id), Array.from({ length: 21 }, (_, k) => String(k + 5).padStart(2, '0')));
  for (const it of ITEMS) {
    const S = parsePath(it.d);
    for (const p of S.flatMap((s) => s.pts)) assert.ok(p.x >= 0 && p.x <= SHEET_W && p.y >= 0 && p.y <= 1, `${it.id} 활동지 밖`);
    assert.equal(observe(it, S.map((s) => s.pts)).stars, 3, `${it.id} 정방향`);
    assert.equal(observe(it, S.map((s) => [...s.pts].reverse())).stars, 3, `${it.id} 반대 방향`);
    const moved = S.map((s) => s.pts.map((p) => ({ x: p.x * 0.6 + 0.3, y: p.y * 0.6 + 0.2 })));
    assert.equal(observe(it, moved, { tol: 0.11, align: true }).stars, 3, `${it.id} 보고 그리기(자리·크기 달라도)`);
    assert.ok(observe(it, []).stars === 0);
  }
  const circle = ITEMS.find((i) => i.id === '10'), half = parsePath(circle.d)[0].pts.slice(0, 12);
  assert.ok(observe(circle, [half]).stars < 3, '반만 그린 원은 별 3개가 아님');
});
