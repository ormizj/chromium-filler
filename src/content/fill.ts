/**
 * Writes values into form controls in a way frameworks (React/Vue) detect, and
 * attaches the CV file to a file input. Also provides on-page highlighting.
 */

import type { MatchConfidence } from '../shared/types';

/** Set `value` via the native setter so React's value tracker sees the change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
}

function dispatch(el: Element, ...types: string[]): void {
  for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true }));
}

function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const wanted = value.trim().toLowerCase();
  const options = Array.from(el.options);
  let match = options.find((o) => o.value.toLowerCase() === wanted);
  if (!match) match = options.find((o) => o.text.trim().toLowerCase() === wanted);
  if (!match) match = options.find((o) => o.text.trim().toLowerCase().includes(wanted) && wanted.length > 0);
  if (!match) return false;
  el.value = match.value;
  dispatch(el, 'input', 'change');
  return true;
}

/** Fill a text input / textarea / select / contenteditable. Returns success. */
export function fillTextField(el: HTMLElement, value: string): boolean {
  if (el instanceof HTMLSelectElement) return fillSelect(el, value);

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    setNativeValue(el, value);
    dispatch(el, 'input', 'change');
    el.blur();
    return true;
  }

  if ((el as HTMLElement).isContentEditable) {
    el.textContent = value;
    dispatch(el, 'input');
    return true;
  }

  return false;
}

/** Attach a File to a file input using DataTransfer (the supported approach). */
export function fillFileInput(input: HTMLInputElement, file: File): boolean {
  if (typeof DataTransfer === 'undefined') return false;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    dispatch(input, 'input', 'change');
    return input.files.length === 1;
  } catch {
    return false;
  }
}

const HIGHLIGHT_COLORS: Record<MatchConfidence, string> = {
  high: '#22c55e',
  low: '#eab308',
  none: '#ef4444',
};

const HL_ATTR = 'data-cf-highlight';

export function highlight(el: HTMLElement, confidence: MatchConfidence): void {
  el.setAttribute(HL_ATTR, confidence);
  el.style.setProperty('outline', `2px solid ${HIGHLIGHT_COLORS[confidence]}`, 'important');
  el.style.setProperty('outline-offset', '1px', 'important');
}

export function clearHighlights(root: ParentNode = document): void {
  root.querySelectorAll(`[${HL_ATTR}]`).forEach((node) => {
    const el = node as HTMLElement;
    el.style.removeProperty('outline');
    el.style.removeProperty('outline-offset');
    el.removeAttribute(HL_ATTR);
  });
}
