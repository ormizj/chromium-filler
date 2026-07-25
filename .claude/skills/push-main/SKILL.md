---
name: push-main
description: Commit all current changes and push them to origin/main. Use when the user asks to commit and push, ship the current work, or runs /push-main.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*)
---

# push-main — commit everything and push to main

This is a solo repo with no PR review flow, so work goes straight onto `main`.
One invocation stages the whole working tree, makes **one** commit, and pushes it
to `origin main`.

**This skill runs no tests, no typecheck, and no build.** That is deliberate — the
user runs those when they want them, and gating every commit on `npm run test:e2e`
would cost minutes per push. Do not add a check step here.

## Procedure

1. **Gather context** — in a single parallel batch:
   `git status`, `git diff HEAD`, `git log --oneline -10`, `git branch --show-current`.
   `git diff HEAD` does not show untracked files, so if `git status` lists new
   files whose content matters to the message, `Read` them.

2. **Nothing to commit?** If the working tree is clean, say so and stop. Never
   make an empty commit.

3. **Check the branch.** If it is not `main`, report which branch it is and ask
   the user before going further — this skill is named for pushing to main, and
   quietly pushing something else is the surprising outcome.

4. **Stage everything**: `git add -A`.

5. **Commit.** Write the message in this repo's own style, which `git log` shows:
   imperative mood, sentence case, no `type:` prefix, and describing the *effect*
   rather than the files —

   > Make the two on-page sheets one object with one slot
   > Stop the paper hover from blanking out the primary button

   Subject line only, unless the change genuinely needs a body. End the message
   with:

   ```
   Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
   ```

   If the diff spans unrelated concerns, it is still one commit — write a subject
   that covers the theme and use body bullets for the parts.

6. **Push**: `git push origin main`. If the push is rejected as non-fast-forward,
   **do not force**. Report the rejection and let the user decide whether to pull
   or rebase.

7. **Report** the commit subject, its short SHA, and that the push landed.
