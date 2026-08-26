/**
 * A recording has to survive the one thing it is most likely to meet: a handoff to
 * the employer's site, which under the default `newTabCloseSource` opens a new tab
 * and closes the one the recording started in. Everything here is about that.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  bindLastStep, getRecording, inheritRecording, popStep, pushStep, startRecording, stopRecording,
} from './recordings';
import type { RecordedStep } from '../shared/recording';
import { resetChromeMock } from '../../test/setup';

const BOARD = 'https://board.test/job/1';
const ATS = 'https://ats.test/apply';

function step(over: Partial<RecordedStep> = {}): RecordedStep {
  return {
    id: 'a', at: 0, leg: 'posting', url: BOARD, action: 'click', label: 'Go', ...over,
  };
}

beforeEach(async () => {
  await resetChromeMock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('one tab, one recording', () => {
  it('holds nothing until a recording is started', async () => {
    expect(await getRecording(1)).toBeUndefined();
  });

  it('keeps the steps in the order they happened', async () => {
    await startRecording(1, 'internal', BOARD);
    await pushStep(1, step({ id: 'a' }));
    await pushStep(1, step({ id: 'b' }));
    expect((await getRecording(1))?.steps.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('keeps two tabs apart', async () => {
    await startRecording(1, 'internal', BOARD);
    await startRecording(2, 'external', 'https://other.test/job');
    await pushStep(1, step({ id: 'only-1' }));
    expect((await getRecording(2))?.steps).toEqual([]);
    expect((await getRecording(2))?.flow).toBe('external');
  });

  it('ignores a step for a tab that is not recording', async () => {
    await pushStep(99, step());
    expect(await getRecording(99)).toBeUndefined();
  });

  it('hands the recording back once and then forgets it', async () => {
    await startRecording(1, 'internal', BOARD);
    await pushStep(1, step());
    expect((await stopRecording(1))?.steps).toHaveLength(1);
    expect(await getRecording(1)).toBeUndefined();
  });

  /**
   * Tab ids are reused after a browser restart, and session storage is meant to be
   * gone by then — but a tab left open for hours with a half-finished recording on
   * it should not silently resume as if nothing happened.
   */
  it('forgets a recording that has been open far too long', async () => {
    vi.useFakeTimers();
    await startRecording(1, 'internal', BOARD);
    vi.setSystemTime(Date.now() + 3 * 60 * 60_000);
    expect(await getRecording(1)).toBeUndefined();
  });
});

describe('crossing the handoff', () => {
  /**
   * Nothing announces the handoff in advance — no click knows it is the one that
   * will leave. The first step to arrive from the far side is the whole of the
   * notice, so that is where the destination is learned.
   */
  it('learns the employer’s URL from the first step that arrives from there', async () => {
    await startRecording(1, 'external', BOARD);
    await pushStep(1, step({ leg: 'posting' }));
    expect((await getRecording(1))?.destinationUrl).toBeUndefined();

    await pushStep(1, step({ leg: 'destination', url: `${ATS}?src=board` }));
    expect((await getRecording(1))?.destinationUrl).toBe(`${ATS}?src=board`);
  });

  it('keeps the first destination URL, not the last', async () => {
    await startRecording(1, 'external', BOARD);
    await pushStep(1, step({ leg: 'destination', url: ATS }));
    await pushStep(1, step({ leg: 'destination', url: `${ATS}/step-2` }));
    expect((await getRecording(1))?.destinationUrl).toBe(ATS);
  });

  /**
   * The reason this store is in the background at all. The employer's form opens in
   * a new tab and the posting tab is closed behind it, so by the time the new tab's
   * content script asks whether it is recording, the tab that knew has gone.
   */
  it('passes the recording to a tab opened by the recording tab', async () => {
    await startRecording(1, 'external', BOARD);
    await pushStep(1, step({ id: 'on-the-board' }));

    await inheritRecording(1, 2);

    const inherited = await getRecording(2);
    expect(inherited?.postingUrl).toBe(BOARD);
    expect(inherited?.steps.map((s) => s.id)).toEqual(['on-the-board']);
  });

  it('passes nothing on from a tab that was not recording', async () => {
    await inheritRecording(1, 2);
    expect(await getRecording(2)).toBeUndefined();
  });
});

describe('changing your mind mid-recording', () => {
  it('re-marks the last step', async () => {
    await startRecording(1, 'internal', BOARD);
    await pushStep(1, step({ id: 'a' }));
    await pushStep(1, step({ id: 'b' }));

    const rec = await bindLastStep(1, 'submit');
    expect(rec?.steps[1].bind).toBe('submit');
    expect(rec?.steps[0].bind).toBeUndefined();
  });

  /**
   * The bar shows the extension's own guess as already made, so "Keep as a step" is
   * how a wrong guess is refused — and the refusal has to actually clear it, or the
   * compiler still routes the step to a config slot the user just rejected.
   */
  it('clears a guess when the step is kept as a step', async () => {
    await startRecording(1, 'internal', BOARD);
    await pushStep(1, step({ bind: 'field:email', bindSource: 'auto' }));

    const rec = await bindLastStep(1, null);
    expect(rec?.steps[0].bind).toBeUndefined();
    expect(rec?.steps[0].bindSource).toBeUndefined();
  });

  it('records a chosen mark as the user’s, so no later guess overrides it', async () => {
    await startRecording(1, 'internal', BOARD);
    await pushStep(1, step({ bind: 'field:email', bindSource: 'auto' }));
    expect((await bindLastStep(1, 'field:phone'))?.steps[0].bindSource).toBe('user');
  });

  it('undoes the last step', async () => {
    await startRecording(1, 'internal', BOARD);
    await pushStep(1, step({ id: 'a' }));
    await pushStep(1, step({ id: 'b' }));
    expect((await popStep(1))?.steps.map((s) => s.id)).toEqual(['a']);
  });

  it('survives an undo with nothing to undo', async () => {
    await startRecording(1, 'internal', BOARD);
    expect((await popStep(1))?.steps).toEqual([]);
  });
});
