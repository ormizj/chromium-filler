/**
 * Click/tap-to-pick element selection. Highlights the element under the pointer;
 * clicking (mouse) or tapping then Confirm (touch) resolves the picked element.
 * Cancels on Escape or the Cancel button.
 */

export type PickHandler = (el: Element) => void;

const OWN_ATTR = 'data-cf-picker';

export function startPicker(onPick: PickHandler, fieldLabel: string): () => void {
  const box = document.createElement('div');
  box.setAttribute(OWN_ATTR, 'box');
  Object.assign(box.style, {
    position: 'fixed', zIndex: '2147483646', pointerEvents: 'none',
    border: '2px solid #6366f1', background: 'rgba(99,102,241,0.15)',
    borderRadius: '4px', transition: 'all 40ms linear', display: 'none',
  } as CSSStyleDeclaration);

  const bar = document.createElement('div');
  bar.setAttribute(OWN_ATTR, 'bar');
  Object.assign(bar.style, {
    position: 'fixed', zIndex: '2147483647', top: '12px', left: '50%',
    transform: 'translateX(-50%)', background: '#111827', color: '#fff',
    font: '13px/1.4 system-ui, sans-serif', padding: '8px 12px', borderRadius: '8px',
    display: 'flex', gap: '8px', alignItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,.35)',
    maxWidth: '92vw',
  } as CSSStyleDeclaration);

  const label = document.createElement('span');
  label.textContent = `Pick the "${fieldLabel}" field, then tap Confirm`;
  const confirmBtn = mkButton('Confirm', '#6366f1');
  const cancelBtn = mkButton('Cancel', '#374151');
  confirmBtn.style.display = 'none';
  bar.append(label, confirmBtn, cancelBtn);

  document.body.append(box, bar);

  let candidate: Element | null = null;

  const isOwn = (el: Element | null) => !!el?.closest(`[${OWN_ATTR}]`);

  const setCandidate = (el: Element | null) => {
    if (!el || isOwn(el)) return;
    candidate = el;
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.top = `${r.top}px`;
    box.style.left = `${r.left}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    confirmBtn.style.display = 'inline-block';
  };

  const onMove = (e: PointerEvent) => setCandidate(document.elementFromPoint(e.clientX, e.clientY));

  const onClick = (e: MouseEvent) => {
    const target = e.target as Element;
    if (isOwn(target)) return; // let toolbar buttons work
    e.preventDefault();
    e.stopPropagation();
    setCandidate(document.elementFromPoint(e.clientX, e.clientY));
    if (candidate) finish(candidate);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancel();
  };

  const cleanup = () => {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    box.remove();
    bar.remove();
  };

  const finish = (el: Element) => { cleanup(); onPick(el); };
  const cancel = () => cleanup();

  confirmBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (candidate) finish(candidate);
  });
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancel();
  });

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  return cancel;
}

function mkButton(text: string, bg: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.setAttribute(OWN_ATTR, 'btn');
  b.textContent = text;
  Object.assign(b.style, {
    background: bg, color: '#fff', border: 'none', borderRadius: '6px',
    padding: '6px 12px', font: '13px system-ui, sans-serif', cursor: 'pointer',
    minHeight: '32px',
  } as CSSStyleDeclaration);
  return b;
}
