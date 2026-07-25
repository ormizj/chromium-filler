/**
 * The three facts the review modal leads with, under the job title: company,
 * location, employment type (`design/reference-updated/design.html` → `.jobmeta`).
 *
 * They come from JSON-LD first, not from the page's text. A `JobPosting` block is
 * the one thing job boards genuinely agree on — Greenhouse, Lever, Workday, Ashby
 * and most in-house boards all emit one, because Google Jobs requires it — so it is
 * both the most reliable source and the cheapest. A per-site selector beats it when
 * a board gets it wrong, and `og:site_name` is the last resort for the company.
 *
 * Nothing here guesses from prose. A wrong company name on the card the user
 * decides from is worse than one chip fewer, so a value that cannot be read is left
 * undefined and the chip is simply not rendered — the same fail-closed posture as
 * `submitDetect`. This is why the heuristic ladder is short and stops early.
 *
 * Pure apart from the `Document` it is handed, so it is unit-testable off a string
 * of HTML rather than only against a live page.
 */

/** What the modal renders as chips. Every field is optional by design. */
export interface JobMeta {
  company?: string;
  location?: string;
  employmentType?: string;
}

/** Selectors a site config may set to override any of the three. */
export interface JobMetaSelectors {
  company?: string;
  location?: string;
  employmentType?: string;
}

/**
 * A chip is one short phrase. Past this, a "location" is either a paragraph that
 * happened to match a selector or a list of forty offices — neither belongs on the
 * card, and both would push the posting itself off the top of it.
 */
const MAX_CHARS = 48;

/** schema.org's employment codes, as the words a person would write. */
const EMPLOYMENT_WORDS: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACTOR: 'Contract',
  TEMPORARY: 'Temporary',
  INTERN: 'Internship',
  VOLUNTEER: 'Volunteer',
  PER_DIEM: 'Per diem',
  OTHER: 'Other',
};

/** Collapse whitespace, and drop anything too long to be a chip. */
function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_CHARS) return undefined;
  return text;
}

function fromSelector(doc: Document, selector: string | undefined): string | undefined {
  if (!selector) return undefined;
  try {
    return clean(doc.querySelector(selector)?.textContent ?? undefined);
  } catch {
    // An unparseable selector is a config typo, not a reason to render nothing.
    return undefined;
  }
}

/** The first entry of a schema.org property that may be a single value or a list. */
function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null;

function isJobPosting(node: unknown): node is Json {
  if (!isObject(node)) return false;
  const type = node['@type'];
  return Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting';
}

/**
 * The `JobPosting` node, wherever the board buried it: several emit an array of
 * blocks, and others wrap everything in an `@graph`.
 */
function findPosting(node: unknown, depth = 0): Json | undefined {
  if (depth > 3) return undefined;
  if (isJobPosting(node)) return node;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findPosting(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (isObject(node) && '@graph' in node) return findPosting(node['@graph'], depth + 1);
  return undefined;
}

function jsonLdPosting(doc: Document): Json | undefined {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = findPosting(JSON.parse(script.textContent ?? ''));
      if (found) return found;
    } catch {
      // Malformed JSON-LD is common and never worth an exception on someone
      // else's page — try the next block.
    }
  }
  return undefined;
}

/** "Berlin, DE" from a schema.org Place / PostalAddress, as much as it gives. */
function placeOf(posting: Json): string | undefined {
  const place = one(posting.jobLocation);
  if (typeof place === 'string') return clean(place);
  if (!isObject(place)) return undefined;
  const address = place.address;
  if (typeof address === 'string') return clean(address);
  if (!isObject(address)) return clean(place.name);
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map((p) => (typeof p === 'string' ? p.trim() : (isObject(p) ? clean(p.name) : undefined)))
    .filter((p): p is string => !!p);
  return clean(parts.join(', '));
}

function companyOf(posting: Json): string | undefined {
  const org = posting.hiringOrganization;
  if (typeof org === 'string') return clean(org);
  return isObject(org) ? clean(org.name) : undefined;
}

function employmentOf(posting: Json): string | undefined {
  const raw = one(posting.employmentType);
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (EMPLOYMENT_WORDS[key]) return EMPLOYMENT_WORDS[key];
  // An unlisted code (boards invent them) is still a fact the page stated: show it
  // as a word rather than as SHOUTING_SNAKE_CASE.
  const word = key.toLowerCase().replace(/_/g, '-');
  return clean(word.charAt(0).toUpperCase() + word.slice(1));
}

/**
 * Remote is the fact people scan for, so it leads — and it does not replace the
 * place when the posting names one, because "Remote" alone hides a timezone
 * requirement that is often the reason to skip the posting.
 */
function locationOf(posting: Json): string | undefined {
  const place = placeOf(posting);
  const remote = String(one(posting.jobLocationType) ?? '').toUpperCase() === 'TELECOMMUTE';
  if (!remote) return place;
  return place ? clean(`Remote (${place})`) ?? 'Remote' : 'Remote';
}

/**
 * Config selectors first, then the page's JSON-LD, then `og:site_name` for the
 * company. Each field resolves independently: a board that gets only the location
 * wrong needs one selector, not three.
 */
export function readJobMeta(doc: Document, selectors: JobMetaSelectors): JobMeta {
  const posting = jsonLdPosting(doc);
  const site = clean(doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content'));

  const meta: JobMeta = {
    company: fromSelector(doc, selectors.company)
      ?? (posting && companyOf(posting))
      ?? site,
    location: fromSelector(doc, selectors.location) ?? (posting && locationOf(posting)),
    employmentType: fromSelector(doc, selectors.employmentType)
      ?? (posting && employmentOf(posting)),
  };
  // Undefined keys are dropped, so a caller can ask `Object.keys(meta).length` —
  // and so the tests can compare against a plain object.
  for (const key of Object.keys(meta) as Array<keyof JobMeta>) {
    if (!meta[key]) delete meta[key];
  }
  return meta;
}
