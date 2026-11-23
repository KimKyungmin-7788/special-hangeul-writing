// 교사 표본(test/samples)과 채점실 표본(test/server-samples)을 엔진으로 다시 재서
// 채점 기준표(demo/rubric.js)를 고칠 근거와 엔진 정확도를 낸다. 사용: node tools/rubric-stats.mjs
import fs from 'node:fs';
import { evaluate, explainScore } from '../src/engine.js';
import { speechCase } from '../src/feedback-ko.js';

const load = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
  .flatMap((f) => { const d = JSON.parse(fs.readFileSync(dir + f, 'utf8')); return (d.samples || [d]).map((s) => ({ ...s, src: dir + f })); }) : [];
const all = [...load('test/samples/'), ...load('test/server-samples/')].filter((s) => !s.disputed);
const PRI = ['WRONG_CHAR', 'STROKES_JOINED', 'OVERSHOOT', 'GAP', 'ALT_FORM', 'STROKE_SPLIT', 'WRONG_ORDER', 'WRONG_DIRECTION', 'MISSING_STROKE', 'EXTRA_STROKE', 'SHAPE', 'TOO_SMALL', 'TOO_BIG', 'OFF_CENTER'];
const rows = all.map((s) => {
  const r = evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device || 'finger' });
  const label = Array.isArray(s.teacherIssues) ? (PRI.find((c) => s.teacherIssues.includes(c)) || 'NONE') : (PRI.find((c) => r.issues.some((i) => i.code === c)) || 'NONE');
  return { s, r, label, d: r.score - s.teacherScore, ex: explainScore(r) };
});
const q = (a, p) => { const v = [...a].sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.round(p * (v.length - 1)))]; };
const mae = (rs) => rs.length ? rs.reduce((a, x) => a + Math.abs(x.d), 0) / rs.length : 0;
const out = { samples: rows.length, server: rows.filter((x) => x.s.src.includes('server')).length, mae: +mae(rows).toFixed(1),
  over15: rows.filter((x) => Math.abs(x.d) > 15).length, byIssue: {}, feedback: null };
for (const k of [...PRI, 'NONE']) {
  const g = rows.filter((x) => x.label === k); if (!g.length) continue;
  const t = g.map((x) => x.s.teacherScore);
  out.byIssue[k] = { n: g.length, min: Math.min(...t), p25: q(t, 0.25), median: q(t, 0.5), p75: q(t, 0.75), max: Math.max(...t), engineMae: +mae(g).toFixed(1) };
}
const fb = rows.filter((x) => x.s.feedback);
if (fb.length) out.feedback = { n: fb.length, sameAsEngine: fb.filter((x) => speechCase(x.r) === x.s.feedback).length };
console.log(JSON.stringify(out, null, 2));
