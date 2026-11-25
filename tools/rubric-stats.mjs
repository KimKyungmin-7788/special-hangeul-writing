// 교사 표본(test/samples)과 채점실 표본(test/server-samples)을 엔진으로 다시 재서
// 채점 기준표(demo/rubric.js)를 고칠 근거와 엔진 정확도를 낸다. 사용: node tools/rubric-stats.mjs
import fs from 'node:fs';
import { evaluate, explainScore } from '../src/engine.js';
import { speechCase } from '../src/feedback-ko.js';
import { migrateLabels, migrateFeedback, engineToLabels, primaryLabel } from '../src/labels.js';
import { rubricFor } from '../demo/rubric.js';

const load = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
  .flatMap((f) => { const d = JSON.parse(fs.readFileSync(dir + f, 'utf8')); return (d.samples || [d]).map((s) => ({ ...s, src: dir + f })); }) : [];
const all = [...load('test/samples/'), ...load('test/server-samples/')].filter((s) => !s.disputed);
const rows = all.map((s) => {
  const r = evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device || 'finger', motorSupport: !!s.motorSupport });
  // 기준표 줄: 교사가 고른 항목이 있으면 그것으로, 없으면 엔진이 찾은 항목으로(평가 항목 기준, src/labels.js)
  const labels = migrateLabels(s.teacherIssues) ?? engineToLabels(r.issues);
  const label = labels[0] === 'EXCLUDE' ? 'EXCLUDE' : (rubricFor(labels)?.name || '문제 없음');
  return { s, r, label, d: r.score - s.teacherScore, ex: explainScore(r) };
});
const q = (a, p) => { const v = [...a].sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.round(p * (v.length - 1)))]; };
const mae = (rs) => rs.length ? rs.reduce((a, x) => a + Math.abs(x.d), 0) / rs.length : 0;
const out = { samples: rows.length, server: rows.filter((x) => x.s.src.includes('server')).length, mae: +mae(rows).toFixed(1),
  over15: rows.filter((x) => Math.abs(x.d) > 15).length, byIssue: {}, feedback: null };
for (const k of [...new Set(rows.map((x) => x.label))]) {
  const g = rows.filter((x) => x.label === k); if (!g.length) continue;
  const t = g.map((x) => x.s.teacherScore);
  out.byIssue[k] = { n: g.length, min: Math.min(...t), p25: q(t, 0.25), median: q(t, 0.5), p75: q(t, 0.75), max: Math.max(...t), engineMae: +mae(g).toFixed(1) };
}
// 학생에게 먼저 말할 것: 교사(★ 또는 우선순위) vs 엔진이 실제로 한 말의 항목
const fb = rows.filter((x) => Array.isArray(x.s.teacherIssues) && x.s.teacherIssues.length);
if (fb.length) out.feedback = { n: fb.length, sameAsEngine: fb.filter((x) =>
  primaryLabel(migrateLabels(x.s.teacherIssues), migrateFeedback(x.s.feedback)) === (engineToLabels([speechCase(x.r)])[0] || null)).length };
console.log(JSON.stringify(out, null, 2));
