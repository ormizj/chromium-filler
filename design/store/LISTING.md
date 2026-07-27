# Chrome Web Store submission — paste-ready copy

Everything the dashboard asks for, in dashboard order. Item ID
`ibdmodmpbhmemofnmgilhgealaeipkmd`.

---

## Package

Upload `chromium-filler-v0.1.0-store.zip`.

**Not** `chromium-filler-v0.1.0.zip` — that one nests everything under a
`chromium-filler/` folder for GitHub / "Load unpacked", and the store does not
descend into a wrapper. `npm run package` now builds both, and fails loudly if
the store archive has no `manifest.json` at its root.

The store zip is also built unminified (`npm run build:store`). Minified code is
allowed — obfuscation is what the policy bans — but Chrome's own review-process
page names "hard-to-review code" as a thing that draws extra scrutiny, and this
extension already asks for `<all_urls>`. The reviewer gets the code as authored.

---

## Store listing

### Category

**Workflow & Planning**

### Language

**English**

### Description

```
Chromium Filler fills in job application forms for you — and then stops, and
shows you what it did, and waits.

Nothing is ever submitted automatically. There is no timer and no "that looked
complete" heuristic that can press Send. The extension fills, reports, and hands
the decision back to you.

HOW IT WORKS

1. You save your details and your CV once, in Options.
2. You open a job posting.
3. On a site you have configured, the extension waits for the form to appear,
   runs any page actions that site needs (expand the description, open the Apply
   modal), and reads the posting's own title and description.
4. It fills every field it is confident about, CV upload included.
5. It shows you a review: every field marked filled, to check, or unmatched.
6. You fix anything it flagged and press Apply — which presses that site's own
   Send button for you. Or you press Skip.

THE REVIEW REPORT

The modal opens on the job itself — title, company, location, contract type, and
the full description, so you can read the posting without leaving the form. A
toggle switches to the field report: every field the extension looked for, what
it put there, and which selector it used.

Three counts sit under the description — filled, to check, unmatched — so a
posting that half-matched is obvious before you press anything.

FIX A WRONG MATCH BY CLICKING THE REAL FIELD

When the extension misses a field, press Pick and then click the actual input on
the page. The selector is saved into that site's configuration, so the next
posting on that site gets it right. No CSS, no DevTools.

A QUEUE, NOT SIXTY TABS

Paste a messy block of text and every URL in it is extracted, normalised and
de-duplicated. A session then keeps a fixed number of job tabs open — five by
default — and opens the next posting the moment you apply, skip or close one. It
survives a browser restart. Every posting keeps a timestamped history: new,
opened, redirected, applied, skipped.

Once a posting is recorded as applied, re-opening it retires both Apply and Skip.
You cannot accidentally apply twice.

TWO-STEP APPLICATIONS

Plenty of boards hand you off to the employer's own system. The extension follows
that handoff when the posting really is external, declines to follow it when the
page is merely ambiguous, and picks the fill back up at the destination.

AN ARCHIVE OF WHAT YOU READ

Every posting's title, description and requirements are captured as you go, and
exportable as JSON or CSV with the columns and statuses you choose.

OPTIONAL SYNC

The job database — and only the job database, never your profile or your CV —
can sync between two browsers through a Google Drive app folder, using an OAuth
client you create yourself. It is off until you set it up, and it runs when you
press Sync now, never on a timer.

YOUR DATA STAYS ON YOUR MACHINE

Your name, email, phone, address and CV are stored on your own device in
chrome.storage.local. There is no account, no server, and no analytics. The
extension sends nothing anywhere except the two things you ask for: the job
application you press Apply on, which goes to that site, and the job database, if
you turn on your own Drive sync.

Open source: https://github.com/ormizj/chromium-filler
```

### Screenshots (1280x800, up to 5)

In this folder, in listing order:

1. `screenshot-1-review-job.png` — the review modal on a posting, Apply and Skip
2. `screenshot-2-review-fields.png` — the per-field report, with Pick
3. `screenshot-3-queue.png` — the queue, stat cards and posting statuses
4. `screenshot-4-profile.png` — the profile and CV, stored on-device
5. `screenshot-6-help.png` — the built-in Help

`screenshot-5-sites.png` is deliberately not in the five: it is the raw JSON
config editor, which reads as forbidding out of context.

Regenerate them all with `npm run screenshots` — they are produced by driving the
*built* extension in real Chromium against the fixture sites, so they cannot
drift from the UI.

---

## Privacy tab

### Single purpose

```
Chromium Filler fills in job application forms on job sites, using details the
user has saved, and shows the user a review of what it filled before anything is
submitted. Every other feature exists to serve that one purpose: the queue
decides which posting to fill next, the per-site configuration is how the
extension knows where the fields are on a given site, the archive is a record of
the postings it filled, and the optional sync carries that record to the user's
second browser.
```

### Permission justifications

**storage**

```
Stores the user's own data on their device: the profile values used to fill
forms, the CV and cover-letter files, the per-site field configurations, the job
queue and the archive of postings. This is the extension's entire state. Nothing
is stored on a server; there is no account.
```

**unlimitedStorage**

```
The CV and cover letter are stored as files in chrome.storage.local so they can
be attached to a site's file input during a fill. A PDF CV alone can exceed the
default quota, and the archive of captured postings grows over a job search, so
the default limit is reached in ordinary use.
```

**tabs**

```
A queue session keeps a fixed number of job postings open at once (five by
default) and opens the next one when the user applies to, skips or closes one.
That requires opening tabs, knowing when one closes, and closing a tab after a
submission is confirmed. It is also how a two-step application follows a posting
from the job board to the employer's own site. The extension does not read
browsing history or the contents of tabs it did not open for this purpose.
```

**scripting**

```
Injects the fill-and-review logic into a job posting page when the user opens
one, so the extension can find the form fields, fill them, attach the CV, and
render the review report. Also used by the click-to-pick feature, where the user
clicks a real input on the page to teach the extension which field it is.
```

**activeTab**

```
Used for the actions the user starts from the toolbar popup — re-running a fill
or opening the setup panel — so those act on the posting the user is currently
looking at.
```

**identity**

```
Only for the optional Google Drive sync, which is off unless the user sets it up.
chrome.identity.launchWebAuthFlow runs the OAuth flow for an OAuth client the
user creates in their own Google Cloud project and pastes into the options page;
the extension ships no client of its own. The scope requested is
drive.appdata, a hidden per-application folder, so the extension can neither see
nor touch any other file in the user's Drive. Only the job database is synced —
never the profile, the CV or the settings.
```

**Host permission (`<all_urls>`)**

```
Job applications are not on a fixed list of sites. Users apply through employer
career pages, small in-house systems, and applicant tracking systems on custom
domains, and a job board routinely hands the applicant off to an employer domain
that is not known until the moment the link is followed. The extension therefore
cannot ship a match-pattern list that would cover its users' applications.

What it actually does on a page is narrow. On load it compares the URL against
the per-site configurations the user has created. If none matches, it does
nothing at all: no fill, no capture, no report. Only on a site the user has
configured does it read the form and the posting text.

It does not read or transmit page content on unmatched sites, does not inject
anything into search, banking or webmail pages, and sends no page data anywhere.
```

### Are you using remote code?

**No, I am not using remote code.** Everything that executes is in the package.

### Data usage — tick these

- **Personally identifiable information** — the profile the user saves (name,
  email, phone, address) and the CV / cover letter, used to fill forms.
- **Website content** — the job posting's own title, description and
  requirements, read from the page so the review can show the user what they are
  applying to, and kept in the archive.
- **Web history** — the queue stores the URLs of job postings the user imported
  or opened, with the timestamps of their status changes.
- **Authentication information** — only if the user turns on sync: the OAuth
  client ID and secret they create themselves and paste into the options page are
  stored on their device.

Do **not** tick: health, financial and payment, personal communications,
location, user activity.

### Certifications — tick all three

- I do not sell or transfer user data to third parties, outside of the approved
  use cases
- I do not use or transfer user data for purposes that are unrelated to my item's
  single purpose
- I do not use or transfer user data to determine creditworthiness or for lending
  purposes

All three are true: nothing leaves the device except the application the user
presses Apply on, and the job database if the user configures their own sync.

### Privacy policy URL

```
https://github.com/ormizj/chromium-filler/blob/main/PRIVACY.md
```

`PRIVACY.md` is in the repo root. Commit and push it before submitting — the
reviewer will open this URL, and a 404 is a rejection.

---

## Distribution

- **Visibility:** Unlisted
- **Regions:** all
- Not for a Chrome OS device only; no Google Analytics.

---

## Two things worth deciding before you press Submit

**The name.** Google's brand guidelines reserve its trademarks for its own
products, and "Chromium" is one of them. Extension names built on it get
rejected as brand-confusing often enough that it is a real risk, not a
theoretical one — the pattern Google does permit is "<Your name> for Chrome",
not "Chrome <thing>". Unlisted lowers the odds it is noticed. If it is, the fix
is a new `name` in `manifest.config.ts`, a rebuild, and a re-upload — the item,
the ID and everything on this page survive. Something like "Applyer", "Formcast"
or "Job Application Filler" would carry no risk at all.

**The extension ID and sync.** The ID above is now fixed and permanent. Anyone
setting up sync creates an OAuth client whose redirect URI is bound to it, so
this is the ID to document. Note that a Google Cloud OAuth consent screen left in
"Testing" expires its refresh tokens after seven days — sync will ask to
re-authorise weekly until the user publishes their own consent screen. That is
worth a line in the sync help, since it will otherwise read as a bug.
