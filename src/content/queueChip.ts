/**
 * The small "Queue · 4/12" mark on a tab the queue opened.
 *
 * The engine runs on every site, so a posting the queue opened and a page the user
 * opened themselves look exactly alike — the same card, the same fills. This is the
 * one thing that says "this tab is part of the queue", and how far through it the
 * user is. It sits in the opposite corner from the card's pill, carries no controls
 * of its own beyond being pressed (which opens the card), and is a shadow root of
 * its own so the page's styles cannot reach it and the engine never mistakes it for
 * an input (`QUEUE_CHIP_HOST_ID` is in `extensionUi`'s own-selector list).
 */

import type { QueueProgress } from '../shared/queue';
import { queueChipText } from '../shared/labels';
import { BASE_CSS } from '../ui/shadowCss';
import { QUEUE_CHIP_HOST_ID } from './extensionUi';
import chipCss from './queueChip.css?inline';

export class QueueChip {
  private host: HTMLElement;
  private button: HTMLButtonElement;

  constructor(onOpen: () => void) {
    this.host = document.createElement('div');
    this.host.id = QUEUE_CHIP_HOST_ID;
    this.host.style.setProperty('all', 'initial');
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${BASE_CSS}\n${chipCss}`;
    this.button = document.createElement('button');
    this.button.className = 'cf-qchip';
    this.button.onclick = () => onOpen();
    shadow.append(style, this.button);
    document.documentElement.appendChild(this.host);
  }

  render(progress?: QueueProgress): void {
    const done = progress?.done ?? 0;
    const total = progress?.total ?? 0;
    const text = queueChipText(done, total);
    this.button.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'cf-qchip-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = text;
    this.button.append(dot, label);
    this.button.setAttribute('aria-label', `${text} — this tab was opened by your queue. Open the review.`);
  }

  /**
   * Whether the review card is expanded. Under 640px the card is a bottom sheet
   * across the whole width, and the chip would sit on top of it — so it steps out
   * of the way while the card is open.
   */
  setCardOpen(open: boolean): void {
    this.button.classList.toggle('cf-card-open', open);
  }

  destroy(): void {
    this.host.remove();
  }
}
