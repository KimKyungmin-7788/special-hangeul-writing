// 엔진 확인용 화면. 엔진(src/)은 화면을 모르고, 이 파일이 그리기·소리·결과 표시를 맡는다.
import { evaluate, checkStroke, listChars, getTemplate } from '../src/engine.js';
import { feedbackKo, speechKo, explainKo, ISSUE_NAMES_KO } from '../src/feedback-ko.js';
import { ENGINE_VERSION } from '../src/engine.js';
import { submitAttempt, teacherLabel, isWriter, isTeacher, SCHOOL, SCHOOL_NAME } from './server.js';
import { copyText } from './copy.js';

const $ = (id) => document.getElementById(id);
const pad = $('pad'), ctx = pad.getContext('2d');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const GROUP_NAME = { consonant: '자음', vowel: '모음' };
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
    ctx.fillStyle = css('--accent');
    ctx.beginPath(); ctx.arc(p.x, p.y, 0.022, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 0.03px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), p.x, p.y + 0.001);
  });
  ctx.restore();
}

function redraw() {
  ctx.clearRect(0, 0, 1, 1);
  drawGuide();
  for (const s of strokes) line(s, css('--pen'), 0.035);
  if (drawing) line(drawing, css('--pen'), 0.035);
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
  c.setLineDash([]); c.strokeStyle = css('--pen'); c.lineWidth = 0.05; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const st of strokesToDraw) {
    c.beginPath(); c.moveTo(st[0].x, st[0].y);
    for (const p of st.slice(1)) c.lineTo(p.x, p.y);
    if (st.length === 1) c.lineTo(st[0].x + 0.001, st[0].y);
    c.stroke();
  }
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
function sendToCarousel(a) {
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
  modelWrap.hidden = !modelOn;
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
  setPadSize(padWanted, false); // 켜면 두 칸이 나란히 들어가도록 쓰기 칸을 줄이고, 끄면 되돌린다
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
function startAuto() {
  cancelAuto();
  const sec = Number($('autoSec').value);
  if (!(sec > 0) || !strokes.length) return; // 0초면 꺼짐
  const dur = sec * 1000, t0 = performance.now(), beats = Math.ceil(sec);
  let done = 0;
  $('autoBar').classList.add('on');
  const tick = (now) => {
    const el = now - t0;
    $('autoBarFill').style.transform = `scaleX(${Math.min(1, el / dur)})`; // 칸 위 진행 막대
    // 0초, 1초, 2초 ... 에 한 번씩 뛴다. 마지막 박동이 가장 크다
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

function showResult(r, attempt) {
  const el = $('result');
  el.replaceChildren();
  const head = document.createElement('div'); head.className = 'score';
  head.innerHTML = `<b>${r.score}</b>점 <span class="grade" style="background:var(${gradeColor(r.grade)})">${r.grade}</span> <span>${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</span>`;
  el.append(head);
  for (const [k, label] of Object.entries(PART_LABEL)) {
    const row = document.createElement('div'); row.className = 'bar';
    const pct = Math.round(r.parts[k] * 100);
    row.innerHTML = `<span>${label}</span><i><span style="width:${pct}%"></span></i><span>${pct}</span>`;
    el.append(row);
  }
  // 왜 이 점수인지 키워드로(교사·둘러보기만. 학생에게는 피드백 문장만 보인다)
  if (!(writer && !isTeacher(writer))) el.append(whyLine(r));
  const ul = document.createElement('ul');
  for (const m of feedbackKo(r)) { const li = document.createElement('li'); li.textContent = m; ul.append(li); }
  el.append(ul);
  const line = speechKo(r);
  if (line && voice.available()) {
    const say = document.createElement('div'); say.className = 'say';
    const txt = document.createElement('span'); txt.textContent = `🔊 ${line}`;
    const again = document.createElement('button'); again.type = 'button'; again.textContent = '다시 듣기';
    again.onclick = () => voice.say(line);
    say.append(txt, again); el.append(say);
  }
  if (attempt && !(writer && !isTeacher(writer))) el.append(calibForm(r, attempt)); // 학생에게는 표본 칸을 보이지 않는다
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
  $('samples').hidden = !!writer && !isTeacher(writer); // 학생에게는 표본 표를 보이지 않는다
}
// 쓰는 사람이 바뀌면 이전 사람의 결과·표본 칸을 지운다
function renderResultEmpty() { $('result').innerHTML = '<p class="empty">글자를 쓰고 \'다 썼어요\'를 누르세요.</p>'; }

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
$('brand').onclick = () => gate.open(true);

// ---------- 교사 점수 표본 모으기 (채점 보정용) ----------
// 글씨 좌표와 선생님 점수만 저장한다. 학생 이름 같은 개인정보는 받지 않는다.
// 저장 위치는 이 브라우저(localStorage)뿐이며, '내려받기'로 파일을 만들어 test/samples/에 넣는다.
const SAMPLE_KEY = 'hw-calibration-samples';
let samples = [];
try { samples = JSON.parse(localStorage.getItem(SAMPLE_KEY) || '[]'); } catch { samples = []; }
const persist = () => { try { localStorage.setItem(SAMPLE_KEY, JSON.stringify(samples)); } catch {} };
const round3 = (v) => Math.round(v * 1000) / 1000;
const toPoints = (s) => s.map((st) => st.map(([x, y]) => ({ x, y })));
const TOLERANCE = 8; // 엔진과 선생님 점수 차이 허용 범위

function calibForm(r, attempt) {
  const box = document.createElement('div'); box.className = 'calib';
  box.innerHTML = `
    <label for="teacherScore">선생님이 본 점수</label>
    <div class="calib-row">
      <input id="teacherScore" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="0~100">
      <button class="btn" id="saveSample">표본 저장</button>
    </div>
    <fieldset class="calib-issues">
      <legend>선생님 눈에 보이는 문제</legend>
      <p class="hint">엔진 결과와 상관없이 보이는 대로 고르세요. 안 고르면 '표시 안 함'으로 저장돼요.</p>
      <div class="chips">
        <label class="chip none"><input type="checkbox" value="NONE"><span>문제 없음</span></label>
        ${Object.entries(ISSUE_NAMES_KO).map(([code, name]) => `<label class="chip"><input type="checkbox" value="${code}"><span>${name}</span></label>`).join('')}
      </div>
    </fieldset>
    <p class="calib-msg" aria-live="polite">엔진 ${r.score}점과 다르게 느껴지면 선생님 점수를 넣어 저장하세요.</p>`;
  const input = box.querySelector('input'), msg = box.querySelector('.calib-msg');
  const checks = [...box.querySelectorAll('.chips input')];
  const none = checks.find((c) => c.value === 'NONE');
  // '문제 없음'과 다른 문제는 함께 고를 수 없다
  for (const c of checks) c.onchange = () => {
    if (!c.checked) return;
    if (c === none) checks.forEach((o) => { if (o !== none) o.checked = false; });
    else none.checked = false;
  };
  box.querySelector('#saveSample').onclick = () => {
    const v = Number(input.value);
    if (input.value === '' || !Number.isInteger(v) || v < 0 || v > 100) { msg.textContent = '0부터 100 사이 정수로 넣어 주세요.'; input.focus(); return; }
    const picked = checks.filter((c) => c.checked && c !== none).map((c) => c.value);
    samples.push({
      char: attempt.char, teacherScore: v, device: attempt.device, engineScoreAtSave: r.score,
      // 교사가 고른 문제 코드. []는 '문제 없음'을 고른 것, null은 표시하지 않은 것(예전 표본도 null)
      teacherIssues: none.checked ? [] : (picked.length ? picked : null),
      engineIssuesAtSave: r.issues.map((i) => i.code),
      strokes: attempt.strokes.map((s) => s.map((p) => [round3(p.x), round3(p.y)])),
      savedAt: new Date().toISOString(),
    });
    persist(); renderSamples();
    msg.textContent = `저장했어요. (선생님 ${v}점 · 엔진 ${r.score}점) 모은 표본 ${samples.length}개`;
    // 교사로 접속했으면 서버의 같은 글씨에도 표본 점수를 붙여 개발자가 볼 수 있게 한다
    if (writer && isTeacher(writer) && attempt.serverId) {
      const issues = none.checked ? [] : (picked.length ? picked : null);
      attempt.serverId
        .then((id) => id && teacherLabel({ id, writer, score: v, issues }))
        .then((ok) => { if (ok) msg.textContent += ' · 서버에도 저장'; })
        .catch(() => { msg.textContent += ' · 서버 저장 실패(인터넷 확인)'; });
    }
    // 같은 글씨를 두 번 저장하지 않도록 비운다
    input.value = ''; checks.forEach((c) => { c.checked = false; });
  };
  return box;
}

function renderSamples() {
  const el = $('samples');
  el.replaceChildren();
  const h = document.createElement('h2'); h.textContent = `모은 채점 표본 ${samples.length}개`; el.append(h);
  if (!samples.length) {
    const p = document.createElement('p'); p.className = 'empty';
    p.textContent = '채점한 뒤 오른쪽에 선생님 점수를 넣고 저장하면 여기에 쌓입니다. 20개쯤 모이면 엔진 점수를 다시 맞출 수 있어요.';
    el.append(p); return;
  }
  const rows = samples.map((s, i) => {
    const res = evaluate(s.char, toPoints(s.strokes), { device: s.device });
    return { i, s, now: res.score, diff: res.score - s.teacherScore, codes: res.issues.map((x) => x.code) };
  });
  const mae = rows.reduce((a, r) => a + Math.abs(r.diff), 0) / rows.length;
  const off = rows.filter((r) => Math.abs(r.diff) > TOLERANCE).length;
  const sum = document.createElement('p'); sum.className = 'calib-sum';
  sum.textContent = `평균 차이 ${mae.toFixed(1)}점 · ±${TOLERANCE}점을 벗어난 표본 ${off}개`;
  const agree = issueAgreement(rows);
  if (agree) sum.textContent += ` · 문제 표시 ${agree.labeled}개 중 선생님이 고른 문제를 엔진이 찾은 비율 ${agree.found}/${agree.picked}, 엔진만 짚은 문제 ${agree.extra}개`;
  el.append(sum);

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>글자</th><th>선생님</th><th>엔진(지금)</th><th>차이</th><th>기기</th><th>문제 (선생님 기준)</th><th></th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const r of [...rows].reverse()) {
    const tr = document.createElement('tr');
    if (Math.abs(r.diff) > TOLERANCE) tr.className = 'off';
    tr.innerHTML = `<td>${r.s.char}</td><td>${r.s.teacherScore}</td><td>${r.now}</td><td>${r.diff > 0 ? '+' : ''}${r.diff}</td><td>${{ finger: '손가락', pen: '펜', board: '전자칠판' }[r.s.device] || r.s.device}</td><td class="iss">${issueCell(r)}</td>`;
    const td = document.createElement('td');
    const del = document.createElement('button'); del.className = 'btn small'; del.textContent = '삭제';
    del.setAttribute('aria-label', `${r.s.char} 표본 삭제`);
    del.onclick = () => { samples.splice(r.i, 1); persist(); renderSamples(); };
    td.append(del); tr.append(td); tb.append(tr);
  }
  table.append(tb); el.append(table);

  const bar = document.createElement('div'); bar.className = 'toolbar';
  const dl = document.createElement('button'); dl.className = 'btn primary'; dl.textContent = '표본 내려받기 (.json)';
  dl.onclick = downloadSamples;
  // 아이패드: 복사하면 같은 Apple ID 맥북에서 바로 붙여 넣을 수 있다(유니버설 클립보드)
  const cp = document.createElement('button'); cp.className = 'btn'; cp.textContent = '표본 복사';
  cp.onclick = async () => { if (await copyText(samplesFileText())) cp.textContent = '복사했어요'; setTimeout(() => { cp.textContent = '표본 복사'; }, 2000); };
  const clear = document.createElement('button'); clear.className = 'btn'; clear.textContent = '모두 지우기';
  clear.onclick = () => { if (confirm(`표본 ${samples.length}개를 모두 지울까요? 되돌릴 수 없어요.`)) { samples = []; persist(); renderSamples(); } };
  bar.append(dl, cp, clear); el.append(bar);
  const hint = document.createElement('p'); hint.className = 'empty';
  hint.textContent = '내려받은 파일을 프로젝트의 test/samples/ 폴더에 넣으면 npm test가 엔진 점수와 선생님 점수 차이를 검사합니다.';
  el.append(hint);
}

// 선생님이 고른 문제와 지금 엔진이 찾은 문제 비교. 그대로: 둘 다, 빨강 '놓침': 엔진이 못 찾음, 회색 +: 엔진만
function issueCell(r) {
  const t = r.s.teacherIssues;
  if (t == null) return '<span class="extra">표시 안 함</span>';
  const name = (c) => ISSUE_NAMES_KO[c] || c;
  const parts = t.map((c) => r.codes.includes(c) ? name(c) : `<span class="miss">${name(c)}(놓침)</span>`);
  for (const c of r.codes) if (!t.includes(c) && ISSUE_NAMES_KO[c]) parts.push(`<span class="extra">+${name(c)}</span>`);
  return parts.length ? parts.join(' · ') : '문제 없음';
}

function issueAgreement(rows) {
  const labeled = rows.filter((r) => Array.isArray(r.s.teacherIssues));
  if (!labeled.length) return null;
  let picked = 0, found = 0, extra = 0;
  for (const r of labeled) {
    picked += r.s.teacherIssues.length;
    found += r.s.teacherIssues.filter((c) => r.codes.includes(c)).length;
    extra += r.codes.filter((c) => !r.s.teacherIssues.includes(c) && ISSUE_NAMES_KO[c]).length;
  }
  return { labeled: labeled.length, picked, found, extra };
}

// 표본 하나를 한 줄로 써서 파일을 짧고 git 비교하기 쉽게
function samplesFileText(d = new Date()) {
  return `{"version":1,"exportedAt":${JSON.stringify(d.toISOString())},"samples":[\n${samples.map((s) => JSON.stringify(s)).join(',\n')}\n]}\n`;
}

function downloadSamples() {
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  const name = `samples-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const body = samplesFileText(d);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

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
  $('result').innerHTML = '<p class="empty">글자를 쓰고 \'다 썼어요\'를 누르세요.</p>';
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
const PAD_MIN = 200, PAD_STEP = 20, PAD_KEY = 'hw-pref-padSize';
const padWrap = $('padWrap'), padHandle = $('padResize'), padLabel = $('padSizeLabel');
let padSize = 420;
let padWanted = 420; // 선생님이 고른 크기. 모델링을 켜서 줄어들어도 끄면 이 크기로 돌아온다
const padMax = () => {
  const stage = padWrap.closest('.stage'), cs = getComputedStyle(stage);
  const inner = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  // 모델링을 켜면 쓰기 칸과 모델링 칸이 사이 12px를 두고 나란히 들어가야 한다
  return modelOn ? (inner - 12) / 2 : inner;
};
function setPadSize(px, save = true) {
  const max = padMax();
  padSize = Math.round(Math.max(Math.min(PAD_MIN, max), Math.min(max, px)));
  if (save) padWanted = padSize;
  document.documentElement.style.setProperty('--pad-size', padSize + 'px');
  padHandle.setAttribute('aria-valuemax', String(Math.round(padMax())));
  padHandle.setAttribute('aria-valuenow', String(padSize));
  padHandle.setAttribute('aria-valuetext', `${padSize}픽셀`);
  padLabel.textContent = `${padSize}px`;
  fitCanvas();
  fitModel();
  if (save) { try { localStorage.setItem(PAD_KEY, String(padSize)); } catch {} }
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
try { const saved = Number(localStorage.getItem(PAD_KEY)); if (saved) padSize = padWanted = saved; } catch {}

renderGrid();
renderCarousel();
renderSamples();
renderWho();
if (!writer) gate.open(); else flushOutbox();
syncModel();
setPadSize(padWanted, false);

// 브라우저 콘솔에서 자동 확인할 때 쓰는 손잡이
window.__hw = { evaluate, getTemplate, setStrokes: (s) => { strokes = s; redraw(); }, score, select };
