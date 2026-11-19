// 한글 쓰기 채점 엔진 (화면 없음, 순수 계산).
// 입력: 학생이 그은 획들 — [[{x,y}, ...], ...], 좌표는 쓰기 칸을 0~1로 본 비율.
// 출력: 점수(0~100)와 세부 항목, 문제 코드(issues). 문구·소리·화면은 앱이 정한다.

import { CONSONANTS } from './strokes-consonants.js';

const N = 32; // 획 하나를 다시 찍을 점 개수

// 기기별 허용 폭(칸 크기 대비 비율). 클수록 너그럽다.
export const PRESETS = {
  finger: { tolerance: 0.16 },
  pen: { tolerance: 0.1 },
  board: { tolerance: 0.2 },
};

// 항목별 배점(합 100)
const WEIGHTS = { order: 25, direction: 15, shape: 40, placement: 20 };
// 획순·방향이 틀리면 모양이 좋아도 이 점수를 넘지 못한다
// (획순 틀림 → 최고 C, 방향 틀림 → 최고 B)
const CAPS = { WRONG_ORDER: 69, WRONG_DIRECTION: 79 };

// ---------- 템플릿 ----------

const templates = {};
for (const [ch, def] of Object.entries(CONSONANTS)) {
  templates[ch] = {
    char: ch,
    name: def.name,
    strokes: def.strokes.map((s) => ({
      type: s.type,
      closed: !!s.circle,
      points: resample(s.circle ? circlePoints(...s.circle) : s.points.map(([x, y]) => ({ x, y }))),
      // 정답으로 함께 받아 줄 다른 모양(예: ㅎ 꼭지의 가로형)
      variants: (s.variants || []).map((v) => resample(v.map(([x, y]) => ({ x, y })))),
    })),
  };
}

export function listChars() { return Object.keys(templates); }
export function getTemplate(ch) { return templates[ch] || null; }

function circlePoints(cx, cy, r) {
  // 위에서 시작해 화면 기준 왼쪽(반시계)으로 한 바퀴
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = -Math.PI / 2 - (i / 64) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// ---------- 기하 도구 ----------

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
  return d;
}

// 길이를 같은 간격으로 나눠 n개 점으로 다시 찍는다.
function resample(pts, n = N) {
  if (pts.length === 0) return [];
  const total = pathLength(pts);
  if (total === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const step = total / (n - 1);
  const out = [{ ...pts[0] }];
  let acc = 0;
  const src = pts.map((p) => ({ ...p }));
  for (let i = 1; i < src.length; i++) {
    const d = dist(src[i - 1], src[i]);
    if (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: src[i - 1].x + t * (src[i].x - src[i - 1].x), y: src[i - 1].y + t * (src[i].y - src[i - 1].y) };
      out.push(q);
      src.splice(i, 0, q);
      acc = 0;
    } else {
      acc += d;
    }
  }
  while (out.length < n) out.push({ ...src[src.length - 1] });
  return out.slice(0, n);
}

function meanDist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += dist(a[i], b[i]);
  return s / a.length;
}

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function bbox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const p of s) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  // 가는 획(ㅡ, ㅣ)이 크기 비교를 망치지 않도록 최소 크기를 둔다
  const w = Math.max(maxX - minX, 0.2), h = Math.max(maxY - minY, 0.2);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w, h };
}

// 학생 획 하나와 템플릿 획 하나의 거리. 방향이 반대인지도 함께 돌려준다.
function compareStroke(user, tpl) {
  if (tpl.closed) {
    // 원: 시작 위치는 따지지 않고, 도는 방향만 본다
    const reversed = Math.sign(signedArea(user)) !== Math.sign(signedArea(tpl.points));
    const u = reversed ? [...user].reverse() : user;
    let best = Infinity;
    for (let s = 0; s < u.length; s++) {
      const shifted = u.slice(s).concat(u.slice(0, s));
      best = Math.min(best, meanDist(shifted, tpl.points));
    }
    return { d: best, reversed };
  }
  let best = null;
  for (const shape of [tpl.points, ...tpl.variants]) {
    const fwd = meanDist(user, shape);
    const rev = meanDist([...user].reverse(), shape);
    const c = fwd <= rev ? { d: fwd, reversed: false } : { d: rev, reversed: true };
    if (!best || c.d < best.d) best = c;
  }
  return best;
}

// 거리 → 0~1 점수. 거리가 허용 폭과 같으면 0.5.
const closeness = (d, tol) => 1 / (1 + (d / tol) ** 2);

// 템플릿 획마다 학생 획을 하나씩(또는 없음) 짝지어 점수 합이 가장 크게.
function assign(scores, nt, nu) {
  if (nt > 7) return greedyAssign(scores, nt, nu);
  let best = { sum: -1, pick: [] };
  const used = new Array(nu).fill(false);
  const pick = new Array(nt).fill(-1);
  (function rec(j, sum) {
    if (j === nt) { if (sum > best.sum) best = { sum, pick: [...pick] }; return; }
    for (let i = 0; i < nu; i++) {
      if (used[i]) continue;
      used[i] = true; pick[j] = i;
      rec(j + 1, sum + scores[j][i]);
      used[i] = false; pick[j] = -1;
    }
    rec(j + 1, sum);
  })(0, 0);
  return best.pick;
}

function greedyAssign(scores, nt, nu) {
  const pairs = [];
  for (let j = 0; j < nt; j++) for (let i = 0; i < nu; i++) pairs.push([scores[j][i], j, i]);
  pairs.sort((a, b) => b[0] - a[0]);
  const pick = new Array(nt).fill(-1), usedU = new Set();
  for (const [, j, i] of pairs) if (pick[j] === -1 && !usedU.has(i)) { pick[j] = i; usedU.add(i); }
  return pick;
}

// 가장 긴 증가 부분수열에 들어가는 위치 표시(획순이 맞은 획)
function lisMask(seq) {
  const n = seq.length, len = new Array(n).fill(1), prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) for (let k = 0; k < i; k++)
    if (seq[k] < seq[i] && len[k] + 1 > len[i]) { len[i] = len[k] + 1; prev[i] = k; }
  let end = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[end]) end = i;
  const mask = new Array(n).fill(false);
  for (let i = n ? end : -1; i !== -1; i = prev[i]) mask[i] = true;
  return mask;
}

function toleranceOf(opts = {}) {
  return opts.tolerance ?? PRESETS[opts.device || 'finger'].tolerance;
}

function prepare(strokes) {
  return strokes
    .filter((s) => s && s.length > 0)
    .map((s) => resample(s.map((p) => ({ x: p.x, y: p.y }))));
}

// ---------- 공개 API ----------

/**
 * 한 글자를 다 쓴 뒤 채점한다.
 * @param {string} char 예: 'ㄷ'
 * @param {Array<Array<{x:number,y:number}>>} userStrokes 칸 기준 0~1 좌표
 * @param {{device?:'finger'|'pen'|'board', tolerance?:number}} [opts]
 */
export function evaluate(char, userStrokes, opts = {}) {
  const tpl = templates[char];
  if (!tpl) throw new Error(`획 데이터가 없는 글자: ${char}`);
  const tol = toleranceOf(opts);
  const tStrokes = tpl.strokes;
  const nt = tStrokes.length;
  const user = prepare(userStrokes);
  const nu = user.length;

  if (nu === 0) {
    return { char, score: 0, grade: 'F', stars: 0,
      parts: { order: 0, direction: 0, shape: 0, placement: 0 },
      strokes: tStrokes.map((s, j) => ({ index: j, type: s.type, matched: -1 })),
      extraStrokes: 0, issues: [{ code: 'EMPTY' }] };
  }

  // 1) 자리·크기: 글자 전체 테두리 상자 비교
  const tb = bbox(tStrokes.map((s) => s.points));
  const ub = bbox(user);
  const offset = Math.hypot(ub.cx - tb.cx, ub.cy - tb.cy);
  const size = Math.sqrt((ub.w * ub.h) / (tb.w * tb.h));
  const placement = clamp01(1 - offset / (tol * 2)) * clamp01(1 - Math.abs(Math.log(size)) / Math.log(1.5 + tol * 3));

  // 2) 모양: 학생 글자를 안내 글자 자리·크기에 맞춘 뒤 획끼리 비교
  const k = 1 / size;
  const aligned = user.map((s) => s.map((p) => ({ x: (p.x - ub.cx) * k + tb.cx, y: (p.y - ub.cy) * k + tb.cy })));
  const cmp = tStrokes.map((t) => aligned.map((u) => compareStroke(u, t)));
  const scores = cmp.map((row) => row.map((c) => closeness(c.d, tol)));
  const pick = assign(scores, nt, nu);

  const strokes = tStrokes.map((t, j) => {
    const i = pick[j];
    return i === -1
      ? { index: j, type: t.type, matched: -1, shape: 0 }
      : { index: j, type: t.type, matched: i, shape: scores[j][i], reversed: cmp[j][i].reversed };
  });
  const matched = strokes.filter((s) => s.matched !== -1);
  const extra = nu - matched.length;
  const shape = (strokes.reduce((a, s) => a + s.shape, 0) / nt) * (nt / (nt + extra));

  // 3) 획순: 학생이 그은 순서대로 늘어놓았을 때 템플릿 번호가 얼마나 차례대로인가
  const byUserOrder = [...matched].sort((a, b) => a.matched - b.matched);
  const mask = lisMask(byUserOrder.map((s) => s.index));
  byUserOrder.forEach((s, n) => { s.inOrder = mask[n]; });
  const order = matched.length ? mask.filter(Boolean).length / nt : 0;

  // 4) 방향
  const direction = matched.length ? matched.filter((s) => !s.reversed).length / nt : 0;

  const parts = { order, direction, shape, placement };
  let score = Math.round(Object.entries(WEIGHTS).reduce((a, [key, w]) => a + w * parts[key], 0));

  // 문제 코드
  const issues = [];
  const missing = nt - matched.length;
  if (missing > 0) issues.push({ code: 'MISSING_STROKE', count: missing, expected: nt });
  if (extra > 0) issues.push({ code: 'EXTRA_STROKE', count: extra, expected: nt });
  const outOfOrder = matched.filter((s) => !s.inOrder).map((s) => s.index);
  if (outOfOrder.length) issues.push({ code: 'WRONG_ORDER', strokes: outOfOrder });
  const reversed = matched.filter((s) => s.reversed).map((s) => s.index);
  if (reversed.length) issues.push({ code: 'WRONG_DIRECTION', strokes: reversed });
  if (size < 0.75) issues.push({ code: 'TOO_SMALL', ratio: size });
  if (size > 1.3) issues.push({ code: 'TOO_BIG', ratio: size });
  if (offset > tol) issues.push({ code: 'OFF_CENTER', dx: ub.cx - tb.cx, dy: ub.cy - tb.cy });
  const worst = matched.reduce((w, s) => (!w || s.shape < w.shape ? s : w), null);
  if (worst && worst.shape < 0.6) issues.push({ code: 'SHAPE', stroke: worst.index });

  for (const it of issues) if (CAPS[it.code] !== undefined) score = Math.min(score, CAPS[it.code]);

  return { char, score, grade: gradeOf(score), stars: starsOf(score), parts, strokes, extraStrokes: extra, issues };
}

/**
 * 획 하나를 그을 때마다 바로 확인한다(획순 지키기 모드).
 * 학생 획이 expectedIndex번 획인지, 다른 획에 더 가까운지(=순서 틀림), 방향이 반대인지 알려 준다.
 * 칸 안의 실제 자리로 비교하므로 안내선을 보여 주는 화면에서 쓴다.
 */
export function checkStroke(char, expectedIndex, userStroke, opts = {}) {
  const tpl = templates[char];
  if (!tpl) throw new Error(`획 데이터가 없는 글자: ${char}`);
  const tol = toleranceOf(opts) * 1.5;
  const [u] = prepare([userStroke]);
  const results = tpl.strokes.map((t) => {
    const c = compareStroke(u, t);
    return { score: closeness(c.d, tol), reversed: c.reversed };
  });
  let best = 0;
  results.forEach((r, j) => { if (r.score > results[best].score) best = j; });
  const exp = results[expectedIndex];
  const wrongOrder = best !== expectedIndex && results[best].score > 0.5 && results[best].score > exp.score + 0.1;
  const wrongDirection = !wrongOrder && exp.reversed && exp.score > 0.4;
  return {
    ok: !wrongOrder && !wrongDirection,
    wrongOrder, wrongDirection,
    bestIndex: best,
    score: exp.score,
  };
}

export function gradeOf(score) {
  return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'F';
}
export function starsOf(score) {
  return score >= 90 ? 3 : score >= 75 ? 2 : score >= 60 ? 1 : 0;
}
