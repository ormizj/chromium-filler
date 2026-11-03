# Chrome Web Store submission — paste-ready copy

Everything the dashboard asks for, in dashboard order. Item ID
`ibdmodmpbhmemofnmgilhgealaeipkmd`.

---

## Package

Upload `../../.archive/chromium-filler-v0.2.0-store.zip`.

**Not** `../../.archive/chromium-filler-v0.2.0.zip` — that one nests everything under a
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
   Forms embedded from Greenhouse, Lever and other applicant tracking systems are
   filled too.
4. A small pill in the corner says it is on. Press it for a card listing what was
   filled, what is worth a look, and any question it did not recognise.
5. You check it over and submit on the site yourself.

IT LEARNS FROM YOUR ANSWERS

There is nothing to teach. When you answer a question it did not know with one of
your details — your email into "Preferred contact", say — it remembers that
question, and the next site that asks it is filled without you. When you replace
something it filled with something unrelated, or empty it, it stops filling that
question. A lesson names exactly one box: "Name" under "Reference 1" will never be
confused with "Name" under "Reference 2".

Answers you type that none of your details hold — a job title, a notice period —
are counted as suggestions, so you can save the ones you keep giving. They are
never filled until you do. Everything it has learned is listed in Options, where
any of it can be forgotten.

IT KNOWS WHAT TO LEAVE ALONE

Login and sign-up forms, search boxes, card numbers and one-time codes are never
filled, on any site. Nor is a box that already has something in it, or one you
have typed in.

A QUEUE, NOT SIXTY TABS

Paste a messy block of text and every URL in it is extracted, normalised and
de-duplicated. A session then keeps a fixed number of job tabs open and opens the
next posting the moment you close or skip one — either marks the posting done. Tabs the queue opened carry a small "Queue" chip, so you always know which
is which. Every posting keeps a timestamped history.

OPTIONAL SYNC

Two browsers can be kept the same — your job list, your details, your own fields,
what it has learned, your CV and cover letter, and your settings — through a
hidden app folder in your own Google Drive, using an OAuth client you create
yourself. A few things stay on each browser: the on/off switch, where the card
sits, and the answers you've typed. Nothing is sent until you set it up, and it
runs when you press Sync now and when the browser starts, never on a timer.

YOUR DATA STAYS ON YOUR MACHINE

Your name, email, phone, address, answers and CV are stored on your own device in
chrome.storage.local. There is no account, no server, and no analytics. The
extension sends nothing anywhere except to your own Google Drive, if you turn on
sync. What it types into a form stays in that form until you submit it.

Open source: https://github.com/ormizj/chromium-filler
```

### Screenshots (1280x800, up to 5)

In this folder, in listing order:

1. `screenshot-1-review.png` — the review card on a filled posting
2. `screenshot-2-learned.png` — a question it learned from the answer you typed
3. `screenshot-3-queue.png` — the queue, stat cards and posting statuses
4. `screenshot-4-profile.png` — the profile and CV, stored on-device
5. `screenshot-5-typed.png` — answers you've typed, ready to save to your profile

`screenshot-6-own-fields.png` (your own fields, and the wordings they answer) and
`screenshot-7-help.png` (the built-in Help) are spares.

Regenerate them all with `npm run screenshots` — they are produced by driving the
*built* extension in real Chromium against the fixture sites, so they cannot
drift from the UI.

---

## Privacy tab

### Single purpose

```
Chromium Filler fills in job application forms, using details the user has saved,
and shows the user a review of what it filled. It never submits anything. Every
other feature serves that one purpose: learning from the answers the user types is
how it recognises questions it did not know, the queue decides which posting to
fill next, and the optional sync carries the user's saved details and job list to
their other browser.
```

### Permission justifications

**storage**

```
Stores the user's own data on their device: the profile values and answers used
to fill forms, the CV and cover-letter files, which form questions the user's
details answer (learned from what they typed), a local count of short answers they
typed that none of their details hold, the job queue and the settings. This is the
extension's entire state. Nothing is stored on a server; there is no account.
```

**unlimitedStorage**

```
The CV and cover letter are stored as files in chrome.storage.local so they can
be attached to a site's file input during a fill. A PDF CV and a cover letter
together can exceed the default quota, so the default limit is reached in ordinary
use.
```

**tabs**

```
A queue session keeps a fixed number of job postings open at once and opens the
next one when the user skips or closes one. That requires opening tabs, knowing
when one closes (which is how the user marks a posting done), and knowing which
tabs the queue opened so they can be marked as such. The toolbar popup also uses
it to find the tab the user is looking at when they press Fill or Reset. The
extension does not read browsing history or the contents of tabs for this purpose.
```

**identity**

```
Only for the optional Google Drive sync, which is off unless the user sets it up.
chrome.identity.launchWebAuthFlow runs the OAuth flow for an OAuth client the
user creates in their own Google Cloud project and pastes into the options page;
the extension ships no client of its own. The scope requested is
drive.appdata, a hidden per-application folder, so the extension can neither see
nor touch any other file in the user's Drive. What is synced is the user's own
extension data — job list, profile, learned questions, CV and cover letter,
settings — so two of their browsers stay the same. The record of typed answers,
the OAuth client and its tokens are never synced.
```

**Host permission (`<all_urls>`)**

```
Job applications are not on a fixed list of sites. Users apply through employer
career pages, small in-house systems, and applicant tracking systems on custom
domains, and a job board routinely hands the applicant off to an employer domain
that is not known until the moment the link is followed. The extension therefore
cannot ship a match-pattern list that would cover its users' applications.

The content script runs in every frame, because application forms are often
embedded in an iframe served from the tracking system's own domain (Greenhouse,
Lever, iCIMS), which a script in the top frame cannot see into.

What it does on a page is narrow. It looks at the page's form inputs and the
question text beside them, and fills the ones it recognises from the user's own
saved details. It never fills a form that has a password field (logins, sign-ups),
a search box, payment card fields or one-time codes. It never submits a form.
When the user finishes typing an answer into a form input, it reads that answer
back: if it is one of the user's saved details, it remembers that the question asks
for it; if it is a short one-line answer none of their details hold, it counts it
on the device as a suggestion the user can save (the user can turn this off, and
nothing typed into a text area or rich-text editor is ever kept). It sends no page
data anywhere.
```

### Are you using remote code?

**No, I am not using remote code.** Everything that executes is in the package.

### Data usage — tick these

- **Personally identifiable information** — the profile the user saves (name,
  email, phone, address) and the CV / cover letter, used to fill forms.
- **Website content** — the wording of form questions, kept with which of the
  user's saved details answers them, so they can be recognised again; and short
  one-line answers the user typed that none of their details hold, kept on the
  device with up to five of the questions they answered, as suggestions to save
  (can be turned off).
- **Web history** — the queue stores the URLs of job postings the user imported
  or opened, with the timestamps of their status changes.
- **Authentication information** — only if the user turns on sync: the OAuth
  client ID and secret they create themselves and paste into the options page are
  stored on their device.

Do **not** tick: health, financial and payment, personal communications,
location, user activity.

"User activity" is left unticked on purpose: it covers monitoring clicks,
keystrokes, scrolling and the like. The extension reads only an answer the user has
committed into a form input (the `change` event when they leave it) — the same form
content declared above — never keystrokes, mouse movement or browsing activity.

### Certifications — tick all three

- I do not sell or transfer user data to third parties, outside of the approved
  use cases
- I do not use or transfer user data for purposes that are unrelated to my item's
  single purpose
- I do not use or transfer user data to determine creditworthiness or for lending
  purposes

All three are true: nothing leaves the device except to the user's own Google
Drive, if they configure their own sync. Filled forms are submitted by the user, on the
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
