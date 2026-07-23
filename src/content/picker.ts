/**
 * Click/tap-to-pick element selection. Highlights the element under the pointer;
 * clicking (mouse) or tapping then Confirm (touch) resolves the picked element.
 * Cancels on Escape or the Cancel button.
 *
 * The mouse and touch flows are deliberately different. A mouse has a hover
 * state, so the highlight tracks the pointer and a click commits what you can
 * already see. A finger has none — the first you learn of what is under it is
 * after you tap — so a tap only *proposes* an element and Confirm commits it.
 * (This is what the Confirm button was always for; a plain `click` handler used
 * to commit first, so on touch you got whatever you happened to hit.)
 */

export type PickHandler = (el: Element) => void;

const OWN_ATTR = 'data-cf-picker';

export function startPicker(onPick: PickHandler, fieldLabel: string, onCancel?: () => void): () => void {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

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
    position: 'fixed', zIndex: '2147483647', left: '50%',
    // A top bar sits under the mobile URL bar and the reachable thumb zone is
    // at the bottom, so on touch the toolbar goes where the hands are.
    ...(coarse
      ? { bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', top: 'auto' }
      : { top: '12px', bottom: 'auto' }),
    transform: 'translateX(-50%)', background: '#111827', color: '#fff',
    font: '13px/1.4 system-ui, sans-serif', padding: '8px 12px', borderRadius: '10px',
    display: 'flex', gap: '8px', alignItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,.35)',
    maxWidth: '92vw', flexWrap: 'wrap', justifyContent: 'center',
  } as CSSStyleDeclaration);

  const label = document.createElement('span');
  label.textContent = coarse
    ? `Tap the "${fieldLabel}" field, then Confirm`
    : `Click the "${fieldLabel}" field`;
  const confirmBtn = mkButton('Confirm', '#6366f1', coarse);
  const cancelBtn = mkButton('Cancel', '#374151', coarse);
  confirmBtn.style.display = 'none';
  bar.append(label, confirmBtn, cancelBtn);

  document.body.append(box, bar);

  let candidate: Element | null = null;
  /** How the in-flight gesture started; a stylus behaves like a finger here. */
  let gestureIsTouch = coarse;

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

  const onDown = (e: PointerEvent) => {
    gestureIsTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as Element;
    if (isOwn(target)) return; // let toolbar buttons work
    e.preventDefault();
    e.stopPropagation();
    setCandidate(document.elementFromPoint(e.clientX, e.clientY));
    // Touch proposes; only Confirm commits. Mouse commits directly, because the
    // highlight has been following the cursor and the target is already visible.
    if (candidate && !gestureIsTouch) finish(candidate);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancel();
  };

  const cleanup = () => {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    box.remove();
    bar.remove();
  };

  const finish = (el: Element) => { cleanup(); onPick(el); };
  const cancel = () => { cleanup(); onCancel?.(); };

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
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  return cancel;
}

function mkButton(text: string, bg: string, coarse: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.setAttribute(OWN_ATTR, 'btn');
  b.textContent = text;
  Object.assign(b.style, {
    background: bg, color: '#fff', border: 'none', borderRadius: '8px',
    padding: coarse ? '10px 18px' : '6px 12px', font: '13px system-ui, sans-serif',
    cursor: 'pointer', minHeight: coarse ? '44px' : '32px',
  } as CSSStyleDeclaration);
  return b;
}
