# Privacy policy — Chromium Filler

Last updated: 27 July 2026

Chromium Filler is a browser extension that fills in job application forms. It
has no server, no account, and no analytics. Everything it knows is stored on the
device it is installed on.

## What it stores, and where

All of the following is kept in `chrome.storage.local` on your own machine:

- **Your profile** — the values you enter in Options to fill forms with: name,
  email address, phone number, city, address, and any links and custom fields you
  add.
- **Your documents** — the CV and cover letter you upload, stored as files so
  they can be attached to a site's file input during a fill.
- **Your site configurations** — the per-site rules describing where the fields
  are on a given job site, including the selectors saved when you use
  click-to-pick.
- **Your job queue** — the URLs of postings you have imported or opened, each
  with a timestamped history of its status (new, opened, redirected, applied,
  skipped).
- **Your archive** — the title, description, requirements and metadata of the
  postings the extension has read, captured so you have a record of what you
  applied to.
- **Your settings**, and — only if you set up sync — the Google OAuth client ID
  and secret you created in your own Google Cloud project.

None of this is transmitted to the author of this extension, and none of it is
transmitted to any third party, with the two exceptions below.

## The only two times data leaves your device

**1. The application you submit.** When you press Apply, the extension presses
that job site's own Send button. The details in the form are then sent to that
site, exactly as they would be if you had typed them in and clicked the button
yourself. That site's own privacy policy governs what happens next. The extension
never submits anything on its own: there is no timer and no heuristic that can
press Apply for you.

**2. Sync, if you turn it on.** Sync is off unless you set it up, and setting it
up means creating an OAuth client in your own Google Cloud project and pasting
its ID and secret into the options page. This extension ships no OAuth client of
its own, and the author has no access to your Google account or to anything you
sync.

When enabled, sync writes **only the job database** — the posting URLs and their
statuses and captured details — to a hidden per-application folder in your own
Google Drive, using the `drive.appdata` scope. That scope gives the extension no
visibility of any other file in your Drive. **Your profile, your CV, your cover
letter and your settings are never synced.** Sync runs when you press "Sync now"
and once at browser startup — never on a timer.

## Reading web pages

The extension requests access to all sites because job applications are not on a
fixed list of domains: employer career pages, in-house systems and applicant
tracking systems live on arbitrary domains, and a job board frequently hands you
off to an employer domain that is not known until the link is followed.

In practice, on any page you open, the extension compares the URL against the
site configurations *you* have created. **If none matches, it does nothing** — it
does not read the page, does not fill anything, and records nothing. Only on a
site you have configured does it read the form fields and the posting's own text,
and that text stays on your device.

It does not read your browsing history, does not monitor your activity, and does
not inject anything into search, banking or webmail pages.

## What is never collected

No analytics, no telemetry, no crash reporting, no advertising identifiers, no
tracking of any kind. The author receives nothing.

## Your control over the data

Everything is on your device and yours to remove:

- Options → Profile clears your details and removes your CV and cover letter.
- Options → Queue removes individual postings or the whole database, and exports
  it as JSON or CSV first if you want a copy.
- Options → Sites removes site configurations.
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
