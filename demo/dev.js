// 글씨 채점실(개발자 전용): 학생·교사가 보낸 글씨를 쓴 순서·빠르기 그대로 다시 보고, 개발자 점수·문제·메모를 붙인다.
// 앱 채점(엔진)은 개발자 점수를 저장한 뒤에 보인다(먼저 보면 점수가 끌려가므로). '앱 채점 먼저 보기'로 바꿀 수 있다.
import { evaluate, getTemplate, explainScore } from '../src/engine.js';
import { ISSUE_NAMES_KO, speechKo, speechCase } from '../src/feedback-ko.js';
import { LABELS, GROUPS as LABEL_GROUPS, EXCLUDE, LABEL_BY_CODE, parseLabel, labelCodes, engineToLabels, primaryLabel, migrateLabels, migrateFeedback } from '../src/labels.js';
import { createLabelPicker } from './label-picker.js';
import { auth, isDev, listAttempts, listBatches, submitBatch, updateAttempt, deleteAttempt } from './server.js';
import { RUBRIC, RUBRIC_DATE, RUBRIC_SAMPLES, GRADES, PRECEDENTS, rubricFor } from './rubric.js';

const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const DEVICE = { finger: '손가락', pen: '펜', board: '전자칠판' };
const issueNames = (codes) => (codes && codes.length ? codes.map((c) => ISSUE_NAMES_KO[c] || c).join(', ') : '문제 없음');
// 평가 항목 이름(정도·세부 포함): 'OVERSHOOT!' → '넘어감(뚜렷)'
const labelNames = (labels) => {
  if (labels == null) return '표시 안 함';
  if (!labels.length) return '문제 없음';
  return labels.map((s) => { const p = parseLabel(s); const n = LABEL_BY_CODE[p.code]?.name || p.code; return p.tag ? null : n + (p.strong ? '(뚜렷)' : ''); }).filter(Boolean).join(', ');
};
// 학생에게 할 말(엔진 문제 코드 → 평가 항목으로 보여 줌)
const SAY = { WRONG_CHAR: '다른 글자처럼 보여요. 시범을 보고 다시 써 봐요.', STROKE_COUNT: '빠진 획(더 그은 획)이 있어요.', WRONG_ORDER: '획순이 달라요. 시범을 보고 따라 써요.',
  WRONG_DIRECTION: '반대로 그었어요. 시작점에서 시작해요.', STROKE_SPLIT: '끊지 말고 이어서 쓰세요.', STROKES_JOINED: '이어 쓰지 말고, 획을 나눠서 써요.',
  OVERSHOOT: '닿는 곳에서 멈춰요.', GAP: '획이 닿을 때까지 그어요.', SHAPE: '안내선에 맞춰 다시 써 봐요.', SIZE: '알맞은 크기로 써요.', OFF_CENTER: '칸 가운데에 써요.' };

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
  load(); refreshSync();
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
  if ($('fState').value === 'todo') q.append('dev_labeled_at', 'is.null');
  if ($('fState').value === 'done') q.append('dev_labeled_at', 'not.is.null');
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
      el('span', {}, r.dev_score != null ? el('span', { className: 'tag done', textContent: `채점 ${r.dev_score}` }) : (r.dev_labeled_at ? el('span', { className: 'tag', textContent: '제외' }) : el('span', { className: 'tag todo', textContent: '채점 전' })),
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

// ---------- 엔진 반영 상태와 제출하기 ----------
// 채점은 자동 저장되고, '제출하기'를 누르면 묶음으로 넘어간다. 매일 자동 처리가 묶음을 받아 엔진 표본에 반영하고 반영 날짜를 남긴다.
// 제출한 뒤 다시 고친 채점은 '반영 안 됨'으로 돌아가 다음 제출에 들어간다.
const fmtDate = (s) => { const d = new Date(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
async function refreshSync() {
  const box = $('sync');
  let unsent = 0, batches = [];
  try {
    unsent = (await withAuth((t) => listAttempts(t, 'select=id&dev_score=not.is.null&batch_id=is.null&limit=1'))).total;
    batches = (await withAuth((t) => listBatches(t, 'select=*&order=created_at.desc&limit=50'))).rows;
  } catch { box.textContent = '반영 상태를 불러오지 못했어요.'; return; }
  const applied = batches.find((b) => b.status === 'applied');
  const pending = batches.filter((b) => b.status === 'submitted');
  const pendingN = pending.reduce((a, b) => a + b.item_count, 0);
  const failed = batches.find((b) => b.status === 'failed');
  box.replaceChildren(
    el('b', { textContent: '🧠 앱에 반영' }),
    el('span', {}, '마지막 반영 ', el('span', { className: 'num', textContent: applied ? fmtDate(applied.applied_at) : '아직 없음' }),
      applied?.summary ? el('span', { className: 'muted', textContent: ` (${applied.summary.split('\n')[0]})` }) : ''),
    el('span', { className: unsent ? 'warn' : 'ok' }, '반영 안 된 채점 ', el('span', { className: 'num', textContent: `${unsent}개` })),
    pendingN ? el('span', {}, '제출됨·처리 대기 ', el('span', { className: 'num', textContent: `${pendingN}개` }), el('span', { className: 'muted', textContent: ` (${fmtDate(pending.at(-1).created_at)} 제출, 매일 자동 처리)` })) : '',
    failed && (!applied || failed.created_at > applied.created_at) ? el('span', { className: 'warn', textContent: `처리 실패: ${failed.summary || ''}` }) : '',
    el('span', { className: 'sp' }));
  const btn = el('button', { className: 'btn primary', type: 'button', textContent: unsent ? `제출하기 (${unsent}개)` : '제출할 채점 없음', disabled: !unsent });
  btn.onclick = async () => {
    await flushSave?.();
    btn.disabled = true;
    try { const r = await withAuth((t) => submitBatch(t)); btn.textContent = `${r.count}개 제출했어요`; } catch { btn.textContent = '제출하지 못했어요'; }
    setTimeout(refreshSync, 800);
  };
  box.append(btn);
}
let flushSave = null; // 지금 열린 글씨에 저장 안 된 변경이 있으면 바로 저장

// ---------- 채점 기준표 ----------
// 교사 표본에서 뽑은 기준을 펼쳐 두고 본다. 줄을 누르면 그 문제와 대표 점수가 채점 칸에 바로 들어간다.
const bandText = (b) => b[0] == null && b[1] == null ? '?' : b[0] == null ? `~${b[1]}` : `${b[0]}~${b[1]}`;
const bandColor = (b) => { const hi = b[1] ?? 100; return hi < 60 ? '#e03131' : hi <= 70 ? '#f08c00' : hi <= 85 ? '#3b5bdb' : '#37b24d'; };
let activeForm = null; // 지금 열린 글씨의 채점 칸(기준표·피드백 목록에서 바로 채우기용)
let rubricTab = 'score';

function trackOf(r) {
  const t = el('div', { className: 'track' });
  const [lo, hi] = r.band;
  if (hi != null) {
    const band = el('span', { className: `band${lo == null ? ' unk' : ''}` });
    band.style.left = `${lo ?? 0}%`; band.style.width = `${hi - (lo ?? 0)}%`; band.style.background = bandColor(r.band);
    t.append(band);
  }
  if (r.typical != null) { const m = el('span', { className: 'typ', title: `대표 ${r.typical}` }); m.style.left = `${r.typical}%`; t.append(m); }
  return t;
}
function renderRubric() {
  const box = $('rubric'); box.replaceChildren();
  const tabs = el('div', { className: 'rb-tabs' });
  tabs.setAttribute('role', 'tablist');
  for (const [k, label] of [['score', '점수 기준'], ['labels', '항목 정의']]) {
    const b = el('button', { type: 'button', textContent: label });
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(rubricTab === k));
    b.onclick = () => { rubricTab = k; renderRubric(); activeForm?.refresh(); };
    tabs.append(b);
  }
  box.append(el('div', { className: 'rb-head' }, el('h2', { textContent: '📋 채점 기준' }), tabs));
  const body = el('div', { className: 'rb-body' });
  box.append(body);
  if (rubricTab === 'score') {
    const scale = el('div', { className: 'scale' });
    for (const t of ['F ~59', 'C 60', 'B 70', 'A 80', 'S 90']) scale.append(el('span', { textContent: t }));
    const steps = el('div', { className: 'steps' });
    for (const [n, t] of [['①', '다른 글자인가'], ['②', '가장 위의 문제 하나가 범위'], ['③', '범위 안에서 모양으로'], ['④', '벗어나면 메모']])
      steps.append(el('span', {}, el('b', { textContent: n }), ` ${t}`));
    body.append(scale, steps,
      el('p', { className: 'rb-tip', textContent: `줄을 누르면 그 문제와 대표 점수(▍)가 바로 들어가요 · 교사 표본 ${RUBRIC_SAMPLES}개 (${RUBRIC_DATE})` }));
    for (const r of RUBRIC) {
      const row = el('button', { type: 'button', className: `rb${r.sub ? ' sub' : ''}${r.n ? '' : ' nodata'}` });
      row.dataset.key = r.name;
      row.append(
        el('div', { className: 'rb-top' }, el('b', { textContent: r.name }),
          el('span', { className: 'rb-band' }, bandText(r.band), el('small', { textContent: r.n ? `표본 ${r.n}` : '표본 필요' })),
          el('span', { className: 'rb-short', textContent: r.short })),
        trackOf(r),
        el('div', { className: 'more' }, el('div', { textContent: r.rule }), r.look ? el('div', { className: 'look', textContent: `예: ${r.look}` }) : ''));
      row.onclick = () => activeForm?.applyRubric(r);
      body.append(row);
    }
    const prec = el('details', { className: 'prec' }, el('summary', { textContent: `예외로 정한 표본 ${PRECEDENTS.length}개` }));
    const ul = el('ul'); for (const p of PRECEDENTS) ul.append(el('li', { textContent: `${p.ch} ${p.score}점: ${p.decision}` }));
    prec.append(ul); body.append(prec);
  } else {
    body.append(el('p', { className: 'rb-tip', textContent: '이 정의 하나로만 고릅니다. 위에 있을수록 학생에게 먼저 말해요(★로 바꿀 수 있음). 넘어감·안 닿음·획 모양·크기는 누를 때마다 살짝 → 뚜렷 → 해제.' }));
    for (const g of LABEL_GROUPS) {
      body.append(el('div', { className: 'fb-group', textContent: `${g.name} · ${g.note}` }));
      for (const l of LABELS.filter((x) => x.group === g.key)) {
        body.append(el('div', { className: 'fb' }, el('b', { textContent: l.name }),
          el('span', { className: `badge ${l.severity ? 'new' : 'on'}`, textContent: l.severity ? '살짝/뚜렷' : '있음/없음' }),
          el('span', { className: 'def', textContent: l.def }), el('q', { textContent: SAY[l.code] })));
      }
    }
    body.append(el('div', { className: 'fb-group', textContent: '그 밖' }),
      el('div', { className: 'fb' }, el('b', { textContent: EXCLUDE.name }), el('span', { className: 'badge' }), el('span', { className: 'def', textContent: `${EXCLUDE.def}. 점수 학습에서 빠져요.` })),
      el('p', { className: 'rb-tip', textContent: '칭찬(잘함·나아짐·격려)은 고르지 않아요. 점수와 지난 기록으로 앱이 정해요.' }));
  }
}
// 지금 고른 문제·피드백과 맞는 줄을 표시
function markRubric(codes) {
  const hit = rubricFor(codes);
  document.querySelectorAll('#rubric .rb').forEach((row) => row.classList.toggle('hit', !!hit && row.dataset.key === hit.name));
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
  if ($('guide')?.checked) {
    const tpl = getTemplate(player.data.ch);
    if (tpl) {
      tpl.strokes.forEach((s) => line(s.points, css('--guide'), 0.07));
      // 정답 획 번호(흐린 파랑). 학생이 그은 차례는 주황 번호
      tpl.strokes.forEach((s, i) => {
        const p = s.points[0];
        c.fillStyle = 'rgba(59, 91, 219, 0.35)'; c.beginPath(); c.arc(p.x, p.y, 0.02, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff'; c.font = 'bold 0.026px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(i + 1), p.x, p.y + 0.001);
      });
    }
  }
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
  flushSave?.();
  const r = rows.find((x) => x.id === id); if (!r) return;
  current = id; stop();
  renderList();
  const d = $('detail'); d.replaceChildren();
  const when = new Date(r.created_at).toLocaleString('ko-KR');
  d.append(el('div', { className: 'head' },
    el('b', { textContent: r.ch }), el('span', { textContent: r.writer }),
    el('span', { className: 'muted', textContent: `${when} · ${DEVICE[r.device] || r.device} · ${r.strokes.length}획 · 앱 채점 v${r.engine_version || '?'}` })));

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
  // 정답 안내선: 학생이 보고 쓴 글자를 흐리게 뒤에 깔아 둔다(기본 켬, 선택은 기억)
  let guideOn = true;
  try { guideOn = localStorage.getItem('hw-dev-guide') !== '0'; } catch {}
  const guide = el('input', { type: 'checkbox', id: 'guide', checked: guideOn });
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
  guide.onchange = () => { try { localStorage.setItem('hw-dev-guide', guide.checked ? '1' : '0'); } catch {} drawReplay(); };

  // 오른쪽: 채점
  const form = el('div', { className: 'form' });
  const scoreIn = el('input', { type: 'number', min: 0, max: 100, step: 1, inputMode: 'numeric', placeholder: '0~100', value: r.dev_score ?? '' });
  scoreIn.setAttribute('aria-label', '개발자 점수');
  // 평가 항목(11개 + 제외, 살짝/뚜렷, ★ 먼저 말할 것). 예전 표시는 새 항목으로 옮겨 보여 준다
  const chips = el('div');
  const picker = createLabelPicker(chips, { value: migrateLabels(r.dev_issues), star: migrateFeedback(r.dev_feedback), withStar: true, withTags: true,
    onChange: () => { updateHint(); changed(); } });
  const note = el('textarea', { placeholder: '기준·이유를 직접 적어요 (예: 획이 떨림, 너무 기울어짐)', maxLength: 500, value: r.dev_note || '' });
  note.setAttribute('aria-label', '메모');
  const msg = el('p', { className: 'muted' }); msg.setAttribute('aria-live', 'polite');
  // 고른 문제 버튼에 맞는 기준 범위를 바로 보여 준다(엔진 점수가 아니라 교사 기준표에서). 범위를 벗어나면 알림
  const hint = el('div', { className: 'hint' }); hint.setAttribute('aria-live', 'polite');
  const updateHint = () => {
    const { labels, star } = picker.get();
    hint.className = 'hint';
    if (labels && labels[0] === EXCLUDE.code) { markRubric(null); hint.textContent = '채점 제외: 점수는 넣지 않아도 돼요. 점수 학습에서 빠져요.'; return; }
    const rb = rubricFor(labels);
    markRubric(labels);
    if (!rb) { hint.textContent = '보이는 문제를 고르면 기준 범위를 알려 드려요.'; return; }
    const first = primaryLabel(labels, star);
    hint.textContent = `📋 ${rb.name}: 보통 ${bandText(rb.band)}${rb.typical ? `, 대표 ${rb.typical}` : ''} · ${rb.rule}`
      + (first ? ` · 🔊 학생에게: “${SAY[first]}”` : '');
    const v = Number(scoreIn.value);
    const [lo, hi] = rb.band;
    if (scoreIn.value !== '' && Number.isFinite(v) && ((lo != null && v < lo) || (hi != null && v > hi))) {
      hint.className = 'hint warn'; hint.textContent += ` — ${v}점은 기준 범위를 벗어나요. 예외라면 메모에 이유를 적어 주세요.`;
    }
  };
  const reveal = el('div', { className: 'reveal' });
  const saveBtn = el('button', { className: 'btn primary', type: 'button', textContent: r.dev_score != null ? '고쳐 저장' : '저장' });
  const nextBtn = el('button', { className: 'btn', type: 'button', textContent: '다음 글씨 →' });
  const delBtn = el('button', { className: 'btn danger', type: 'button', textContent: '삭제' });
  form.append(
    el('h3', { textContent: '개발자 점수' }), el('div', { className: 'score-in' }, scoreIn, el('span', { className: 'muted', textContent: 'Enter로 저장' })),
    el('h3', { textContent: '보이는 문제' }), chips, hint,
    el('h3', { textContent: '기준·메모 (직접 입력)' }), note,
    el('div', { className: 'actions' }, saveBtn, nextBtn, delBtn), msg, reveal);

  // 내 채점과 앱 채점(엔진)을 나란히. 화면에는 '엔진' 대신 '앱'이라고 쓴다
  const showReveal = () => {
    reveal.replaceChildren();
    if (r.dev_score == null && !$('showEngine').checked) {
      reveal.append(el('span', { className: 'hidden-note', textContent: '앱 채점은 내 점수를 저장하면 보여요.' }));
      return;
    }
    const now = evaluate(r.ch, r.strokes.map((s) => s.map(([x, y]) => ({ x, y }))), { device: r.device });
    const mine = migrateLabels(r.dev_issues);
    const excluded = mine?.[0] === EXCLUDE.code;
    const appLabels = engineToLabels(now.issues);
    const names = (codes) => (codes.length ? codes.map((c) => LABEL_BY_CODE[c]?.name || c).join(', ') : '문제 없음');
    const col = (title, score, sub) => el('div', { className: 'vs-col' },
      el('div', { className: 'vs-t', textContent: title }), el('div', { className: 'vs-s', textContent: score }), el('div', { className: 'vs-i', textContent: sub }));
    reveal.append(el('div', { className: 'vs' },
      col('내 채점', excluded ? '제외' : r.dev_score != null ? `${r.dev_score}점` : '—', mine ? (excluded ? '채점 제외' : labelNames(mine)) : '항목 안 고름'),
      col('앱 채점', `${now.score}점`, names(appLabels))));
    if (r.teacher_score != null) reveal.append(el('div', { className: 'vs-note', textContent: `교사가 쓰면서 매긴 점수: ${r.teacher_score}점 · ${labelNames(migrateLabels(r.teacher_issues))}` }));

    const line = (ok, text) => reveal.append(el('div', { className: ok ? 'v-ok' : 'v-warn', textContent: `${ok ? '✓' : '!'} ${text}` }));
    if (r.dev_score != null && !excluded) {
      const diff = now.score - r.dev_score;
      line(Math.abs(diff) <= 5, diff === 0 ? '점수가 같아요.' : Math.abs(diff) <= 5 ? `점수가 비슷해요(${Math.abs(diff)}점 차이).`
        : `앱이 ${Math.abs(diff)}점 ${diff > 0 ? '높게' : '낮게'} 줬어요.`);
    }
    if (mine && !excluded) {
      const want = labelCodes(mine);
      const miss = want.filter((c) => !appLabels.includes(c)), extra = appLabels.filter((c) => !want.includes(c));
      if (!miss.length && !extra.length) line(true, '같은 문제를 찾았어요.');
      if (miss.length) line(false, `앱이 못 본 문제: ${names(miss)}`);
      if (extra.length) line(false, `앱만 짚은 문제: ${names(extra)}`);
      // 학생에게 먼저 할 말
      const said = speechKo(now);
      const appFirst = engineToLabels([speechCase(now)])[0] || null, myFirst = primaryLabel(mine, migrateFeedback(r.dev_feedback));
      if (myFirst || appFirst) {
        if (myFirst === appFirst) line(true, `학생에게 같은 말을 먼저 해요: “${said || SAY[myFirst]}”`);
        else {
          line(false, '학생에게 먼저 할 말이 달라요.');
          reveal.append(el('div', { className: 'v-sub', textContent: `앱: ${said ? `“${said}”` : '(말하지 않고 칭찬)'}` }),
            el('div', { className: 'v-sub', textContent: `나: ${myFirst ? `${LABEL_BY_CODE[myFirst].name} — “${SAY[myFirst]}”` : '(말할 것 없음)'}` }));
        }
      }
    }
    // 앱 점수가 나온 까닭(펼쳐 보기)
    const ex = explainScore(now);
    const PART = { order: '획순', direction: '방향', shape: '모양', placement: '자리·크기' };
    const cut = ex.deductions.map((d) => `${PART[d.key]} ${Math.round(d.lost)}점`).join(', ');
    const why = [];
    if (ex.binding) {
      why.push(`‘${ISSUE_NAMES_KO[ex.binding.code] || ex.binding.code}’ 문제가 있으면 앱은 ${ex.binding.cap}점까지만 줘요.`);
      if (cut) why.push(`모양 등에서 깎인 점수(${cut})는 이미 그보다 낮지 않아서 더 깎지 않았어요.`);
    } else if (cut) why.push(`100점에서 ${cut}을 깎았어요.`);
    else why.push('깎은 점수가 없어요.');
    if (r.engine_score != null && r.engine_score !== now.score) why.push(`보낼 때 앱 점수는 ${r.engine_score}점이었어요(그 뒤 앱 채점 규칙이 바뀜).`);
    const det = el('details', { className: 'v-why' }, el('summary', { textContent: '앱 점수가 나온 까닭' }));
    for (const t of why) det.append(el('div', { textContent: t }));
    reveal.append(det);
  };
  showReveal();

  // 저장: 입력을 바꾸면 1초 뒤 자동 저장(앱 채점은 아직 안 보임). '저장하고 앱 채점과 비교'나 다음 글씨로 넘어가면 바로 저장
  // 다시 고치면 batch_id를 비워 '반영 안 됨'으로 돌린다(다음 제출에 들어감)
  const validScore = () => { const v = Number(scoreIn.value); return scoreIn.value !== '' && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null; };
  const isExcluded = () => (picker.get().labels || [])[0] === EXCLUDE.code;
  const buildPatch = (v) => {
    const { labels, star } = picker.get();
    return { dev_score: isExcluded() ? null : v, dev_issues: labels, dev_note: note.value.trim() || null,
      dev_feedback: star, dev_feedback_text: null,
      dev_labeled_at: new Date().toISOString(), dev_by: session.uid, batch_id: null };
  };
  let dirty = false, timer = null, saving = null;
  const persist = async () => {
    clearTimeout(timer); timer = null;
    const v = validScore();
    if (!dirty || (v == null && !isExcluded())) return v != null || isExcluded();
    dirty = false;
    saving = withAuth((t) => updateAttempt(t, r.id, buildPatch(v)))
      .then(([upd]) => { Object.assign(r, upd || {}); auto.textContent = `자동 저장됨 · ${fmtDate(new Date().toISOString()).split(' ').pop()}`; renderList(); refreshSync(); return true; })
      .catch(() => { dirty = true; auto.textContent = ''; msg.textContent = '저장하지 못했어요. 인터넷을 확인해 주세요.'; return false; });
    return saving;
  };
  const changed = () => { dirty = true; auto.textContent = validScore() == null && !isExcluded() ? '' : '저장 중…'; clearTimeout(timer); timer = setTimeout(persist, 1000); };
  flushSave = persist;
  const auto = el('span', { className: 'autosaved' }); auto.setAttribute('aria-live', 'polite');
  saveBtn.textContent = '저장하고 앱 채점과 비교';
  saveBtn.after(auto);
  saveBtn.onclick = async () => {
    if (validScore() == null && !isExcluded()) { msg.textContent = '0부터 100 사이 정수로 넣어 주세요.'; scoreIn.focus(); return; }
    dirty = true; saveBtn.disabled = true;
    const ok = await persist(); saveBtn.disabled = false;
    if (ok) { msg.textContent = ''; showReveal(); nextBtn.focus(); }
  };
  note.addEventListener('input', changed);
  scoreIn.onkeydown = (e) => { if (e.key === 'Enter') saveBtn.click(); };
  scoreIn.oninput = () => { updateHint(); changed(); };
  updateHint();
  // 기준표·피드백 목록에서 바로 채우기
  activeForm = {
    applyRubric(rb) {
      picker.set(rb.code === 'NONE' ? [] : [rb.code + (rb.sev === 'strong' ? '!' : '')], null);
      if (rb.typical != null) scoreIn.value = String(rb.typical);
      updateHint(); changed(); scoreIn.focus(); scoreIn.select();
    },
    refresh() { updateHint(); },
  };
  nextBtn.onclick = () => {
    const i = rows.findIndex((x) => x.id === r.id);
    const nxt = rows.slice(i + 1).find((x) => !x.dev_labeled_at) || rows[i + 1];
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
    feedback: r.dev_feedback || undefined, feedbackText: r.dev_feedback_text || undefined,
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
