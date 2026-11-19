// 한글 쓰기 채점 엔진 (화면 없음, 순수 계산).
// 입력: 학생이 그은 획들 — [[{x,y}, ...], ...], 좌표는 쓰기 칸을 0~1로 본 비율.
// 출력: 점수(0~100)와 세부 항목, 문제 코드(issues). 문구·소리·화면은 앱이 정한다.

import { CONSONANTS } from './strokes-consonants.js';
import { VOWELS } from './strokes-vowels.js';

const N = 32; // 획 하나를 다시 찍을 점 개수

// 기기별 허용 폭(칸 크기 대비 비율). 클수록 너그럽다.
export const PRESETS = {
  finger: { tolerance: 0.16 },
  // 교사 표본(펜 ㄴ 5개)에서 펜을 더 엄격하게 볼 근거가 없어 손가락과 같게 둔다(2026-11-19)
  pen: { tolerance: 0.16 },
  board: { tolerance: 0.2 },
};

// 항목별 배점(합 100). 획순·방향은 대부분 맞히므로 점수 상한(CAPS)으로 다루고,
// 눈에 보이는 글씨 모양에 배점을 몰아준다. 교사는 칸 안의 위치·크기는 거의 따지지 않았다.
// (교사 채점 표본 6개로 맞춤, 평균 차이 4.2점, 2026-11-19)
const WEIGHTS = { order: 10, direction: 5, shape: 75, placement: 10 };
// 모양 비교의 허용 폭 배율(1보다 작을수록 엄격)
const SHAPE_STRICTNESS = 0.8;
// 모양 비교 전에 가로·세로를 따로 늘려 맞추는 정도(0: 같은 비율로만, 1: 가로세로 비율 무시).
// 교사는 납작하거나 길쭉한 ㄴ도 모양이 바르면 높게 줬다.
const ASPECT_FIT = 0.8;
// 획순·방향이 틀리면 모양이 좋아도 이 점수를 넘지 못한다
// (다른 글자 → F, 획순 틀림 → 최고 C, 방향 틀림 → 최고 B)
const CAPS = { WRONG_CHAR: 39, WRONG_ORDER: 69, STROKES_JOINED: 69, STROKE_SPLIT: 69, WRONG_DIRECTION: 79 };
// 전체 모양(챔퍼 거리) 비교의 허용 폭 배율. 챔퍼 거리는 가장 가까운 점끼리 재서 값이 작게 나오므로 더 엄격하게 둔다
const INK_STRICTNESS = 0.5;
// 획이 템플릿 획을 '덮었다'고 볼 거리(허용 폭 대비)
const COVER_RADIUS = 0.6;
// 다른 글자의 모양 점수가 이만큼 더 높으면 '다른 글자를 썼다'고 본다
const WRONG_CHAR_MARGIN = 0.2;

// ---------- 템플릿 ----------

const templates = {};
const GROUPS = { consonant: CONSONANTS, vowel: VOWELS };
for (const [group, defs] of Object.entries(GROUPS)) for (const [ch, def] of Object.entries(defs)) {
  templates[ch] = {
    char: ch,
    name: def.name,
    group,
    strokes: def.strokes.map((s) => ({
      type: s.type,
      closed: !!s.circle,
      points: resample(s.circle ? circlePoints(...s.circle) : s.points.map(([x, y]) => ({ x, y }))),
      // 정답으로 함께 받아 줄 다른 모양(예: ㅎ 꼭지의 가로형)
      variants: (s.variants || []).map((v) => resample(v.map(([x, y]) => ({ x, y })))),
    })),
  };
}

/** @param {'consonant'|'vowel'} [group] 생략하면 전체 */
export function listChars(group) {
  return Object.keys(templates).filter((ch) => !group || templates[ch].group === group);
}
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
  const user = prepare(userStrokes);
  const result = scoreBest(tpl, user, tol);
  if (!user.length) return result;

  // 다른 글자 검사: 다른 글자의 전체 모양 점수가 확연히 높으면 글자를 잘못 쓴 것(예: ㅏ 자리에 ㅓ).
  // 획과 무관한 전체 모양으로 비교해야 이어 쓴 ㅁ을 'ㅇ'으로 오해하지 않는다.
  let look = null;
  for (const other of Object.values(templates)) {
    if (other.char === char) continue;
    const s = scoreBest(other, user, tol).inkShape;
    if (!look || s > look.shape) look = { char: other.char, shape: s };
  }
  if (look && look.shape >= result.inkShape + WRONG_CHAR_MARGIN) {
    result.issues.unshift({ code: 'WRONG_CHAR', looksLike: look.char });
    result.score = Math.min(result.score, CAPS.WRONG_CHAR);
    result.grade = gradeOf(result.score);
    result.stars = starsOf(result.score);
  }
  return result;
}

// 선을 일정 간격(칸의 2%)으로 촘촘히 다시 찍는다
function densify(pts) {
  return resample(pts, Math.max(2, Math.ceil(pathLength(pts) / 0.02) + 1));
}

// 두 점 묶음의 챔퍼 거리: 각 점에서 상대 묶음의 가장 가까운 점까지 거리의 평균(양쪽 평균)
function chamfer(a, b) {
  const near = (p, q) => q.reduce((m, r) => Math.min(m, dist(p, r)), Infinity);
  const ab = a.reduce((s, p) => s + near(p, b), 0) / a.length;
  const ba = b.reduce((s, p) => s + near(p, a), 0) / b.length;
  return (ab + ba) / 2;
}

// 템플릿 획 t의 점 가운데 학생 선 u에서 r 안에 있는 비율
function coverage(t, u, r) {
  return t.filter((p) => u.some((q) => dist(p, q) <= r)).length / t.length;
}

// 획 나눔 판정. joined: 학생 획 하나가 템플릿 획 여러 개를 혼자 덮음(이어 씀).
// split: 템플릿 획 하나를 학생 획 여러 개가 나눠 덮음(나눠 씀).
function segmentation(tInk, uInk, r) {
  const FULL = 0.7;
  const cov = tInk.map((t) => uInk.map((u) => coverage(t, u, r)));
  const joined = [];
  uInk.forEach((_, i) => {
    const covered = tInk.map((_, j) => j)
      .filter((j) => cov[j][i] >= FULL && !cov[j].some((c, i2) => i2 !== i && c >= FULL));
    if (covered.length >= 2) joined.push({ userStroke: i, strokes: covered });
  });
  const split = [];
  tInk.forEach((t, j) => {
    if (cov[j].some((c) => c >= FULL)) return;
    const parts = cov[j].map((c, i) => [c, i]).filter(([c]) => c >= 0.2).map(([, i]) => i);
    if (parts.length < 2) return;
    const union = t.filter((p) => parts.some((i) => uInk[i].some((q) => dist(p, q) <= r))).length / t.length;
    if (union >= 0.8) split.push({ stroke: j, pieces: parts.length });
  });
  return { joined, split };
}

// 정답 변형이 있으면 모양 조합마다 따로 채점해 가장 높은 결과를 쓴다
// (변형에 따라 글자 테두리 상자가 달라지므로 획 하나만 바꿔 비교하면 안 된다)
function scoreBest(tpl, user, tol) {
  let best = null;
  for (const form of concreteForms(tpl.strokes)) {
    const r = scoreAgainst(tpl.char, form, user, tol);
    if (!best || r.score > best.score) best = r;
  }
  return best;
}

function concreteForms(strokes) {
  let sets = [[]];
  for (const s of strokes) {
    const shapes = [s.points, ...s.variants];
    sets = sets.flatMap((set) => shapes.map((p) => [...set, { ...s, points: p, variants: [] }]));
  }
  return sets.slice(0, 16);
}

function scoreAgainst(char, tStrokes, user, tol) {
  const nt = tStrokes.length;
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
  const placement = clamp01(1 - offset / (tol * 1.5)) * clamp01(1 - Math.abs(Math.log(size)) / Math.log(1.3 + tol * 2));

  // 2) 모양: 학생 글자를 안내 글자 자리·크기에 맞춘 뒤 획끼리 비교
  const k = 1 / size;
  const kx = Math.pow(k, 1 - ASPECT_FIT) * Math.pow(tb.w / ub.w, ASPECT_FIT);
  const ky = Math.pow(k, 1 - ASPECT_FIT) * Math.pow(tb.h / ub.h, ASPECT_FIT);
  const aligned = user.map((s) => s.map((p) => ({ x: (p.x - ub.cx) * kx + tb.cx, y: (p.y - ub.cy) * ky + tb.cy })));
  // 2-1) 획과 무관한 전체 모양: 획 수·순서·방향을 빼고 그려진 선 자체를 비교한다.
  //      이어 쓰기·나눠 쓰기 판정과 다른 글자 판정에 쓴다.
  const uInk = aligned.map(densify);
  const tInk = tStrokes.map((t) => densify(t.points));
  const inkShape = closeness(chamfer(uInk.flat(), tInk.flat()), tol * SHAPE_STRICTNESS * INK_STRICTNESS);
  const seg = segmentation(tInk, uInk, tol * COVER_RADIUS);

  const cmp = tStrokes.map((t) => aligned.map((u) => compareStroke(u, t)));
  const scores = cmp.map((row) => row.map((c) => closeness(c.d, tol * SHAPE_STRICTNESS)));
  const pick = assign(scores, nt, nu);

  const strokes = tStrokes.map((t, j) => {
    const i = pick[j];
    return i === -1
      ? { index: j, type: t.type, matched: -1, shape: 0 }
      : { index: j, type: t.type, matched: i, shape: scores[j][i], reversed: cmp[j][i].reversed };
  });
  const matched = strokes.filter((s) => s.matched !== -1);
  const extra = nu - matched.length;
  // 평균과 가장 못 쓴 획을 반반 섞는다: 한 획만 크게 틀어져도 글씨 전체가 어색해 보이기 때문
  const strokeScores = strokes.map((s) => s.shape);
  const avg = strokeScores.reduce((a, v) => a + v, 0) / nt;
  let shape = (0.5 * avg + 0.5 * Math.min(...strokeScores)) * (nt / (nt + extra));

  // 3) 획순: 학생이 그은 순서대로 늘어놓았을 때 템플릿 번호가 얼마나 차례대로인가
  const byUserOrder = [...matched].sort((a, b) => a.matched - b.matched);
  const mask = lisMask(byUserOrder.map((s) => s.index));
  byUserOrder.forEach((s, n) => { s.inOrder = mask[n]; });
  let order = matched.length ? mask.filter(Boolean).length / nt : 0;

  // 4) 방향
  let direction = matched.length ? matched.filter((s) => !s.reversed).length / nt : 0;

  // 문제 코드
  let issues = [];
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

  // 이어 쓰기·나눠 쓰기: 획끼리 짝이 안 맞아도 전체 모양은 맞는 경우.
  // 모양은 전체 모양 점수로 매기고, 획 단위 지적(빠짐·더함·순서·방향·모양)은 이 한 가지로 바꾼다.
  if (seg.joined.length || seg.split.length) {
    shape = inkShape;
    order = 0.5;
    direction = 1;
    const BY_STROKE = new Set(['MISSING_STROKE', 'EXTRA_STROKE', 'WRONG_ORDER', 'WRONG_DIRECTION', 'SHAPE']);
    issues = issues.filter((i) => !BY_STROKE.has(i.code));
    if (seg.joined.length) issues.unshift({ code: 'STROKES_JOINED', joined: seg.joined });
    else issues.unshift({ code: 'STROKE_SPLIT', split: seg.split });
  }

  const parts = { order, direction, shape, placement };
  let score = Math.round(Object.entries(WEIGHTS).reduce((a, [key, w]) => a + w * parts[key], 0));
  for (const it of issues) if (CAPS[it.code] !== undefined) score = Math.min(score, CAPS[it.code]);

  return { char, score, grade: gradeOf(score), stars: starsOf(score), parts, inkShape, strokes, extraStrokes: extra, issues };
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
