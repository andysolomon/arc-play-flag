# Release runbook

How a change reaches https://arc-play-flag.vercel.app, how to check it landed, who watches what, and how to roll it back. The app has no backend and no database: every play lives in the coach's browser (`localStorage`), so a release can only break the code that is served, never the data on the device, and a rollback is only ever a change of which build Vercel serves.

## How a release happens

1. A pull request against `main` passes **Merge Gate** (`.github/workflows/merge.yml`: commitlint, lint, typecheck, `bun test`) and **PR Checks** (`.github/workflows/pr.yml`, adds `bun run build`). `main` rejects direct pushes.
2. The merge lands on `main`. Two things start at once:
   - **Vercel** builds the commit and promotes it to production. This is the deployment coaches get.
   - **Release** (`.github/workflows/release.yml`) runs `semantic-release`, which reads the conventional-commit subjects, picks the next version, tags `main` and writes a GitHub release with notes. Nothing is published to npm and no file in the repo changes.
3. The build inlines the short commit SHA as its release id (`next.config.ts` → `NEXT_PUBLIC_RELEASE`, from `VERCEL_GIT_COMMIT_SHA`). It appears in every problem report as `Release: \`abc1234\` (production)`. To map a report to a version: `git tag --contains abc1234` or open the commit on GitHub and read the tag beside it.

Local builds say `local` (development). Preview deployments say the PR's SHA with `(preview)`.

## Release verification

Run this on **production** within a few minutes of the merge. Previews are behind Vercel Authentication, so for a PR use the preview URL after logging in to Vercel, or `bun run build && bun run start` on the branch.

Before the app:

- [ ] GitHub → Actions → **Release** run for the merge is green, and a new tag/release exists with the expected notes (a `fix:` makes a patch, a `feat:` a minor, a `BREAKING CHANGE` footer a major).
- [ ] Vercel → Project `arc-play-flag` → Deployments: the newest production deployment is **Ready** and its commit matches `main`.

In the app (a normal window, then repeat the first three steps in a private window so nothing is cached):

- [ ] `/` loads with an empty field and both sidebars closed; no errors in the console.
- [ ] Drag a player, tap one, give it a route, press ▶: the play runs.
- [ ] Play tools → Save → the toast says **Saved**. Reload: the play comes back from the draft and appears under "Open a saved play…".
- [ ] Copy share link → open it in a private window: the read-only play renders and **Open in designer ›** loads it.
- [ ] Break a share link on purpose (drop its last 20 characters): the **NOT FOUND** card appears, not Vercel's or Next's default 404.
- [ ] `/playbooks`: make a playbook, add the play, **Download wristbands PDF** produces a PDF that opens; **Download playbook file** produces a `.playbook.json` that **Import a file…** reads back.
- [ ] `/demo`: the first clip plays.
- [ ] Play tools → **Where your plays live** opens; **Report a problem** opens a GitHub new-issue page whose body shows the new release SHA and `Page: \`/\``, and contains no play names.
- [ ] DevTools → Network → **Offline**, reload `/`: the designer still opens (service worker shell). Go online again.
- [ ] Forced failure drills (below) at least once per month or after any change to `app/`, `components/App.tsx`, `lib/play/storage.ts` or `lib/diagnostics.ts`.

If any box stays unticked, roll back first (next section), then investigate.

### Forced failure drills

These exercise the recovery paths so they are known to work before a coach needs them. None of them touch the plays on your own device if you use a private window.

**Persistence failure (save cannot land).** In a private window, draw a play, then in the console fill storage:

```js
try { for (let i = 0; ; i++) localStorage.setItem("ffpd.drill." + i, "x".repeat(1e6)); } catch (e) { console.log("full", e.name); }
```

Press **Save**. Expected: the toast says the browser's storage is full, the yellow **SaveFailure** panel appears under the tiles with **Try again** and **Download play**, and **Download play** saves `<play-name>.playbook.json`. Autosave says it is off once, not on every keystroke. Then clear the junk:

```js
Object.keys(localStorage).filter((k) => k.startsWith("ffpd.drill.")).forEach((k) => localStorage.removeItem(k));
```

**Try again** now succeeds and the panel disappears. Go to `/playbooks` → **Import a file…** with the downloaded file: the play comes back as `<name> (recovered)`. **Report a problem** lists a `storage` entry such as `StorageError: storage quota: ffpd.plays.v2`, and nothing else about the play.

**Render failure (the screen throws).** Open React DevTools → Components, select `App`, and use the **Suspend / Error boundary** toggle (the ⚠ button) to throw inside the tree. Expected: the **SOMETHING BROKE** card from `app/error.tsx` replaces the screen, names the play that is in the autosave, and **Download play** saves the same recovery file; **Try again** restores the screen; **Reload** starts fresh with the draft intact. Without DevTools, `throw new Error("drill")` in the console only reaches the diagnostics list (the boundary is for render errors), so check **Report a problem** shows it as `error · Error: drill`.

**Export failure.** Play tools → Export → **Save picture card** with DevTools **Offline** and a cold cache (private window). Expected: the status line under the buttons reports the failure in words, the designer keeps working, and the report lists an `export` entry.

**Diagnostics cannot write.** With storage full (the first drill), trigger any of the above. Expected: the app behaves the same; the report still lists the errors from memory (the browser line says `storage full`).

## Monitoring ownership

There is no error-reporting service and no analytics: coaches' plays never leave their devices, so the signals are the ones below. One person owns each; today that is the maintainer (`andysolomon`) for all of them.

| What | Where | Who | When |
| --- | --- | --- | --- |
| Deployment status (Ready / Error / Canceled) | Vercel → Deployments; GitHub commit checks on `main` | maintainer | On every merge, before ticking the checklist |
| Build failures | Vercel build logs; GitHub → Actions → **Release** | maintainer | On every merge |
| Runtime and edge logs (500s on `/p/[id]`, missing assets) | Vercel → Project → Logs (filter by status ≥ 400) | maintainer | Weekly, and after any report |
| Coach problem reports | GitHub issues opened from **Report a problem** (title "Problem report") | maintainer | Triage within a week; a report naming a release that is still in production is looked at the same day |
| Storage and privacy behaviour described in the app | `components/Support.tsx` versus the code in `lib/play/storage.ts`, `lib/play/share.ts`, `lib/diagnostics.ts` | reviewer of any PR touching those files | Every such PR |

A problem report carries: the release SHA and environment, the scrubbed page (`/`, `/playbooks`, `/demo`, `/p/[id]`), the user agent, viewport, online/offline, storage state, and the last five errors (name, scrubbed message, first twelve stack lines). It never carries play contents, notes, share payloads, the query string or any `localStorage` value; `lib/diagnostics.test.ts` pins that down.

## Rollback

Roll back when a release fails the checklist, when a problem report shows a regression that stops drawing, saving, sharing or printing, or when Vercel's logs show a spike of 5xx responses after a deploy. Do the Vercel step first (seconds), then the git step (minutes) so the next merge doesn't bring the bad build back.

### 1. Serve the previous build (Vercel)

1. Vercel → Project `arc-play-flag` → **Deployments**.
2. Find the last production deployment that was **Ready** before the bad one (its commit is the previous `main` tip).
3. Open its **⋯** menu → **Instant Rollback** (on plans without it: **Promote to Production**). Confirm.
4. Reload https://arc-play-flag.vercel.app in a private window. **Report a problem** must show the *previous* release SHA. Tick the checklist again.

A Vercel rollback is a pointer change: it is immediate, but the **next push to `main` deploys again and replaces it**. Nothing else may merge until step 2 is done.

Coaches with the app installed will run the rolled-back build on their next navigation: `public/sw.js` fetches pages network-first and refreshes static assets in the background, so one reload is enough. A build-only rollback never touches their stored plays.

### 2. Revert the change (git, via a PR)

`main` is PR-only, so a revert is a pull request like any other:

```sh
git switch main && git pull
git switch -c fix/revert-<short-description>
git revert --no-edit <bad-sha>            # one revert per commit of the release, newest first
bun install --frozen-lockfile && bun run lint && bun run typecheck && bun test && bun run build
git push -u origin HEAD
gh pr create --base main --title "fix: revert <what> (rollback of <version>)" --body "Rolls back <version>: <why>. Vercel was rolled back to <previous deployment> at <time>."
```

Merge once **Merge Gate** and **PR Checks** are green (`gh pr update-branch <n> --rebase` if `main` moved). The merge deploys the reverted code as the newest production deployment and `semantic-release` publishes it as a patch release, so the pointer set in step 1 is no longer load-bearing. Re-run the checklist on production.

### When a rollback is not enough

- **A stored-data shape changed.** Plays are versioned by storage key (`ffpd.plays.v2`, `ffpd.playbooks.v1`, `ffpd.team.v1`, `ffpd.draft.v1`, `ffpd.diagnostics.v1`), and the readers in `lib/play/storage.ts` normalise whatever they find rather than trusting it. A release that introduced a new key (say `ffpd.plays.v3`) and migrated data into it cannot be undone by serving the old build, because the old build reads the old key. Such a release must keep writing the old key too, or must not be rolled back: fix forward instead. Reviewers block any PR that renames a key without a compatibility note here.
- **A share-link format changed.** Links a coach already copied must keep decoding (`lib/play/share.ts`); `decodeShare` returning null sends them to the NOT FOUND card. A rollback restores the old decoder, so a format change must decode both old and new before it ships.
- **The service worker cache name changed** (`VERSION` in `public/sw.js`). Rolling back re-serves the older `sw.js`; browsers install it because the bytes differ, and its activate step deletes the newer cache. Expect one extra reload for installed users, nothing more.

### Verifying a rollback safely

Rehearse without touching production:

- **Preview deployment.** Open the revert PR; Vercel gives it a preview URL. Log in to Vercel (previews are authentication-protected), run the checklist there, and confirm **Report a problem** shows the PR's SHA with `(preview)`.
- **Local.** `git checkout <target-sha> && bun install --frozen-lockfile && bun run build && bun run start`, then run the checklist against http://localhost:3000 (the report says `local`). This is also how to check that the target build still reads the data the current build wrote: export a playbook file from the current production app, then import it locally.
- **Dry run of the Vercel step.** In the Vercel dashboard, open the previous production deployment's **⋯** menu far enough to see **Instant Rollback** / **Promote to Production**, then cancel. Note the deployment id and the time it takes to find; that is most of the rollback's duration.

### Rehearsal log

| Date | Who | What was rehearsed | Target deployment | Outcome, notes |
| --- | --- | --- | --- | --- |
| — | — | Not yet rehearsed. The first entry should be a full dry run: Vercel rollback to the previous production deployment, checklist on production, revert PR merged, checklist again. | — | — |
