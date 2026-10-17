# Demo tour workflow

This runbook keeps `/demo` repeatable. Use it whenever an app change makes a clip stale, a feature is added to the tour, or the Demo tile/icon changes.

## Output contract

Each chapter has one slug in `components/demo/demos.ts` and three matching files in `public/demos/`:

```text
<slug>.webm  # preferred playback format
<slug>.mp4   # Safari and compatibility fallback
<slug>.webp  # poster shown before playback
```

Every clip is 576×720, a phone's 4:5 shape: the app in its own phone layout (384 CSS pixels wide, zoomed 1.5× so it is crisp) under a 52-pixel caption band the recorder owns. Keep clips silent, 6–12 seconds long, readable at the width of a phone card, and focused on one task. The whole tour stays within 120 seconds. The complete poster-and-video set must remain below 2 MB; `components/demo/demos.test.ts` enforces the limit and missing files. The service worker precaches the whole set, so that budget is what an offline install costs: it was raised from 1.25 MB when the five original chapters were split into eight (paid for with a higher encoding CRF), and from 1.7 MB when the field, end zone and slides chapters made nine (issue #107). The phone frame carries ten chapters in the same budget at a higher CRF (52 for VP9, 37 for H.264).

Each chapter's card also lists its captions, in order: the text alternative to a silent clip. The recorder checks that a chapter showed exactly those captions, so the list under a clip is never a paraphrase of it.

`components/demo/recorded-from.json`, beside the tour's manifest, records which UI the clips were recorded from (it stays out of `public/demos/`, which holds only what the app serves and precaches). See [Keeping the clips current](#keeping-the-clips-current).

Use short videos instead of GIFs. `DemoClip` lists WebM first, MP4 second, uses `preload="none"`, never crops (`object-contain` in a 4:5 box), and pauses the previous demo when another starts. The first chapter is the hero: `DemoScreen` shows it full width above the grid. It plays without the browser's video controls, which draw over the clip (iOS covers it with skip, scrub and AirPlay buttons; `disableRemotePlayback` keeps Android Chrome's cast button off it): the whole clip is one button, named Play or Pause and the chapter, and the play sign and chapter number show over it only while it is stopped. Do not add a product timeline or scrubber; at 6–12 seconds a clip is watched through, and a tap starts it over once it ends.

## Current chapter plan

The tour follows a coach's week, and every chapter opens on a formation of its own (`FORMATIONS` in `fixtures.ts`), so the tour reads like a playbook and not like one play edited ten times.

| Slug | Story | Formation | Required beats |
| --- | --- | --- | --- |
| `first-play` | Draw a play, press play (the hero) | New-play spread, one drag into Twins Left | New play, drag Z into the slot, a slant and a go by the tap, star the read, ▶ to the catch |
| `roster` | Put your players on the play | Bunch Right | Roster mode with the starters' names, X's depth chart, Show player names on the play, the Secondary Lineup |
| `league-rules` | It knows your league's rules | Pistol | The ball on their 5, the dive stamped RUN IN NO-RUN ZONE, made a pass, the zones switched off |
| `run-game` | Run it, then fake it | Trips Right | ▶ the jet sweep, then ▶ the jet fake to the post against a faded Cover 1 |
| `defense` | Call a Cover 1, then watch it move | Cover 1 against Twins Right | Safety to Zone deep, LC in man on X off the faded offense, R's blitz moved back to 7 yards, ▶ with the defense moving |
| `game-day` | Build the book, call it from the sideline | the 7-play Otter Game Plan | Add a play, move it up, the game-day reader, search "4", Full screen |
| `wristbands` | Every player gets their own wristband | the same book | Pick the adult slim band, download, X's insert over the panel, then Z's, the binder and the slides |
| `share` | Send it to your staff | Twins Left | Save the unsaved play, coaching points, copy a link, open the shared page |
| `touchdown` | Score in your own end zone | Bunch Left at their 10 | Pick Synthwave '84 lettered for the team, draw X a custom route into the end zone, ▶ to the celebration |
| `trick-plays` | Trick plays, legal by design | Gun Split backs | QB laterals to Z, Z throws, the catch dragged forward snaps back, ▶ the double pass |

A chapter carries at most six `covers` entries; past that it stops being legible on a phone. If a feature does not fit one of these stories, add the smallest useful chapter rather than stretching an existing clip. Update the expected chapter count in `components/demo/demos.test.ts` deliberately.

### Coverage is a promise, not a caption

The `covers` pills on a chapter's `/demo` card are checked, not asserted by hand. Each beat declares the features it demonstrates, and a feature is only counted once that beat has completed — so a failed assertion never counts as coverage. `driver.finish()` refuses to publish a chapter whose card promises something no beat demonstrated, and a beat that claims a feature the card does not list is an error too. It refuses, too, a chapter whose captions were not the card's, in the card's order, and one that ends more than 1.5 seconds before its promised length (dead time a viewer sits through: set the chapter's `time` to what it takes, or show more). `scripts/demo-recorder/coverage.ts` holds the coverage rules; `coverage.test.ts` covers them without a browser.

Prove a feature with the beat whose result is on screen, not the tap that triggers it: the print chapter downloads a PDF and then lays the real insert over the panel (`wristbandCard`, the same SVG the PDF rasterises), so "Wristbands" is proven by a wristband, not by a button.

## The recorder

The development-only recorder in `scripts/demo-recorder/` is the canonical way to regenerate every chapter. It drives the same accessible controls a coach uses, seeds only the stable fictional **Riverside Otters** fixtures, films the app in its phone layout inside a harness page it owns, encodes the three delivery files, and verifies them before it writes anything you can keep.

| File | Holds |
| --- | --- |
| `scripts/demo-recorder.ts` | The `bun run demo:record` entry point |
| `scripts/demo-recorder/options.ts` | Arguments, chapter slugs, output names, `--help` |
| `scripts/demo-recorder/fixtures.ts` | The fictional plays, playbook, team, and per-chapter starting draft |
| `scripts/demo-recorder/harness.ts` | The page the recorder films: the caption band, the app in a zoomed same-origin frame under it, the cover shown while a screen loads, and the touch (a dot and a ripple where a beat taps or drags) |
| `scripts/demo-recorder/chapters.ts` | One function per chapter: captions, actions, expected states, poster moment, target length, frame rate |
| `scripts/demo-recorder/interactions.ts` | Bounded, state-confirmed retries for controls that can render before React hydration |
| `scripts/demo-recorder/runtime.ts` | Disposable profile, capture, encoding, verification, publishing into the output directory |
| `scripts/demo-recorder/media.ts` | The frame (576×720, the app at 384 CSS pixels zoomed 1.5×, the 52-pixel band), the frame rates, and the asset contract as pure checks over `ffprobe` output |
| `scripts/demo-recorder/freshness.ts` | The fingerprint of the UI a recording shows, written as `recorded-from.json`, and the check against it |
| `scripts/demo-restamp.ts` | The `bun run demo:restamp` entry point, for a UI change no clip shows |
| `scripts/demo-recorder/*.test.ts` | Unit tests for arguments, fixtures, manifest alignment, cleanup, freshness, and the contract |

### Privacy and isolation

Every chapter launches Chromium with a brand-new temporary profile under the system temp directory, seeds `localStorage` with the fixtures from `fixtures.ts`, records, and removes the profile afterwards. This happens on success and on failure. The recorder never accepts a profile path, never reads a normal browser profile, and never writes to `public/demos/` on its own. Never copy personal profile data, real team names, or real player names into the fixtures.

### Pinned tools

| Tool | Version | Where it is pinned |
| --- | --- | --- |
| Bun | 1.4.0 | `packageManager` in `package.json` |
| `@playwright/test` | 1.63.0 (Chromium build 1243) | Exact version in `package.json` and integrity-locked in `bun.lock`; `bun run demo:setup` installs the matching browser |
| FFmpeg / ffprobe | 6.x or later with `libvpx-vp9`, `libx264`, and `libwebp` | System package; the recorder checks for the encoders and prints the version it used |

The current set was regenerated with FFmpeg 6.1.1 and the Chromium build its machine shipped (named with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, the same override `playwright.config.ts` honours). A different FFmpeg major version may change file sizes slightly; the set budget check will say so.

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

bun run demo:record --chapter first-play --output-dir /tmp/arc-demo-review
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

bun run demo:record --chapter run-game --output-dir "$one_dir" --contact-sheets --trace
bun run demo:record --chapter all --output-dir "$all_dir_a" --contact-sheets --trace
bun run demo:record --chapter all --output-dir "$all_dir_b" --contact-sheets --trace
```

For each `all` directory, record the final `Complete Demo set` byte count and retain every `Recorded …` line. Probe all twenty videos and confirm the ten slugs and promised durations still match `components/demo/demos.ts`. Review every `*.sheet.png` at full width and every `*.sheet-390.png` at 390 px. Any exception, `.failure.png`, missing delivery file, duration outside 6–12 seconds, or set at/above 2,000,000 bytes means the run is not acceptance evidence.

Record one chapter at a time on an otherwise idle machine: a beat's holds are wall-clock, so a build or a test suite running beside the recorder stretches a chapter past its promised length.

To prove clean-checkout reproducibility, repeat the setup, production build/server, dry-run, single-chapter run, and both `all` runs from a newly created checkout of the exact review revision using `bun install --frozen-lockfile`. Record `git rev-parse HEAD`, `git status --short`, `bun --version`, `playwright --version`, `ffmpeg -version`, and `ffprobe -version` with the evidence. Do not reuse `.next`, `node_modules`, a capture directory, or a browser profile from the development checkout.

Publish only one complete set from a validated `all` directory after comparing the two independent results. Never mix files across runs or publish the single-chapter capture.

### What a run verifies

For every chapter the recorder:

1. Opens the harness page, shows the chapter's first caption in the band, and opens the first screen behind the cover; the chapter's clock starts when that screen is on camera, and the clip starts there (the browser launching and the first load are cut from the front of the raw capture).
2. Plays the chapter's beats, checking each expected state in the app (routes stored, toasts shown, downloads received with the right filename), drawing the touch where each one taps or drags.
3. Fails if the beats ran past the length promised in `components/demo/demos.ts` (by more than a quarter second): encoding trims every clip to that length, so an overrun would silently cut the last beats, and with them things the card promises. Fails, too, if they ended more than 1.5 seconds short of it. Otherwise it holds the last frame until the promised length, then trims normalized source timestamps to that fixed manifest length (never variable wall-clock capture time).
4. Encodes WebM (VP9, CRF 52) and MP4 (H.264, CRF 37) at the chapter's frame rate (12 fps where ▶ plays a ball in flight, 10 elsewhere), and the poster from a screenshot taken at the chapter's chosen moment.
5. Probes each file: exactly one video stream, no audio, 576×720, the expected codec, 6–12 seconds, and more than 1 KB.
6. Moves the three files into the output directory together, from a staging directory, only after every check passes.

Before the first chapter it opens each screen once in a throwaway headless browser, so a freshly built server's slow first render and scripts, and the browser's slow first launch, do not eat into the first chapter's length. An `all` run finally adds up the thirty files, fails if they reach 2,000,000 bytes, and writes `recorded-from.json`: the fingerprint of the UI in this checkout when the run began (the app it recorded must be built from the same checkout).

A chapter also fails before any of that if it did not demonstrate every feature its `/demo` card advertises, or showed captions other than the card's.

The service worker is blocked while recording and its pill is styled out of the frame (`ON_CAMERA_CSS` in `runtime.ts`), the drawers snap instead of sliding, and every other motion (a route drawing on, the confetti, an end zone's own animation) plays as it does for a coach.

### When a beat fails

Failures name the chapter, the beat, and one of five classes, and leave `<slug>.failure.png` (a screenshot of the moment) in the output directory and nothing else:

| Class | Meaning | Usual fix |
| --- | --- | --- |
| `selector` | A visible control changed, moved under a drawer, or disappeared | Update the locator in `chapters.ts` to the control's new accessible name |
| `state` | The control was used but the expected result did not land | Check the app change; adjust the assertion or the fixture |
| `export` | An in-app download did not happen, failed, or had the wrong name | Check the export path in the app, then the expected filename pattern |
| `recording` | Navigation, capture, encoding, duration, or output validation failed | Read the message: server not running, encoder missing, beats longer than the promised length (`--trace` shows where the time goes), set over budget |
| `coverage` | The chapter finished without showing something its `/demo` card promises, or showed captions other than the card's | Add a beat that demonstrates it, or take the pill off the card in `demos.ts`; make the `captions` and the `say` calls agree |

Chapters run in the app's phone layout (384 CSS pixels wide): the two sidebars are drawers that cover most of the field one at a time, and picking a route or the primary read folds the palette away, so show every payoff with the drawers closed (`closePanels`). On a fresh profile, server-rendered controls can also appear before React attaches their handlers. `ChapterDriver` handles both cases with bounded, state-confirmed retries, so use its helpers (`click`, `clickUntilState`, `selectPlayer`, `pick`, `paletteAction`, `tapField`, `dragPlayer`, `dragHandle`, `runPlay`, `choose`, `setChecked`, `unfold`, `pickLook`, `download`, `overlay`) rather than raw clicks when adding beats. `unfold` opens the folded Theme and End zone sections of Play tools; `pickLook` picks a theme or end zone and waits for the "Switching to …" interstitial to come down; a beat whose state is already reached (a drawer already open) is skipped, so no tap ever lands on nothing.

The app is in a frame the harness zooms 1.5×, so every tap goes through the driver, which scales a control's box to the page's pixels; Playwright's own `click` on a control in the frame lands in the wrong place. The helpers draw the touch where the tap lands: a dot that shows a moment before, then a ripple, and a dot that follows a drag.

Captions live in the band over the app, never in it, so say the first one before the first `goto` (the band shows it from the clip's first frame) and change it before each story beat. A chapter that narrates the primary read on ▶ sets `pinRandom` so the simulation always throws to it; such a chapter must never save a play. A chapter with a ball in flight sets `fps: 12`.

### Publishing into the tour

Review the output first. Look at the contact sheets at full width and at 390 px, open the posters, and play a clip. Then replace the committed set and its stamp in one step and run the gate:

```sh
bun run demo:record --chapter all --output-dir /tmp/arc-demo-review --force --contact-sheets
cp /tmp/arc-demo-review/*.webm /tmp/arc-demo-review/*.mp4 /tmp/arc-demo-review/*.webp public/demos/
cp /tmp/arc-demo-review/recorded-from.json components/demo/
bun test
```

Do not copy single chapters from a partial or failed run, and do not commit `.sheet*.png`, `.raw.webm`, or `.failure.png` files.

### Keeping the clips current

The coverage check proves each chapter did what its card promises when it was recorded; it cannot see the UI move on afterwards. `components/demo/recorded-from.json` can. It holds the sha256 of every file under `components/` (tests and the `/demo` page's own `components/demo/` aside) and of `app/globals.css`, taken by the `all` run that recorded the committed set. `components/demo/demos.test.ts` fingerprints the checkout again, so `bun test` fails the moment one of those files is changed, added, removed or renamed without a new recording, and names each one.

When it fails, either:

- **re-record** the whole tour against a build of the checkout and publish the set with its stamp, as above; or
- if you have watched every clip and the change does not show in any of them (a refactor, a print-only style, a screen no chapter opens), **restamp** instead, and say why:

  ```sh
  bun run demo:restamp --reason "the binder's print colours changed; no clip prints"
  ```

  The stamp then carries the reason and the files it waved through, so the reviewer sees both in the diff. A restamp refuses without a reason, when nothing has changed, and without a recorded stamp to move on.

### Extending coverage

To change what a chapter shows, edit its function in `chapters.ts`: every story beat is `d.say(...)` followed by actions and an `expectState` that names what should be true afterwards. Call `d.poster()` at the frame that best explains the chapter; the recorder uses the final frame if a chapter never does. Change starting data only in `fixtures.ts`, keeping ids, names, and routes stable so re-recordings look the same. Run with `--trace` to keep the actions inside the promised length.

To add a chapter:

1. Add it to `DEMOS` in `components/demo/demos.ts` with its slug, title, time, summary, `captions` and `covers`.
2. Add the slug to `CHAPTER_SLUGS` in `options.ts` and a `CHAPTERS` entry in `chapters.ts` with the same `targetSeconds` as the manifest's `time`.
3. Add any starting play to `fixtures.ts` in a formation of its own (`FORMATIONS`) and, if the chapter opens one, to `CHAPTER_PLAY`; a chapter that must start mid-edit seeds `CHAPTER_DRAFT` instead.
4. Give every `covers` entry a beat that proves it with its result on screen: pass the feature names to the `expectState` (or `download`) that confirms the action landed.
5. Run `bun test scripts/demo-recorder`; the tests fail until the manifest, slugs, and lengths agree.
6. Record it, review it, publish the set with its stamp, and add the slug to `DEMOS` in `lib/offline/sw.js` (every build stamps a new release into the worker, so installed copies refresh without a cache version bump).

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

The recorder captures a 576×720 page: the caption band over the app in its phone layout, zoomed 1.5×, with the drawers snapping instead of sliding and every other motion on. Chapter actions and their visible assertions live in `scripts/demo-recorder/chapters.ts`; keep every action deterministic and label each expected state explicitly.

For each beat:

1. Put the app in its known starting state before capture begins.
2. Show one short caption describing the intent, not the mouse action.
3. Let the touch land on the control (the driver draws it), and leave enough time to see the result with the drawers closed.
4. Avoid dead time, fast flashing changes, and overlapping menus.
5. End on a stable result for roughly half a second.

Review the capture once at full size and once at 390 px wide (`--contact-sheets` produces both). Text, tap targets, the ball, and route changes must remain understandable without audio.

## 3. Encode the assets

The recorder runs the commands below after a successful capture. They remain here for diagnosing or manually reproducing an encoding failure from a `--keep-raw` capture. Replace `SLUG`, `LEAD` (the seconds of launch and first load the run cut from the front; `--trace` prints the clock), `SECONDS` (the chapter's promised length), `FPS` (12 for a ▶ chapter, else 10) and `raw-capture`:

```sh
ffmpeg -y -i raw-capture.webm -an -vf "trim=start=LEAD:duration=SECONDS,setpts=PTS-STARTPTS,fps=FPS,scale=576:720:flags=lanczos" \
  -c:v libvpx-vp9 -crf 52 -b:v 0 SLUG.webm

ffmpeg -y -i raw-capture.webm -an -vf "trim=start=LEAD:duration=SECONDS,setpts=PTS-STARTPTS,fps=FPS,scale=576:720:flags=lanczos" \
  -c:v libx264 -crf 37 -preset slow -pix_fmt yuv420p -movflags +faststart SLUG.mp4

ffmpeg -y -i poster-frame.png -frames:v 1 -vf "scale=576:720:flags=lanczos" \
  -c:v libwebp -q:v 72 SLUG.webp
```

Choose a poster frame that communicates the chapter before playback: a payoff, with the drawers closed; in a ▶ chapter, the ball in the air (`runPlay`'s `posterAt`). If the three new files push the complete set over 2 MB, shorten the clip first, then raise the VP9/MP4 CRF slightly, then drop a ▶ chapter to 10 fps.

Check the results:

```sh
ffprobe -v error -show_entries stream=codec_name,codec_type,width,height -show_entries format=duration,size \
  -of default=noprint_wrappers=1 public/demos/SLUG.webm

du -cb public/demos/* | tail -1
```

## 4. Update the tour

1. Add or edit the chapter in `components/demo/demos.ts`. Keep the slug aligned with all three filenames and with `CHAPTER_SLUGS` in the recorder.
2. List every demonstrated feature in `covers`; this is the tour's coverage inventory. List the captions in `captions`; the recorder holds the chapter to them.
3. Keep the summary concrete and accurate to the recording.
4. If the Demo icon changes, preserve the source at `design/assets/icons/demo.png` and commit its optimized sidebar copy at `public/icons/demo.png`.
5. If a new route or asset family is introduced, add it to `lib/offline/sw.js`; `scripts/stamp-sw.ts` writes it to `public/sw.js` with the build's release, so installed copies refresh.
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

`e2e/journeys/demo-tour.journey.ts` then proves on every pull request that `/demo` lists every chapter as the manifest says (its captions under it), that each clip and poster served is the committed file at the promised length and 576×720, that no clip shows the browser's controls or cast button or can play fullscreen on an iPhone, that the play sign and chapter number show only while a clip is stopped, that a tap anywhere on a clip, or Tab then Enter or Space, plays and pauses it, and that one clip plays at a time; it leaves `test-results/demo-tour-<device>.json`, `test-results/demo-tour-<device>-playback.json` with a picture of the first card stopped and playing, and a mid-clip frame of every chapter. Then check the production build in a desktop and 390×844 mobile viewport:

- Open **Play tools**, confirm the Demo tile uses the expected icon, and navigate through it.
- Confirm every poster renders and every card is legible.
- Play every clip from start to finish in at least one Chromium browser.
- Confirm a second clip pauses the first.
- On a real iPhone in Safari, play a clip: nothing of the browser's draws over it, a tap pauses it and brings the play sign back, and a finished clip plays again on a tap. The phone projects in the journeys run Chromium, so only a real device catches WebKit drawing its own controls.
- Confirm WebM and MP4 URLs return successfully; test Safari when changing codec settings.
- Confirm no horizontal overflow on mobile.
- Wait for **Offline ready**, then turn the network off and confirm `/`, `/playbooks`, and `/demo` still open. All advertised clips (including ones not yet played) must load and seek from the service-worker cache.
- While offline, reopen a shared URL that was visited online and confirm the exact play returns. A different, unvisited shared URL must show **Shared play unavailable offline** rather than the designer or another play.
- On a first visit, confirm the indicator reads **Offline updating…** and does not switch to **Offline ready** until every shell dependency and demo asset has been verified. A later release offers **Update ready** once its shell is complete; **Update now** reloads onto it. A failed update must leave the prior worker and its cached shared URLs usable. `e2e/journeys/offline.journey.ts` and `e2e/journeys/update.journey.ts` prove both on every pull request; this check is for a real device after a deploy.

In the pull request, name the chapters added or refreshed, report the aggregate media size, include the verification commands, and call out any workflow coverage that remains for a later clip.
