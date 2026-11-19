// 엔진 확인용 화면. 엔진(src/)은 화면을 모르고, 이 파일이 그리기·소리·결과 표시를 맡는다.
import { evaluate, checkStroke, listChars, getTemplate } from '../src/engine.js';
import { feedbackKo } from '../src/feedback-ko.js';

const $ = (id) => document.getElementById(id);
const pad = $('pad'), ctx = pad.getContext('2d');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const chars = listChars();
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

function drawGuide(upto = Infinity, partial = 1) {
  ctx.save();
  ctx.setLineDash([0.015, 0.015]);
  line([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], css('--line'), 0.004);
  line([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], css('--line'), 0.004);
  ctx.restore();
  if (!$('guideOn').checked && upto === Infinity) return;
  getTemplate(current).strokes.forEach((s, i) => {
    if (i > upto) return;
    const pts = i === upto ? s.points.slice(0, Math.max(1, Math.ceil(s.points.length * partial))) : s.points;
    line(pts, css('--guide'), 0.07);
    // 획 번호와 시작점
    const p = s.points[0];
    ctx.fillStyle = css('--accent');
    ctx.beginPath(); ctx.arc(p.x, p.y, 0.022, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 0.03px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), p.x, p.y + 0.001);
  });
}

function redraw() {
  ctx.clearRect(0, 0, 1, 1);
  drawGuide();
  for (const s of strokes) line(s, css('--pen'), 0.035);
  if (drawing) line(drawing, css('--pen'), 0.035);
}

function toPoint(e) {
  const r = pad.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}

pad.addEventListener('pointerdown', (e) => {
  if (animating) return;
  pad.setPointerCapture(e.pointerId);
  drawing = [toPoint(e)];
  scratch.start();
});
pad.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = toPoint(e), last = drawing[drawing.length - 1];
  scratch.speed(Math.hypot(p.x - last.x, p.y - last.y));
  drawing.push(p);
  redraw();
});
function endStroke() {
  if (!drawing) return;
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
}
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);

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
    speed(v) { if (gain) gain.gain.setTargetAtTime(Math.min(0.25, v * 12), ac.currentTime, 0.02); },
    stop() { if (gain) gain.gain.setTargetAtTime(0, ac.currentTime, 0.05); },
  };
})();

// ---------- 획순 애니메이션 ----------
async function animate() {
  if (animating) return;
  animating = true;
  const n = getTemplate(current).strokes.length;
  for (let i = 0; i < n; i++) {
    for (let t = 0; t <= 1.001; t += 0.05) {
      ctx.clearRect(0, 0, 1, 1);
      drawGuide(i, t);
      await new Promise((r) => setTimeout(r, 25));
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
  const r = evaluate(current, strokes, { device: $('device').value });
  best[current] = Math.max(best[current] ?? 0, r.score);
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
  const ul = document.createElement('ul');
  for (const m of feedbackKo(r)) { const li = document.createElement('li'); li.textContent = m; ul.append(li); }
  el.append(ul);
  renderGrid();
  console.log('채점 결과', r);
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
  $('progress').textContent = `${Object.keys(best).length}/${chars.length}`;
}

function select(ch) {
  current = ch; strokes = []; toast('');
  $('result').innerHTML = '<p class="empty">글자를 쓰고 \'다 썼어요\'를 누르세요.</p>';
  renderGrid(); redraw();
}

function toast(msg) { $('toast').textContent = msg; }

$('animBtn').onclick = animate;
$('clearBtn').onclick = () => { strokes = []; toast(''); redraw(); };
$('doneBtn').onclick = score;
$('guideOn').onchange = redraw;
window.addEventListener('resize', fitCanvas);

renderGrid();
fitCanvas();

// 브라우저 콘솔에서 자동 확인할 때 쓰는 손잡이
window.__hw = { evaluate, getTemplate, setStrokes: (s) => { strokes = s; redraw(); }, score, select };
