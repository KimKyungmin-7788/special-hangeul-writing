// 채점실에서 제출된 글씨(서버 hw_attempts 행 JSON)를 엔진 표본 파일로 합친다.
// 사용: node tools/ingest-server.mjs rows.json
//  - rows.json: [{ id, ch, device, strokes:[[[x,y,t],...]], dev_score, dev_issues, dev_feedback, dev_feedback_text, dev_note, writer, engine_score, engine_issues, engine_version, dev_labeled_at, batch_id }, ...]
//  - 결과: test/server-samples/labeled.json (글씨 id로 겹치지 않게, 새로 고친 것으로 덮어씀)
// 작성자 코드(writer)는 학생 단위로 학습·검사 묶음을 나눌 때만 쓰는 가명 코드다. 실명은 들어 있지 않다.
import fs from 'node:fs';

const [, , src] = process.argv;
if (!src) { console.error('사용: node tools/ingest-server.mjs rows.json'); process.exit(1); }
const rows = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = new URL('../test/server-samples/labeled.json', import.meta.url);
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')).samples : [];
const byId = new Map(prev.map((s) => [s.id, s]));
let added = 0, updated = 0;
for (const r of rows) {
  if (r.dev_score == null) continue;
  const s = {
    id: r.id, char: r.ch, device: r.device, teacherScore: r.dev_score, teacherIssues: r.dev_issues ?? null,
    feedback: r.dev_feedback || undefined, feedbackText: r.dev_feedback_text || undefined, note: r.dev_note || undefined,
    writer: r.writer, engineScoreAtSave: r.engine_score, engineIssuesAtSave: r.engine_issues, engineVersion: r.engine_version,
    labeledAt: r.dev_labeled_at, batch: r.batch_id,
    strokes: r.strokes.map((st) => st.map(([x, y]) => [x, y])),
    times: r.strokes.map((st) => st.map((p) => p[2] ?? 0)),
  };
  if (byId.has(s.id)) updated++; else added++;
  byId.set(s.id, s);
}
const samples = [...byId.values()].sort((a, b) => String(a.labeledAt).localeCompare(String(b.labeledAt)));
fs.writeFileSync(out, `{"version":1,"source":"server","updatedAt":${JSON.stringify(new Date().toISOString())},"samples":[\n${samples.map((s) => JSON.stringify(s)).join(',\n')}\n]}\n`);
console.log(JSON.stringify({ added, updated, total: samples.length }));
