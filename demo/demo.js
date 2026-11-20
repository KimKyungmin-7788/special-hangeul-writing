// 엔진 확인용 화면. 엔진(src/)은 화면을 모르고, 이 파일이 그리기·소리·결과 표시를 맡는다.
import { evaluate, checkStroke, listChars, getTemplate } from '../src/engine.js';
import { feedbackKo } from '../src/feedback-ko.js';
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

let activePointer = null; // 지금 획을 긋고 있는 손가락·펜(동시에 하나만 받는다)
pad.addEventListener('pointerdown', (e) => {
  if (animating || drawing) return;
  // 펜슬만 받기: 펜슬로 쓰는 동안 손바닥·손가락 터치가 획으로 들어가지 않게 한다
  if ($('penOnly').checked && e.pointerType !== 'pen') return;
  e.preventDefault();
  cancelAuto(); // 다음 획을 시작하면 자동 제출 타이머 취소
  leaveViewing();
  activePointer = e.pointerId;
  try { pad.setPointerCapture(e.pointerId); } catch {} // 칸 밖으로 나가도 획이 끊기지 않게(실패해도 쓰기는 계속)
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

function loadAttempt(id) {
  const a = attempts.find((x) => x.id === id);
  if (!a) return;
  cancelAuto();
  viewing = id;
  const g = getTemplate(a.char).group;
  if (g !== group) { group = g; chars = listChars(group); }
  current = a.char;
  strokes = a.strokes.map((st) => st.map((p) => ({ ...p })));
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

// ---------- 자동 제출 타이머 ----------
// 펜을 떼면 쓰기 칸 오른쪽 위에서 원형 타이머가 돌고, 지정 시간(기본 3초) 안에 다음 획이 없으면 '다 썼어요'를 누른 것처럼 채점한다.
const AUTO_R = 15, AUTO_C = 2 * Math.PI * AUTO_R; // 원 둘레
let autoRun = null;
function cancelAuto() {
  if (autoRun) cancelAnimationFrame(autoRun.raf);
  autoRun = null;
  $('autoTimer').classList.remove('running');
}
function startAuto() {
  cancelAuto();
  const sec = Number($('autoSec').value);
  if (!(sec > 0) || !strokes.length) return; // 0초면 꺼짐
  const dur = sec * 1000, t0 = performance.now();
  $('autoTimer').classList.add('running');
  const tick = (now) => {
    const used = Math.min(1, (now - t0) / dur);
    $('autoRing').style.strokeDashoffset = String(AUTO_C * used);
    $('autoNum').textContent = String(Math.max(1, Math.ceil((dur - (now - t0)) / 1000)));
    if (used >= 1) { cancelAuto(); score(); return; }
    autoRun.raf = requestAnimationFrame(tick);
  };
  autoRun = { raf: requestAnimationFrame(tick) };
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
    speed(v) { if (gain) gain.gain.setTargetAtTime(Math.min(0.25, v * 12), ac.currentTime, 0.02); },
    stop() { if (gain) gain.gain.setTargetAtTime(0, ac.currentTime, 0.05); },
  };
})();

// ---------- 획순 애니메이션 ----------
async function animate() {
  if (animating) return;
  cancelAuto();
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
  cancelAuto();
  // 캐러셀에서 불러온 글씨를 보고 있을 때는 새 기록을 만들지 않고 그 결과만 다시 보여 준다
  if (viewing) { const a = attempts.find((x) => x.id === viewing); if (a) showResult(a.result, a); return; }
  const device = $('device').value;
  const r = evaluate(current, strokes, { device });
  best[current] = Math.max(best[current] ?? 0, r.score);
  if (!strokes.length) { showResult(r, null); return; }
  const a = { id: ++attemptSeq, char: current, strokes, device, result: r, n: attempts.filter((x) => x.char === current).length + 1 };
  attempts.push(a);
  showResult(r, a);
  sendToCarousel(a); // 쓴 칸이 아래 캐러셀로 날아가 쌓이고
  strokes = [];      // 큰 쓰기 칸은 자동으로 비워 새 글쓰기를 준비한다
  redraw();
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
  const ul = document.createElement('ul');
  for (const m of feedbackKo(r)) { const li = document.createElement('li'); li.textContent = m; ul.append(li); }
  el.append(ul);
  if (attempt) el.append(calibForm(r, attempt));
  renderGrid();
}

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
    <p class="calib-msg" aria-live="polite">엔진 ${r.score}점과 다르게 느껴지면 선생님 점수를 넣어 저장하세요.</p>`;
  const input = box.querySelector('input'), msg = box.querySelector('.calib-msg');
  box.querySelector('#saveSample').onclick = () => {
    const v = Number(input.value);
    if (input.value === '' || !Number.isInteger(v) || v < 0 || v > 100) { msg.textContent = '0부터 100 사이 정수로 넣어 주세요.'; input.focus(); return; }
    samples.push({
      char: attempt.char, teacherScore: v, device: attempt.device, engineScoreAtSave: r.score,
      strokes: attempt.strokes.map((s) => s.map((p) => [round3(p.x), round3(p.y)])),
      savedAt: new Date().toISOString(),
    });
    persist(); renderSamples();
    msg.textContent = `저장했어요. (선생님 ${v}점 · 엔진 ${r.score}점) 모은 표본 ${samples.length}개`;
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
    const now = evaluate(s.char, toPoints(s.strokes), { device: s.device }).score;
    return { i, s, now, diff: now - s.teacherScore };
  });
  const mae = rows.reduce((a, r) => a + Math.abs(r.diff), 0) / rows.length;
  const off = rows.filter((r) => Math.abs(r.diff) > TOLERANCE).length;
  const sum = document.createElement('p'); sum.className = 'calib-sum';
  sum.textContent = `평균 차이 ${mae.toFixed(1)}점 · ±${TOLERANCE}점을 벗어난 표본 ${off}개`;
  el.append(sum);

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>글자</th><th>선생님</th><th>엔진(지금)</th><th>차이</th><th>기기</th><th></th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const r of [...rows].reverse()) {
    const tr = document.createElement('tr');
    if (Math.abs(r.diff) > TOLERANCE) tr.className = 'off';
    tr.innerHTML = `<td>${r.s.char}</td><td>${r.s.teacherScore}</td><td>${r.now}</td><td>${r.diff > 0 ? '+' : ''}${r.diff}</td><td>${{ finger: '손가락', pen: '펜', board: '전자칠판' }[r.s.device] || r.s.device}</td>`;
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
  cancelAuto();
  if (viewing) { viewing = null; renderCarousel(); }
  current = ch; strokes = []; toast('');
  $('result').innerHTML = '<p class="empty">글자를 쓰고 \'다 썼어요\'를 누르세요.</p>';
  renderGrid(); redraw();
}

function toast(msg) { $('toast').textContent = msg; }

$('animBtn').onclick = animate;
$('clearBtn').onclick = () => { cancelAuto(); leaveViewing(); strokes = []; toast(''); redraw(); };
$('doneBtn').onclick = score;
$('guideOn').onchange = redraw;
// 펜슬만 받기·입력 기기는 이 기기(브라우저)에 기억해 둔다
for (const id of ['penOnly', 'device', 'autoSec']) {
  const el = $(id), key = 'hw-pref-' + id;
  try { const v = localStorage.getItem(key); if (v !== null) { if (el.type === 'checkbox') el.checked = v === '1'; else el.value = v; } } catch {}
  el.addEventListener('change', () => { try { localStorage.setItem(key, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value); } catch {} });
}
window.addEventListener('resize', () => { setPadSize(padSize, false); });

// ---------- 쓰기 칸 크기 조절 ----------
// 획은 칸 기준 0~1 좌표로 저장되므로 크기를 바꿔도 그대로 맞춰 다시 그려지고 채점도 같다.
const PAD_MIN = 200, PAD_STEP = 20, PAD_KEY = 'hw-pref-padSize';
const padWrap = $('padWrap'), padHandle = $('padResize'), padLabel = $('padSizeLabel');
let padSize = 420;
const padMax = () => {
  const stage = padWrap.parentElement, cs = getComputedStyle(stage);
  return Math.max(PAD_MIN, stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
};
function setPadSize(px, save = true) {
  padSize = Math.round(Math.max(PAD_MIN, Math.min(padMax(), px)));
  document.documentElement.style.setProperty('--pad-size', padSize + 'px');
  padHandle.setAttribute('aria-valuemax', String(Math.round(padMax())));
  padHandle.setAttribute('aria-valuenow', String(padSize));
  padHandle.setAttribute('aria-valuetext', `${padSize}픽셀`);
  padLabel.textContent = `${padSize}px`;
  fitCanvas();
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
try { const saved = Number(localStorage.getItem(PAD_KEY)); if (saved) padSize = saved; } catch {}

renderGrid();
renderCarousel();
renderSamples();
setPadSize(padSize, false);

// 브라우저 콘솔에서 자동 확인할 때 쓰는 손잡이
window.__hw = { evaluate, getTemplate, setStrokes: (s) => { strokes = s; redraw(); }, score, select };
