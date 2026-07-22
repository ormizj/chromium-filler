/**
 * Runs a SiteConfig's prep steps: expand the job description, open the apply/CV
 * modal, etc. Optional steps that fail are logged and skipped; required steps
 * that fail abort the run.
 */

import type { PrepStep } from '../shared/types';
import { waitForSelector } from './waitForForm';

const LOG = '[chromium-filler]';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runPrepSteps(steps: PrepStep[] | undefined): Promise<void> {
  if (!steps?.length) return;
  for (const step of steps) {
    try {
      await runStep(step);
    } catch (err) {
      if (step.optional) {
        console.warn(LOG, 'optional prep step skipped:', step, err);
      } else {
        console.error(LOG, 'prep step failed:', step, err);
        throw err;
      }
    }
  }
}

async function runStep(step: PrepStep): Promise<void> {
  switch (step.action) {
    case 'delay':
      await delay(step.ms ?? 300);
      return;

    case 'waitFor': {
      if (!step.selector) return;
      const el = await waitForSelector(step.selector, step.ms ?? 10000);
      if (!el && !step.optional) throw new Error(`waitFor timed out: ${step.selector}`);
      return;
    }

    case 'scrollIntoView': {
      const el = step.selector ? document.querySelector(step.selector) : null;
      if (!el) {
        if (step.optional) return;
        throw new Error(`scrollIntoView target not found: ${step.selector}`);
      }
      (el as HTMLElement).scrollIntoView({ block: 'center' });
      return;
    }

    case 'click': {
      const el = step.selector ? await waitForSelector(step.selector, step.ms ?? 5000) : null;
      if (!el) {
        if (step.optional) return;
        throw new Error(`click target not found: ${step.selector}`);
      }
      (el as HTMLElement).click();
      await delay(150);
      return;
    }

    default:
      return;
  }
}
