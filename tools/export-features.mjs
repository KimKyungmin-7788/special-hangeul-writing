// 교사 채점 표본(test/samples/*.json)을 엔진으로 다시 재서, 한 표본당 한 줄인 CSV로 내보낸다.
// 엔진의 측정값(measures)과 교사 점수·교사가 고른 문제를 나란히 두어, 점수 보정 모델을 학습하거나 표로 살펴볼 때 쓴다.
// 실행: npm run features > features.csv
import fs from 'node:fs';
import { evaluate } from '../src/engine.js';

const dir = new URL('../test/samples/', import.meta.url);
const rows = [];
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  const data = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
  for (const [k, s] of (data.samples || [data]).entries()) {
    const r = evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device || 'finger' });
    rows.push({
      id: `${f}#${k}`, char: s.char, device: s.device || 'finger',
      teacherScore: s.teacherScore, engineScore: r.score,
      disputed: s.disputed ? 1 : 0,
      // 비어 있으면 표시 안 함, NONE이면 '문제 없음'
      teacherIssues: s.teacherIssues == null ? '' : (s.teacherIssues.join(';') || 'NONE'),
      engineIssues: r.issues.map((i) => i.code).join(';'),
      ...r.measures,
    });
  }
}
const cols = Object.keys(rows[0] || {});
const cell = (v) => typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
process.stdout.write([cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
