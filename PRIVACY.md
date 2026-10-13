# Privacy policy — Chromium Filler

Last updated: 13 October 2026

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
- **What you have taught it** — when you teach the extension a form question it
  did not recognise, it keeps that question's wording (and, where needed, the
  name of the form section it was in, or the site it was on) together with which
  of your fields answers it. It does not keep what you typed into the form.
- **Your job queue** — the URLs of postings you have imported or opened, each
  with a timestamped history of its status (new, opened, redirected, applied,
  skipped).
- **Your archive** — the title, description, requirements and metadata of the
  postings in your job queue, captured so you have a record of what you applied to.
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

When enabled, sync writes **only the job database** — the posting URLs and their
statuses and captured details — to a hidden per-application folder in your own
Google Drive, using the `drive.appdata` scope. That scope gives the extension no
visibility of any other file in your Drive. **Your profile, your own fields, what you have taught it, your CV, your cover
letter and your settings are never synced.** Sync runs when you press "Sync now"
and once at browser startup — never on a timer.

## Reading web pages

The extension requests access to all sites because job applications are not on a
fixed list of domains: employer career pages, in-house systems and applicant
tracking systems live on arbitrary domains, and a job board frequently hands you
off to an employer domain that is not known until the link is followed.

In practice, on a page you open, the extension looks at the page's form inputs —
their labels and the questions written beside them — and fills the ones it
recognises from your own saved details, unless you have turned "Fill
automatically" off. It never fills a form containing a password field (logins and
sign-ups), a search box, payment card fields or one-time codes, and it never
submits anything. It reads a posting's own text (title and description) only on
pages from your job queue, and that text stays on your device. Nothing it reads on
a page is sent anywhere.

It does not read your browsing history and does not monitor your activity.

## What is never collected

No analytics, no telemetry, no crash reporting, no advertising identifiers, no
tracking of any kind. The author receives nothing.

## Your control over the data

Everything is on your device and yours to remove:

- Options → Profile clears your details and removes your CV and cover letter.
- Options → Queue removes individual postings or the whole database, and exports
  it as JSON or CSV first if you want a copy.
- Options → Profile → What it has learned forgets anything you taught it.
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
