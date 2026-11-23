// 평가 항목 고르기(채점실·연습 화면 표본 칸이 같이 쓴다). 항목 정의는 src/labels.js
//  - 문제 없음 / 4갈래 11개 / 채점 제외
//  - 정도가 있는 항목(넘어감·안 닿음·획 모양·크기)은 누를 때마다 살짝 → 뚜렷 → 해제
//  - withStar: 고른 항목 중 '학생에게 먼저 말할 것' ★ 하나
//  - withTags: '획 모양'을 고르면 세부 이유(길이·기울기·떨림·꺾임·간격)를 덧붙일 수 있음
import { LABELS, GROUPS, EXCLUDE, SHAPE_TAGS, parseLabel, primaryLabel } from '../src/labels.js';

const CSS = `
.lp { display: grid; gap: 8px; }
.lp-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.lp-g { font-size: 12px; color: var(--muted); min-width: 100%; margin-top: 2px; }
.lp-g small { opacity: .8; }
.lp button { font: inherit; font-size: 14px; min-height: 36px; padding: 4px 11px; border: 1.5px solid var(--line); background: #fff; color: var(--ink); border-radius: 999px; cursor: pointer; }
.lp button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.lp button.strong[aria-pressed="true"] { background: #a61e1e; border-color: #a61e1e; }
.lp button.none[aria-pressed="true"] { background: var(--good); border-color: var(--good); }
.lp button.excl[aria-pressed="true"] { background: #6b7280; border-color: #6b7280; }
.lp button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.lp .star { min-height: 30px; padding: 2px 9px; font-size: 13px; }
.lp .star[aria-pressed="true"] { background: #f2b632; border-color: #f2b632; color: #3a3a3c; }
.lp .tag { min-height: 30px; padding: 2px 9px; font-size: 13px; }
.lp-hint { font-size: 12px; color: var(--muted); }
`;
let cssAdded = false;

export function createLabelPicker(box, { value = null, star = null, withStar = false, withTags = false, onChange = () => {} } = {}) {
  if (!cssAdded) { const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); cssAdded = true; }
  // 상태: none(문제 없음), excl(제외), sel(code → 0 꺼짐 / 1 살짝·켬 / 2 뚜렷), tags, star
  const S = { none: false, excl: false, sel: {}, tags: new Set(), star };
  const set = (labels, st) => {
    S.none = Array.isArray(labels) && labels.length === 0; S.excl = false; S.sel = {}; S.tags = new Set(); S.star = st || null;
    for (const raw of labels || []) {
      const { code, strong, tag } = parseLabel(raw);
      if (code === EXCLUDE.code) { S.excl = true; continue; }
      if (tag) S.tags.add(tag);
      S.sel[code] = Math.max(S.sel[code] || 0, strong ? 2 : 1);
    }
    render();
  };
  const get = () => {
    if (S.excl) return { labels: [EXCLUDE.code], star: null };
    if (S.none) return { labels: [], star: null };
    const out = [];
    for (const l of LABELS) {
      const v = S.sel[l.code]; if (!v) continue;
      out.push(l.code + (l.severity && v === 2 ? '!' : ''));
      if (l.code === 'SHAPE') for (const t of S.tags) out.push(`SHAPE.${t}`);
    }
    const st = S.star && S.sel[S.star] ? S.star : null;
    return { labels: out.length ? out : null, star: st };
  };
  const btn = (text, pressed, cls, onclick, aria) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    b.setAttribute('aria-pressed', String(!!pressed)); if (cls) b.className = cls; if (aria) b.setAttribute('aria-label', aria);
    b.onclick = () => { onclick(); render(); onChange(get()); };
    return b;
  };
  function render() {
    box.replaceChildren();
    const wrap = document.createElement('div'); wrap.className = 'lp';
    const top = document.createElement('div'); top.className = 'lp-row';
    top.append(
      btn('문제 없음', S.none, 'none', () => { S.none = !S.none; if (S.none) { S.sel = {}; S.excl = false; S.tags.clear(); S.star = null; } }),
      btn(EXCLUDE.name, S.excl, 'excl', () => { S.excl = !S.excl; if (S.excl) { S.sel = {}; S.none = false; S.tags.clear(); S.star = null; } }, `${EXCLUDE.name}: ${EXCLUDE.def}`));
    wrap.append(top);
    for (const g of GROUPS) {
      const row = document.createElement('div'); row.className = 'lp-row';
      const h = document.createElement('div'); h.className = 'lp-g'; h.innerHTML = `${g.name} <small>· ${g.note}</small>`;
      row.append(h);
      for (const l of LABELS.filter((x) => x.group === g.key)) {
        const v = S.sel[l.code] || 0;
        const text = l.severity && v ? `${l.name} · ${v === 2 ? '뚜렷' : '살짝'}` : l.name;
        const b = btn(text, v > 0, v === 2 ? 'strong' : '', () => {
          S.none = false; S.excl = false;
          const nv = l.severity ? (v + 1) % 3 : (v ? 0 : 1);
          if (nv) S.sel[l.code] = nv; else { delete S.sel[l.code]; if (S.star === l.code) S.star = null; if (l.code === 'SHAPE') S.tags.clear(); }
        }, `${l.name}: ${l.def}${l.severity ? ' (누를 때마다 살짝, 뚜렷, 해제)' : ''}`);
        b.title = l.def;
        row.append(b);
      }
      wrap.append(row);
    }
    const picked = LABELS.filter((l) => S.sel[l.code]);
    if (withTags && S.sel.SHAPE) {
      const row = document.createElement('div'); row.className = 'lp-row';
      const h = document.createElement('span'); h.className = 'lp-hint'; h.textContent = '획 모양 세부(선택):'; row.append(h);
      for (const t of SHAPE_TAGS) row.append(btn(t.name, S.tags.has(t.code), 'tag', () => { S.tags.has(t.code) ? S.tags.delete(t.code) : S.tags.add(t.code); }));
      wrap.append(row);
    }
    if (withStar && picked.length > 1) {
      const row = document.createElement('div'); row.className = 'lp-row';
      const auto = primaryLabel(get().labels, null);
      const h = document.createElement('span'); h.className = 'lp-hint'; h.textContent = '★ 학생에게 먼저 말할 것:'; row.append(h);
      for (const l of picked) row.append(btn(`★ ${l.name}`, (S.star || auto) === l.code, 'star', () => { S.star = S.star === l.code ? null : l.code; }, `${l.name}을 먼저 말하기`));
      wrap.append(row);
    }
    box.append(wrap);
  }
  set(value, star);
  return { get, set };
}
