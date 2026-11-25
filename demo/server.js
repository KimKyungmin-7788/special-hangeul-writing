// 서버(Supabase) 연결. 학생·교사 글씨 보내기와 개발자 로그인·조회에 쓴다.
// 이 키는 공개용(publishable) 키라 화면 코드에 있어도 된다. 읽기·수정 권한은 서버 규칙(RLS)이 막는다.
export const SUPABASE_URL = 'https://pbpkoumwdjjciayxpbti.supabase.co';
const KEY = 'sb_publishable_Al-2MssElYz-dnvHv9XUvg_wQCvleWp';

// 작성자 코드 규칙(서버 hw_writer_ok와 같다). 학생은 실명 없이 학교급-학년-번호만 받는다.
export const SCHOOL = { '초': 6, '중': 3, '고': 3, '전': 3 }; // 학교급별 학년 수
export const SCHOOL_NAME = { '초': '초등', '중': '중학', '고': '고등', '전': '전공과' };
export const isWriter = (w) => /^(초-[1-6]|중-[1-3]|고-[1-3]|전-[1-3])-(0[1-9]|[1-9][0-9])$/.test(w)
  || /^교사-[가-힣A-Za-z0-9]{1,10}$/.test(w);
export const isTeacher = (w) => /^교사-/.test(w);

async function call(path, { method = 'POST', body, token, headers = {} } = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    method,
    headers: { apikey: KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) { const e = new Error((data && (data.message || data.error_description || data.msg)) || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// ---------- 학생·교사: 보내기 ----------
// 획: [[x, y, t], ...] (t는 첫 획을 시작한 뒤 지난 밀리초)
// motor: 이 글씨를 쓸 때 운동 지원이 켜져 있었는지(엔진이 운동 조절 문제를 너그럽게 봄)
export function submitAttempt({ writer, ch, device, strokes, engineScore, engineIssues, engineVersion, motor = false }) {
  return call('/rest/v1/rpc/hw_submit', { body: {
    p_writer: writer, p_ch: ch, p_device: device, p_strokes: strokes,
    p_engine_score: engineScore, p_engine_issues: engineIssues, p_engine_version: engineVersion, p_motor: !!motor,
  } });
}
export function teacherLabel({ id, writer, score, issues }) {
  return call('/rest/v1/rpc/hw_teacher_label', { body: { p_id: id, p_writer: writer, p_score: score, p_issues: issues } });
}

// ---------- 개발자: 로그인·조회·채점 ----------
export const auth = {
  async signIn(email, password) {
    return call('/auth/v1/token?grant_type=password', { body: { email, password } });
  },
  async refresh(refreshToken) {
    return call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
  },
  async signOut(token) {
    try { await call('/auth/v1/logout', { token }); } catch {}
  },
};
export const isDev = (token) => call('/rest/v1/rpc/hw_is_dev', { token, body: {} });
// 목록과 전체 개수(Content-Range)
export const listAttempts = (token, query) => listTable(token, 'hw_attempts', query);
export const listBatches = (token, query) => listTable(token, 'hw_batches', query);
// 제출하기: 채점했지만 아직 안 낸 글씨를 묶음으로(자동 처리가 매일 엔진 표본에 반영)
export const submitBatch = (token) => call('/rest/v1/rpc/hw_submit_batch', { token, body: {} });
async function listTable(token, table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, Prefer: 'count=exact' } });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  const total = Number((res.headers.get('content-range') || '').split('/')[1]) || 0;
  return { rows: await res.json(), total };
}
export const updateAttempt = (token, id, patch) => call(`/rest/v1/hw_attempts?id=eq.${encodeURIComponent(id)}`, {
  method: 'PATCH', token, body: patch, headers: { Prefer: 'return=representation' } });
export const deleteAttempt = (token, id) => call(`/rest/v1/hw_attempts?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', token });
