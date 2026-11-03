# Privacy policy — Chromium Filler

Last updated: 3 November 2026

Chromium Filler is a browser extension that fills in job application forms. It
has no server, no account, and no analytics. Everything it knows is stored on the
device it is installed on.

## What it stores, and where

All of the following is kept in `chrome.storage.local` on your own machine:

- **Your profile** — the values you enter in Options to fill forms with: name,
  email address, phone number, city, address, links, and the answers in any fields
  of your own you add (for example years of experience or notice period).
- **Your documents** — the CV and cover letter you upload, stored as files so
  they can be attached to a site's file input during a fill.
- **What it has learned** — when you answer a form question it did not recognise
  with one of your saved details, it keeps that question's wording (and, where
  needed, the name of the form section it was in, or the site it was on) together
  with which of your fields answers it. The lesson stores which field, not what you
  typed: your answer is already in your profile.
- **Answers you've typed** — short, one-line answers you type into forms that none
  of your saved details hold (a job title, a notice period), each with how often you
  gave it and up to five of the questions it answered. They are kept so Options →
  Profile can suggest saving them, and are never filled anywhere until you do.
  Nothing typed into a large text box or a rich-text editor (a cover letter, an
  email, a chat message) is ever kept, and neither is anything typed into a form the
  extension leaves alone (below). This record stays on this browser — it is never
  synced — and the "Remember answers you type" setting turns it off.
- **Your job queue** — the URLs of postings you have imported or opened, each
  with a timestamped history of its status (new or done).
- **Your settings**, and — only if you set up sync — the Google OAuth client ID
  and secret you created in your own Google Cloud project.

None of this is transmitted to the author of this extension, and none of it is
transmitted to any third party, with the two exceptions below.

## The only two times data leaves your device

**1. The application you submit.** The extension fills form fields on the page;
it never submits a form. When you press the site's own submit button, the details
in the form are sent to that site, exactly as they would be if you had typed them
in yourself. That site's own privacy policy governs what happens next.

**2. Sync, if you turn it on.** Sync is off unless you set it up, and setting it
up means creating an OAuth client in your own Google Cloud project and pasting
its ID and secret into the options page. This extension ships no OAuth client of
its own, and the author has no access to your Google account or to anything you
sync.

When enabled, sync keeps your browsers the same by writing your extension data —
your job queue, your profile and your own fields, what it has learned, your CV and
cover letter, and your settings — to a hidden per-application folder in your own
Google Drive, using the `drive.appdata` scope. That scope gives the extension no
visibility of any other file in your Drive. **The answers you've typed, the OAuth
client and its sign-in tokens are never synced**, and neither are three settings
that belong to one browser: the on/off switch, the "Sync this browser" switch and
where the review card sits. Options → Sync lists exactly what syncs and what stays.
Sync runs when you press "Sync now" and once at browser startup — never on a timer.

## Reading web pages

The extension requests access to all sites because job applications are not on a
fixed list of domains: employer career pages, in-house systems and applicant
tracking systems live on arbitrary domains, and a job board frequently hands you
off to an employer domain that is not known until the link is followed.

In practice, on a page you open — including forms embedded in it from another
site, as applicant tracking systems often do — the extension looks at the page's
form inputs, their labels and the questions written beside them, and fills the
ones it recognises from your own saved details, unless you have switched it off
(the switch in the toolbar popup or on its card). When you finish typing an answer
into one of those inputs, it reads the answer back to learn from it, as described
above. It never fills or reads a form containing a password field (logins and
sign-ups), a search box, payment card fields or one-time codes, and it never
submits anything. Nothing it reads on a page is sent anywhere.

It does not read your browsing history and does not monitor your activity.

## What is never collected

No analytics, no telemetry, no crash reporting, no advertising identifiers, no
tracking of any kind. The author receives nothing.

## Your control over the data

Everything is on your device and yours to remove:

- Options → Profile clears your details and removes your CV and cover letter.
- Options → Queue removes individual postings or the whole list. Options → Sync
  exports a backup file of everything first if you want a copy.
- Options → Profile → What it has learned forgets anything it learned.
- Options → Profile → Answers you've typed dismisses any of them, and Options →
  Settings → "Remember answers you type" stops keeping them.
- Options → Settings → "Learn from what you type" stops it learning anything new.
- Uninstalling the extension deletes all of its local storage.
- If you enabled sync, the synced copy lives in your own Google Drive; revoke the
  extension's access in your Google Account settings and delete the app folder
  through Drive's "Manage apps" settings.

## Selling and sharing

Your data is not sold or transferred to third parties. It is not used or
transferred for any purpose unrelated to filling in job application forms. It is
not used or transferred to determine creditworthiness or for lending purposes.

## Changes

Material changes to this policy will be published in this file in the repository,
with the date above updated.

## Contact

Questions, or a privacy problem to report: open an issue at
<https://github.com/ormizj/chromium-filler/issues>, or email ormizj@gmail.com.
