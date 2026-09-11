# Demo tour workflow

This runbook keeps `/demo` repeatable. Use it whenever an app change makes a clip stale, a feature is added to the tour, or the Demo tile/icon changes.

## Output contract

Each chapter has one slug in `components/demo/demos.ts` and three matching files in `public/demos/`:

```text
<slug>.webm  # preferred playback format
<slug>.mp4   # Safari and compatibility fallback
<slug>.webp  # poster shown before playback
```

Record at 960×540. Keep clips silent, 6–12 seconds long, readable at phone width, and focused on one task. The complete poster-and-video set must remain below 1.25 MB; `components/demo/demos.test.ts` enforces the limit and missing files.

Use short videos instead of GIFs. `DemoClip` lists WebM first, MP4 second, uses `preload="none"`, and pauses the previous demo when another starts. Do not add a product timeline or scrubber—the playback chapter demonstrates a play running with the browser's native video controls.

## Current chapter plan

| Slug | Story | Required beats |
| --- | --- | --- |
| `build-play` | Draw the offense | Name a play, add quick and custom routes, mark the primary route, mirror, undo/redo |
| `run-play` | Watch plays run | Show a snap, a run, a pass, and play-action completing to the primary player |
| `build-defense` | Build the defense | Toggle offense/both, then show zones, man coverage, and a legal blitz |
| `save-export` | Save, share and export | Save, notes, duplicate, share link, picture export, video export |
| `playbooks` | Build a playbook | Create/team setup, add/order plays, wristbands, binder PDF, playbook import/export |

If a feature does not fit one of these stories, add the smallest useful chapter rather than stretching an existing clip. Update the expected chapter count in `components/demo/demos.test.ts` deliberately.

## The recorder

The development-only recorder in `scripts/demo-recorder/` is the canonical way to regenerate every chapter. It drives the same accessible controls a coach uses, seeds only the stable fictional **Riverside Otters** fixtures, captures the 960×540 viewport, encodes the three delivery files, and verifies them before it writes anything you can keep.

| File | Holds |
| --- | --- |
| `scripts/demo-recorder.ts` | The `bun run demo:record` entry point |
| `scripts/demo-recorder/options.ts` | Arguments, chapter slugs, output names, `--help` |
| `scripts/demo-recorder/fixtures.ts` | The fictional plays, playbook, team, and per-chapter starting draft |
| `scripts/demo-recorder/chapters.ts` | One function per chapter: captions, actions, expected states, poster moment, target length |
| `scripts/demo-recorder/interactions.ts` | Bounded, state-confirmed retries for controls that can render before React hydration |
| `scripts/demo-recorder/runtime.ts` | Disposable profile, capture, encoding, verification, publishing into the output directory |
| `scripts/demo-recorder/media.ts` | The asset contract as pure checks over `ffprobe` output |
| `scripts/demo-recorder/*.test.ts` | Unit tests for arguments, fixtures, manifest alignment, cleanup, and the contract |

### Privacy and isolation

Every chapter launches Chromium with a brand-new temporary profile under the system temp directory, seeds `localStorage` with the fixtures from `fixtures.ts`, records, and removes the profile afterwards. This happens on success and on failure. The recorder never accepts a profile path, never reads a normal browser profile, and never writes to `public/demos/` on its own. Never copy personal profile data, real team names, or real player names into the fixtures.

### Pinned tools

| Tool | Version | Where it is pinned |
| --- | --- | --- |
| Bun | 1.4.0 | `packageManager` in `package.json` |
| `@playwright/test` | 1.63.0 (Chromium build 1243) | Exact version in `package.json` and integrity-locked in `bun.lock`; `bun run demo:setup` installs the matching browser |
| FFmpeg / ffprobe | 9.x with `libvpx-vp9`, `libx264`, and `libwebp` | System package; the recorder checks for the encoders and prints the version it used |

Recordings were last regenerated with FFmpeg n9.0.1. A different FFmpeg major version may change file sizes slightly; the set budget check will say so.

### Setup

```sh
bun install --frozen-lockfile
bun run demo:setup
ffmpeg -version
ffprobe -version
```

### Recording

Serve the production build in another terminal, then record one chapter or all chapters into an explicit review directory. There is deliberately no default output directory, and existing matching files are refused unless `--force` is present.

```sh
bun run build
bun run start

bun run demo:record --chapter build-play --output-dir /tmp/arc-demo-review
bun run demo:record --chapter all --output-dir /tmp/arc-demo-review --force
```

Useful options (`--help` lists them all):

| Option | Effect |
| --- | --- |
| `--base-url <url>` | The running app, default `http://127.0.0.1:3000`; `next start -p 3777` pairs with `--base-url http://127.0.0.1:3777` |
| `--contact-sheets` | Also write `<slug>.sheet.png` (full width, one frame per second) and `<slug>.sheet-390.png` (the same frames at 390 px) for review |
| `--trace` | Print each beat with its elapsed time, to see where a chapter spends its seconds |
| `--keep-raw` | Keep Playwright's raw `<slug>.raw.webm` beside the encoded files for encoder diagnosis |
| `--headed` | Show Chromium while it records |
| `--dry-run` | Check arguments, the output directory, and profile cleanup without a browser, encoder, or running app |

```sh
bun run demo:record --chapter all --output-dir /tmp/arc-demo-dry-run --dry-run
```

### Acceptance and reproducibility evidence

Acceptance requires one isolated chapter capture and **two separate successful `all` captures**. Start with three distinct empty directories; every chapter in every command receives a fresh disposable profile. Keep the command output with the review so exceptions, tool versions, per-chapter elapsed times, and aggregate bytes are auditable.

```sh
one_dir=$(mktemp -d /tmp/arc-demo-one.XXXXXX)
all_dir_a=$(mktemp -d /tmp/arc-demo-all-a.XXXXXX)
all_dir_b=$(mktemp -d /tmp/arc-demo-all-b.XXXXXX)

bun run demo:record --chapter run-play --output-dir "$one_dir" --contact-sheets --trace
bun run demo:record --chapter all --output-dir "$all_dir_a" --contact-sheets --trace
bun run demo:record --chapter all --output-dir "$all_dir_b" --contact-sheets --trace
```

For each `all` directory, record the final `Complete Demo set` byte count and retain the five `Recorded …` lines. Probe all ten videos and confirm the five slugs and promised durations still match `components/demo/demos.ts`. Review every `*.sheet.png` at full width and every `*.sheet-390.png` at 390 px. Any exception, `.failure.png`, missing delivery file, duration outside 6–12 seconds, or set at/above 1,250,000 bytes means the run is not acceptance evidence.

To prove clean-checkout reproducibility, repeat the setup, production build/server, dry-run, single-chapter run, and both `all` runs from a newly created checkout of the exact review revision using `bun install --frozen-lockfile`. Record `git rev-parse HEAD`, `git status --short`, `bun --version`, `playwright --version`, `ffmpeg -version`, and `ffprobe -version` with the evidence. Do not reuse `.next`, `node_modules`, a capture directory, or a browser profile from the development checkout.

Publish only one complete set from a validated `all` directory after comparing the two independent results. Never mix files across runs or publish the single-chapter capture.

### What a run verifies

For every chapter the recorder:

1. Plays the chapter's beats, checking each expected state in the app (routes stored, toasts shown, downloads received with the right filename).
2. Holds the last frame until the chapter reaches the length promised in `components/demo/demos.ts`, then trims normalized source timestamps to that fixed manifest length (never variable wall-clock capture time).
3. Encodes WebM (VP9, CRF 42) and MP4 (H.264, CRF 30) at 8 fps, and the poster from a screenshot taken at the chapter's chosen moment.
4. Probes each file: exactly one video stream, no audio, 960×540, the expected codec, 6–12 seconds, and more than 1 KB.
5. Moves the three files into the output directory together, from a staging directory, only after every check passes.

An `all` run finally adds up the fifteen files and fails if they reach 1,250,000 bytes.

### When a beat fails

Failures name the chapter, the beat, and one of four classes, and leave `<slug>.failure.png` (a screenshot of the moment) in the output directory and nothing else:

| Class | Meaning | Usual fix |
| --- | --- | --- |
| `selector` | A visible control changed, moved under a drawer, or disappeared | Update the locator in `chapters.ts` to the control's new accessible name |
| `state` | The control was used but the expected result did not land | Check the app change; adjust the assertion or the fixture |
| `export` | An in-app download did not happen, failed, or had the wrong name | Check the export path in the app, then the expected filename pattern |
| `recording` | Navigation, capture, encoding, duration, or output validation failed | Read the message: server not running, encoder missing, chapter over 12 s, set over budget |

Chapters run in the app's compact layout (the 960 px viewport is under the 1024 px breakpoint): the two sidebars are drawers that overlay the field one at a time, and picking a route or the primary read folds the palette away. On a fresh profile, server-rendered controls can also appear before React attaches their handlers. `ChapterDriver` handles both cases with bounded, state-confirmed retries, so use its helpers (`clickUntilState`, `selectPlayer`, `pick`, `paletteAction`, `tapField`, `download`) rather than raw clicks when adding beats.

### Publishing into the tour

Review the output first. Look at the contact sheets at full width and at 390 px, open the posters, and play a clip. Then replace the committed set in one step and run the gate:

```sh
bun run demo:record --chapter all --output-dir /tmp/arc-demo-review --force --contact-sheets
cp /tmp/arc-demo-review/*.webm /tmp/arc-demo-review/*.mp4 /tmp/arc-demo-review/*.webp public/demos/
bun test
```

Do not copy single chapters from a partial or failed run, and do not commit `.sheet*.png`, `.raw.webm`, or `.failure.png` files.

### Extending coverage

To change what a chapter shows, edit its function in `chapters.ts`: every story beat is `d.say(...)` followed by actions and an `expectState` that names what should be true afterwards. Call `d.poster()` at the frame that best explains the chapter; the recorder uses the final frame if a chapter never does. Change starting data only in `fixtures.ts`, keeping ids, names, and routes stable so re-recordings look the same. Run with `--trace` to keep the actions inside the promised length.

To add a chapter:

1. Add it to `DEMOS` in `components/demo/demos.ts` with its slug, title, time, summary, and `covers`.
2. Add the slug to `CHAPTER_SLUGS` in `options.ts` and a `CHAPTERS` entry in `chapters.ts` with the same `targetSeconds` as the manifest's `time`.
3. Add any starting play to `fixtures.ts` and, if the chapter opens one, to `CHAPTER_PLAY`.
4. Run `bun test scripts/demo-recorder`; the tests fail until the manifest, slugs, and lengths agree.
5. Record it, review it, publish the three files, and add them to `public/sw.js` with a cache version bump.

## 1. Prepare deterministic app data

1. Start from a clean branch based on current `main`.
2. Run the setup commands above, `bun test`, and `bun run build`.
3. Serve the production build with `bun run start`.
4. Let the recorder create and clean its disposable browser profile. Do not pass it, or copy into it, any personal profile data.
5. Change only the fictional fixtures in `scripts/demo-recorder/fixtures.ts` when a chapter needs different starting data. The keys it seeds are:
   - `ffpd.draft.v1`
   - `ffpd.plays.v2`
   - `ffpd.playbooks.v1`
   - `ffpd.team.v1`
   - `ffpd.first-use.v1` (set to `done` so the first-use guide never covers a chapter)
6. Use the primary route for every shown completion. Playback and exported clips should not depend on a random receiver choice.

Never record personal browser chrome, accounts, bookmarks, notifications, or real team/player data.

## 2. Record a chapter

The recorder captures the app viewport at exactly 960×540 with browser chrome hidden and reduced motion on, so drawers snap instead of sliding. Chapter actions and their visible assertions live in `scripts/demo-recorder/chapters.ts`; keep every action deterministic and label each expected state explicitly.

For each beat:

1. Put the app in its known starting state before capture begins.
2. Show one short caption describing the intent, not the mouse action.
3. Move the pointer to the control, pause briefly, activate it, and leave enough time to see the result.
4. Avoid dead time, fast flashing changes, and overlapping menus.
5. End on a stable result for roughly half a second.

Review the capture once at full size and once at 390 px wide (`--contact-sheets` produces both). Text, tap targets, the ball, and route changes must remain understandable without audio.

## 3. Encode the assets

The recorder runs the commands below after a successful capture. They remain here for diagnosing or manually reproducing an encoding failure from a `--keep-raw` capture. Replace `SLUG`, `SECONDS` (the chapter's promised length), and `raw-capture`:

```sh
ffmpeg -y -i raw-capture.webm -t SECONDS -an -vf "fps=8,scale=960:540:flags=lanczos" \
  -c:v libvpx-vp9 -crf 42 -b:v 0 SLUG.webm

ffmpeg -y -i raw-capture.webm -t SECONDS -an -vf "fps=8,scale=960:540:flags=lanczos" \
  -c:v libx264 -crf 30 -preset slow -pix_fmt yuv420p -movflags +faststart SLUG.mp4

ffmpeg -y -i poster-frame.png -frames:v 1 -vf "scale=960:540:flags=lanczos" \
  -c:v libwebp -q:v 72 SLUG.webp
```

Choose a poster frame that communicates the chapter before playback. If the three new files push the complete set over 1.25 MB, shorten the clip first, then raise the VP9/MP4 CRF slightly. Keep the 8 fps delivery rate unless motion becomes hard to follow.

Check the results:

```sh
ffprobe -v error -show_entries stream=codec_name,codec_type,width,height -show_entries format=duration,size \
  -of default=noprint_wrappers=1 public/demos/SLUG.webm

du -cb public/demos/* | tail -1
```

## 4. Update the tour

1. Add or edit the chapter in `components/demo/demos.ts`. Keep the slug aligned with all three filenames and with `CHAPTER_SLUGS` in the recorder.
2. List every demonstrated feature in `covers`; this is the tour's coverage inventory.
3. Keep the summary concrete and accurate to the recording.
4. If the Demo icon changes, preserve the source at `design/assets/icons/demo.png` and commit its optimized sidebar copy at `public/icons/demo.png`.
5. If a new route or asset family is introduced, add it to `public/sw.js` and bump the cache version so installed copies refresh.
6. Update this chapter table when the story or required beats change.

## 5. Verify before review

Run the full local gate:

```sh
bun run lint
bun run typecheck
bun test
bun run build
git diff --check
```

Then check the production build in a desktop and 390×844 mobile viewport:

- Open **Play tools**, confirm the Demo tile uses the expected icon, and navigate through it.
- Confirm every poster renders and all five cards are legible.
- Play every clip from start to finish in at least one Chromium browser.
- Confirm a second clip pauses the first.
- Confirm WebM and MP4 URLs return successfully; test Safari when changing codec settings.
- Confirm no horizontal overflow on mobile.
- Wait for **Offline ready**, then turn the network off and confirm `/`, `/playbooks`, and `/demo` still open. All advertised clips (including ones not yet played) must load and seek from the service-worker cache.
- While offline, reopen a shared URL that was visited online and confirm the exact play returns. A different, unvisited shared URL must show **Shared play unavailable offline** rather than the designer or another play.
- During a worker update, confirm the indicator reads **Offline updating…** and does not return to **Offline ready** until every shell dependency and demo asset has been verified. A failed update must leave the prior worker and its cached shared URLs usable.

In the pull request, name the chapters added or refreshed, report the aggregate media size, include the verification commands, and call out any workflow coverage that remains for a later clip.
