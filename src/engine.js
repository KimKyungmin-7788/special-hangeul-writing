// 한글 쓰기 채점 엔진 (화면 없음, 순수 계산).
// 입력: 학생이 그은 획들 — [[{x,y}, ...], ...], 좌표는 쓰기 칸을 0~1로 본 비율.
// 출력: 점수(0~100)와 세부 항목, 문제 코드(issues). 문구·소리·화면은 앱이 정한다.

import { CONSONANTS } from './strokes-consonants.js';
import { VOWELS } from './strokes-vowels.js';

// 채점 규칙이 바뀌면 올린다. 서버에 저장한 글씨마다 어느 엔진으로 채점했는지 남긴다
export const ENGINE_VERSION = '0.4';

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
// (교사 채점 표본 23개로 맞춤, 평균 차이 6.0점, 2026-11-19)
const WEIGHTS = { order: 10, direction: 5, shape: 75, placement: 10 };
// 모양 비교의 허용 폭 배율(1보다 작을수록 엄격)
const SHAPE_STRICTNESS = 1.0;
// 모양 비교 전에 가로·세로를 따로 늘려 맞추는 정도(0: 같은 비율로만, 1: 가로세로 비율 무시).
// 교사는 납작하거나 길쭉한 ㄴ도 모양이 바르면 높게 줬다.
const ASPECT_FIT = 0.8;
// 획순·방향이 틀리면 모양이 좋아도 이 점수를 넘지 못한다
// (다른 글자 → F, 획순 틀림 → 최고 C, 방향 틀림 → 최고 B)
const CAPS = { WRONG_CHAR: 39, WRONG_ORDER: 69, STROKE_SPLIT: 72, ALT_FORM: 65, WRONG_DIRECTION: 79 };
// 이어 쓰기: 이은 횟수만큼 상한을 낮춘다(1번 이으면 60, 2번 이상이면 40). 교사 표본: 3획 ㄹ을 1획으로 40점, ㅁ을 2획으로 60점
const joinedCap = (joins) => Math.max(40, 80 - 20 * joins);
// 전체 모양(챔퍼 거리) 비교의 허용 폭 배율. 챔퍼 거리는 가장 가까운 점끼리 재서 값이 작게 나오므로 더 엄격하게 둔다
const INK_STRICTNESS = 0.5;
// 획이 템플릿 획을 '덮었다'고 볼 거리(허용 폭 대비)
const COVER_RADIUS = 0.6;
// 접점 검사: 정답에서 획 끝이 다른 획에 이만큼 가까우면 '닿는 곳'으로 본다(칸 대비)
const JUNCTION_TOUCH = 0.035;
// 접점을 넘어간 길이가 OVER_OK까지는 봐주고, OVER_BAD 이상이면 가장 크게 감점(칸 대비).
// 교사가 일부러 틀리게 쓴 모음 8개(40~50점)를 포함한 표본으로 맞춤(2026-11-19, 11-20 표본 60개로 다시 확인)
const OVER_OK = 0.04;
const OVER_BAD = 0.12;
// 넘어간 정도에 따른 점수 상한: 가장 심하면 OVER_CAP점, 전혀 안 넘어가면 상한 없음
const OVER_CAP = 40;
// 접점에 닿지 않고 떨어진 거리: GAP_OK까지는 봐주고, GAP_BAD 이상이면 최고 GAP_CAP점
const GAP_OK = 0.08;
const GAP_BAD = 0.25;
const GAP_CAP = 50;
// 문제 종류: 'error' 글자를 바르게 알면 고칠 수 있는 오류(배워야 할 것) · 'motor' 손의 운동 조절에서 오기 쉬운 것.
// 운동 지원을 켠 학생은 motor 문제를 너그럽게 채점한다(장애 특성으로 생기는 어려움을 벌점으로 만들지 않기 위해).
export const ISSUE_KIND = {
  WRONG_CHAR: 'error', WRONG_ORDER: 'error', WRONG_DIRECTION: 'error', MISSING_STROKE: 'error', EXTRA_STROKE: 'error',
  STROKES_JOINED: 'error', ALT_FORM: 'error', EMPTY: 'error',
  STROKE_SPLIT: 'motor', OVERSHOOT: 'motor', GAP: 'motor', SHAPE: 'motor', TOO_SMALL: 'motor', TOO_BIG: 'motor', OFF_CENTER: 'motor',
};
// 운동 지원 규칙. ⚠ 아직 운동 지원 학생 표본이 없어 정한 값이다. 표본이 쌓이면 다시 맞춘다
const BASE_RULES = { splitCap: CAPS.STROKE_SPLIT, overOk: OVER_OK, overBad: OVER_BAD, gapOk: GAP_OK, gapBad: GAP_BAD, tolMul: 1 };
const MOTOR_RULES = { splitCap: 88, overOk: 0.07, overBad: 0.16, gapOk: 0.12, gapBad: 0.30, tolMul: 1.15 };
let R = BASE_RULES; // evaluate 하는 동안 쓰는 규칙

// 실수로 찍힌 점(이보다 짧은 획)은 무시한다(칸 대비)
const MIN_STROKE = 0.02;
// 연달아 그은 두 획의 끝·시작이 이만큼 가까우면 '펜을 뗐다 이어 쓴 한 획'으로 본다(칸 대비)
const MERGE_GAP = 0.08;
// 다른 글자의 모양 점수가 이만큼 더 높으면 '다른 글자를 썼다'고 본다
const WRONG_CHAR_MARGIN = 0.2;

// ---------- 템플릿 ----------

const templates = {};
const GROUPS = { consonant: CONSONANTS, vowel: VOWELS };
const buildStroke = (s) => ({
  type: s.type,
  closed: !!s.circle,
  points: resample(s.circle ? circlePoints(...s.circle) : s.points.map(([x, y]) => ({ x, y }))),
  // 정답으로 함께 받아 줄 다른 모양(예: ㅎ 꼭지의 가로형)
  variants: (s.variants || []).map((v) => resample(v.map(([x, y]) => ({ x, y })))),
});
for (const [group, defs] of Object.entries(GROUPS)) for (const [ch, def] of Object.entries(defs)) {
  templates[ch] = {
    char: ch,
    name: def.name,
    group,
    // 바른 획순은 아니지만 흔히 쓰는 다른 꼴(예: ㅈ을 ㅡ+ㅅ 3획으로). 알아보되 감점한다
    altForms: (def.altForms || []).map((f) => f.map(buildStroke)),
    strokes: def.strokes.map(buildStroke),
  };
}

// ---------- 받침 없는 글자(가~하): 자음 + ㅏ ----------
// 자음은 칸의 왼쪽, ㅏ는 오른쪽에 둔다. 각 낱자 획 데이터의 테두리 상자를 그 자리로 옮겨 만든다.
// 획순은 자음을 다 쓴 뒤 ㅏ. ⚠ 실제 글자에서 자음 꼴(예: '가'의 ㄱ 세로가 비스듬함)은 교사 검수 후 다듬는다.
const SYLLABLE_ROW = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
// 칸 안 자리: 교과서식 '한글 따라쓰기' 칸(가~하)의 글자를 픽셀로 재서 정했다(2026-11-23).
//  cons: 자음 획 중심선이 차지하는 상자 [x0, y0, x1, y1] (글꼴 굵기 0.07의 절반만큼 안쪽으로)
//  a: ㅏ [세로 x, 세로 위, 세로 아래, 짧은 가로 y, 짧은 가로 오른쪽 끝]
const SYL_LAYOUT = {
  'ㄱ': { cons: [0.223, 0.27, 0.517, 0.694], a: [0.715, 0.211, 0.847, 0.482, 0.844] },
  'ㄴ': { cons: [0.255, 0.259, 0.611, 0.636], a: [0.726, 0.211, 0.847, 0.465, 0.843] },
  'ㄷ': { cons: [0.243, 0.259, 0.577, 0.647], a: [0.709, 0.2, 0.836, 0.465, 0.834] },
  'ㄹ': { cons: [0.235, 0.27, 0.583, 0.683], a: [0.711, 0.211, 0.847, 0.482, 0.83] },
  'ㅁ': { cons: [0.218, 0.27, 0.465, 0.647], a: [0.677, 0.211, 0.847, 0.459, 0.806] },
  'ㅂ': { cons: [0.23, 0.259, 0.489, 0.647], a: [0.701, 0.211, 0.847, 0.465, 0.831] },
  'ㅅ': { cons: [0.193, 0.247, 0.583, 0.683], a: [0.715, 0.2, 0.836, 0.476, 0.838] },
  'ㅇ': { cons: [0.223, 0.249, 0.517, 0.691], a: [0.709, 0.202, 0.846, 0.464, 0.832] },
  'ㅈ': { cons: [0.206, 0.261, 0.611, 0.691], a: [0.726, 0.202, 0.846, 0.47, 0.855] },
  'ㅊ': { cons: [0.218, 0.225, 0.613, 0.703], a: [0.74, 0.202, 0.846, 0.464, 0.858] },
  'ㅋ': { cons: [0.223, 0.261, 0.534, 0.679], a: [0.711, 0.202, 0.846, 0.464, 0.83] },
  'ㅌ': { cons: [0.255, 0.273, 0.599, 0.667], a: [0.726, 0.214, 0.858, 0.47, 0.843] },
  'ㅍ': { cons: [0.218, 0.273, 0.624, 0.655], a: [0.738, 0.214, 0.858, 0.464, 0.855] },
  'ㅎ': { cons: [0.205, 0.249, 0.571, 0.703], a: [0.709, 0.214, 0.858, 0.512, 0.826] },
};
// '가'·'카'의 ㄱ은 위를 가로로 긋고 왼쪽 아래로 휘어 내려온다(자음 상자 안 0~1 좌표). 재어 보니 끝이 거의 왼쪽 끝까지 온다
const SLANT_G = [[0, 0], [1, 0], [0.97, 0.2], [0.81, 0.5], [0.5, 0.8], [0.08, 1]];
function boxOf(strokes) {
  const pts = strokes.flatMap((s) => [...s.points, ...s.variants.flat()]);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function placeStrokes(strokes, to, from = boxOf(strokes)) {
  const sx = (to.x1 - to.x0) / ((from.x1 - from.x0) || 1), sy = (to.y1 - to.y0) / ((from.y1 - from.y0) || 1);
  // 가는 획(ㅣ처럼 폭이 거의 없는 것)은 늘리지 않고 가운데에 둔다
  const mx = from.x1 - from.x0 < 0.05 ? null : sx, my = from.y1 - from.y0 < 0.05 ? null : sy;
  const f = (p) => ({ x: mx == null ? (to.x0 + to.x1) / 2 : to.x0 + (p.x - from.x0) * mx, y: my == null ? (to.y0 + to.y1) / 2 : to.y0 + (p.y - from.y0) * my });
  return strokes.map((s) => ({ ...s, points: resample(s.points.map(f)), variants: s.variants.map((v) => resample(v.map(f))) }));
}
const inBox = (b, pts) => pts.map(([u, v]) => ({ x: b[0] + u * (b[2] - b[0]), y: b[1] + v * (b[3] - b[1]) }));
for (const c of SYLLABLE_ROW) {
  const cons = templates[c], L = SYL_LAYOUT[c];
  const ch = String.fromCharCode(0xAC00 + CHOSEONG.indexOf(c) * 21 * 28); // 초성 + ㅏ, 받침 없음
  const consBox = boxOf(cons.strokes);
  const to = { x0: L.cons[0], y0: L.cons[1], x1: L.cons[2], y1: L.cons[3] };
  let cs = placeStrokes(cons.strokes, to, consBox);
  if (c === 'ㄱ' || c === 'ㅋ') {
    // 첫 획(꺾임)을 비스듬히 휘는 꼴로. ㅋ의 가운데 가로는 그 휜 획에 닿는 곳까지
    cs[0] = { ...cs[0], points: resample(inBox(L.cons, SLANT_G)), variants: [] };
    if (c === 'ㅋ') cs[1] = { ...cs[1], points: resample(inBox(L.cons, [[0, 0.5], [0.81, 0.5]])), variants: [] };
  }
  if (c === 'ㅎ') {
    // '하'의 ㅎ: 재어 보니 꼭지는 짧은 가로(세로 꼭지도 정답), 가로획 y 0.357, ㅇ은 살짝 넓은 타원
    const P = (pts) => resample(pts.map(([x, y]) => ({ x, y })));
    const ring = circlePoints(0, 0, 1).map((p) => [0.388 + p.x * 0.135, 0.584 + p.y * 0.122]);
    cs = [
      { ...cs[0], points: P([[0.29, 0.238], [0.475, 0.238]]), variants: [P([[0.382, 0.2], [0.382, 0.278]])] },
      { ...cs[1], points: P([[0.19, 0.357], [0.585, 0.357]]), variants: [] },
      { ...cs[2], points: P(ring), variants: [] },
    ];
  }
  const [vx, vt, vb, hy, hx] = L.a;
  const v = [
    { type: '세로', closed: false, points: resample([{ x: vx, y: vt }, { x: vx, y: vb }]), variants: [] },
    { type: '가로', closed: false, points: resample([{ x: vx, y: hy }, { x: hx, y: hy }]), variants: [] },
  ];
  templates[ch] = {
    char: ch, name: ch, group: 'syllable',
    parts: [c, 'ㅏ'],
    strokes: [...cs, ...v],
    altForms: cons.altForms.map((f) => [...placeStrokes(f, to, consBox), ...v]),
  };
}

/** @param {'consonant'|'vowel'|'syllable'} [group] 생략하면 전체 */
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
  R = opts.motorSupport ? MOTOR_RULES : BASE_RULES;
  try { return withKinds(evaluateWith(char, tpl, userStrokes, opts), !!opts.motorSupport); } finally { R = BASE_RULES; }
}

// 문제마다 종류(error/motor)를 달고, 운동 지원 여부를 결과에 남긴다
function withKinds(r, motor) {
  for (const it of r.issues) it.kind = ISSUE_KIND[it.code] || 'error';
  r.motorSupport = motor;
  return r;
}

function evaluateWith(char, tpl, userStrokes, opts) {
  const tol = toleranceOf(opts) * R.tolMul;
  let user = prepare((userStrokes || []).filter((s) => s && s.length && pathLength(s) >= MIN_STROKE));
  const rawStrokes = user.length;
  let result = scoreBest(tpl, user, tol);
  result.measures.rawStrokes = rawStrokes;
  if (!user.length) return result;
  const nt = tpl.strokes.length;

  // 꺾이는 곳에서 펜을 뗐다가 그 자리에서 이어 쓴 경우(ㄱ을 가로·삐침 두 번에): 붙은 연속 획을 이어 붙여 다시 채점
  if (user.length > nt) {
    const m = mergeChained(user, nt);
    if (m) {
      const r2 = scoreBest(tpl, m.strokes, tol);
      if (r2.parts.shape > result.parts.shape) {
        r2.issues = r2.issues.filter((i) => i.code !== 'STROKE_SPLIT');
        r2.issues.unshift({ code: 'STROKE_SPLIT', split: m.split });
        capScore(r2, R.splitCap, 'STROKE_SPLIT');
        r2.measures.mergedPieces = m.merges;
        result = r2;
        user = m.strokes;
      }
    }
  }
  // 흔히 쓰는 다른 꼴로 쓴 경우(ㅈ을 ㅡ+ㅅ 3획으로): 알아보되 최고 ALT_FORM점
  for (const alt of tpl.altForms) {
    if (alt.length !== user.length || alt.length === nt) continue;
    const r3 = scoreAgainst(char, alt, user, tol);
    if (r3.parts.shape > result.parts.shape + 0.05) {
      r3.issues.unshift({ code: 'ALT_FORM', strokes: alt.length, expected: nt });
      capScore(r3, CAPS.ALT_FORM, 'ALT_FORM');
      r3.measures.altForm = 1;
      result = r3;
    }
  }

  // 다른 글자 검사: 다른 글자의 전체 모양 점수가 확연히 높으면 글자를 잘못 쓴 것(예: ㅏ 자리에 ㅓ).
  // 획과 무관한 전체 모양으로 비교해야 이어 쓴 ㅁ을 'ㅇ'으로 오해하지 않는다.
  let look = null;
  for (const other of Object.values(templates)) {
    if (other.char === char) continue;
    if ((other.group === 'syllable') !== (tpl.group === 'syllable')) continue; // 낱자는 낱자끼리, 글자는 글자끼리
    // 획 수를 맞게 썼으면 획 수가 같은 글자와만 견준다(ㅏ↔ㅓ, ㅐ↔ㅔ처럼 실제로 헷갈리는 짝)
    if ((user.length === nt || result.issues.some((i) => i.code === 'ALT_FORM' || i.code === 'STROKE_SPLIT'))
      && other.strokes.length !== user.length) continue;
    const s = scoreBest(other, user, tol).inkShapeUniform;
    if (!look || s > look.shape) look = { char: other.char, shape: s };
  }
  result.measures.rawStrokes = rawStrokes;
  // 가장 닮은 다른 글자가 이 글자보다 얼마나 더 닮았나(0.2 이상이면 다른 글자로 판정)
  if (look) result.measures.otherCharMargin = look.shape - result.inkShapeUniform;
  if (look && look.shape >= result.inkShapeUniform + WRONG_CHAR_MARGIN) {
    result.issues.unshift({ code: 'WRONG_CHAR', looksLike: look.char });
    capScore(result, CAPS.WRONG_CHAR, 'WRONG_CHAR');
  }
  return result;
}

function capScore(r, cap, code) {
  addCap(r.caps || (r.caps = []), code, cap);
  r.score = Math.min(r.score, cap);
  r.grade = gradeOf(r.score);
  r.stars = starsOf(r.score);
}

// 연달아 그은 두 획의 끝·시작이 붙어 있으면 한 획으로 잇는다(가장 가까운 쌍부터, 목표 획 수가 될 때까지)
function mergeChained(user, target) {
  let strokes = [...user], merges = 0;
  let sizes = user.map(() => 1); // 이어 붙인 획마다 원래 몇 조각이었는지
  while (strokes.length > target) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < strokes.length - 1; i++) {
      const d = dist(strokes[i][strokes[i].length - 1], strokes[i + 1][0]);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0 || bd > MERGE_GAP) break;
    strokes = [...strokes.slice(0, best), resample([...strokes[best], ...strokes[best + 1]]), ...strokes.slice(best + 2)];
    sizes = [...sizes.slice(0, best), sizes[best] + sizes[best + 1], ...sizes.slice(best + 2)];
    merges++;
  }
  return merges ? { strokes, merges, split: sizes.map((n, i) => ({ stroke: i, pieces: n })).filter((g) => g.pieces > 1) } : null;
}

// 점 p에서 꺾은선까지의 최단 거리
function distToPolyline(p, pts) {
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / L) : 0;
    m = Math.min(m, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return pts.length === 1 ? dist(p, pts[0]) : m;
}

// 정답 글자의 접점: 어떤 획의 끝(시작 또는 끝)이 다른 획에 닿는 곳. 예) ㅔ의 짧은 가로 끝 → 첫 세로
function junctionsOf(tStrokes) {
  const out = [];
  tStrokes.forEach((a, ai) => {
    if (a.closed) return;
    for (const end of ['start', 'end']) {
      const p = end === 'start' ? a.points[0] : a.points[a.points.length - 1];
      tStrokes.forEach((b, bi) => {
        if (bi !== ai && distToPolyline(p, b.points) <= JUNCTION_TOUCH) out.push({ a: ai, end, b: bi });
      });
    }
  });
  return out;
}

// 학생 획 u가 접점 쪽 끝에서 획 v를 지나쳐 넘어간 길이.
// 접점 쪽 끝에서 거꾸로 따라가며 v에 처음 닿는 곳까지의 길이를 잰다(멈췄으면 0, 모자라도 0).
function overshootLength(u, fromEnd, v) {
  const pts = fromEnd ? [...u].reverse() : u;
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) along += dist(pts[i - 1], pts[i]);
    if (distToPolyline(pts[i], v) <= JUNCTION_TOUCH) return along;
    if (along > 0.5) break;
  }
  return 0;
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
// split: 템플릿 획 하나를 학생 획 여러 개가 나눠 덮음(끊어 씀).
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
    // 나눠 쓰기는 펜을 뗐다가 그 자리에서 이어 그은 것: 연달아 그은 획이고, 앞 획 끝과 뒤 획 시작이 붙어 있어야 한다
    const chained = parts.every((i, n) => n === 0
      || (i === parts[n - 1] + 1 && dist(uInk[i][0], uInk[i - 1][uInk[i - 1].length - 1]) <= r * 1.5));
    if (!chained) return;
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
      extraStrokes: 0, issues: [{ code: 'EMPTY' }], measures: emptyMeasures(nt), caps: [] };
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
  // 다른 글자 판정용: 가로·세로를 같은 비율로만 맞춘 전체 모양.
  // 가로세로를 따로 맞추면 ㅣ·ㅡ처럼 가는 글자와 비교할 때 어떤 글씨든 가늘게 눌려 ㅣ처럼 보이게 된다.
  const uInkU = user.map((s) => densify(s.map((p) => ({ x: (p.x - ub.cx) * k + tb.cx, y: (p.y - ub.cy) * k + tb.cy }))));
  const inkShapeUniform = closeness(chamfer(uInkU.flat(), tInk.flat()), tol * SHAPE_STRICTNESS * INK_STRICTNESS);
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
  // 평균에 가장 못 쓴 획을 1/4 섞는다: 한 획만 크게 틀어져도 글씨 전체가 어색해 보이기 때문
  const strokeScores = strokes.map((s) => s.shape);
  const avg = strokeScores.reduce((a, v) => a + v, 0) / nt;
  let shape = (0.75 * avg + 0.25 * Math.min(...strokeScores)) * (nt / (nt + extra));

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
    if (seg.joined.length) {
      const joins = seg.joined.reduce((a, j) => a + j.strokes.length - 1, 0);
      issues.unshift({ code: 'STROKES_JOINED', joined: seg.joined, joins });
    }
    else issues.unshift({ code: 'STROKE_SPLIT', split: seg.split });
  }

  // 5) 접점: 정답에서 획 끝이 다른 획에 닿는 곳마다, 학생 획이 거기서 멈췄는지 넘어갔는지 본다.
  //    교사는 비율·위치보다 '획이 넘어간 것'을 크게 감점했다(ㅔ·ㅖ·ㅛ 등 표본 40~50점).
  let overCap = Infinity;
  const caps = []; // 이 글씨에 걸린 점수 상한들(문제 코드별). 가장 낮은 것이 점수를 정한다
  let overAt = null, gapAt = null;
  if (!seg.joined.length && !seg.split.length) {
    for (const jn of junctionsOf(tStrokes)) {
      const A = strokes[jn.a], B = strokes[jn.b];
      if (A.matched === -1 || B.matched === -1) continue;
      // 학생 획의 방향이 반대면 '끝'이 반대쪽이다
      const fromEnd = (jn.end === 'end') !== !!A.reversed;
      // 넘어간 부분이 글자를 키우므로, 가로·세로를 따로 늘린 좌표가 아니라 같은 비율로 맞춘 좌표에서 잰다
      const u = uInkU[A.matched], v = uInkU[B.matched];
      const len = overshootLength(u, fromEnd, v);
      if (!overAt || len > overAt.len) overAt = { ...jn, len };
      // 넘어가지 않았다면, 닿아야 할 획에서 얼마나 떨어져 멈췄는지
      if (len === 0) {
        const gap = distToPolyline(fromEnd ? u[u.length - 1] : u[0], v);
        if (!gapAt || gap > gapAt.gap) gapAt = { ...jn, gap };
      }
    }
    if (overAt && overAt.len > R.overOk) {
      const j = clamp01(1 - (overAt.len - R.overOk) / (R.overBad - R.overOk));
      overCap = Math.round(OVER_CAP + (100 - OVER_CAP) * j);
      addCap(caps, 'OVERSHOOT', overCap);
      issues.unshift({ code: 'OVERSHOOT', stroke: overAt.a, into: overAt.b, length: overAt.len });
    }
    if (gapAt && gapAt.gap > R.gapOk) {
      const j = clamp01(1 - (gapAt.gap - R.gapOk) / (R.gapBad - R.gapOk));
      const gapCap = Math.round(GAP_CAP + (100 - GAP_CAP) * j);
      overCap = Math.min(overCap, gapCap);
      addCap(caps, 'GAP', gapCap);
      issues.unshift({ code: 'GAP', stroke: gapAt.a, to: gapAt.b, length: gapAt.gap });
    }
  }

  const parts = { order, direction, shape, placement };
  let score = Math.round(Object.entries(WEIGHTS).reduce((a, [key, w]) => a + w * parts[key], 0));
  const uncapped = score;
  for (const it of issues) if (CAPS[it.code] !== undefined) {
    const cap = it.code === 'STROKE_SPLIT' ? R.splitCap : CAPS[it.code];
    score = Math.min(score, cap); addCap(caps, it.code, cap);
  }
  const joinedIssue = issues.find((i) => i.code === 'STROKES_JOINED');
  if (joinedIssue) { score = Math.min(score, joinedCap(joinedIssue.joins)); addCap(caps, 'STROKES_JOINED', joinedCap(joinedIssue.joins)); }
  score = Math.min(score, overCap);

  // 측정값: 상한·배점을 적용하기 전의 날 숫자. 교사 점수에 맞춰 무게를 학습할 때 입력으로 쓴다.
  const measures = {
    ...emptyMeasures(nt),
    userStrokes: nu,
    missingStrokes: missing,
    extraStrokes: extra,
    outOfOrderStrokes: outOfOrder.length,
    reversedStrokes: reversed.length,
    order, direction, shape, placement,
    strokeShapeAvg: avg,
    strokeShapeMin: Math.min(...strokeScores),
    inkShape, inkShapeUniform,
    sizeRatio: size,
    aspectRatio: (ub.w / ub.h) / (tb.w / tb.h),
    offset,
    overshoot: overAt ? overAt.len : 0,
    gap: gapAt ? gapAt.gap : 0,
    joins: seg.joined.reduce((a, j) => a + j.strokes.length - 1, 0),
    splitPieces: seg.split.reduce((a, s) => a + s.pieces - 1, 0),
    uncappedScore: uncapped,
  };

  return { char, score, grade: gradeOf(score), stars: starsOf(score), parts, inkShape, inkShapeUniform, strokes, extraStrokes: extra, issues, measures, caps };
}

// 측정값의 기본 틀. 키 순서가 곧 내보내기(CSV) 열 순서다.
function emptyMeasures(nt) {
  return {
    expectedStrokes: nt, userStrokes: 0, rawStrokes: 0, missingStrokes: nt, extraStrokes: 0,
    outOfOrderStrokes: 0, reversedStrokes: 0,
    order: 0, direction: 0, shape: 0, placement: 0, strokeShapeAvg: 0, strokeShapeMin: 0,
    inkShape: 0, inkShapeUniform: 0, sizeRatio: 0, aspectRatio: 0, offset: 0,
    overshoot: 0, gap: 0, joins: 0, splitPieces: 0, mergedPieces: 0, altForm: 0,
    otherCharMargin: 0, uncappedScore: 0,
  };
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

// 같은 문제의 상한이 여러 번 걸리면 낮은 값만 남긴다
function addCap(list, code, cap) {
  const it = list.find((c) => c.code === code);
  if (!it) list.push({ code, cap }); else it.cap = Math.min(it.cap, cap);
}

/**
 * 점수가 왜 이렇게 나왔는지 풀어 준다(교사·개발자용 키워드).
 * - deductions: 네 항목에서 깎인 점수(획순 10·방향 5·모양 75·자리·크기 10 중 잃은 만큼)
 * - caps: 문제마다 걸린 점수 상한(낮은 순). 가장 낮은 상한이 항목 점수보다 낮으면 그 상한이 점수를 정한다(binding)
 * - 문제가 겹쳐도 상한끼리 더해 깎지는 않는다: 가장 무거운 문제 하나의 상한만 적용되고 나머지는 '겹침'으로 표시
 */
export function explainScore(r) {
  const parts = r.parts || { order: 0, direction: 0, shape: 0, placement: 0 };
  const deductions = Object.entries(WEIGHTS)
    .map(([key, w]) => ({ key, weight: w, lost: Math.round(w * (1 - parts[key]) * 10) / 10 }))
    .filter((d) => d.lost >= 0.5)
    .sort((a, b) => b.lost - a.lost);
  const fromParts = Math.round(Object.entries(WEIGHTS).reduce((a, [key, w]) => a + w * parts[key], 0));
  const caps = [...(r.caps || [])].sort((a, b) => a.cap - b.cap);
  const binding = caps.length && caps[0].cap < fromParts ? caps[0] : null;
  return { fromParts, deductions, caps, binding, overlapped: binding ? caps.slice(1) : [], score: r.score };
}

export function gradeOf(score) {
  return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'F';
}
export function starsOf(score) {
  return score >= 90 ? 3 : score >= 75 ? 2 : score >= 60 ? 1 : 0;
}
