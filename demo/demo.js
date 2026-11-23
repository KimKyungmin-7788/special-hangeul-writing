// 엔진 확인용 화면. 엔진(src/)은 화면을 모르고, 이 파일이 그리기·소리·결과 표시를 맡는다.
import { evaluate, checkStroke, listChars, getTemplate } from '../src/engine.js';
import { feedbackKo, speechKo, explainKo } from '../src/feedback-ko.js';
import { ENGINE_VERSION } from '../src/engine.js';
import { submitAttempt, isWriter, isTeacher, SCHOOL, SCHOOL_NAME } from './server.js';

const $ = (id) => document.getElementById(id);
const pad = $('pad'), ctx = pad.getContext('2d');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const GROUP_NAME = { consonant: '자음', vowel: '모음', syllable: '가나다' };
let group = 'consonant';
let chars = listChars(group);
const best = {}; // 글자별 최고 점수(이 화면에서만, 저장 안 함)
let current = chars[0];
let strokes = [];   // 확정된 획들 (0~1 좌표)
let drawing = null; // 지금 긋는 획
let animating = false;

// ---------- 캔버스 ----------
function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const size = pad.clientWidth;
  pad.width = size * dpr; pad.height = size * dpr;
  ctx.setTransform(dpr * size, 0, 0, dpr * size, 0, 0); // 좌표를 0~1로 쓰기
  redraw();
}

// 연필 선: 흑연 가닥 여러 개를 살짝 어긋나게 겹친다. 같은 획은 다시 그려도 같은 모양이 되도록 점 번호로 흔들림을 정한다
const wob = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v) - 0.5; };
function pencilLine(c, points, width, rgb = '58,58,60', alpha = 1) {
  if (!points.length) return;
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  const pts = points.length === 1 ? [points[0], { x: points[0].x + 0.001, y: points[0].y }] : points;
  for (let k = 0; k < 5; k++) {
    const off = (k - 2) * width * 0.2;
    c.strokeStyle = `rgba(${rgb},${alpha * (0.6 + (wob(k, 7) + 0.5) * 0.3)})`; // 진한 연필(4B 정도)
    c.lineWidth = width * (0.34 + (wob(k, 3) + 0.5) * 0.18);
    c.beginPath();
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const o = off + wob(i, k) * width * 0.12;
      const x = p.x - (dy / L) * o, y = p.y + (dx / L) * o;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    });
    c.stroke();
  }
  c.restore();
}

function line(points, color, width) {
  if (!points.length) return;
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  if (points.length === 1) ctx.lineTo(points[0].x + 0.001, points[0].y);
  ctx.stroke();
}

// 획의 앞부분 k(0~1, 길이 비율)만 잘라 낸다. 끝점은 점 사이를 보간해서, 그리는 동안 선이 매끄럽게 자란다
function partialPath(pts, k) {
  if (k >= 1 || pts.length < 2) return pts;
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let left = seg.reduce((a, v) => a + v, 0) * Math.max(0, k);
  const out = [pts[0]];
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]) {
      const t = seg[i] ? left / seg[i] : 0, a = pts[i], b = pts[i + 1];
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return out;
    }
    left -= seg[i]; out.push(pts[i + 1]);
  }
  return out;
}

// 안내 글자 진하기(1 보통 → 0.1 거의 안 보임). S를 한 번 받으면 흐려지고, 흐린 채로 또 S를 받으면 다음 글자로 넘어간다
let guideAlpha = 1, guideFaded = false, guideFadeRaf = null;
const GUIDE_FAINT = 0.1;
function setGuideFaded(faded, animate = true) {
  guideFaded = faded;
  cancelAnimationFrame(guideFadeRaf);
  const to = faded ? GUIDE_FAINT : 1, from = guideAlpha, t0 = performance.now(), dur = animate ? 700 : 0;
  const step = (now) => {
    const k = dur ? Math.min(1, (now - t0) / dur) : 1;
    guideAlpha = from + (to - from) * (1 - (1 - k) ** 3);
    redraw();
    if (k < 1) guideFadeRaf = requestAnimationFrame(step);
  };
  if (dur) guideFadeRaf = requestAnimationFrame(step); else step(t0);
}

function drawGuide(upto = Infinity, partial = 1) {
  ctx.save();
  ctx.setLineDash([0.015, 0.015]);
  line([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], css('--line'), 0.004);
  line([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], css('--line'), 0.004);
  ctx.restore();
  if (!$('guideOn').checked && upto === Infinity) return;
  ctx.save();
  if (upto === Infinity) ctx.globalAlpha = guideAlpha; // '획순 보기' 애니메이션은 늘 또렷하게
  getTemplate(current).strokes.forEach((s, i) => {
    if (i > upto) return;
    const pts = i === upto ? partialPath(s.points, partial) : s.points;
    line(pts, css('--guide'), 0.07);
    // 획 번호와 시작점
    const p = s.points[0];
    // 시작점: 빨간 색연필 동그라미, 번호는 그 왼쪽 위에
    ctx.strokeStyle = css('--red-pencil'); ctx.lineWidth = 0.006;
    ctx.beginPath(); ctx.arc(p.x, p.y, 0.026, 0.25, Math.PI * 2.1); ctx.stroke();
    ctx.fillStyle = css('--red-pencil'); ctx.font = 'bold 0.07px Gaegu, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), p.x - 0.052, p.y - 0.04);
  });
  ctx.restore();
}

function redraw() {
  ctx.clearRect(0, 0, 1, 1);
  drawGuide();
  for (const s of strokes) pencilLine(ctx, s, 0.045);
  if (drawing) pencilLine(ctx, drawing, 0.045);
}

// t: 이 글자의 첫 획을 시작한 뒤 지난 밀리초. 개발자 화면에서 쓴 순서·빠르기 그대로 다시 보여 줄 때 쓴다
let attemptT0 = 0;
function toPoint(e) {
  const r = pad.getBoundingClientRect();
  const now = e.timeStamp || performance.now();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, t: Math.max(0, Math.round(now - attemptT0)) };
}

let activePointer = null; // 지금 획을 긋고 있는 손가락·펜(동시에 하나만 받는다)
pad.addEventListener('pointerdown', (e) => {
  if (animating || drawing) return;
  // 펜슬만 받기: 펜슬로 쓰는 동안 손바닥·손가락 터치가 획으로 들어가지 않게 한다
  if ($('penOnly').checked && e.pointerType !== 'pen') return;
  e.preventDefault();
  cancelAuto(); // 다음 획을 시작하면 자동 제출 타이머 취소
  voice.stop(); // 다시 쓰기 시작하면 말하던 피드백을 멈춘다
  cancelAdvance(); // 넘어가기 전에 다시 쓰기 시작하면 이 글자에 머문다
  leaveViewing();
  activePointer = e.pointerId;
  try { pad.setPointerCapture(e.pointerId); } catch {} // 칸 밖으로 나가도 획이 끊기지 않게(실패해도 쓰기는 계속)
  if (!strokes.length) attemptT0 = e.timeStamp || performance.now();
  drawing = [toPoint(e)];
  scratch.start();
});
pad.addEventListener('pointermove', (e) => {
  if (!drawing || e.pointerId !== activePointer) return;
  // 펜슬은 화면 갱신보다 촘촘하게 점을 보내므로, 브라우저가 묶어 둔 점까지 모두 받는다
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  for (const ev of events.length ? events : [e]) {
    const p = toPoint(ev), last = drawing[drawing.length - 1];
    scratch.speed(Math.hypot(p.x - last.x, p.y - last.y));
    drawing.push(p);
  }
  redraw();
});
function endStroke(e) {
  if (!drawing || (e && e.pointerId !== activePointer)) return;
  activePointer = null;
  scratch.stop();
  const s = drawing; drawing = null;
  if ($('guided').checked) {
    const expected = strokes.length;
    const n = getTemplate(current).strokes.length;
    if (expected < n) {
      const r = checkStroke(current, expected, s, { device: $('device').value });
      if (!r.ok) {
        toast(r.wrongOrder ? `순서가 달라요! ${expected + 1}번 획을 먼저 써요.` : `방향이 반대예요! ${expected + 1}번 획의 동그라미에서 시작해요.`);
        pad.classList.remove('shake'); void pad.offsetWidth; pad.classList.add('shake');
        redraw();
        return;
      }
    }
  }
  toast('');
  strokes.push(s);
  redraw();
  startAuto(); // 펜을 뗐다: 지정 시간 안에 다음 획이 없으면 자동 제출
}
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);

// ---------- 쓴 글자 캐러셀 ----------
// 제출한 글씨는 쓰기 칸 모양 그대로 아래 캐러셀에 쌓인다(이 화면에서만, 저장 안 함).
// 카드를 누르면 그 글씨와 결과를 큰 칸으로 불러오고, 불러온 상태에서 펜을 대면 새 글쓰기가 시작된다.
const attempts = [];
let attemptSeq = 0;
let viewing = null; // 불러온 기록의 id

function drawThumb(canvas, strokesToDraw) {
  const dpr = window.devicePixelRatio || 1, size = canvas.clientWidth || 84;
  canvas.width = size * dpr; canvas.height = size * dpr;
  const c = canvas.getContext('2d');
  c.setTransform(size * dpr, 0, 0, size * dpr, 0, 0);
  c.clearRect(0, 0, 1, 1);
  c.strokeStyle = css('--line'); c.lineWidth = 1 / size; c.setLineDash([3 / size, 3 / size]);
  c.beginPath(); c.moveTo(0.5, 0); c.lineTo(0.5, 1); c.moveTo(0, 0.5); c.lineTo(1, 0.5); c.stroke();
  c.setLineDash([]);
  for (const st of strokesToDraw) pencilLine(c, st, 0.06);
}

function renderCarousel() {
  const box = $('carousel');
  box.replaceChildren();
  $('carouselEmpty').hidden = attempts.length > 0;
  for (const a of attempts) {
    const b = document.createElement('button');
    b.className = 'thumb'; b.dataset.id = a.id;
    b.setAttribute('aria-current', String(a.id === viewing));
    b.setAttribute('aria-label', `${a.char} ${a.n}번째, ${a.result.score}점. 눌러서 불러오기`);
    const cv = document.createElement('canvas');
    const badge = document.createElement('span'); badge.className = 'badge';
    badge.textContent = `${a.result.grade} ${a.result.score}`;
    badge.style.background = `var(${gradeColor(a.result.grade)})`;
    const cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = `${a.char} · ${a.n}번째`;
    b.append(cv, badge, cap);
    b.onclick = () => loadAttempt(a.id);
    box.append(b);
    drawThumb(cv, a.strokes);
  }
}

// 쓴 칸이 작아지며 캐러셀 끝 카드 자리로 날아가는 효과
// 카드가 캐러셀로 내려갈 때: 종이가 스윽 미끄러지는 소리 + 내려앉는 작은 톡(효과음 켰을 때만)
function cardSound() {
  if (!$('sfxOn').checked) return;
  const ac = scratch.ctx(); if (!ac) return;
  const t = ac.currentTime + 0.01;
  // 스윽: 잡음을 대역 필터로 걸러 높은 데서 낮은 쪽으로
  const len = Math.floor(ac.sampleRate * 0.4), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(); src.buffer = buf;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(700, t + 0.38);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  src.connect(bp).connect(g).connect(ac.destination); src.start(t); src.stop(t + 0.42);
  // 톡: 카드가 내려앉을 때(날아가는 애니메이션 0.48초에 맞춤)
  const at = t + 0.44, o = ac.createOscillator(), og = ac.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(420, at); o.frequency.exponentialRampToValueAtTime(220, at + 0.08);
  og.gain.setValueAtTime(0.0001, at); og.gain.exponentialRampToValueAtTime(0.18, at + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
  o.connect(og).connect(ac.destination); o.start(at); o.stop(at + 0.14);
}

function sendToCarousel(a) {
  cardSound();
  const from = pad.getBoundingClientRect();
  const snapshot = pad.toDataURL();
  renderCarousel();
  const box = $('carousel');
  box.scrollLeft = box.scrollWidth; // 새 카드가 보이게 끝으로
  const card = box.querySelector(`.thumb[data-id="${a.id}"]`);
  if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = card.querySelector('canvas').getBoundingClientRect();
  card.style.opacity = '0';
  const img = new Image();
  img.src = snapshot;
  img.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;`
    + 'z-index:50;pointer-events:none;border-radius:14px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);transform-origin:0 0';
  document.body.append(img);
  const anim = img.animate([
    { transform: 'none', opacity: 1 },
    { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})`, opacity: 0.85 },
  ], { duration: 480, easing: 'cubic-bezier(.3,.7,.2,1)' });
  anim.onfinish = () => { img.remove(); card.style.opacity = ''; };
}

// ---------- 획순 시범(모델링) ----------
// 쓰기 칸 오른쪽에 같은 크기로 서서, 글자를 획순대로 쓰는 모습을 계속 되풀이해 보여 준다.
// 켜고 끄기(획순 시범 버튼)와 재생·멈춤(칸 오른쪽 위 버튼)은 이 기기에 기억한다.
const model = $('model'), mctx = model.getContext('2d');
const modelWrap = $('modelWrap'), modelPlayBtn = $('modelPlay'), modelBtn = $('modelBtn');
const MODEL_ON_KEY = 'hw-pref-modelOn', MODEL_PLAY_KEY = 'hw-pref-modelPlay', MODEL_SPEED_KEY = 'hw-pref-modelSpeed';
const speedBtns = [...document.querySelectorAll('.speed button')];
let modelSpeed = 1; // 0.6 느리게, 1 보통, 1.6 빠르게
const MODEL_GAP = 300, MODEL_HOLD = 1400; // 획 사이 쉼, 다 쓴 뒤 멈춰 보여 주는 시간(ms)
let modelOn = true, modelPlaying = !matchMedia('(prefers-reduced-motion: reduce)').matches;
try {
  const on = localStorage.getItem(MODEL_ON_KEY); if (on !== null) modelOn = on === '1';
  const pl = localStorage.getItem(MODEL_PLAY_KEY); if (pl !== null) modelPlaying = pl === '1';
  const sp = Number(localStorage.getItem(MODEL_SPEED_KEY)); if (speedBtns.some((b) => Number(b.dataset.speed) === sp)) modelSpeed = sp;
} catch {}
let modelT = 0, modelLast = null, modelRaf = null;

const strokeLen = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
// 획마다 [시작, 끝] 시각. 긴 획은 조금 더 천천히
function modelPlan() {
  let t = 0;
  const spans = getTemplate(current).strokes.map((s, i) => {
    const d = 350 + strokeLen(s.points) * 1100;
    const span = [t + (i ? MODEL_GAP : 0), t + (i ? MODEL_GAP : 0) + d];
    t = span[1];
    return span;
  });
  return { spans, total: t + MODEL_HOLD };
}

function fitModel() {
  const dpr = window.devicePixelRatio || 1, size = model.clientWidth;
  if (!size) return;
  model.width = size * dpr; model.height = size * dpr;
  mctx.setTransform(dpr * size, 0, 0, dpr * size, 0, 0);
  drawModel();
}

// 연필 그림(기기마다 다른 이모지 대신 직접 그림). 연필 끝이 (x, y)에 닿고 몸통은 오른쪽 위로
function drawPencil(c, x, y) {
  c.save();
  c.translate(x, y); c.rotate(-Math.PI / 4);
  const L = 0.12, W = 0.022, tip = 0.03;
  c.lineJoin = 'round'; c.lineWidth = 0.004; c.strokeStyle = '#495057';
  // 깎인 나무와 심
  c.fillStyle = '#f3d9a4'; c.beginPath(); c.moveTo(0, 0); c.lineTo(tip, -W / 2); c.lineTo(tip, W / 2); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#343a40'; c.beginPath(); c.moveTo(0, 0); c.lineTo(tip * 0.35, -W * 0.18); c.lineTo(tip * 0.35, W * 0.18); c.closePath(); c.fill();
  // 노란 몸통, 쇠붙이, 지우개
  c.fillStyle = '#fcc419'; c.fillRect(tip, -W / 2, L - tip - 0.03, W); c.strokeRect(tip, -W / 2, L - tip - 0.03, W);
  c.fillStyle = '#adb5bd'; c.fillRect(L - 0.03, -W / 2, 0.012, W); c.strokeRect(L - 0.03, -W / 2, 0.012, W);
  c.fillStyle = '#ff8787'; c.fillRect(L - 0.018, -W / 2, 0.018, W); c.strokeRect(L - 0.018, -W / 2, 0.018, W);
  c.restore();
}

function drawModel() {
  if (!modelOn) return;
  const c = mctx, { spans, total } = modelPlan();
  const t = modelT % total;
  const seg = (pts, color, w) => {
    if (!pts.length) return;
    c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) c.lineTo(p.x, p.y);
    if (pts.length === 1) c.lineTo(pts[0].x + 0.001, pts[0].y);
    c.stroke();
  };
  c.clearRect(0, 0, 1, 1); // 시범 화면에는 십자선을 두지 않는다(학생이 쓰는 칸과 헷갈리지 않게)
  const tpl = getTemplate(current).strokes;
  tpl.forEach((s) => seg(s.points, css('--model-under'), 0.07)); // 글자 전체를 아주 옅게
  tpl.forEach((s, i) => {
    const [a, b] = spans[i];
    if (t < a) return;
    const k = Math.min(1, (t - a) / (b - a));
    const pts = partialPath(s.points, k);
    seg(pts, css('--model-ink'), 0.05);
    // 지금 쓰는 획은 펜 끝을 보여 준다
    if (k < 1) {
      const p = pts[pts.length - 1];
      c.fillStyle = css('--accent'); c.beginPath(); c.arc(p.x, p.y, 0.014, 0, Math.PI * 2); c.fill();
      drawPencil(c, p.x, p.y); // 누가 쓰고 있는 걸 보는 느낌: 펜 끝에 연필
    }
  });
  // 획 번호: 이미 시작한 획과 다음에 쓸 획의 시작점
  tpl.forEach((s, i) => {
    if (t < spans[i][0] && !(i === 0 || t >= spans[i - 1][1])) return;
    const p = s.points[0];
    c.fillStyle = css('--accent'); c.beginPath(); c.arc(p.x, p.y, 0.022, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 0.03px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(i + 1), p.x, p.y + 0.001);
  });
}

function modelTick(ts) {
  // 탭을 오래 비웠다 돌아와도 건너뛰지 않게 한 번에 0.1초까지만 넘긴다
  if (modelLast !== null) modelT += Math.min(100, ts - modelLast) * modelSpeed;
  modelLast = ts;
  drawModel();
  modelRaf = requestAnimationFrame(modelTick);
}
function syncModel() {
  modelWrap.classList.toggle('off', !modelOn); // 꺼도 자리는 그대로 두어 쓰기 칸이 움직이지 않게
  document.querySelector('main').classList.toggle('with-model', modelOn);
  modelBtn.setAttribute('aria-pressed', String(modelOn));
  speedBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === modelSpeed)));
  modelPlayBtn.textContent = modelPlaying ? '❚❚' : '▶';
  modelPlayBtn.setAttribute('aria-label', modelPlaying ? '획순 시범 멈추기' : '획순 시범 재생');
  if (modelRaf) cancelAnimationFrame(modelRaf);
  modelRaf = null; modelLast = null;
  if (modelOn && modelPlaying) modelRaf = requestAnimationFrame(modelTick);
  else drawModel();
}
// 글자가 바뀌면 처음부터
function resetModel() { modelT = 0; drawModel(); }
modelBtn.onclick = () => {
  modelOn = !modelOn;
  try { localStorage.setItem(MODEL_ON_KEY, modelOn ? '1' : '0'); } catch {}
  syncModel();
};
for (const b of speedBtns) b.onclick = () => {
  modelSpeed = Number(b.dataset.speed);
  try { localStorage.setItem(MODEL_SPEED_KEY, String(modelSpeed)); } catch {}
  syncModel();
};
// 시범 화면을 눌렀으면 학생 칸을 알려 준다
model.addEventListener('pointerdown', () => {
  toast('여기는 시범이에요. 왼쪽 칸에 써요 ✏️');
  const w = $('padWrap'); w.classList.remove('nudge'); void w.offsetWidth; w.classList.add('nudge');
  setTimeout(() => w.classList.remove('nudge'), 1900);
});
modelPlayBtn.onclick = () => {
  modelPlaying = !modelPlaying;
  try { localStorage.setItem(MODEL_PLAY_KEY, modelPlaying ? '1' : '0'); } catch {}
  syncModel();
};

function loadAttempt(id) {
  const a = attempts.find((x) => x.id === id);
  if (!a) return;
  cancelAuto();
  viewing = id;
  const g = getTemplate(a.char).group;
  if (g !== group) { group = g; chars = listChars(group); }
  if (current !== a.char && guideFaded) setGuideFaded(false, false);
  current = a.char;
  strokes = a.strokes.map((st) => st.map((p) => ({ ...p })));
  resetModel();
  toast('불러온 글씨예요. 펜을 대면 새로 쓰기 시작해요.');
  redraw();
  showResult(a.result, a);
  renderCarousel();
}

// 불러온 글씨를 보다가 펜을 대면 비우고 새 글쓰기로
function leaveViewing() {
  if (!viewing) return;
  viewing = null;
  strokes = [];
  toast('');
  renderCarousel();
}

// ---------- 자동 제출: 두근두근 카운트 ----------
// 펜을 떼면 1초마다 쓰기 칸이 한 번 꿀렁이며 반짝이고 두근 소리가 난다(설정한 초만큼: 1초면 한 번, 2초면 두 번).
// 그사이 다음 획이 없으면 '다 썼어요'를 누른 것처럼 채점하고, 쓴 칸은 아래 캐러셀로 들어간다.
let autoRun = null;
function cancelAuto() {
  if (autoRun) cancelAnimationFrame(autoRun.raf);
  autoRun = null;
  $('autoBar').classList.remove('on'); $('autoBarFill').style.transform = 'scaleX(0)';
  $('padWrap').classList.remove('beat', 'last');
}
function pulse(last) {
  $('padWrap').classList.remove('beat', 'last');
  void $('padWrap').offsetWidth; // 애니메이션을 처음부터 다시
  $('padWrap').classList.add('beat');
  if (last) $('padWrap').classList.add('last');
  heart(last ? 1.25 : 1);
  if ($('sfxOn').checked && navigator.vibrate) { try { navigator.vibrate(last ? [40, 120, 30] : [25, 120, 18]); } catch {} }
}
const AUTO_DELAY = 500; // 펜을 뗀 뒤 첫 꿀렁까지 잠깐 기다림(ms). 이어서 다음 획을 쓰려던 학생을 재촉하지 않게
function startAuto() {
  cancelAuto();
  const sec = Number($('autoSec').value);
  if (!(sec > 0) || !strokes.length) return; // 0초면 꺼짐
  const dur = sec * 1000, t0 = performance.now(), beats = Math.ceil(sec);
  let done = 0;
  $('autoBar').classList.add('on');
  const tick = (now) => {
    const el = now - t0 - AUTO_DELAY;
    if (el < 0) { autoRun.raf = requestAnimationFrame(tick); return; }
    $('autoBarFill').style.transform = `scaleX(${Math.min(1, el / dur)})`; // 칸 위 진행(연필이 지나간 자리)
    $('autoPencil').style.left = `${Math.min(1, el / dur) * 100}%`;
    // 기다린 뒤 0초, 1초, 2초 ... 에 한 번씩 뛴다. 마지막 박동이 가장 크다
    while (done < beats && el >= done * 1000) { pulse(done === beats - 1); done++; }
    if (el >= dur) { cancelAuto(); score(); return; }
    autoRun.raf = requestAnimationFrame(tick);
  };
  autoRun = { raf: requestAnimationFrame(tick) };
}

// 쿵 소리: 낮은 '쿵' 한 번. 작은 스피커에서도 들리게 배음을 섞는다
function heart(strength = 1) {
  if (!$('sfxOn').checked) return;
  const ac = scratch.ctx(); if (!ac) return;
  const t = ac.currentTime + 0.01;
  const thump = (at, g) => {
    for (const [type, f0, f1, mul] of [['sine', 95, 42, 1], ['triangle', 190, 84, 0.35]]) {
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + 0.14);
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.exponentialRampToValueAtTime(Math.min(1, 0.8 * g * mul), at + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      o.connect(gn).connect(ac.destination); o.start(at); o.stop(at + 0.24);
    }
  };
  thump(t, strength); // 칸이 한 번 꿀렁일 때 '쿵' 한 번
}

// ---------- 서걱 소리 (Web Audio 잡음) ----------
const scratch = (() => {
  let ac, gain;
  function init() {
    ac = new AudioContext();
    const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.8;
    gain = ac.createGain(); gain.gain.value = 0;
    src.connect(bp).connect(gain).connect(ac.destination); src.start();
  }
  return {
    start() { if (!ac) init(); ac.resume(); },
    ctx() { return ac || null; }, // 두근 소리도 같은 소리 장치를 쓴다(첫 터치에서 켜짐)
    speed(v) { if (gain && $('sfxOn').checked) gain.gain.setTargetAtTime(Math.min(0.25, v * 12), ac.currentTime, 0.02); },
    stop() { if (gain) gain.gain.setTargetAtTime(0, ac.currentTime, 0.05); },
  };
})();

// ---------- 소리 피드백 (브라우저 음성 합성) ----------
// 기기에 설치된 한국어 음성을 먼저 고른다. 없으면 브라우저가 주는 한국어 음성(네트워크일 수 있음)을 쓴다.
// 읽는 글은 피드백 문장뿐이고, 학생이 쓴 글씨는 보내지 않는다. 한국어 음성이 없으면 말하지 않는다.
const voice = (() => {
  const synth = window.speechSynthesis;
  let ko = null, unlocked = false;
  const pick = () => {
    const vs = (synth ? synth.getVoices() : []).filter((v) => /^ko/i.test(v.lang));
    ko = vs.find((v) => v.localService) || vs[0] || null;
  };
  if (synth) { pick(); synth.addEventListener?.('voiceschanged', pick); }
  return {
    // 아이패드 사파리는 첫 소리를 손가락으로 누를 때 내야 이후 자동으로도 말할 수 있다
    unlock() {
      if (!synth || unlocked) return;
      unlocked = true;
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch {}
    },
    say(text) {
      if (!synth || !text) return;
      if (!ko) pick();
      if (!ko) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = ko; u.lang = ko.lang; u.rate = 0.95;
      synth.speak(u);
    },
    stop() { if (synth && synth.speaking) synth.cancel(); },
    available: () => !!synth,
  };
})();
document.addEventListener('pointerdown', () => voice.unlock(), { capture: true });

// ---------- 획순 애니메이션 ----------
async function animate() {
  if (animating) return;
  cancelAuto();
  animating = true;
  const n = getTemplate(current).strokes.length;
  // 화면 갱신마다(requestAnimationFrame) 지난 시간으로 그려서 끊기지 않게
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < n; i++) {
    const dur = 500, t0 = performance.now();
    for (let t = 0; t < 1;) {
      t = Math.min(1, (await frame() - t0) / dur);
      ctx.clearRect(0, 0, 1, 1);
      drawGuide(i, t);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  animating = false;
  redraw();
}

// ---------- 채점 결과 ----------
const gradeColor = (g) => ({ S: '--good', A: '--good', B: '--accent', C: '--warn', F: '--bad' }[g]);
const PART_LABEL = { order: '획순', direction: '방향', shape: '모양', placement: '자리·크기' };

function score() {
  cancelAuto();
  // 캐러셀에서 불러온 글씨를 보고 있을 때는 새 기록을 만들지 않고 그 결과만 다시 보여 준다
  if (viewing) { const a = attempts.find((x) => x.id === viewing); if (a) showResult(a.result, a); return; }
  const device = $('device').value;
  const r = evaluate(current, strokes, { device });
  best[current] = Math.max(best[current] ?? 0, r.score);
  if (!strokes.length) { showResult(r, null); return; }
  const a = { id: ++attemptSeq, char: current, strokes, device, result: r, n: attempts.filter((x) => x.char === current).length + 1 };
  a.serverId = send(a); // 학생·교사로 접속했으면 서버에 보낸다(둘러보기는 보내지 않음)
  attempts.push(a);
  showResult(r, a);
  // 점수가 낮거나, 높아도 고칠 점이 있으면 한 문장으로 말해 준다
  if ($('voiceOn').checked) voice.say(speechKo(r));
  sendToCarousel(a); // 쓴 칸이 아래 캐러셀로 날아가 쌓이고
  strokes = [];      // 큰 쓰기 칸은 자동으로 비워 새 글쓰기를 준비한다
  redraw();
  if (r.grade === 'S' && $('autoNext').checked) {
    // 첫 S: 안내 글자를 거의 안 보이게 흐리고 한 번 더. 흐린 채로 S: 다음 글자로
    if (!guideFaded && $('guideOn').checked) { setGuideFaded(true); toast('S! 이번엔 안내 글자 없이 써 봐요.'); }
    else scheduleAdvance();
  }
}

// ---------- S를 받으면 다음 글자로 ----------
// 잠깐 칭찬을 보여 준 뒤 다음 글자로 넘어간다. 결과 칸(교사 표본 입력)은 그대로 두어, 넘어간 뒤에도 표본을 저장할 수 있다.
// 그사이 다시 쓰기 시작하거나 다른 글자를 고르면 넘어가지 않는다.
const ADVANCE_MS = 1300;
let advanceTimer = null;
function cancelAdvance() { if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; } }
function scheduleAdvance() {
  cancelAdvance();
  const i = chars.indexOf(current);
  if (i < 0 || i === chars.length - 1) { toast(`S! ${GROUP_NAME[group]} 마지막 글자까지 왔어요.`); return; }
  const next = chars[i + 1];
  toast(`S! 다음 글자 '${next}'로 넘어가요.`);
  advanceTimer = setTimeout(() => {
    advanceTimer = null;
    current = next; strokes = []; toast(''); setGuideFaded(false, false);
    renderGrid(); redraw(); resetModel();
  }, ADVANCE_MS);
}

function whyLine(r) {
  const box = document.createElement('div'); box.className = 'why';
  const h = document.createElement('b'); h.textContent = '왜 이 점수?'; box.append(h);
  for (const k of explainKo(r)) { const s = document.createElement('span'); s.className = `k-${k.kind}`; s.textContent = k.text; box.append(s); }
  return box;
}

// 채점 결과: 점수·등급·별과 한마디만. 선생님에게는 '자세히'(부분 점수·왜 이 점수)를 접어서 둔다
// 포스트잇 자리: 시범 칸 오른쪽에 넉넉한 빈자리가 있으면 거기, 없으면(아이패드 세로 등) 왼쪽 버튼 아래 빈자리에.
// 어느 쪽이든 떠 있어서 다른 것을 밀지 않는다
function placeNote() {
  const note = $('result'), side = document.querySelector('.side'), work = document.querySelector('.work');
  if (!note) return;
  if (innerWidth <= 640) { // 휴대폰: 쓴 글자 모음 오른쪽 빈자리에
    const car = document.querySelector('.carousel-wrap');
    note.classList.remove('left'); note.classList.add('phone');
    note.style.top = `${car.getBoundingClientRect().top - work.getBoundingClientRect().top}px`;
    return;
  }
  note.classList.remove('phone');
  // 두 칸은 가운데 정렬이므로 오른쪽 빈자리 = (종이 줄 너비 − 두 칸 너비) / 2
  const free = ($('padRow').clientWidth - (2 * padSize + PAD_GAP)) / 2;
  const left = free < 218;
  note.classList.toggle('left', left);
  note.style.top = left ? `${side.offsetTop + side.offsetHeight + 14}px` : '';
}
function showResult(r) {
  const el = $('result');
  el.replaceChildren();
  const head = document.createElement('div'); head.className = 'score';
  head.innerHTML = `<b>${r.score}</b><small>점</small> <span class="grade" style="background:var(${gradeColor(r.grade)})">${r.grade}</span> <span class="stars" aria-label="별 ${r.stars}개">${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</span>`;
  const msg = document.createElement('div'); msg.className = 'say';
  const txt = document.createElement('span'); txt.textContent = feedbackKo(r).join(' ');
  msg.append(txt);
  const line = speechKo(r);
  if (line && voice.available()) {
    const again = document.createElement('button'); again.type = 'button'; again.textContent = '🔊 다시 듣기';
    again.onclick = () => voice.say(line);
    msg.append(again);
  }
  const close = document.createElement('button'); close.type = 'button'; close.className = 'note-close';
  close.textContent = '✕'; close.setAttribute('aria-label', '점수 닫기');
  close.onclick = () => el.replaceChildren();
  el.append(close, head, msg);
  placeNote();
  if (writer && isTeacher(writer)) {
    const det = document.createElement('details'); det.className = 'more';
    const sum = document.createElement('summary'); sum.textContent = '자세히'; det.append(sum);
    for (const [k, label] of Object.entries(PART_LABEL)) {
      const row = document.createElement('div'); row.className = 'bar';
      const pct = Math.round(r.parts[k] * 100);
      row.innerHTML = `<span>${label}</span><i><span style="width:${pct}%"></span></i><span>${pct}</span>`;
      det.append(row);
    }
    det.append(whyLine(r));
    el.append(det);
  }
  renderGrid();
}

// ---------- 쓰는 사람(작성자 코드)과 서버 보내기 ----------
// 학생은 '초-3-01'처럼 학교급-학년-번호만, 교사는 '교사-이름/번호'. 실명 입력칸은 없다.
// 고른 코드는 이 기기에 기억하고, 공용 기기는 '바꾸기'로 바꾼다. 둘러보기는 서버에 보내지 않는다.
const WRITER_KEY = 'hw-writer', OUTBOX_KEY = 'hw-outbox';
let writer = null; // null이면 둘러보기
try { const w = localStorage.getItem(WRITER_KEY); if (w && isWriter(w)) writer = w; } catch {}
let outbox = [];
try { outbox = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { outbox = []; }
const saveOutbox = () => { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox.slice(-200))); } catch {} };

function packStrokes(st) {
  return st.map((s) => s.map((p) => [round3(p.x), round3(p.y), Math.round(p.t ?? 0)]));
}
// 서버에 보내고 서버 id를 돌려준다. 실패하면 이 기기에 모아 두었다가 다음에 다시 보낸다
function send(a) {
  if (!writer) return null;
  const item = { writer, ch: a.char, device: a.device, strokes: packStrokes(a.strokes),
    engineScore: a.result.score, engineIssues: a.result.issues.map((i) => i.code), engineVersion: ENGINE_VERSION };
  return submitAttempt(item).then((id) => { flushOutbox(); return id; })
    .catch((e) => { if (!/bad_writer|too_large/.test(e.message)) { outbox.push(item); saveOutbox(); } return null; })
    .finally(renderWho);
}
let flushing = false;
async function flushOutbox() {
  if (flushing || !outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) { await submitAttempt(outbox[0]); outbox.shift(); saveOutbox(); }
  } catch {} finally { flushing = false; renderWho(); }
}
window.addEventListener('online', flushOutbox);

function renderWho() {
  $('whoName').textContent = writer || '둘러보기';
  $('whoSync').textContent = !writer ? '(저장 안 함)' : outbox.length ? `· 보내기 대기 ${outbox.length}개` : '';
}
// 쓰는 사람이 바뀌면 이전 사람의 결과·표본 칸을 지운다
function renderResultEmpty() { $('result').replaceChildren(); }

// 고르기 화면
const gate = (() => {
  const st = { role: null, school: null, grade: null };
  const pick = (box, v) => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const code = () => {
    if (st.role === 'student') {
      const n = Number($('gNum').value);
      if (!st.school || !st.grade || !Number.isInteger(n) || n < 1 || n > 99) return null;
      return `${st.school}-${st.grade}-${String(n).padStart(2, '0')}`;
    }
    if (st.role === 'teacher') { const t = $('gTname').value.trim(); return t ? `교사-${t}` : null; }
    return null;
  };
  const update = () => {
    const c = code();
    const ok = !!c && isWriter(c);
    $('gPreview').textContent = c || '';
    $('gGo').disabled = !ok;
    $('gErr').textContent = c && !ok ? '한글·영문·숫자만 10자까지 쓸 수 있어요.' : '';
  };
  const grades = () => {
    const box = $('gGrade'); box.replaceChildren();
    if (!st.school) return;
    if (st.grade > SCHOOL[st.school]) st.grade = null;
    for (let g = 1; g <= SCHOOL[st.school]; g++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.v = String(g); b.textContent = `${g}학년`;
      b.onclick = () => { st.grade = g; pick(box, String(g)); update(); };
      box.append(b);
    }
    pick(box, String(st.grade));
  };
  for (const [k, name] of Object.entries(SCHOOL_NAME)) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.v = k; b.textContent = name;
    b.onclick = () => { st.school = k; pick($('gSchool'), k); grades(); update(); };
    $('gSchool').append(b);
  }
  $('gRole').querySelectorAll('button').forEach((b) => { b.onclick = () => {
    st.role = b.dataset.v; pick($('gRole'), st.role);
    $('gStudent').hidden = st.role !== 'student'; $('gTeacher').hidden = st.role !== 'teacher';
    update();
  }; });
  $('gNum').oninput = update; $('gTname').oninput = update;
  const close = () => { $('gate').hidden = true; renderWho(); renderResultEmpty(); flushOutbox(); };
  $('gGo').onclick = () => {
    const c = code(); if (!c || !isWriter(c)) return;
    writer = c; try { localStorage.setItem(WRITER_KEY, c); } catch {}
    close();
  };
  $('gSkip').onclick = () => { writer = null; try { localStorage.removeItem(WRITER_KEY); } catch {} close(); };
  // 처음 화면을 버튼으로 열었을 때는 바꾸지 않고 닫을 수 있다(✕, Esc)
  const dismiss = () => { $('gate').hidden = true; };
  $('gClose').onclick = dismiss;
  $('gate').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('gClose').hidden) dismiss(); });
  return { open(canClose = false) { $('gClose').hidden = !canClose; $('gate').hidden = false; update(); $('gRole').querySelector('button').focus(); } };
})();
$('whoChange').onclick = () => gate.open(true);
// ⚙ 설정 서랍: 바깥을 누르거나 Esc로 닫는다
const setPanel = $('settings'), setBtn = $('setBtn');
const setOpen = (on) => { setPanel.hidden = !on; setBtn.setAttribute('aria-expanded', String(on)); };
setBtn.onclick = (e) => { e.stopPropagation(); setOpen(setPanel.hidden); };
document.addEventListener('pointerdown', (e) => { if (!setPanel.hidden && !setPanel.contains(e.target) && e.target !== setBtn) setOpen(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !setPanel.hidden) { setOpen(false); setBtn.focus(); } });
$('setWho').onclick = () => { setOpen(false); gate.open(true); };
$('brand').onclick = () => gate.open(true);

// 표본 작성(교사·개발자 점수와 평가 항목)은 글씨 채점실(/dev)에서 한다. 연습 화면은 쓰기에만 집중한다.
const round3 = (v) => Math.round(v * 1000) / 1000;

// ---------- 글자 목록 ----------
function renderGrid() {
  const grid = $('charGrid');
  grid.replaceChildren();
  for (const ch of chars) {
    const b = document.createElement('button');
    b.className = 'cell'; b.textContent = ch;
    b.setAttribute('aria-current', ch === current);
    b.setAttribute('aria-label', `${getTemplate(ch).name}${best[ch] != null ? `, 최고 ${best[ch]}점` : ''}`);
    if (best[ch] != null) {
      const g = best[ch] >= 90 ? 'S' : best[ch] >= 80 ? 'A' : best[ch] >= 70 ? 'B' : best[ch] >= 60 ? 'C' : 'F';
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = g;
      badge.style.background = `var(${gradeColor(g)})`;
      b.append(badge);
    }
    b.onclick = () => select(ch);
    grid.append(b);
  }
  $('progress').textContent = `${chars.filter((c) => best[c] != null).length}/${chars.length}`;
  $('groupName').textContent = GROUP_NAME[group];
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.group === group));
}

document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => { group = t.dataset.group; chars = listChars(group); select(chars[0]); };
});

function select(ch) {
  cancelAuto(); cancelAdvance();
  if (viewing) { viewing = null; renderCarousel(); }
  current = ch; strokes = []; toast(''); if (guideFaded) setGuideFaded(false, false);
  $('result').replaceChildren();
  renderGrid(); redraw(); resetModel();
}

function toast(msg) { $('toast').textContent = msg; }

$('animBtn').onclick = animate;
$('clearBtn').onclick = () => { cancelAuto(); cancelAdvance(); leaveViewing(); strokes = []; toast(''); redraw(); };
$('doneBtn').onclick = score;
$('guideOn').onchange = redraw;
// 펜슬만 받기·입력 기기는 이 기기(브라우저)에 기억해 둔다
$('voiceOn').addEventListener('change', () => { if (!$('voiceOn').checked) voice.stop(); });
for (const id of ['penOnly', 'device', 'autoSec', 'voiceOn', 'autoNext', 'sfxOn']) {
  const el = $(id), key = 'hw-pref-' + id;
  try { const v = localStorage.getItem(key); if (v !== null) { if (el.type === 'checkbox') el.checked = v === '1'; else el.value = v; } } catch {}
  el.addEventListener('change', () => { try { localStorage.setItem(key, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value); } catch {} });
}
window.addEventListener('resize', () => { setPadSize(padWanted, false); });

// ---------- 쓰기 칸 크기 조절 ----------
// 획은 칸 기준 0~1 좌표로 저장되므로 크기를 바꿔도 그대로 맞춰 다시 그려지고 채점도 같다.
const PAD_GAP = 28; // 쓰기 칸과 시범 칸 사이(크기 조절 손잡이가 끼지 않게). index.html의 .pad-row gap과 같아야 한다
// 칸 크기는 실제 종이의 십자칸처럼 1.5cm ~ 5cm. 화면의 1cm가 몇 픽셀인지는 브라우저가 알려 주지 않으므로
// 기기 종류로 어림한다(CSS 픽셀/cm): 아이패드 약 52(264ppi, 2배), 휴대폰 약 63, 컴퓨터는 CSS 표준 37.8.
// 기기마다 몇 mm 차이 날 수 있다.
const PX_PER_CM = (() => {
  const touch = navigator.maxTouchPoints > 1, ua = navigator.userAgent;
  if (/iPad/.test(ua) || (touch && /Macintosh/.test(ua))) return 52;
  if (touch && Math.min(screen.width, screen.height) < 600) return 63;
  if (touch && /Android/.test(ua)) return 50;
  return 96 / 2.54;
})();
const PAD_MIN_CM = 1.5, PAD_MAX_CM = 5, PAD_STEP_CM = 0.5;
const PAD_MIN = PAD_MIN_CM * PX_PER_CM, PAD_MAX = PAD_MAX_CM * PX_PER_CM, PAD_STEP = PAD_STEP_CM * PX_PER_CM, PAD_KEY = 'hw-pref-padCm';
const padWrap = $('padWrap'), padHandle = $('padResize'), padLabel = $('padSizeLabel');
let padSize = PAD_MAX;
let padWanted = PAD_MAX; // 선생님이 고른 크기. 모델링을 켜서 줄어들어도 끄면 이 크기로 돌아온다
const padMax = () => {
  // 시범을 켜든 끄든 쓰기 칸과 시범 칸이 사이 PAD_GAP을 두고 나란히 들어갈 크기(자리가 움직이지 않게)
  const inner = $('padRow').clientWidth;
  return Math.min(PAD_MAX, (inner - PAD_GAP) / 2);
};
const cmText = (px) => `${(px / PX_PER_CM).toFixed(1)}cm`;
function setPadSize(px, save = true) {
  const max = padMax();
  padSize = Math.round(Math.max(Math.min(PAD_MIN, max), Math.min(max, px)));
  if (save) padWanted = padSize;
  document.documentElement.style.setProperty('--pad-size', padSize + 'px');
  padHandle.setAttribute('aria-valuemin', String(Math.round(Math.min(PAD_MIN, max))));
  padHandle.setAttribute('aria-valuemax', String(Math.round(max)));
  padHandle.setAttribute('aria-valuenow', String(padSize));
  padHandle.setAttribute('aria-valuetext', cmText(padSize));
  padLabel.textContent = cmText(padSize);
  fitCanvas();
  fitModel();
  placeNote();
  if (save) { try { localStorage.setItem(PAD_KEY, (padSize / PX_PER_CM).toFixed(2)); } catch {} }
}
let padDrag = null;
padHandle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { padHandle.setPointerCapture(e.pointerId); } catch {}
  padDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, size: padWrap.getBoundingClientRect().width };
  padWrap.classList.add('resizing');
});
padHandle.addEventListener('pointermove', (e) => {
  if (!padDrag || e.pointerId !== padDrag.id) return;
  // 오른쪽·아래로 끌면 커지고 왼쪽·위로 끌면 작아진다(더 많이 움직인 쪽을 따름)
  const dx = e.clientX - padDrag.x, dy = e.clientY - padDrag.y;
  setPadSize(padDrag.size + (Math.abs(dx) > Math.abs(dy) ? dx : dy), false);
});
const endPadDrag = (e) => {
  if (!padDrag || e.pointerId !== padDrag.id) return;
  padDrag = null;
  padWrap.classList.remove('resizing');
  setPadSize(padSize);
};
padHandle.addEventListener('pointerup', endPadDrag);
padHandle.addEventListener('pointercancel', endPadDrag);
padHandle.addEventListener('keydown', (e) => {
  const d = { ArrowRight: PAD_STEP, ArrowUp: PAD_STEP, ArrowLeft: -PAD_STEP, ArrowDown: -PAD_STEP }[e.key];
  if (d) { e.preventDefault(); setPadSize(padSize + d); }
});
try { const cm = Number(localStorage.getItem(PAD_KEY)); if (cm) padSize = padWanted = cm * PX_PER_CM; } catch {}

renderGrid();
renderCarousel();
renderWho();
if (!writer) gate.open(); else flushOutbox();
syncModel();
setPadSize(padWanted, false);

// 브라우저 콘솔에서 자동 확인할 때 쓰는 손잡이
window.__hw = { evaluate, getTemplate, setStrokes: (s) => { strokes = s; redraw(); }, score, select };
