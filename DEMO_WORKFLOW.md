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

## 1. Prepare deterministic app data

1. Start from a clean branch based on current `main`.
2. Run `bun install`, `bun test`, and `bun run build`.
3. Serve the production build with `bun run start`.
4. Open a fresh browser profile and clear site data before recording.
5. Seed only fictional plays and playbooks in local storage. Use stable ids and names so re-recordings look the same. The relevant keys are:
   - `ffpd.draft.v1`
   - `ffpd.plays.v2`
   - `ffpd.playbooks.v1`
6. Use the primary route for every shown completion. Playback and exported clips should not depend on a random receiver choice.

Never record personal browser chrome, accounts, bookmarks, notifications, or real team/player data.

## 2. Record a chapter

Record the app viewport at exactly 960×540 with browser chrome hidden. An automated browser recorder is preferred because it produces repeatable pointer targets and timing; a normal screen recorder is acceptable when the same sequence can be reproduced.

For each beat:

1. Put the app in its known starting state before capture begins.
2. Show one short caption describing the intent, not the mouse action.
3. Move the pointer to the control, pause briefly, activate it, and leave enough time to see the result.
4. Avoid dead time, fast flashing changes, and overlapping menus.
5. End on a stable result for roughly half a second.

Review the raw capture once at full size and once at 390 px wide. Text, tap targets, the ball, and route changes must remain understandable without audio.

## 3. Encode the assets

Use `ffmpeg` to make both delivery formats from the lossless or high-quality raw capture. Replace `SLUG` and `raw-capture` in these commands:

```sh
ffmpeg -y -i raw-capture.webm -an -vf "fps=8,scale=960:540:flags=lanczos" \
  -c:v libvpx-vp9 -crf 39 -b:v 0 public/demos/SLUG.webm

ffmpeg -y -i raw-capture.webm -an -vf "fps=8,scale=960:540:flags=lanczos" \
  -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -movflags +faststart \
  public/demos/SLUG.mp4

ffmpeg -y -ss 0.5 -i raw-capture.webm -frames:v 1 \
  -vf "scale=960:540:flags=lanczos" -c:v libwebp -q:v 72 \
  public/demos/SLUG.webp
```

Choose a poster frame that communicates the chapter before playback. If the three new files push the complete set over 1.25 MB, shorten the clip first, then raise VP9/MP4 CRF slightly. Keep the 8 fps delivery rate unless motion becomes hard to follow.

Check the results:

```sh
ffprobe -v error -show_entries stream=codec_name,width,height -show_entries format=duration,size \
  -of default=noprint_wrappers=1 public/demos/SLUG.webm

du -ch public/demos/* | tail -1
```

## 4. Update the tour

1. Add or edit the chapter in `components/demo/demos.ts`. Keep the slug aligned with all three filenames.
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
