// 쓰기 준비(선 긋기·형태 구성 21종) 화면. 모양·관찰값은 src/prewrite.js, 연습 화면 공통 기능은 demo.js가 api로 넘겨준다.
// - 가로로 긴 활동지 한 장(쓰기 칸 + 시범 칸 자리)에 그린다
// - 4걸음: 통로 안에서 → 점선 따라 → 점 잇기 → 보고 그리기. 별 3개면 다음 걸음, 4걸음을 마치면 다음 활동
// - 데려다주기: 획의 시작점에 캐릭터, 끝점에 목표. 펜으로 끌고 가면 따라오고, 닿으면 반가워한다(설정에서 끌 수 있음)
// - 다 그리면 서버에 보낸다(글자 칸 'P05', 걸음 prep_step). 진행은 쓰는 사람마다 이 기기에도 기억
import { ITEMS, ITEM_BY_ID, AREAS, STEPS, SHEET_W, parsePath, resample, keyPoints, observe, sayFor, stepTol, obsCodes } from '../src/prewrite.js';

const ARRIVE_COVER = 0.75; // 이만큼 따라 그린 뒤 끝점에 닿아야 '도착'(지름길로 바로 가지 못하게)

// ---------- 캐릭터(직접 그림: 기기마다 다른 이모지 대신) ----------
const ART = {
  bunny(c, r) {
    c.fillStyle = '#fff'; c.strokeStyle = '#4a4a4f'; c.lineWidth = r * 0.08;
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * r * 0.32, -r * 0.75, r * 0.2, r * 0.5, s * 0.15, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#f7b6c8'; c.beginPath(); c.ellipse(s * r * 0.32, -r * 0.72, r * 0.09, r * 0.34, s * 0.15, 0, 7); c.fill(); c.fillStyle = '#fff'; }
    c.beginPath(); c.arc(0, 0, r * 0.62, 0, 7); c.fill(); c.stroke();
    c.fillStyle = '#3a3a3c'; for (const s of [-1, 1]) { c.beginPath(); c.arc(s * r * 0.22, -r * 0.08, r * 0.08, 0, 7); c.fill(); }
    c.fillStyle = '#f08aa6'; c.beginPath(); c.arc(0, r * 0.12, r * 0.08, 0, 7); c.fill();
    c.fillStyle = 'rgba(240,138,166,.35)'; for (const s of [-1, 1]) { c.beginPath(); c.arc(s * r * 0.38, r * 0.16, r * 0.1, 0, 7); c.fill(); }
  },
  carrot(c, r) {
    c.fillStyle = '#4caf50'; for (const a of [-0.5, 0, 0.5]) { c.save(); c.rotate(a); c.beginPath(); c.ellipse(0, -r * 0.62, r * 0.1, r * 0.3, 0, 0, 7); c.fill(); c.restore(); }
    c.fillStyle = '#f28c28'; c.strokeStyle = '#b85f12'; c.lineWidth = r * 0.07;
    c.beginPath(); c.moveTo(-r * 0.32, -r * 0.4); c.quadraticCurveTo(0, -r * 0.52, r * 0.32, -r * 0.4); c.lineTo(0, r * 0.75); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-r * 0.15, -r * 0.1); c.lineTo(r * 0.02, -r * 0.1); c.moveTo(-r * 0.05, r * 0.2); c.lineTo(r * 0.12, r * 0.2); c.stroke();
  },
  bee(c, r) {
    c.fillStyle = 'rgba(190,225,255,.85)'; c.strokeStyle = '#6a8fb5'; c.lineWidth = r * 0.06;
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * r * 0.22, -r * 0.5, r * 0.22, r * 0.32, s * 0.4, 0, 7); c.fill(); c.stroke(); }
    c.fillStyle = '#ffd43b'; c.strokeStyle = '#3a3a3c'; c.lineWidth = r * 0.08;
    c.beginPath(); c.ellipse(0, 0, r * 0.65, r * 0.45, 0, 0, 7); c.fill(); c.stroke();
    c.save(); c.beginPath(); c.ellipse(0, 0, r * 0.65, r * 0.45, 0, 0, 7); c.clip();
    c.fillStyle = '#3a3a3c'; for (const x of [-0.12, 0.18]) c.fillRect(x * r, -r, r * 0.14, r * 2); c.restore();
    c.fillStyle = '#3a3a3c'; c.beginPath(); c.arc(-r * 0.42, -r * 0.08, r * 0.07, 0, 7); c.fill();
  },
  flower(c, r) {
    c.fillStyle = '#ff8fb1'; for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; c.beginPath(); c.arc(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, r * 0.3, 0, 7); c.fill(); }
    c.fillStyle = '#ffd43b'; c.strokeStyle = '#e0a800'; c.lineWidth = r * 0.06; c.beginPath(); c.arc(0, 0, r * 0.26, 0, 7); c.fill(); c.stroke();
  },
  car(c, r) {
    c.fillStyle = '#e8553d'; c.strokeStyle = '#3a3a3c'; c.lineWidth = r * 0.07;
    c.beginPath(); c.roundRect(-r * 0.75, -r * 0.1, r * 1.5, r * 0.5, r * 0.15); c.fill(); c.stroke();
    c.beginPath(); c.roundRect(-r * 0.42, -r * 0.5, r * 0.8, r * 0.45, r * 0.15); c.fill(); c.stroke();
    c.fillStyle = '#cfe8ff'; c.fillRect(-r * 0.3, -r * 0.4, r * 0.25, r * 0.25); c.fillRect(r * 0.02, -r * 0.4, r * 0.25, r * 0.25);
    c.fillStyle = '#3a3a3c'; for (const x of [-0.42, 0.42]) { c.beginPath(); c.arc(x * r, r * 0.42, r * 0.18, 0, 7); c.fill(); }
  },
  house(c, r) {
    c.fillStyle = '#fff3d6'; c.strokeStyle = '#3a3a3c'; c.lineWidth = r * 0.07;
    c.beginPath(); c.rect(-r * 0.55, -r * 0.15, r * 1.1, r * 0.75); c.fill(); c.stroke();
    c.fillStyle = '#d9534f'; c.beginPath(); c.moveTo(-r * 0.72, -r * 0.1); c.lineTo(0, -r * 0.72); c.lineTo(r * 0.72, -r * 0.1); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#8b5a2b'; c.fillRect(-r * 0.14, r * 0.2, r * 0.28, r * 0.4);
  },
  cat(c, r) {
    c.fillStyle = '#f4a742'; c.strokeStyle = '#3a3a3c'; c.lineWidth = r * 0.07;
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.55, -r * 0.2); c.lineTo(s * r * 0.45, -r * 0.8); c.lineTo(s * r * 0.1, -r * 0.5); c.closePath(); c.fill(); c.stroke(); }
    c.beginPath(); c.arc(0, 0, r * 0.6, 0, 7); c.fill(); c.stroke();
    c.fillStyle = '#3a3a3c'; for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * r * 0.22, -r * 0.08, r * 0.07, r * 0.11, 0, 0, 7); c.fill(); }
    c.beginPath(); c.moveTo(-r * 0.06, r * 0.1); c.lineTo(r * 0.06, r * 0.1); c.lineTo(0, r * 0.18); c.closePath(); c.fill();
    c.lineWidth = r * 0.04; for (const s of [-1, 1]) for (const y of [0.15, 0.27]) { c.beginPath(); c.moveTo(s * r * 0.2, y * r); c.lineTo(s * r * 0.62, (y - 0.05) * r); c.stroke(); }
  },
  fish(c, r) {
    c.fillStyle = '#5aa9e6'; c.strokeStyle = '#2b6b9e'; c.lineWidth = r * 0.07;
    c.beginPath(); c.moveTo(r * 0.45, 0); c.lineTo(r * 0.8, -r * 0.3); c.lineTo(r * 0.8, r * 0.3); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(-r * 0.05, 0, r * 0.55, r * 0.35, 0, 0, 7); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(-r * 0.32, -r * 0.07, r * 0.09, 0, 7); c.fill(); c.fillStyle = '#3a3a3c'; c.beginPath(); c.arc(-r * 0.32, -r * 0.07, r * 0.045, 0, 7); c.fill();
  },
};
const PAIRS = [['bunny', 'carrot', '토끼를 당근까지'], ['bee', 'flower', '꿀벌을 꽃까지'], ['car', 'house', '자동차를 집까지'], ['cat', 'fish', '고양이를 물고기까지']];
const sprite = (c, name, x, y, r, scale = 1) => { c.save(); c.translate(x, y); c.scale(scale, scale); ART[name](c, r); c.restore(); };

// 항목 아이콘(작은 SVG)
export function itemIcon(item, size = 40) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '-4 -4 118 58'); svg.setAttribute('width', size); svg.setAttribute('height', Math.round(size * 58 / 118));
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', item.d);
  for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) p.setAttribute(k, v);
  svg.append(p); return svg;
}

export function createPrep(api) {
  const $ = (id) => document.getElementById(id);
  const cv = $('prepPad'), c = cv.getContext('2d'), stepsBox = $('prepSteps');
  let item = ITEMS[0], step = 1, target = parsePath(item.d), strokes = [], drawing = null, pointer = null, carry = null;
  let flip = [], arrived = [], popAt = [], anim = null, autoTimer = null, advanceTimer = null, W = 0, H = 0;
  const progKey = () => `hw-prep:${api.writer() || 'guest'}`;
  const progress = () => { try { return JSON.parse(localStorage.getItem(progKey()) || '{}'); } catch { return {}; } };
  const saveProgress = (p) => { try { localStorage.setItem(progKey(), JSON.stringify(p)); } catch {} };
  const charOn = () => $('prepChar').checked;
  const tol = () => stepTol(step, $('prepLane').value);
  let t0 = 0; // 이번 활동지의 첫 획을 시작한 시각(쓴 시각을 밀리초로 남김)
  const pair = (k) => PAIRS[(ITEMS.indexOf(item) + k) % PAIRS.length];
  const ends = (k) => { const p = target[k].pts; const a = p[0], b = p[p.length - 1]; return flip[k] ? [b, a] : [a, b]; };

  function reset() {
    target = parsePath(item.d); strokes = []; drawing = null; carry = null;
    flip = target.map(() => false); arrived = target.map(() => false); popAt = target.map(() => 0);
    clearTimeout(autoTimer); stopAnim(); draw();
  }
  function fit(widthPx) {
    const w = Math.max(200, Math.round(widthPx)), h = Math.round(w / SHEET_W), dpr = window.devicePixelRatio || 1;
    cv.style.width = `${w}px`; cv.style.height = `${h}px`; cv.width = w * dpr; cv.height = h * dpr; W = w; H = h;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  }
  const X = (p) => p.x * H, Y = (p) => p.y * H;
  function pathOf(pts) { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(X(p), Y(p)) : c.moveTo(X(p), Y(p)))); }

  function draw(extra) {
    if (!W) return;
    c.clearRect(0, 0, W, H);
    c.lineCap = 'round'; c.lineJoin = 'round';
    // 걸음별 안내
    for (const s of target) {
      if (step === 1) {
        pathOf(s.pts); c.strokeStyle = 'rgba(61,99,184,.32)'; c.lineWidth = tol() * 2 * H + 3; c.stroke();
        pathOf(s.pts); c.strokeStyle = '#eef3ff'; c.lineWidth = tol() * 2 * H - 1; c.stroke();
      } else if (step === 2) {
        const g = ($('prepDash').value === 'sparse' ? 0.06 : 0.03) * H;
        pathOf(s.pts); c.setLineDash([g, g]); c.strokeStyle = '#9b917f'; c.lineWidth = Math.max(2.5, H * 0.012); c.stroke(); c.setLineDash([]);
      } else if (step === 3) {
        c.fillStyle = '#7a7366'; for (const p of keyPoints(s)) { c.beginPath(); c.arc(X(p), Y(p), Math.max(4, H * 0.018), 0, 7); c.fill(); }
      }
    }
    if (extra) extra();
    // 쓴 선
    c.strokeStyle = '#3a3a3c'; c.lineWidth = Math.max(3, H * 0.022);
    for (const s of [...strokes, ...(drawing ? [drawing] : [])]) { if (s.length < 2) continue; pathOf(s); c.stroke(); }
    // 시작·끝 표시(보고 그리기에서는 없음)
    if (step < 4) drawMarkers();
  }
  function drawMarkers() {
    const r = Math.max(18, H * 0.1), now = performance.now();
    target.forEach((s, k) => {
      const [a, b] = ends(k);
      const goal = s.closed ? { x: a.x + 0.09, y: a.y - 0.09 } : b;
      if (charOn()) {
        const [who, what] = pair(k);
        const pop = popAt[k] ? Math.max(0, 1 - (now - popAt[k]) / 500) : 0;
        if (!arrived[k]) sprite(c, what, X(goal), Y(goal), r * 0.8);
        else { sprite(c, what, X(goal), Y(goal), r * 0.8, 1 + 0.35 * Math.sin(pop * Math.PI)); c.font = `${Math.round(r * 0.7)}px sans-serif`; c.fillStyle = '#e64980'; c.fillText('♥', X(goal) + r * 0.4, Y(goal) - r * 0.7); }
        const at = carry === k && drawing ? drawing[drawing.length - 1] : arrived[k] ? goal : a;
        sprite(c, who, X(at), Y(at), r * 0.75);
      } else {
        c.fillStyle = '#2f8a4c'; c.beginPath(); c.arc(X(a), Y(a), Math.max(6, H * 0.025), 0, 7); c.fill();
        if (!s.closed) { c.fillStyle = arrived[k] ? '#2f8a4c' : '#c8433a'; c.beginPath(); c.moveTo(X(b), Y(b)); c.lineTo(X(b), Y(b) - H * 0.09); c.lineTo(X(b) + H * 0.06, Y(b) - H * 0.07); c.lineTo(X(b), Y(b) - H * 0.05); c.closePath(); c.fill();
          c.strokeStyle = '#3a3a3c'; c.lineWidth = 2; c.beginPath(); c.moveTo(X(b), Y(b)); c.lineTo(X(b), Y(b) - H * 0.09); c.stroke(); }
      }
    });
    if (popAt.some((t) => t && now - t < 500)) requestAnimationFrame(() => draw());
  }

  // ---------- 걸음·항목 표시 ----------
  function renderSteps() {
    stepsBox.replaceChildren();
    const done = progress()[item.id] || 0;
    const title = document.createElement('span'); title.className = 'prep-title'; title.textContent = `${item.id} ${item.name}`;
    stepsBox.append(title);
    for (const s of STEPS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'prep-step';
      b.textContent = `${'①②③④'[s.n - 1]} ${s.name}${done >= s.n ? ' ✓' : ''}`;
      b.setAttribute('aria-pressed', String(s.n === step)); if (done >= s.n) b.classList.add('done');
      b.onclick = () => { step = s.n; api.clearNote(); reset(); renderSteps(); };
      stepsBox.append(b);
    }
    const ref = document.createElement('span'); ref.className = 'prep-ref'; ref.title = '보고 그릴 모양';
    ref.append(itemIcon(item, 64)); stepsBox.append(ref);
    const hint = document.createElement('span'); hint.className = 'prep-hint';
    hint.textContent = step === 4 ? '위 모양을 보고 그려요' : charOn() ? `${pair(0)[2]} 데려다줘요` : '초록 점에서 시작해요';
    stepsBox.append(hint);
  }
  function renderItems(grid) {
    grid.replaceChildren(); grid.classList.add('prep-grid');
    const p = progress();
    for (const a of AREAS) {
      const row = document.createElement('div'); row.className = 'prep-row';
      const h = document.createElement('span'); h.className = 'prep-area'; h.textContent = a.name; row.append(h);
      for (const it of ITEMS.filter((x) => x.area === a.key)) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'cell prep-cell';
        b.setAttribute('aria-current', String(it.id === item.id)); b.setAttribute('aria-label', `${it.id} ${it.name}, ${p[it.id] || 0}걸음 마침`);
        b.title = `${it.id} ${it.name} · ${it.goal}`;
        b.append(itemIcon(it, 42));
        const n = document.createElement('small'); n.textContent = it.id; b.append(n);
        if (p[it.id]) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = p[it.id] >= 4 ? 'S' : '①②③'.slice(0, p[it.id]); b.append(badge); }
        b.onclick = () => choose(it.id);
        row.append(b);
      }
      grid.append(row);
    }
  }
  function choose(id, s) {
    item = ITEM_BY_ID[id]; const done = progress()[id] || 0;
    step = s || Math.min(4, done + 1);
    clearTimeout(advanceTimer); api.clearNote(); api.toast(''); reset(); renderSteps(); api.refreshGrid();
  }
  const progressText = () => { const p = progress(); return `${ITEMS.filter((it) => (p[it.id] || 0) >= 4).length}/${ITEMS.length}`; };

  // ---------- 그리기 ----------
  const toPt = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * SHEET_W, y: (e.clientY - r.top) / r.height, t: Math.max(0, Math.round((e.timeStamp || performance.now()) - t0)) }; };
  const near = (p, q, d) => Math.hypot(p.x - q.x, p.y - q.y) <= d;
  function coverOf(k) {
    const ink = [...strokes, ...(drawing ? [drawing] : [])].filter((s) => s.length > 1).flatMap((s) => resample(s, 0.015));
    const pts = resample(target[k].pts, 0.015), t = tol();
    return pts.filter((p) => ink.some((q) => near(p, q, t))).length / pts.length;
  }
  cv.addEventListener('pointerdown', (e) => {
    if (anim || drawing) return;
    if (api.penOnly() && e.pointerType !== 'pen') return;
    e.preventDefault(); clearTimeout(autoTimer); clearTimeout(advanceTimer); api.voiceStop();
    pointer = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch {}
    if (!strokes.length) t0 = e.timeStamp || performance.now();
    const p = toPt(e); drawing = [p]; carry = null;
    // 시작점 가까이에서 시작하면 캐릭터를 데려간다. 반대쪽 끝에서 시작하면 그쪽을 출발점으로(방향은 정답으로 보지 않음)
    const t = tol() * 1.7;
    target.forEach((s, k) => {
      if (arrived[k] || carry != null || step === 4) return;
      const [a, b] = ends(k);
      if (near(p, a, t)) carry = k;
      else if (!s.closed && near(p, b, t)) { flip[k] = !flip[k]; carry = k; }
    });
    api.scratch.start(); draw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing || e.pointerId !== pointer) return;
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) { const p = toPt(ev), l = drawing[drawing.length - 1]; api.scratch.speed(Math.hypot(p.x - l.x, p.y - l.y) / SHEET_W); drawing.push(p); }
    if (carry != null) {
      const [a, b] = ends(carry), goal = target[carry].closed ? a : b, tip = drawing[drawing.length - 1];
      if (near(tip, goal, tol()) && drawing.length > 8 && coverOf(carry) >= ARRIVE_COVER) {
        arrived[carry] = true; popAt[carry] = performance.now(); api.ding(); carry = null;
      }
    }
    draw();
  });
  const end = (e) => {
    if (!drawing || (e && e.pointerId !== pointer)) return;
    pointer = null; api.scratch.stop();
    if (drawing.length > 1) strokes.push(drawing);
    drawing = null; carry = null; draw();
    // 모두 데려다줬으면 잠깐 뒤 스스로 확인(보고 그리기는 '다 그렸어요'로)
    if (step < 4 && arrived.every(Boolean)) autoTimer = setTimeout(done, 700);
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

  // ---------- 그리는 법 ----------
  function stopAnim() { if (anim) { cancelAnimationFrame(anim); anim = null; } }
  function demo() {
    stopAnim(); strokes = []; drawing = null; arrived = target.map(() => false); api.clearNote();
    const lens = target.map((s) => resample(s.pts, 0.01));
    const durs = lens.map((p) => 500 + p.length * 9), t0 = performance.now();
    const tick = (now) => {
      let t = now - t0, k = 0;
      while (k < durs.length && t > durs[k] + 250) { t -= durs[k] + 250; k++; }
      if (k >= durs.length) { anim = null; draw(); return; }
      const f = Math.min(1, t / durs[k]);
      draw(() => {
        c.strokeStyle = '#3d63b8'; c.lineWidth = Math.max(4, H * 0.03);
        for (let j = 0; j < k; j++) { pathOf(lens[j]); c.stroke(); }
        const part = lens[k].slice(0, Math.max(2, Math.round(lens[k].length * f)));
        pathOf(part); c.stroke();
        const tip = part[part.length - 1];
        if (charOn()) sprite(c, pair(k)[0], X(tip), Y(tip), Math.max(18, H * 0.1) * 0.75);
        else { c.fillStyle = '#3d63b8'; c.beginPath(); c.arc(X(tip), Y(tip), 7, 0, 7); c.fill(); }
      });
      anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  }

  // ---------- 확인 ----------
  function done() {
    clearTimeout(autoTimer); stopAnim();
    const o = observe(item, strokes, { tol: tol(), step, align: step === 4 });
    const say = sayFor(item, o);
    api.showResult({ item, step, o, say });
    if (strokes.length) api.send({ ch: `P${item.id}`, step, strokes, score: o.score, issues: obsCodes(o) });
    if (o.stars === 3) {
      const p = progress(); p[item.id] = Math.max(p[item.id] || 0, step); saveProgress(p); api.refreshGrid();
      advanceTimer = setTimeout(() => {
        if (step < 4) { step += 1; api.toast(`다음 걸음: ${STEPS[step - 1].name}`); reset(); renderSteps(); }
        else if (api.autoNext()) { const i = ITEMS.indexOf(item); if (i < ITEMS.length - 1) choose(ITEMS[i + 1].id, 1); else api.toast('쓰기 준비 21개를 모두 마쳤어요!'); }
      }, 1300);
    }
    return o;
  }
  function clear() { clearTimeout(autoTimer); clearTimeout(advanceTimer); api.clearNote(); reset(); }

  return { fit, draw, demo, done, clear, renderItems, renderSteps, progressText, choose, reset, get item() { return item; }, get step() { return step; } };
}
