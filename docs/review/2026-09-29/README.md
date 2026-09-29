# Coach-workflow review — 2026-09-29

Exploratory browser test of the whole coaching workflow, driven with Playwright the way a coach uses the app.

**Build under test:** `a4fc2014` (`main`), the same commit Vercel production (`dpl_Bss7Chsmn7z6g9Kus73hMXukAntA`) was serving. The sandbox could not open the Vercel URL in Chromium, so the production build was served locally with `next start` plus a disposable Redis (the repo's `e2e/support/redis-rest.ts`), as the journeys do. The four playbook share links were then created on production by replaying the exact snapshots the app uploaded, and each was read back from production.

## What was exercised

| Area | Result |
| --- | --- |
| 18 plays built through the UI (drags, 17 preset routes/runs, 3 custom routes, man/zone/blitz/spy, primary reads, notes, line of scrimmage) | All stored exactly as entered |
| 4 playbooks: 2 offense × 5 plays, 2 defense × 4 plays | Created, ordered, persisted |
| Team name + colour | Painted on end zones, slides, prints |
| Exports × 4 books: wristbands, binder (1-up and 4-up), postcards, flyer, slides `.pptx`, playbook file | 28/28 downloaded and reported "Saved"; decks have titles, alt text and notes |
| Share links (playbooks and single plays) | Created, opened read-only, imported on a second (phone) device |
| Device backup → restore onto an empty device | 18 plays, 4 books, team: lossless |
| Themes: Light, Dark, Tokyo Night, Rosé Pine; print emulation | Work; print stays ink on paper |
| End zones: all 8 unlocked by touchdowns, a TD scored in each | 8/8 celebrate with their own confetti; unlock order correct |
| Phone (390×844), offline reload, delete play, long/emoji names, draft after reload, 7-yard rush rule | Work |
| Demo tour: 7 clips | All load (960×540 WebM); content is out of date (see E5) |

## Findings (screenshots in this folder)

- `E1-stub-routes.png` — preset Out/Corner/Wheel/Flat shrink to stubs from the default X/Y spots
- `E2-defense-wristbands.png` — defensive wristbands are keyed to offensive positions
- `E3-no-run-zone.png` — runs can be designed and saved inside a no-run zone
- `E4-desktop-depth.png` — laptop/desktop designer shows only 16 yards downfield
- `E5-stale-demo.png` — demo tour shows UI that has since changed
- `E6-toast-over-title.png` — UX polish

`scripts/` holds the Playwright scripts (plain Node + `playwright`, `SP` is a scratch directory) and `results/` the JSON each run wrote.
