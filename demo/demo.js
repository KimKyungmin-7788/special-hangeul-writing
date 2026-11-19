// 엔진 확인용 화면. 엔진(src/)은 화면을 모르고, 이 파일이 그리기·소리·결과 표시를 맡는다.
import { evaluate, checkStroke, listChars, getTemplate } from '../src/engine.js';
import { feedbackKo } from '../src/feedback-ko.js';

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
  if (strokes.length) el.append(calibForm(r));
  renderGrid();
  console.log('채점 결과', r);
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

function calibForm(r) {
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
      char: current, teacherScore: v, device: $('device').value, engineScoreAtSave: r.score,
      strokes: strokes.map((s) => s.map((p) => [round3(p.x), round3(p.y)])),
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
  const clear = document.createElement('button'); clear.className = 'btn'; clear.textContent = '모두 지우기';
  clear.onclick = () => { if (confirm(`표본 ${samples.length}개를 모두 지울까요? 되돌릴 수 없어요.`)) { samples = []; persist(); renderSamples(); } };
  bar.append(dl, clear); el.append(bar);
  const hint = document.createElement('p'); hint.className = 'empty';
  hint.textContent = '내려받은 파일을 프로젝트의 test/samples/ 폴더에 넣으면 npm test가 엔진 점수와 선생님 점수 차이를 검사합니다.';
  el.append(hint);
}

function downloadSamples() {
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  const name = `samples-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  // 표본 하나를 한 줄로 써서 파일을 짧고 git 비교하기 쉽게
  const body = `{"version":1,"exportedAt":${JSON.stringify(d.toISOString())},"samples":[\n${samples.map((s) => JSON.stringify(s)).join(',\n')}\n]}\n`;
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
renderSamples();
fitCanvas();

// 브라우저 콘솔에서 자동 확인할 때 쓰는 손잡이
window.__hw = { evaluate, getTemplate, setStrokes: (s) => { strokes = s; redraw(); }, score, select };
