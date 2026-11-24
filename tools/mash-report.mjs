// 뭉갬 후보(보고만) 점검: 엔진이 '뭉갬 후보'로 본 글씨와 교사 점수를 견준다. 매일 반영(tools/APPLY.md)에서 돌린다.
// 기준을 만든 표본(2026-11-24 채점실 5개) 뒤에 들어온 표본만 따로 세어, 새 글씨에서도 맞는지 본다.
// 실행: node tools/mash-report.mjs
import fs from 'node:fs';
import { evaluate } from '../src/engine.js';
import { migrateLabels } from '../src/labels.js';

const BASE_UNTIL = '2026-11-24T23:59:59Z'; // 이때까지 채점된 표본으로 기준을 정했다
const AGREE_MAX = 15;                      // 교사 점수가 이 이하면 '교사도 뭉갠 글씨로 봄'
const ENABLE_AT = 15;                      // 새 후보가 이만큼 쌓이면 상한 켤지 운영자에게 묻는다

const S = JSON.parse(fs.readFileSync(new URL('../test/server-samples/labeled.json', import.meta.url), 'utf8')).samples;
const rows = S.filter((s) => Number.isFinite(s.teacherScore) && migrateLabels(s.teacherIssues)?.[0] !== 'EXCLUDE').map((s) => {
  const r = evaluate(s.char, s.strokes.map((st) => st.map(([x, y]) => ({ x, y }))), { device: s.device });
  return { ch: s.char, t: s.teacherScore, e: r.score, cand: !!r.measures.mashCandidate, fresh: String(s.labeledAt) > BASE_UNTIL,
    m: `길이 ${r.measures.mashLenRatio.toFixed(2)}배 · 엇갈림 ${r.measures.mashCrossings} · 꺾임 +${r.measures.mashTurnExcess.toFixed(1)}` };
});
const fresh = rows.filter((r) => r.fresh), cand = fresh.filter((r) => r.cand);
const agree = cand.filter((r) => r.t <= AGREE_MAX), wrong = cand.filter((r) => r.t > AGREE_MAX);
const missed = fresh.filter((r) => !r.cand && r.t <= AGREE_MAX);
console.log(`뭉갬 후보(보고만) · 기준 뒤 새 표본 ${fresh.length}개`);
console.log(`- 후보 ${cand.length}개 중 교사도 ${AGREE_MAX}점 이하 ${agree.length}개, 아님 ${wrong.length}개${cand.length ? ` (맞은 비율 ${Math.round((agree.length / cand.length) * 100)}%)` : ''}`);
console.log(`- 교사는 ${AGREE_MAX}점 이하인데 후보 아님(놓침) ${missed.length}개`);
for (const r of wrong) console.log(`  · 잘못 잡음: ${r.ch} 교사 ${r.t} 엔진 ${r.e} (${r.m})`);
for (const r of missed) console.log(`  · 놓침: ${r.ch} 교사 ${r.t} 엔진 ${r.e} (${r.m})`);
console.log(cand.length >= ENABLE_AT ? `▶ 새 후보가 ${ENABLE_AT}개를 넘었음: 상한(최고 10점)을 켤지 운영자에게 묻기` : `- 상한 켤지 묻기까지 새 후보 ${ENABLE_AT - cand.length}개 남음`);
