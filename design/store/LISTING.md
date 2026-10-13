# Chrome Web Store submission — paste-ready copy

Everything the dashboard asks for, in dashboard order. Item ID
`ibdmodmpbhmemofnmgilhgealaeipkmd`.

---

## Package

Upload `../../.archive/chromium-filler-v0.1.4-store.zip`.

**Not** `../../.archive/chromium-filler-v0.1.4.zip` — that one nests everything under a
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
Chromium Filler fills in job application forms for you — and then stops, shows
you what it did, and leaves the submitting to you.

Nothing is ever submitted. The extension never presses a site's Submit button,
under any circumstances. It fills, reports, and you press the site's own button
when you are ready.

HOW IT WORKS

1. You save your details and your CV once, in Options — plus answers to the
   questions you get asked a lot: years of experience, notice period, whether you
   need sponsorship.
2. You open a job posting, on any site. There is nothing to set up per site.
3. Every field the extension recognises is filled, CV upload included. When more
   fields appear — a form opening behind "Apply now", the next page of a
   multi-step form — they are filled as they appear.
4. A small card lists what was filled, what is worth a look, and any question it
   did not recognise.
5. You check it over and submit on the site yourself.

TEACH IT ONCE

When a question is not recognised, press Teach and say what it is — one of your
details, one of your own answers, or "ignore this question". It is filled at
once, and remembered by its wording, so the next site that asks the same question
is filled without asking you. A lesson names exactly one box: "Name" under
"Reference 1" will never be confused with "Name" under "Reference 2". Everything
it has learned is listed in Options, where any of it can be undone.

IT KNOWS WHAT TO LEAVE ALONE

Login and sign-up forms, search boxes, card numbers and one-time codes are never
filled, on any site. Nor is a box that already has something in it, or one you
have typed in.

A QUEUE, NOT SIXTY TABS

Paste a messy block of text and every URL in it is extracted, normalised and
de-duplicated. A session then keeps a fixed number of job tabs open and opens the
next posting the moment you close or skip one — closing a tab marks the posting
done. Tabs the queue opened carry a small "Queue" chip, so you always know which
is which. Every posting keeps a timestamped history.

AN ARCHIVE OF WHAT YOU READ

The title, description and requirements of every posting from your queue are
captured as you go, and exportable as JSON or CSV with the columns and statuses
you choose.

OPTIONAL SYNC

The job database — and only the job database, never your profile or your CV —
can sync between two browsers through a Google Drive app folder, using an OAuth
client you create yourself. Nothing is sent until you set it up, and it runs when
you press Sync now, never on a timer.

YOUR DATA STAYS ON YOUR MACHINE

Your name, email, phone, address, answers and CV are stored on your own device in
chrome.storage.local. There is no account, no server, and no analytics. The
extension sends nothing anywhere except the job database, if you turn on your own
Drive sync. What it types into a form stays in that form until you submit it.

Open source: https://github.com/ormizj/chromium-filler
```

### Screenshots (1280x800, up to 5)

In this folder, in listing order:

1. `screenshot-1-review-job.png` — the review card on a posting
2. `screenshot-2-review-fields.png` — the per-question report, with Teach
3. `screenshot-3-queue.png` — the queue, stat cards and posting statuses
4. `screenshot-4-profile.png` — the profile and CV, stored on-device
5. `screenshot-5-own-fields.png` — your own fields, and the wordings they answer

`screenshot-6-help.png` is the built-in Help, kept as a spare.

Regenerate them all with `npm run screenshots` — they are produced by driving the
*built* extension in real Chromium against the fixture sites, so they cannot
drift from the UI.

---

## Privacy tab

### Single purpose

```
Chromium Filler fills in job application forms, using details the user has saved,
and shows the user a review of what it filled. It never submits anything. Every
other feature serves that one purpose: what the user teaches it is how it
recognises questions it did not know, the queue decides which posting to fill
next, the archive is a record of the postings it filled, and the optional sync
carries that record to the user's second browser.
```

### Permission justifications

**storage**

```
Stores the user's own data on their device: the profile values and answers used
to fill forms, the CV and cover-letter files, what the user has taught the
extension about questions it did not recognise, the job queue and the archive of
postings. This is the extension's entire state. Nothing is stored on a server;
there is no account.
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
A queue session keeps a fixed number of job postings open at once and opens the
next one when the user skips or closes one. That requires opening tabs, knowing
when one closes (which is how the user marks a posting done), and knowing which
tabs the queue opened so they can be marked as such. The extension does not read
browsing history or the contents of tabs for this purpose.
```

**scripting**

```
Runs the fill-and-review logic in the page, so the extension can find the form
fields, fill them, attach the CV, and render the review card. Also used by the
point-at-a-field feature, where the user clicks a real input on the page to teach
the extension what it is.
```

**activeTab**

```
Used for the actions the user starts from the toolbar popup — filling the page,
resetting it, or pointing at a field to teach — so those act on the tab the user
is currently looking at.
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

What it does on a page is narrow. It looks at the page's form inputs and fills
the ones it recognises from the user's own saved details. It never fills a form
that has a password field (logins, sign-ups), a search box, payment card fields
or one-time codes. It never submits a form. It only reads the posting's text
(title and description) on pages from the user's own job queue, and it sends no
page data anywhere.
```

### Are you using remote code?

**No, I am not using remote code.** Everything that executes is in the package.

### Data usage — tick these

- **Personally identifiable information** — the profile the user saves (name,
  email, phone, address) and the CV / cover letter, used to fill forms.
- **Website content** — the job posting's own title, description and
  requirements, read from postings in the user's queue so the review can show the
  user what they are applying to, and kept in the archive; and the wording of a
  form question the user chooses to teach, kept so it can be recognised again.
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

All three are true: nothing leaves the device except the job database, if the
user configures their own sync. Filled forms are submitted by the user, on the
site, never by the extension.

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
