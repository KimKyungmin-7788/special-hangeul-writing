// 쓰기 준비(선 긋기·형태 구성) 21종: 모양 데이터와 관찰값 계산. 화면은 demo/prep.js가 맡는다.
// 근거: 쓰기 준비 기술 학습 콘텐츠 인계서(05~25번). 번호·이름·순서는 인계서 그대로 둔다.
// 한글 채점 엔진(src/engine.js)과는 따로다. 획 방향을 정답으로 보지 않는다(어느 쪽에서 그어도 됨).
//
// 좌표: 인계서 SVG viewBox "-4 -4 118 58"을 높이 1로 맞춘 단위. x는 0 ~ SHEET_W(≈2.03), y는 0 ~ 1.

export const AREAS = [
  { key: 'single', name: '단일 방향 움직임' },
  { key: 'curve', name: '기본 곡선과 원' },
  { key: 'join', name: '직선 결합과 방향 전환' },
  { key: 'diag', name: '사선과 닫힌 도형' },
  { key: 'pattern', name: '연속 움직임과 복합 패턴' },
];

// id, 영역, 활동명, 목표, SVG 경로(인계서 5절). 여러 M은 한 장 안의 여러 획(따로 그어도 됨)
export const ITEMS = [
  { id: '05', area: 'single', name: '수직선', goal: '위아래 방향 조절', d: 'M25 5 V45 M55 5 V45 M85 5 V45' },
  { id: '06', area: 'single', name: '수평선', goal: '좌우 방향 조절', d: 'M8 8 H102 M8 25 H102 M8 42 H102' },
  { id: '07', area: 'single', name: '수직·수평선 혼합', goal: '움직임 방향 고르기', d: 'M15 5 V45 M35 25 H70 M95 5 V45' },
  { id: '08', area: 'curve', name: '큰 열린 곡선', goal: '부드럽게 방향 바꾸기', d: 'M8 40 Q55 -25 102 40' },
  { id: '09', area: 'curve', name: '반원', goal: '같은 굽기 유지', d: 'M8 37 A22 22 0 0 1 52 37 M60 10 A22 22 0 0 0 104 10' },
  { id: '10', area: 'curve', name: '원', goal: '시작점과 끝점 잇기', d: 'M55 4 A21 21 0 0 1 55 46 A21 21 0 0 1 55 4 Z' },
  { id: '11', area: 'join', name: '직각선', goal: '한 번 직각으로 꺾기', d: 'M12 5 V43 H45 M65 43 V5 H100' },
  { id: '12', area: 'join', name: '연결 직선', goal: '두 번 직각으로 꺾기', d: 'M10 43 V6 H45 V43 M65 6 V43 H100 V6' },
  { id: '13', area: 'join', name: 'T자형', goal: '선 중간에 다른 선 잇기', d: 'M10 6 H50 M30 6 V44 M78 5 V45 M78 25 H105' },
  { id: '14', area: 'join', name: '십자선', goal: '두 직선 엇갈리기', d: 'M55 3 V47 M33 25 H77' },
  { id: '15', area: 'diag', name: '하향 사선', goal: '왼쪽 위에서 오른쪽 아래로', d: 'M10 5 L35 45 M43 5 L68 45 M76 5 L101 45' },
  { id: '16', area: 'diag', name: '사각형', goal: '직각으로 닫힌 모양', d: 'M35 5 H75 V45 H35 Z' },
  { id: '17', area: 'diag', name: '상향 사선', goal: '왼쪽 아래에서 오른쪽 위로', d: 'M10 45 L35 5 M43 45 L68 5 M76 45 L101 5' },
  { id: '18', area: 'diag', name: 'V자·산 모양', goal: '사선 방향 바꾸기', d: 'M5 5 L28 45 L51 5 M59 45 L82 5 L105 45' },
  { id: '19', area: 'diag', name: 'X자', goal: '두 사선 엇갈리기', d: 'M35 5 L75 45 M75 5 L35 45' },
  { id: '20', area: 'diag', name: '삼각형', goal: '사선과 수평선으로 닫기', d: 'M55 3 L81 45 H29 Z' },
  { id: '21', area: 'pattern', name: '계단선', goal: '직각을 되풀이해 꺾기', d: 'M5 43 H25 V31 H45 V19 H65 V7 H105' },
  { id: '22', area: 'pattern', name: '지그재그', goal: '사선을 되풀이해 꺾기', d: 'M5 43 L18 7 L31 43 L44 7 L57 43 L70 7 L83 43 L96 7 L108 43' },
  { id: '23', area: 'pattern', name: '물결선', goal: '곡선을 이어서 조절', d: 'M5 25 Q18 -8 31 25 T57 25 T83 25 T109 25' },
  { id: '24', area: 'pattern', name: '고리 반복선', goal: '곡선 되풀이와 엇갈림', d: 'M5 40 C30 40 36 4 22 4 C6 4 12 40 42 40 C66 40 72 4 58 4 C42 4 48 40 78 40 C102 40 108 4 94 4 C78 4 84 40 108 40' },
  { id: '25', area: 'pattern', name: '소용돌이', goal: '크기와 회전 조절', d: 'M55 25 C55 19 63 19 63 25 C63 39 40 39 40 24 C40 2 80 2 80 25 C80 55 20 55 20 24' },
];
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

// 지원 걸음(인계서 4절의 8가지를 학생 화면에서는 4걸음으로). 통로 너비·점선 간격은 선생님 설정
export const STEPS = [
  { n: 1, name: '통로 안에서', short: '통로' },
  { n: 2, name: '점선 따라', short: '점선' },
  { n: 3, name: '점 잇기', short: '점 잇기' },
  { n: 4, name: '보고 그리기', short: '보고 그리기' },
];

export const PREP_VERSION = 'prep-0.1';
// 걸음별 허용 폭(활동지 높이 기준). 통로는 선생님 설정(넓게/좁게)
export function stepTol(step, lane = 'wide') { return step === 1 ? (lane === 'narrow' ? 0.055 : 0.085) : step === 4 ? 0.11 : 0.09; }
// 서버 engine_issues에 남길 관찰 코드
export function obsCodes(o) { return [o.connected ? null : 'NOT_CONNECTED', o.stray > 0.2 ? 'STRAY' : null, o.cover < 0.85 ? 'LOW_COVER' : null].filter(Boolean); }

export const VIEW = { x: -4, y: -4, w: 118, h: 58 };
export const SHEET_W = VIEW.w / VIEW.h;
const U = (x, y) => ({ x: (x - VIEW.x) / VIEW.h, y: (y - VIEW.y) / VIEW.h });

// ---------- SVG 경로 → 획(점 목록) ----------
// 데이터는 절대 좌표 명령(M L H V Q T C A Z)만 쓴다
function arcPoints(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2, n = 24) {
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    out.push([cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy]);
  }
  return out;
}
export function parsePath(d) {
  const tok = d.match(/[MLHVQTCAZ]|-?\d*\.?\d+/g);
  const strokes = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = null, lastCtl = null, i = 0;
  const num = () => Number(tok[i++]);
  const push = (px, py) => { cur.pts.push([px, py]); x = px; y = py; };
  while (i < tok.length) {
    if (/[A-Z]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M') { cur = { pts: [], closed: false }; strokes.push(cur); x = num(); y = num(); sx = x; sy = y; cur.pts.push([x, y]); lastCtl = null; cmd = 'L'; continue; }
    if (cmd === 'L') { push(num(), num()); lastCtl = null; }
    else if (cmd === 'H') { push(num(), y); lastCtl = null; }
    else if (cmd === 'V') { push(x, num()); lastCtl = null; }
    else if (cmd === 'Q' || cmd === 'T') {
      const [qx, qy] = cmd === 'Q' ? [num(), num()] : lastCtl ? [2 * x - lastCtl[0], 2 * y - lastCtl[1]] : [x, y];
      const ex = num(), ey = num(), x0 = x, y0 = y;
      for (let k = 1; k <= 20; k++) { const t = k / 20, a = (1 - t) ** 2, b = 2 * (1 - t) * t, c = t * t; push(a * x0 + b * qx + c * ex, a * y0 + b * qy + c * ey); }
      lastCtl = [qx, qy];
    } else if (cmd === 'C') {
      const c1x = num(), c1y = num(), c2x = num(), c2y = num(), ex = num(), ey = num(), x0 = x, y0 = y;
      for (let k = 1; k <= 24; k++) { const t = k / 24, m = 1 - t; push(m ** 3 * x0 + 3 * m * m * t * c1x + 3 * m * t * t * c2x + t ** 3 * ex, m ** 3 * y0 + 3 * m * m * t * c1y + 3 * m * t * t * c2y + t ** 3 * ey); }
      lastCtl = null;
    } else if (cmd === 'A') {
      const rx = num(), ry = num(), rot = num(), fa = num(), fs = num(), ex = num(), ey = num();
      for (const [px, py] of arcPoints(x, y, rx, ry, rot, fa, fs, ex, ey)) push(px, py);
      lastCtl = null;
    } else if (cmd === 'Z') { cur.closed = true; if (x !== sx || y !== sy) push(sx, sy); cmd = null; }
    else throw new Error(`지원하지 않는 경로 명령: ${cmd}`);
  }
  return strokes.map((s) => {
    const pts = s.pts.map(([px, py]) => U(px, py));
    const a = pts[0], b = pts[pts.length - 1];
    return { pts, closed: s.closed || Math.hypot(a.x - b.x, a.y - b.y) < 0.02 };
  });
}

// 일정 간격으로 다시 찍기
export function resample(pts, step = 0.01) {
  const out = [{ ...pts[0] }]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let px = pts[i - 1].x, py = pts[i - 1].y; const qx = pts[i].x, qy = pts[i].y;
    let seg = Math.hypot(qx - px, qy - py);
    while (acc + seg >= step) { const t = (step - acc) / seg; px += (qx - px) * t; py += (qy - py) * t; out.push({ x: px, y: py }); seg = Math.hypot(qx - px, qy - py); acc = 0; }
    acc += seg;
  }
  const last = pts[pts.length - 1], o = out[out.length - 1];
  if (Math.hypot(last.x - o.x, last.y - o.y) > step * 0.3) out.push({ ...last });
  return out;
}
const length = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

// 점 잇기용 주요 지점: 끝점, 꺾이는 곳(35° 넘게), 사이가 너무 멀면 중간 점을 더함
export function keyPoints(stroke, maxGap = 0.16) {
  const r = resample(stroke.pts, 0.01);
  const idx = [0];
  for (let i = 3; i < r.length - 3; i++) {
    const a = Math.atan2(r[i].y - r[i - 3].y, r[i].x - r[i - 3].x), b = Math.atan2(r[i + 3].y - r[i].y, r[i + 3].x - r[i].x);
    let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 0.6 && i - idx[idx.length - 1] > 6) idx.push(i);
  }
  if (!stroke.closed) idx.push(r.length - 1);
  const out = [];
  const step = Math.round(maxGap / 0.01);
  for (let k = 0; k < idx.length; k++) {
    out.push(r[idx[k]]);
    const next = k + 1 < idx.length ? idx[k + 1] : stroke.closed ? r.length - 1 : null;
    if (next == null) continue;
    const gap = next - idx[k];
    const parts = Math.ceil(gap / step);
    for (let j = 1; j < parts; j++) out.push(r[idx[k] + Math.round((gap * j) / parts)]);
  }
  return out;
}

// ---------- 관찰값과 별 ----------
// 인계서 6절의 관찰 축: 형태 정확성(덮은 비율), 경로 이탈, 연결성(끝점·닫힘), 독립성(걸음)
// 별 기준은 임시값이다. 쌓이는 기록을 보고 정한다(인계서: 평가 기준은 아직 확정하지 않음)
export const STAR_RULES = { three: { cover: 0.85, stray: 0.2 }, two: { cover: 0.6, stray: 0.4 } };
const nearest = (p, pts) => { let m = Infinity; for (const q of pts) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < m) m = d; } return m; };

// 보고 그리기: 학생은 활동지 아무 데나 그리므로, 쓴 선의 테두리를 모양의 테두리에 맞춘 뒤 견준다(가로세로 같은 비율)
function alignTo(ink, T) {
  const box = (pts) => { const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
  const a = box(ink), b = box(T);
  const k = Math.max(b.x1 - b.x0, b.y1 - b.y0) / Math.max(a.x1 - a.x0, a.y1 - a.y0, 1e-6);
  const ax = (a.x0 + a.x1) / 2, ay = (a.y0 + a.y1) / 2, bx = (b.x0 + b.x1) / 2, by = (b.y0 + b.y1) / 2;
  return ink.map((p) => ({ x: bx + (p.x - ax) * k, y: by + (p.y - ay) * k }));
}

export function observe(item, userStrokes, { tol = 0.09, step = 1, align = false } = {}) {
  const target = parsePath(item.d);
  const T = target.map((s) => resample(s.pts, 0.01));
  let ink = userStrokes.filter((s) => s.length > 1).flatMap((s) => resample(s, 0.01));
  if (align && ink.length) ink = alignTo(ink, T.flat());
  if (!ink.length) return { stars: 0, cover: 0, stray: 1, connected: false, step, perStroke: target.map(() => ({ cover: 0, ends: false })), score: 0 };
  const perStroke = T.map((pts, k) => {
    const cover = pts.filter((p) => nearest(p, ink) <= tol).length / pts.length;
    const ends = target[k].closed
      ? pts.slice(0, Math.max(2, Math.round(pts.length * 0.06))).concat(pts.slice(-Math.max(2, Math.round(pts.length * 0.06)))).every((p) => nearest(p, ink) <= tol * 1.2)
      : nearest(pts[0], ink) <= tol * 1.2 && nearest(pts[pts.length - 1], ink) <= tol * 1.2;
    return { cover, ends };
  });
  const allT = T.flat();
  const cover = allT.filter((p) => nearest(p, ink) <= tol).length / allT.length;
  const stray = ink.filter((p) => nearest(p, allT) > tol).length / ink.length;
  const connected = perStroke.every((s) => s.ends);
  const R = STAR_RULES;
  const stars = cover >= R.three.cover && stray <= R.three.stray && connected ? 3 : cover >= R.two.cover && stray <= R.two.stray ? 2 : 1;
  return { stars, cover, stray, connected, step, perStroke, score: Math.round(100 * (0.6 * cover + 0.4 * (1 - stray))) };
}

export function sayFor(item, o) {
  const closed = parsePath(item.d).some((s) => s.closed);
  if (o.stars === 3) return closed ? '잘 닫았어요! 멋져요.' : '끝까지 잘 이었어요!';
  if (o.stars === 0) return '선을 그려 봐요.';
  if (!o.connected && o.cover >= 0.6) return closed ? '처음 자리까지 돌아와서 닫아요.' : '끝점까지 닿게 그려요.';
  if (o.stray > 0.4) return '선을 따라 천천히 그려요.';
  if (o.cover < 0.6) return '모양을 끝까지 이어 그려요.';
  return '조금만 더 선을 따라 그려요.';
}
