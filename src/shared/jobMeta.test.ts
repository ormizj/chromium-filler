/**
 * The Job view's meta line — company, location, employment type.
 *
 * These three facts are the reference's lead under the title, and they are the one
 * part of it the modal could not render because nothing extracted them. The rules
 * here are the same fail-closed ones the rest of the extension follows: a value is
 * shown only when the page actually says it, because a wrong company name on the
 * card the user decides from is worse than a card with one chip fewer.
 */
import { describe, it, expect } from 'vitest';
import { readJobMeta } from './jobMeta';

/** A document from HTML, the way the content script sees the real page. */
function doc(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

function ld(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

const posting = (over: Record<string, unknown> = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Staff Platform Engineer',
  hiringOrganization: { '@type': 'Organization', name: 'Acme' },
  jobLocation: {
    '@type': 'Place',
    address: { '@type': 'PostalAddress', addressLocality: 'Berlin', addressCountry: 'DE' },
  },
  employmentType: 'FULL_TIME',
  ...over,
});

describe('readJobMeta — JSON-LD, the one thing job boards agree on', () => {
  it('reads company, location and type from a JobPosting', () => {
    expect(readJobMeta(doc(ld(posting())), {})).toEqual({
      company: 'Acme',
      location: 'Berlin, DE',
      employmentType: 'Full-time',
    });
  });

  it('spells the schema.org employment codes as words', () => {
    const type = (v: unknown) =>
      readJobMeta(doc(ld(posting({ employmentType: v }))), {}).employmentType;
    expect(type('PART_TIME')).toBe('Part-time');
    expect(type('CONTRACTOR')).toBe('Contract');
    expect(type('INTERN')).toBe('Internship');
    expect(type('TEMPORARY')).toBe('Temporary');
    // An unknown code is still better shown than dropped — just tidied.
    expect(type('SEASONAL')).toBe('Seasonal');
    expect(type(['FULL_TIME', 'PART_TIME'])).toBe('Full-time');
  });

  it('says Remote, and where remote-from when the posting also names a place', () => {
    expect(readJobMeta(doc(ld(posting({ jobLocationType: 'TELECOMMUTE' }))), {}).location)
      .toBe('Remote (Berlin, DE)');
    const noPlace = posting({ jobLocationType: 'TELECOMMUTE' }) as Record<string, unknown>;
    delete noPlace.jobLocation;
    expect(readJobMeta(doc(ld(noPlace)), {}).location).toBe('Remote');
  });

  it('takes the first of several locations rather than concatenating them', () => {
    const many = posting({
      jobLocation: [
        { address: { addressLocality: 'Berlin' } },
        { address: { addressLocality: 'Lisbon' } },
      ],
    });
    expect(readJobMeta(doc(ld(many)), {}).location).toBe('Berlin');
  });

  it('finds the posting inside an @graph, where several boards put it', () => {
    const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, posting()] };
    expect(readJobMeta(doc(ld(graph)), {}).company).toBe('Acme');
  });

  it('accepts a plain-string hiringOrganization', () => {
    expect(readJobMeta(doc(ld(posting({ hiringOrganization: 'Acme GmbH' }))), {}).company)
      .toBe('Acme GmbH');
  });

  it('ignores JSON-LD that is not a JobPosting', () => {
    const other = { '@type': 'Organization', name: 'Some Recruiter' };
    expect(readJobMeta(doc(ld(other)), {})).toEqual({});
  });

  it('survives malformed JSON-LD instead of throwing on someone else\'s page', () => {
    const html = '<script type="application/ld+json">{ not json }</script>' + ld(posting());
    expect(readJobMeta(doc(html), {}).company).toBe('Acme');
  });
});

describe('readJobMeta — the fallbacks, in order', () => {
  it('prefers a configured selector over the page\'s own JSON-LD', () => {
    const html = `${ld(posting())}<span class="co">Northwind Labs</span>`;
    expect(readJobMeta(doc(html), { company: '.co' }).company).toBe('Northwind Labs');
  });

  /**
   * `og:site_name` is the name of the *website*, which on a job board is the
   * board — "LinkedIn", "Indeed", "Greenhouse". Rendering that in a chip the user
   * reads as the hiring company is not a weak guess, it is a wrong answer, and it
   * is the one thing this module's own doc comment promises not to do. One chip
   * fewer beats a confident lie on the card the posting is judged from.
   */
  it('never reports the website’s name as the hiring company', () => {
    const html = '<meta property="og:site_name" content="LinkedIn" />';
    expect(readJobMeta(doc(html), {})).toEqual({});
  });

  it('still takes the company from the posting’s own structured data', () => {
    const html = `${ld(posting())}<meta property="og:site_name" content="LinkedIn" />`;
    expect(readJobMeta(doc(html), {}).company).toBe('Acme');
  });

  // A board that publishes no JSON-LD is exactly where a per-site selector earns
  // its keep — that is the supported way to name the employer, not a site-wide guess.
  it('lets a configured selector name the company where nothing else can', () => {
    const html = '<meta property="og:site_name" content="LinkedIn" /><span class="co">Northwind Labs</span>';
    expect(readJobMeta(doc(html), { company: '.co' }).company).toBe('Northwind Labs');
  });

  it('ignores a selector that matches nothing rather than reporting empty text', () => {
    expect(readJobMeta(doc('<span class="co"> </span>'), { company: '.co' })).toEqual({});
  });

  it('ignores a malformed selector instead of throwing', () => {
    expect(readJobMeta(doc(ld(posting())), { company: ':::' }).company).toBe('Acme');
  });

  it('collapses whitespace and drops a value too long to be a chip', () => {
    const html = `<span class="co">  Acme
      Corporation  </span><span class="loc">${'x'.repeat(80)}</span>`;
    const meta = readJobMeta(doc(html), { company: '.co', location: '.loc' });
    expect(meta.company).toBe('Acme Corporation');
    expect(meta.location).toBeUndefined();
  });

  it('returns an empty object for a page that says none of it', () => {
    expect(readJobMeta(doc('<h1>Staff Platform Engineer</h1>'), {})).toEqual({});
  });
});
