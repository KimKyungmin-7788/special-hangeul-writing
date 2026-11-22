// 글씨 채점실(개발자 전용): 학생·교사가 보낸 글씨를 쓴 순서·빠르기 그대로 다시 보고, 개발자 점수·문제·메모를 붙인다.
// 엔진 점수는 개발자 점수를 저장한 뒤에 보인다(먼저 보면 점수가 끌려가므로). '엔진 점수 먼저 보기'로 바꿀 수 있다.
import { evaluate, getTemplate } from '../src/engine.js';
import { ISSUE_NAMES_KO, explainKo } from '../src/feedback-ko.js';
import { auth, isDev, listAttempts, updateAttempt, deleteAttempt } from './server.js';
import { RUBRIC, RUBRIC_DATE, RUBRIC_SAMPLES, GRADES, PRECEDENTS, rubricFor } from './rubric.js';

const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const DEVICE = { finger: '손가락', pen: '펜', board: '전자칠판' };
const issueNames = (codes) => (codes && codes.length ? codes.map((c) => ISSUE_NAMES_KO[c] || c).join(', ') : '문제 없음');

// ---------- 로그인(세션은 이 탭에만) ----------
const SESSION_KEY = 'hw-dev-session';
let session = null;
try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch {}
const saveSession = (s) => { session = s; try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch {} };
const fromToken = (t) => ({ access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in - 60) * 1000, email: t.user?.email, uid: t.user?.id });

async function token() {
  if (!session) throw Object.assign(new Error('login'), { status: 401 });
  if (Date.now() > session.exp) saveSession(fromToken(await auth.refresh(session.refresh)));
  return session.access;
}
// 401이면 로그인 화면으로
async function withAuth(fn) {
  try { return await fn(await token()); } catch (e) {
    if (e.status === 401 || e.message === 'login') { saveSession(null); showLogin('다시 로그인해 주세요.'); }
    throw e;
  }
}

function showLogin(msg = '') {
  $('login').hidden = false; $('app').hidden = true; $('me').hidden = true;
  $('loginErr').textContent = msg; $('email').focus();
}
async function enter() {
  try {
    const ok = await withAuth((t) => isDev(t));
    if (!ok) { saveSession(null); showLogin('개발자로 등록된 계정이 아니에요.'); return; }
  } catch { return; }
  $('login').hidden = true; $('app').hidden = false; $('me').hidden = false;
  $('meEmail').textContent = session.email || '';
  load();
}
$('loginBtn').onclick = async () => {
  $('loginErr').textContent = '';
  $('loginBtn').disabled = true;
  try { saveSession(fromToken(await auth.signIn($('email').value.trim(), $('password').value))); $('password').value = ''; enter(); }
  catch { $('loginErr').textContent = '이메일이나 비밀번호가 맞지 않아요.'; }
  finally { $('loginBtn').disabled = false; }
};
$('password').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };
$('logout').onclick = async () => { if (session) await auth.signOut(session.access); saveSession(null); showLogin(); };

// ---------- 목록 ----------
const PAGE = 50;
let rows = [], total = 0, current = null;
function query(offset = 0) {
  const q = new URLSearchParams({ select: '*', order: 'created_at.desc', limit: String(PAGE), offset: String(offset) });
  if ($('fRole').value) q.append('role', `eq.${$('fRole').value}`);
  if ($('fState').value === 'todo') q.append('dev_score', 'is.null');
  if ($('fState').value === 'done') q.append('dev_score', 'not.is.null');
  const w = $('fWriter').value.trim(); if (w) q.append('writer', `like.*${w.replace(/[*,()]/g, '')}*`);
  const ch = $('fCh').value.trim(); if (ch) q.append('ch', `eq.${ch}`);
  return q.toString();
}
async function load(more = false) {
  try {
    const r = await withAuth((t) => listAttempts(t, query(more ? rows.length : 0)));
    rows = more ? rows.concat(r.rows) : r.rows; total = r.total;
  } catch { return; }
  renderList();
  if (!more) { if (rows[0]) open(rows[0].id); else $('detail').replaceChildren(el('p', { className: 'empty', textContent: '조건에 맞는 글씨가 없어요.' })); }
}
function renderList() {
  $('count').textContent = `${total}개`;
  const list = $('list'); list.replaceChildren();
  for (const r of rows) {
    const d = new Date(r.created_at);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const b = el('button', { className: 'row', type: 'button' },
      el('span', { className: 'ch', textContent: r.ch }),
      el('span', { className: 'meta' }, el('b', { textContent: r.writer }), el('br'), el('small', { textContent: `${when} · ${DEVICE[r.device] || r.device}` })),
      el('span', {}, r.dev_score != null ? el('span', { className: 'tag done', textContent: `채점 ${r.dev_score}` }) : el('span', { className: 'tag todo', textContent: '채점 전' }),
        r.teacher_score != null ? el('span', { className: 'tag t', textContent: `교사 ${r.teacher_score}` }) : ''));
    b.setAttribute('role', 'listitem');
    b.setAttribute('aria-current', String(r.id === current));
    b.onclick = () => open(r.id);
    list.append(b);
  }
  if (rows.length < total) {
    const more = el('button', { className: 'btn', type: 'button', textContent: `더 보기 (${total - rows.length}개 남음)` });
    more.style.width = '100%'; more.onclick = () => load(true);
    list.append(more);
  }
}
for (const id of ['fRole', 'fState']) $(id).onchange = () => load();
for (const id of ['fWriter', 'fCh']) $(id).onkeydown = (e) => { if (e.key === 'Enter') load(); };
$('refresh').onclick = () => load();

const SHOW_KEY = 'hw-dev-showEngine';
try { $('showEngine').checked = localStorage.getItem(SHOW_KEY) === '1'; } catch {}
$('showEngine').onchange = () => { try { localStorage.setItem(SHOW_KEY, $('showEngine').checked ? '1' : '0'); } catch {} if (current) open(current); };

// ---------- 채점 기준표 ----------
// 교사 표본에서 뽑은 기준을 펼쳐 두고 본다. 채점하다 기준이 흐트러질 때 다시 맞추는 용도.
const bandText = (b) => b[0] == null && b[1] == null ? '표본 없음' : b[0] == null ? `최고 ${b[1]}` : `${b[0]}~${b[1]}`;
function renderRubric() {
  const box = $('rubric'); box.replaceChildren();
  box.append(el('h2', { textContent: '📋 채점 기준' }),
    el('p', { className: 'src', textContent: `교사 표본 ${RUBRIC_SAMPLES}개에서 실제로 준 점수로 만듦 (${RUBRIC_DATE}). n은 근거 표본 수.` }));
  const how = el('ol');
  for (const t of ['다른 글자로 읽히는지 먼저 본다.', '아래 표에서 가장 위에 걸리는 문제 하나가 점수 범위를 정한다.', '그 범위 안에서 모양(안내선과 얼마나 같은지)으로 더 깎는다.', '범위를 벗어나게 줄 때는 메모에 이유를 남긴다.'])
    how.append(el('li', { textContent: t }));
  box.append(how);
  const g = el('div', { className: 'grades' });
  for (const [k, v] of GRADES) g.append(el('span', { textContent: `${k} ${v}${k === 'F' ? '~59' : '+'}` }));
  box.append(g);
  for (const r of RUBRIC) {
    const row = el('div', { className: `rb${r.sub ? ' sub' : ''}${r.n ? '' : ' nodata'}` });
    row.dataset.codes = r.codes.join(' ');
    row.append(el('div', { className: 'rb-top' }, el('b', { textContent: r.name }),
      el('span', {}, el('span', { className: 'rb-band', textContent: bandText(r.band) }), ' ', el('span', { className: 'rb-n', textContent: r.n ? `n=${r.n}` : '근거 없음' }))),
    el('div', { textContent: r.rule }));
    if (r.look) row.append(el('div', { className: 'look', textContent: `예: ${r.look}` }));
    box.append(row);
  }
  const prec = el('div', { className: 'prec' }, el('b', { textContent: '예외로 정한 표본 (원칙은 그대로)' }));
  const ul = el('ul'); for (const p of PRECEDENTS) ul.append(el('li', { textContent: `${p.ch} ${p.score}점: ${p.decision}` }));
  prec.append(ul); box.append(prec);
}
// 지금 고른 문제와 맞는 줄을 기준표에서 표시
function markRubric(codes) {
  const hit = rubricFor(codes);
  document.querySelectorAll('#rubric .rb').forEach((row) => row.classList.toggle('hit', !!hit && row.dataset.codes === hit.codes.join(' ') && !row.classList.contains('sub')));
}
const RUBRIC_KEY = 'hw-dev-rubric';
function setRubric(open) {
  $('rubric').hidden = !open;
  $('app').classList.toggle('with-rubric', open);
  $('rubricBtn').setAttribute('aria-pressed', String(open));
  try { localStorage.setItem(RUBRIC_KEY, open ? '1' : '0'); } catch {}
  requestAnimationFrame(() => drawReplay());
}
renderRubric();
$('rubricBtn').onclick = () => setRubric($('rubric').hidden);
try { setRubric(localStorage.getItem(RUBRIC_KEY) !== '0'); } catch { setRubric(true); }

// ---------- 다시 보기(쓴 순서·빠르기 그대로) ----------
const GAP_MAX = 600; // '쉬는 시간 줄이기'를 켜면 이보다 긴 멈춤을 이만큼으로 줄인다
const player = { raf: null, t: 0, last: null, speed: 1, playing: false, data: null };

// 점마다 다시 보기 시각을 매긴다. 획 사이·획 안의 멈춤도 그대로(줄이기를 켜면 짧게)
function timeline(strokes, squeeze) {
  let prev = null, clock = 0;
  const out = strokes.map((s) => s.map((p, i) => {
    const raw = p[2] ?? i * 16;
    if (prev !== null) { const dt = Math.max(0, raw - prev); clock += squeeze ? Math.min(dt, GAP_MAX) : dt; }
    prev = raw;
    return { x: p[0], y: p[1], at: clock };
  }));
  const real = strokes.length ? Math.max(0, (strokes.at(-1).at(-1)[2] ?? 0) - (strokes[0][0][2] ?? 0)) : 0;
  return { strokes: out, total: clock, real };
}

function drawReplay() {
  const cv = $('replay'); if (!cv || !player.data) return;
  const c = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1, size = cv.clientWidth;
  if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
  c.setTransform(size * dpr, 0, 0, size * dpr, 0, 0);
  c.clearRect(0, 0, 1, 1);
  const line = (pts, color, w, dash) => {
    if (!pts.length) return;
    c.save(); if (dash) c.setLineDash(dash);
    c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) c.lineTo(p.x, p.y);
    if (pts.length === 1) c.lineTo(pts[0].x + 0.001, pts[0].y);
    c.stroke(); c.restore();
  };
  line([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], css('--line'), 0.004, [0.015, 0.015]);
  line([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], css('--line'), 0.004, [0.015, 0.015]);
  if ($('guide')?.checked) { const tpl = getTemplate(player.data.ch); if (tpl) tpl.strokes.forEach((s) => line(s.points, css('--guide'), 0.07)); }
  const t = player.t;
  player.data.tl.strokes.forEach((s, i) => {
    if (!s.length || s[0].at > t) return;
    const pts = [];
    for (let k = 0; k < s.length; k++) {
      if (s[k].at <= t) { pts.push(s[k]); continue; }
      const a = s[k - 1], b = s[k], f = (t - a.at) / ((b.at - a.at) || 1);
      pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      break;
    }
    line(pts, css('--pen'), 0.035);
    const writing = t < s.at(-1).at;
    if (writing) { const p = pts.at(-1); c.fillStyle = css('--accent'); c.beginPath(); c.arc(p.x, p.y, 0.016, 0, Math.PI * 2); c.fill(); }
    // 획 번호: 학생이 그은 차례
    const p0 = s[0];
    c.fillStyle = css('--warn'); c.beginPath(); c.arc(p0.x, p0.y, 0.024, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 0.03px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(i + 1), p0.x, p0.y + 0.001);
  });
  const total = player.data.tl.total;
  $('prog').value = total ? Math.min(1, t / total) : 1;
  $('ptime').textContent = `${(Math.min(t, total) / 1000).toFixed(1)}초 / ${(total / 1000).toFixed(1)}초 (실제 쓴 시간 ${(player.data.tl.real / 1000).toFixed(1)}초)`;
}
function tick(ts) {
  if (player.last !== null) player.t += Math.min(100, ts - player.last) * player.speed;
  player.last = ts;
  drawReplay();
  if (player.t >= player.data.tl.total + 300) { stop(); return; }
  player.raf = requestAnimationFrame(tick);
}
function play() {
  if (player.t >= player.data.tl.total) player.t = 0;
  player.playing = true; player.last = null;
  cancelAnimationFrame(player.raf); player.raf = requestAnimationFrame(tick);
  $('pplay').textContent = '❚❚ 멈춤';
}
function stop() {
  player.playing = false; cancelAnimationFrame(player.raf); player.raf = null;
  if ($('pplay')) $('pplay').textContent = '▶ 재생';
  drawReplay();
}

// ---------- 한 글씨 보기·채점 ----------
function open(id) {
  const r = rows.find((x) => x.id === id); if (!r) return;
  current = id; stop();
  renderList();
  const d = $('detail'); d.replaceChildren();
  const when = new Date(r.created_at).toLocaleString('ko-KR');
  d.append(el('div', { className: 'head' },
    el('b', { textContent: r.ch }), el('span', { textContent: r.writer }),
    el('span', { className: 'muted', textContent: `${when} · ${DEVICE[r.device] || r.device} · ${r.strokes.length}획 · 엔진 ${r.engine_version || '?'}` })));

  // 왼쪽: 다시 보기
  const left = el('div');
  const speedSeg = el('div', { className: 'seg' });
  speedSeg.setAttribute('role', 'group'); speedSeg.setAttribute('aria-label', '재생 속도');
  for (const sp of [0.5, 1, 2, 4]) {
    const b = el('button', { type: 'button', textContent: `${sp}배` });
    b.setAttribute('aria-pressed', String(sp === player.speed));
    b.onclick = () => { player.speed = sp; speedSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
    speedSeg.append(b);
  }
  const squeeze = el('input', { type: 'checkbox', id: 'squeeze', checked: true });
  const guide = el('input', { type: 'checkbox', id: 'guide' });
  left.append(
    el('canvas', { id: 'replay' }),
    el('progress', { id: 'prog', max: 1, value: 0 }),
    el('div', { className: 'time', id: 'ptime' }),
    el('div', { className: 'ctrls' },
      el('button', { className: 'btn primary', id: 'pplay', type: 'button', textContent: '▶ 재생', onclick: () => (player.playing ? stop() : play()) }),
      el('button', { className: 'btn', type: 'button', textContent: '처음부터', onclick: () => { player.t = 0; play(); } }),
      el('button', { className: 'btn', type: 'button', textContent: '다 쓴 모습', onclick: () => { stop(); player.t = player.data.tl.total; drawReplay(); } }),
      speedSeg),
    el('div', { className: 'ctrls' },
      el('label', { className: 'chk' }, squeeze, '긴 멈춤 줄이기'),
      el('label', { className: 'chk' }, guide, '정답 안내선')));
  squeeze.onchange = () => { player.data.tl = timeline(r.strokes, squeeze.checked); player.t = Math.min(player.t, player.data.tl.total); drawReplay(); };
  guide.onchange = drawReplay;

  // 오른쪽: 채점
  const form = el('div', { className: 'form' });
  const scoreIn = el('input', { type: 'number', min: 0, max: 100, step: 1, inputMode: 'numeric', placeholder: '0~100', value: r.dev_score ?? '' });
  scoreIn.setAttribute('aria-label', '개발자 점수');
  const chips = el('div', { className: 'chips' });
  const mk = (code, name, cls = '') => {
    const inp = el('input', { type: 'checkbox', value: code });
    inp.checked = code === 'NONE' ? (Array.isArray(r.dev_issues) && !r.dev_issues.length) : (r.dev_issues || []).includes(code);
    chips.append(el('label', { className: `chip ${cls}` }, inp, el('span', { textContent: name })));
    return inp;
  };
  const none = mk('NONE', '문제 없음', 'none');
  const checks = Object.entries(ISSUE_NAMES_KO).map(([c, n]) => mk(c, n));
  for (const c of [none, ...checks]) c.onchange = () => {
    if (c.checked) { if (c === none) checks.forEach((o) => { o.checked = false; }); else none.checked = false; }
    updateHint();
  };
  const note = el('textarea', { placeholder: '기준·이유를 직접 적어요 (예: 획이 떨림, 너무 기울어짐)', maxLength: 500, value: r.dev_note || '' });
  note.setAttribute('aria-label', '메모');
  const msg = el('p', { className: 'muted' }); msg.setAttribute('aria-live', 'polite');
  // 고른 문제 버튼에 맞는 기준 범위를 바로 보여 준다(엔진 점수가 아니라 교사 기준표에서). 범위를 벗어나면 알림
  const hint = el('div', { className: 'hint' }); hint.setAttribute('aria-live', 'polite');
  const updateHint = () => {
    const picked = none.checked ? [] : checks.filter((c) => c.checked).map((c) => c.value);
    const any = none.checked || picked.length;
    const rb = any ? rubricFor(picked) : null;
    markRubric(any ? picked : null);
    hint.className = 'hint';
    if (!rb) { hint.textContent = '보이는 문제를 고르면 기준 범위를 알려 드려요.'; return; }
    const sub = rb.codes.includes('OVERSHOOT') ? ' (살짝 지나친 정도면 80~85)' : '';
    hint.textContent = `📋 ${rb.name}: 보통 ${bandText(rb.band)}${rb.typical ? `, 대표 ${rb.typical}` : ''}${sub} · ${rb.rule}`;
    const v = Number(scoreIn.value);
    const [lo, hi] = rb.band;
    if (scoreIn.value !== '' && Number.isFinite(v) && ((lo != null && v < lo) || (hi != null && v > hi))) {
      const okSlight = rb.codes.includes('OVERSHOOT') && v >= 80 && v <= 85;
      if (!okSlight) { hint.className = 'hint warn'; hint.textContent += ` — ${v}점은 기준 범위를 벗어나요. 예외라면 메모에 이유를 적어 주세요.`; }
    }
  };
  const reveal = el('div', { className: 'reveal' });
  const saveBtn = el('button', { className: 'btn primary', type: 'button', textContent: r.dev_score != null ? '고쳐 저장' : '저장' });
  const nextBtn = el('button', { className: 'btn', type: 'button', textContent: '다음 글씨 →' });
  const delBtn = el('button', { className: 'btn danger', type: 'button', textContent: '삭제' });
  form.append(
    el('h3', { textContent: '개발자 점수' }), el('div', { className: 'score-in' }, scoreIn, el('span', { className: 'muted', textContent: 'Enter로 저장' })),
    el('h3', { textContent: '보이는 문제 (여러 개 고를 수 있어요)' }), chips, hint,
    el('h3', { textContent: '기준·메모 (직접 입력)' }), note,
    el('div', { className: 'actions' }, saveBtn, nextBtn, delBtn), msg, reveal);

  const showReveal = () => {
    reveal.replaceChildren();
    if (r.dev_score == null && !$('showEngine').checked) {
      reveal.append(el('span', { className: 'hidden-note', textContent: '엔진 점수는 개발자 점수를 저장하면 보여요.' }));
      return;
    }
    const now = evaluate(r.ch, r.strokes.map((s) => s.map(([x, y]) => ({ x, y }))), { device: r.device });
    const add = (label, text) => reveal.append(el('div', {}, el('b', { textContent: `${label} ` }), text));
    add('보낼 때 엔진', `${r.engine_score}점 · ${issueNames(r.engine_issues)} (v${r.engine_version || '?'})`);
    add('지금 엔진', `${now.score}점 · ${issueNames(now.issues.map((i) => i.code))}`);
    const why = el('div', { className: 'why' }, el('b', { textContent: '엔진이 이 점수를 준 이유' }));
    for (const k of explainKo(now)) why.append(el('span', { className: `k-${k.kind}`, textContent: k.text }));
    reveal.append(why);
    if (r.teacher_score != null) add('교사 표본', `${r.teacher_score}점 · ${r.teacher_issues ? issueNames(r.teacher_issues) : '문제 표시 안 함'}`);
    if (r.dev_score != null) {
      const diff = now.score - r.dev_score;
      add('개발자', `${r.dev_score}점 · ${r.dev_issues ? issueNames(r.dev_issues) : '문제 표시 안 함'}`);
      reveal.append(el('div', { className: 'diff-big', textContent: `지금 엔진 − 개발자 = ${diff > 0 ? '+' : ''}${diff}점` }));
      if (r.dev_issues) {
        const got = now.issues.map((i) => i.code);
        const miss = r.dev_issues.filter((c) => !got.includes(c)), extra = got.filter((c) => !r.dev_issues.includes(c) && ISSUE_NAMES_KO[c]);
        if (miss.length) add('엔진이 놓친 문제', issueNames(miss));
        if (extra.length) add('엔진만 짚은 문제', issueNames(extra));
      }
    }
  };
  showReveal();

  saveBtn.onclick = async () => {
    const v = Number(scoreIn.value);
    if (scoreIn.value === '' || !Number.isInteger(v) || v < 0 || v > 100) { msg.textContent = '0부터 100 사이 정수로 넣어 주세요.'; scoreIn.focus(); return; }
    const picked = checks.filter((c) => c.checked).map((c) => c.value);
    const patch = { dev_score: v, dev_issues: none.checked ? [] : (picked.length ? picked : null), dev_note: note.value.trim() || null,
      dev_labeled_at: new Date().toISOString(), dev_by: session.uid };
    saveBtn.disabled = true;
    try {
      const [upd] = await withAuth((t) => updateAttempt(t, r.id, patch));
      Object.assign(r, upd || patch);
      msg.textContent = '저장했어요.'; saveBtn.textContent = '고쳐 저장';
      renderList(); showReveal(); nextBtn.focus();
    } catch { msg.textContent = '저장하지 못했어요. 인터넷을 확인하고 다시 눌러 주세요.'; }
    finally { saveBtn.disabled = false; }
  };
  scoreIn.onkeydown = (e) => { if (e.key === 'Enter') saveBtn.click(); };
  scoreIn.oninput = updateHint;
  updateHint();
  nextBtn.onclick = () => {
    const i = rows.findIndex((x) => x.id === r.id);
    const nxt = rows.slice(i + 1).find((x) => x.dev_score == null) || rows[i + 1];
    if (nxt) open(nxt.id); else msg.textContent = '목록의 마지막이에요. 더 보기나 불러오기를 눌러 주세요.';
  };
  delBtn.onclick = async () => {
    if (!confirm(`${r.writer}의 '${r.ch}' 글씨를 지울까요? 되돌릴 수 없어요.`)) return;
    try {
      await withAuth((t) => deleteAttempt(t, r.id));
      const i = rows.findIndex((x) => x.id === r.id); rows.splice(i, 1); total--;
      renderList();
      if (rows[i] || rows[i - 1]) open((rows[i] || rows[i - 1]).id); else $('detail').replaceChildren(el('p', { className: 'empty', textContent: '글씨가 없어요.' }));
    } catch { msg.textContent = '지우지 못했어요.'; }
  };

  d.append(el('div', { className: 'detail' }, left, form));
  player.data = { ch: r.ch, tl: timeline(r.strokes, true) };
  player.t = 0;
  requestAnimationFrame(() => { drawReplay(); play(); });
  if (r.dev_score == null) scoreIn.focus({ preventScroll: true });
}
window.addEventListener('resize', drawReplay);

// ---------- 내려받기: test/samples/ 형식 ----------
$('export').onclick = async () => {
  const all = [];
  try {
    for (let off = 0; ; off += 1000) {
      const q = new URLSearchParams({ select: '*', order: 'created_at.asc', limit: '1000', offset: String(off), dev_score: 'not.is.null' });
      const r = await withAuth((t) => listAttempts(t, q.toString()));
      all.push(...r.rows); if (r.rows.length < 1000) break;
    }
  } catch { alert('불러오지 못했어요.'); return; }
  if (!all.length) { alert('채점한 글씨가 아직 없어요.'); return; }
  const samples = all.map((r) => ({
    char: r.ch, teacherScore: r.dev_score, device: r.device, engineScoreAtSave: r.engine_score,
    teacherIssues: r.dev_issues, engineIssuesAtSave: r.engine_issues, note: r.dev_note || undefined,
    writer: r.writer, source: 'server', id: r.id, engineVersion: r.engine_version,
    strokes: r.strokes.map((s) => s.map(([x, y]) => [x, y])), savedAt: r.dev_labeled_at,
  }));
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  const body = `{"version":1,"exportedAt":${JSON.stringify(d.toISOString())},"samples":[\n${samples.map((s) => JSON.stringify(s)).join(',\n')}\n]}\n`;
  const a = el('a', { href: URL.createObjectURL(new Blob([body], { type: 'application/json' })),
    download: `server-samples-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

if (session) enter(); else showLogin();
