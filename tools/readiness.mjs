// 2단계(점수 보정 학습)로 넘어가도 되는지 점검한다. 매일 반영 작업(tools/APPLY.md)에서 돌리고 보고서에 적는다.
// 조건을 모두 넘으면 ready: true. 마지막 조건은 '시험 학습'이 실제로 지금 규칙 엔진보다 교사 점수에 더 가까운지다.
// 실행: node tools/readiness.mjs        (사람용 요약)
//       node tools/readiness.mjs --json (기계용)
import fs from 'node:fs';
import { evaluate, listChars } from '../src/engine.js';
import { migrateLabels } from '../src/labels.js';

// 넘어갈 조건(바꾸려면 운영자와 합의 후 docs/engine-report.md에 이유를 남긴다)
export const CRITERIA = {
  samples: 300,        // 점수가 있는 표본(채점 제외·이견 표본 빼고)
  writers: 15,         // 서로 다른 작성자 코드
  charCoverage: 0.8,   // 표본 5개 이상인 글자의 비율(자음·모음·가나다 49자 중)
  perChar: 5,
  perGrade: 20,        // S·A·B·C·F 등급마다 교사 점수 표본 수
  labeledRatio: 0.8,   // 평가 항목까지 붙은 표본 비율
  gain: 1.0,           // 시험 학습이 엔진보다 줄여야 하는 평균 차이(점)
  foldsBetter: 4,      // 5번 나눠 시험할 때 학습 쪽이 나은 횟수
};

const read = (url) => { try { return JSON.parse(fs.readFileSync(url, 'utf8')); } catch { return null; } };
function loadSamples() {
  const out = [];
  const dir = new URL('../test/samples/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const d = read(new URL(f, dir)); if (!d) continue;
    for (const s of d.samples || [d]) out.push({ ...s, source: 'local' });
  }
  const srv = read(new URL('../test/server-samples/labeled.json', import.meta.url));
  for (const s of srv?.samples || []) out.push({ ...s, source: 'server' });
  return out.filter((s) => Number.isFinite(s.teacherScore) && !s.disputed && migrateLabels(s.teacherIssues)?.[0] !== 'EXCLUDE');
}

const grade = (v) => (v >= 90 ? 'S' : v >= 80 ? 'A' : v >= 70 ? 'B' : v >= 60 ? 'C' : 'F');
const DEVICES = ['finger', 'pen', 'board'];

// 시험 학습: 엔진 측정값으로 교사 점수를 맞추는 릿지 회귀(가장 단순한 학습모델). 앱에는 넣지 않고 비교만 한다
function features(s) {
  const r = evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device || 'finger' });
  const m = Object.entries(r.measures).filter(([, v]) => typeof v === 'number').sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  return { engine: r.score, x: [r.score, ...m, ...DEVICES.map((d) => ((s.device || 'finger') === d ? 1 : 0))] };
}
function ridgeFit(X, y, lambda = 1) {
  const n = X.length, p = X[0].length;
  const mu = Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[j], 0) / n);
  const sd = Array.from({ length: p }, (_, j) => Math.sqrt(X.reduce((a, r) => a + (r[j] - mu[j]) ** 2, 0) / n) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
  const ym = y.reduce((a, v) => a + v, 0) / n;
  // (ZᵀZ + λI) w = Zᵀ(y − ȳ)
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => Z.reduce((a, r) => a + r[i] * r[j], 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: p }, (_, i) => Z.reduce((a, r, k) => a + r[i] * (y[k] - ym), 0));
  for (let i = 0; i < p; i++) { // 가우스 소거
    let piv = i; for (let k = i + 1; k < p; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) continue;
    for (let k = i + 1; k < p; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < p; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
  }
  const w = Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) { if (Math.abs(A[i][i]) < 1e-12) continue; let s = b[i]; for (let j = i + 1; j < p; j++) s -= A[i][j] * w[j]; w[i] = s / A[i][i]; }
  return (x) => Math.max(0, Math.min(100, ym + x.reduce((a, v, j) => a + w[j] * (v - mu[j]) / sd[j], 0)));
}
function trial(samples, folds = 5) {
  if (samples.length < folds * 4) return null;
  const rows = samples.map((s) => ({ ...features(s), y: s.teacherScore }));
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const idx = rows.map((_, i) => i).sort(() => rnd() - 0.5);
  let eng = 0, mod = 0, better = 0;
  for (let f = 0; f < folds; f++) {
    const test = idx.filter((_, k) => k % folds === f), train = idx.filter((_, k) => k % folds !== f);
    const predict = ridgeFit(train.map((i) => rows[i].x), train.map((i) => rows[i].y));
    let e = 0, m = 0;
    for (const i of test) { e += Math.abs(rows[i].engine - rows[i].y); m += Math.abs(predict(rows[i].x) - rows[i].y); }
    eng += e; mod += m; if (m < e) better++;
  }
  return { engineMae: eng / rows.length, modelMae: mod / rows.length, gain: (eng - mod) / rows.length, foldsBetter: better, folds };
}

export function readiness() {
  const S = loadSamples(), C = CRITERIA;
  const chars = ['consonant', 'vowel', 'syllable'].flatMap((g) => listChars(g));
  const perChar = Object.fromEntries(chars.map((c) => [c, 0])); for (const s of S) if (s.char in perChar) perChar[s.char]++;
  const covered = chars.filter((c) => perChar[c] >= C.perChar).length;
  const grades = { S: 0, A: 0, B: 0, C: 0, F: 0 }; for (const s of S) grades[grade(s.teacherScore)]++;
  const writers = new Set(S.map((s) => s.writer).filter(Boolean)).size;
  const labeled = S.filter((s) => Array.isArray(migrateLabels(s.teacherIssues))).length;
  const t = trial(S);
  const checks = [
    { key: 'samples', name: '점수 표본 수', now: S.length, need: C.samples, ok: S.length >= C.samples },
    { key: 'writers', name: '작성자 수', now: writers, need: C.writers, ok: writers >= C.writers },
    { key: 'charCoverage', name: `표본 ${C.perChar}개 이상인 글자`, now: `${covered}/${chars.length}`, need: `${Math.ceil(chars.length * C.charCoverage)}/${chars.length}`, ok: covered >= chars.length * C.charCoverage },
    { key: 'perGrade', name: '등급별 표본(가장 적은 등급)', now: `${Math.min(...Object.values(grades))} (${Object.entries(grades).map(([g, n]) => `${g}${n}`).join(' ')})`, need: C.perGrade, ok: Math.min(...Object.values(grades)) >= C.perGrade },
    { key: 'labeledRatio', name: '평가 항목이 붙은 비율', now: `${S.length ? Math.round((labeled / S.length) * 100) : 0}%`, need: `${C.labeledRatio * 100}%`, ok: S.length > 0 && labeled / S.length >= C.labeledRatio },
    { key: 'trial', name: '시험 학습이 엔진보다 교사에 가까움',
      now: t ? `엔진 ${t.engineMae.toFixed(1)}점 → 학습 ${t.modelMae.toFixed(1)}점 차이 (${t.foldsBetter}/${t.folds}번 나음)` : '표본이 너무 적어 시험 못 함',
      need: `${C.gain}점 이상 줄고 ${C.foldsBetter}/5번 이상 나음`, ok: !!t && t.gain >= C.gain && t.foldsBetter >= C.foldsBetter },
  ];
  return { date: new Date().toISOString().slice(0, 10), ready: checks.every((c) => c.ok), passed: checks.filter((c) => c.ok).length, total: checks.length, checks, trial: t };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = readiness();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); }
  else {
    console.log(`2단계(점수 보정 학습) 준비: ${r.ready ? '✅ 넘어가도 됨' : `아직 (${r.passed}/${r.total} 통과)`}`);
    for (const c of r.checks) console.log(`${c.ok ? '✓' : '·'} ${c.name}: ${c.now} / 기준 ${c.need}`);
  }
}
