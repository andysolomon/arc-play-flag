# Flag Football Play Designer

A 5v5 flag-football whiteboard. Drag players on a green field, tap one to give it a route or a run (offense) or a coverage (defense), save plays, and press ▶ to watch the play run: the centre snaps, the QB hands off or throws, and the marked primary read gets the ball 80% of the time (the other drawn receivers share the rest; exported clips always complete to the primary).

Every play starts where every drive does, on your own goal line: yards count down into their end zone, so that is the 40. For a play from midfield, a red-zone play or a conversion, **Line of scrimmage** in Play tools puts that play's ball on the 20, the 10 or the 5: the yard numbers, no-run zones, goal line and end zone move with it, and the spot is saved with the play, so its pictures, printouts and links show the same field.

With the ball in a no-run zone (the 5), the route palette marks its runs with the band's hatching and says why. A run can still be drawn, but a play whose call is a run is flagged: a yellow **RUN IN NO-RUN ZONE** stamp in the backfield of the field and of every thumbnail, share snapshot and printout, "Run in a no-run zone" on its play card and in its playbook, and in the slides' alt text and speaker notes. You're told when a play becomes flagged, however that happens: a run picked, the ball moved onto the 5, the primary read moved onto the runner. A handoff or pitch that ends in a throw (play-action or an option) is a pass and is never flagged, and neither is a league that turns **No-run zones** off.

Saved plays go into **playbooks** (`/playbooks`), which print without any server: wristband inserts (one per position on each play's own side, that route or coverage bold; defenders come tagged LC, LB, R, RC and S, as the offense comes tagged C, QB, X, Y and Z), binder pages (one detailed play per page, or four simple per page), two-sided postcards (two-up with cut lines, or one per 4 × 6 in sheet), a one-page flyer of six featured plays, a slide deck for team meetings (`.pptx`: a title slide, the plays at a glance, then one play per slide with every player's job, and your notes in the speaker notes) that opens in PowerPoint, Keynote and Google Slides, and a playbook file to hand to an assistant coach. The **demo tour** (`/demo`) covers the full workflow in seven short clips, each one focused enough to watch on a phone. PDFs, slide decks and JSON files are written locally and work offline. Every slide is a picture drawn in Patrick Hand, so it looks the same in every app. Slide titles and speaker notes are real text in Arial, and so is anything you type on a slide you add. Creating a short playbook share link explicitly uploads that book as a snapshot; recipients can preview and import it without downloading a file. Individual plays export as `.play.json` files.

Play art draws each play from its own side. A man defender whose receiver isn't in the picture wears an "on X" tag instead of an arrow, and a defensive call is stamped MAN, ZONE or MAN + ZONE, as a Madden play card is. Tick **Offense in play art** (or **Defense in play art**) in Play tools or the share dialog to draw the other team, faded, on that play's thumbnail, share snapshot and printouts.

The app follows the device's light or dark setting. **Theme** in Play tools (or playbook settings) pins Light or Dark on that device. The dark theme is chalk on a dark board; the field, printed pages and exports stay ink on paper in both.

**Team** in Play tools (or playbook settings) is your team's name and colour: the name goes on cards, slides and printed pages and is painted across your end zone; the colour paints the Home Team end zone, the touchdown banner and the exports' accents.

**End zone** in Play tools (or playbook settings) dresses the band past the goal line: Classic keeps the green, and each of the others (Home Team in your team's colour, Synthwave '84, Sakura, Matrix, Great Wave, 8-Bit, Event Horizon, after themes from [Omarchy's collection](https://omarchy.us/themes/)) has its own design, idle animation and touchdown celebration, and letters your team's name in its own hand rather than the words END ZONE, which the band already is. Three are open from the start; every touchdown pass thrown with ▶ by the play's own offense (caught in the end zone, or caught short and carried in; not out the back of it) sets off confetti in that end zone's colours and opens the next. The end zone comes into view with the ball near their goal (**Line of scrimmage**). It is kept on the device, and printed pages and exports keep the classic green.

The design system and functional prototype live in [`design/`](design/readme.md); the app is a faithful port of `design/Flag Football Play Designer.dc.html`.

## Develop

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
bun dev          # http://localhost:3000
bun test         # unit tests for lib/play
bun run build && bun run test:e2e   # browser journeys against the production build (Playwright; see e2e/README.md)
bun run lint     # eslint (typescript-eslint strict)
bun run typecheck
bun run build
bun run icons    # re-encode design/assets/icons → public/icons (already committed)
```

## Deploy

Live at **https://arc-play-flag.vercel.app**. Hosted on Vercel: every push to `main` deploys production; pull requests get preview URLs. Plays still live in `localStorage`. Short-link sharing uses a server-side Upstash Redis store (`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, or the `KV_REST_API_URL`/`KV_REST_API_TOKEN` pair a Vercel Marketplace store injects); local editing and file transfers work without them. See [sharing setup and retention](docs/runbook/sharing.md) and the [architecture decision](docs/adr/001-short-playbook-links.md).

Manual deploy from a machine with the Vercel CLI:

```sh
bunx vercel --prod
```

## Layout

- `app/` — Next.js App Router: the designer (`/`), the playbooks screen (`/playbooks`, one static shell that also shows a single book via `?book=<id>` so it opens offline), the video tour (`/demo`), shared plays (`/p/[id]`), short playbook links (`/s/[token]`), sharing API (`/api/shares`), root layout, `globals.css` with the design tokens in `@theme`.
- `components/` — Header, PlaySidebar, RouteSidebar, Field, PlayerToken, RouteLayer, Hint, PlayThumb; `components/playbooks/` holds the playbook list, book editor and export panel, while `components/demo/` defines the tour chapters and player cards.
- `lib/play/` — pure domain code (routes, geometry, zones, history, storage, library, the derived call) with `bun test` coverage, plus the man tags and coverage stamp (`marks.ts`, `coverage.ts`), which the `man-coverage-art` journey covers. Plays are keyed by a generated id (`ffpd.plays.v2`); the prototype's name-keyed `ffpd.plays.v1` is migrated on first read.
- `e2e/` — Playwright browser journeys (`*.journey.ts`) that drive the production build through the saving, history, playbook, import, sharing and export flows with fictional fixtures; they run on every pull request.
- `lib/endzone.ts` — the end zones, how many touchdown passes open each, and the device's pick and count (`ffpd.endzone.v1`, `ffpd.touchdowns.v1`); `lib/play/touchdown.ts` finds the moment a caught pass crosses the goal line. Each design is `components/endzone/art/<id>.tsx` (its keyframes in the End zones section of `app/globals.css`), and `components/endzone/Celebration.tsx` is the confetti.
- `lib/theme.ts` — the Auto / Light / Dark choice (`ffpd.theme.v1`) and the inline script the root layout runs before first paint, so a dark device never sees a flash of paper. The dark palette itself is the `data-theme="dark"` block in `app/globals.css`.
- `lib/render/` — the play as static SVG markup, drawn from the same geometry as the live field (thumbnails, cards, printed pages).
- `lib/export/` — page composition in points, the zero-dependency PDF writer and `.pptx` writer (`pptx.ts`, with its stored ZIP packer `zip.ts`), the rasteriser, and the wristband, binder, card, postcard, flyer, slides and playbook-file formats. Export code is loaded on demand. `video.ts` records a 4:5 clip from the designer with a 1.5-second formation still, deterministic completed run, and 1.5-second final hold. The play name and selected playbook number stay visible; the browser records WebM or MP4. Keep the tab visible during recording; exports can be cancelled.
- `public/icons/` — the sticker PNGs, pre-optimised (≤ 8 KB each): ink on paper as `<name>.png` and the dark board's chalk version as `<name>-dark.png`, both in the page with the theme picking one (`components/Sticker.tsx`). Sources live in `design/assets/icons` and `icons-dark`; `bun run icons` re-encodes them. Dark sheets from the owner are cut by `scripts/cut-stickers.ts`, and the stickers with no sheet (new, notes, playbook, run routes) are drawn by `scripts/tool-stickers.ts` and `scripts/run-stickers.ts` (run with `node`).
- `public/demos/` — lazy-loaded 960×540 tour clips: WebM first, MP4 fallback, and a WebP poster per chapter. The complete set is kept under 1.7 MB.

See [`DEMO_WORKFLOW.md`](DEMO_WORKFLOW.md) to record, encode, extend, and verify the tour reproducibly.
