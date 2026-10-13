import { describe, it, expect } from 'vitest';
import {
  CONCEPT_HELP, DEVICE_ONLY_TEXT, DOT_LEGEND, LOCAL_SCOPE_TEXT, SETTINGS_HELP, SYNC_SCOPE_TEXT,
  SYNC_SETUP_STEPS, SYNC_TROUBLESHOOTING, type HelpEntry,
} from './help';
import { LOCAL_SETTINGS, SYNCED_SETTINGS, SYNC_DOMAINS } from './syncUnits';
import { DEFAULT_SETTINGS } from './defaults';

/** Every catalog, flattened, so the shape rules are asserted once for all of them. */
const ALL: Array<[string, HelpEntry]> = [
  ...Object.entries(SETTINGS_HELP),
  ...Object.entries(CONCEPT_HELP),
];

describe('help catalog', () => {
  it('gives every entry a title and a body', () => {
    for (const [key, entry] of ALL) {
      expect(entry.title.trim(), key).not.toBe('');
      expect(entry.body.trim(), key).not.toBe('');
    }
  });

  // A body that only repeats its own title is a placeholder, not an explanation.
  it('never restates the title as the body', () => {
    for (const [key, entry] of ALL) {
      expect(entry.body.trim().toLowerCase(), key).not.toBe(entry.title.trim().toLowerCase());
      expect(entry.body.trim().length, key).toBeGreaterThan(entry.title.trim().length);
    }
  });

  it('gives the card\'s key concepts a one-line form', () => {
    for (const key of ['dots', 'teaching', 'picker', 'customFields'] as const) {
      const short = CONCEPT_HELP[key].short;
      expect(short, key).toBeTruthy();
      expect(short!.length, `${key} is too long for a key line`).toBeLessThan(90);
    }
  });

  /**
   * `richText` renders backticks and nothing else — no bold, no italic. A
   * `*word*` therefore ships as two literal asterisks on the Sites reference,
   * the Help tab and every `?` that quotes the entry, and nothing else here
   * would fail: the shape rules above only ask that a body be non-empty.
   *
   * The backtick spans come out first, because several bodies legitimately
   * quote `*` as the URL-pattern glob. `example` is exempt for the same reason
   * from the other side — it is rendered as a whole `<code>`, never through
   * `richText`.
   */
  it('never uses an emphasis mark no surface can render', () => {
    const prose = (entry: HelpEntry): Array<[string, string]> => [
      ['body', entry.body],
      ...(entry.when ? [['when', entry.when] as [string, string]] : []),
      ...(entry.short ? [['short', entry.short] as [string, string]] : []),
    ];
    const outsideCode = (text: string) =>
      text.split('`').filter((_, i) => i % 2 === 0).join('');

    for (const [key, entry] of ALL) {
      for (const [field, text] of prose(entry)) {
        expect(outsideCode(text), `${key}.${field}`).not.toMatch(/[*_]/);
      }
    }
  });

  it('shows each dot colour rather than naming it', () => {
    expect(DOT_LEGEND.map((d) => d.status)).toEqual(['high', 'low', 'none']);
    for (const row of DOT_LEGEND) expect(row.label.trim()).not.toBe('');
  });

  /**
   * The product never presses a site's Submit button, and nothing the user reads
   * may say or imply otherwise — "until you press Apply" outlived the button by a
   * release once already.
   */
  it('never promises to send anything', () => {
    for (const [key, entry] of ALL) {
      const text = `${entry.body} ${entry.when ?? ''} ${entry.short ?? ''}`;
      expect(text, key).not.toMatch(/\bpress(es)? Apply\b|Apply presses|Apply sends/);
    }
    expect(CONCEPT_HELP.neverSubmits.body).toMatch(/never/i);
  });
});

describe('sync setup guide', () => {
  it('walks every step with a title and a body', () => {
    expect(SYNC_SETUP_STEPS.length).toBeGreaterThanOrEqual(8);
    for (const step of SYNC_SETUP_STEPS) {
      expect(step.title.trim()).not.toBe('');
      expect(step.body.trim().length, step.title).toBeGreaterThan(step.title.length);
    }
  });

  // The guide is followed by someone with a Google Cloud tab open beside it, so
  // every link has to land on Google's own console and nowhere else.
  it('links only to the Google Cloud console', () => {
    const links = SYNC_SETUP_STEPS.flatMap((s) => (s.link ? [s.link] : []));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.href).toMatch(/^https:\/\/console\.cloud\.google\.com\//);
      expect(link.label.trim()).not.toBe('');
    }
  });

  // The redirect URI is the one value that has to travel from here to Google, and
  // getting it into the wrong box is the commonest failure — so exactly one step
  // shows this browser's own copy of it.
  it('shows the redirect URI in exactly one step', () => {
    expect(SYNC_SETUP_STEPS.filter((s) => s.showsRedirectUri)).toHaveLength(1);
  });

  it('answers the error a missing redirect URI produces', () => {
    expect(SYNC_TROUBLESHOOTING.some((e) => /request is invalid/i.test(e.title))).toBe(true);
    for (const entry of SYNC_TROUBLESHOOTING) {
      expect(entry.body.trim().length, entry.title).toBeGreaterThan(entry.title.length);
    }
  });

  // richText renders backticks and nothing else; `**bold**` ships as asterisks.
  it('uses no markup richText cannot render', () => {
    const all = [
      ...SYNC_SETUP_STEPS.flatMap((s) => [s.title, s.body]),
      ...SYNC_TROUBLESHOOTING.flatMap((e) => [e.title, e.body]),
    ];
    for (const text of all) expect(text).not.toMatch(/\*\*|\]\(/);
    // A title is set as plain text, so even a backtick ships literally there.
    for (const { title } of [...SYNC_SETUP_STEPS, ...SYNC_TROUBLESHOOTING]) {
      expect(title).not.toContain('`');
    }
  });

  // The steps live in the guide; the concept entry says why, not how, so the two
  // cannot drift into two different sets of instructions.
  it('keeps the steps out of the concept entry', () => {
    expect(CONCEPT_HELP.syncClient.body).not.toMatch(/\(1\)/);
  });
});

/**
 * The Sync tab's "What syncs" list is the user's only view of what leaves the
 * browser in the background, so it has to be complete — rendered from the same
 * model the sync uses, and asserted here to cover all of it.
 */
describe('what syncs', () => {
  it('words every family of synced data', () => {
    for (const d of SYNC_DOMAINS) {
      expect(SYNC_SCOPE_TEXT[d].title.trim(), d).not.toBe('');
      expect(SYNC_SCOPE_TEXT[d].detail.trim(), d).not.toBe('');
    }
  });

  it('lists every setting on exactly one side', () => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const synced = (SYNCED_SETTINGS as string[]).includes(key);
      const local = key in LOCAL_SCOPE_TEXT;
      expect(synced !== local, key).toBe(true);
    }
    expect(Object.keys(LOCAL_SCOPE_TEXT).sort()).toEqual([...LOCAL_SETTINGS].sort());
  });

  it('names every synced setting by a real title', () => {
    for (const key of SYNCED_SETTINGS) expect(SETTINGS_HELP[key].title.trim(), key).not.toBe('');
  });

  it('says what stays on this browser beyond the settings', () => {
    expect(DEVICE_ONLY_TEXT.some((l) => /OAuth/.test(l.title))).toBe(true);
  });
});
