// 아이패드 사파리에서도 되는 복사.
// http://내부망주소 로 열면 '안전한 연결'이 아니라서 navigator.clipboard가 막힌다.
// 그때는 숨긴 입력칸을 선택해 복사 명령을 쓰고, 그것도 안 되면 화면에 글을 보여 줘서 직접 복사하게 한다.
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.append(ta);
  ta.focus();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  if (!ok) showForManualCopy(text);
  return ok;
}

function showForManualCopy(text) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:100;padding:16px';
  box.innerHTML = `<div style="background:#fff;border-radius:14px;padding:16px;max-width:560px;width:100%">
    <p style="margin:0 0 8px;font-size:15px">자동 복사가 막혀 있어요. 아래 글을 길게 눌러 <b>전체 선택 → 복사</b>해 주세요.</p>
    <textarea readonly style="width:100%;height:220px;font-size:13px"></textarea>
    <button style="margin-top:8px;font:inherit;padding:8px 14px;border-radius:10px;border:1px solid #ccc;background:#fff">닫기</button></div>`;
  box.querySelector('textarea').value = text;
  box.querySelector('button').onclick = () => box.remove();
  document.body.append(box);
  box.querySelector('textarea').select();
}
