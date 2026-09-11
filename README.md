# Flag Football Play Designer

A 5v5 flag-football whiteboard. Drag players on a green field, tap one to give it a route or a run (offense) or a coverage (defense), save plays, and press ▶ to watch the deterministic teaching path: the centre snaps, the QB hands off or throws, and the call follows the marked primary read (or the first drawn receiver when no read is marked).

Saved plays go into **playbooks** (`/playbooks`), which print without any server: wristband inserts (one per position, that route bold), binder pages (one detailed play per page, or four simple per page), a 4:5 picture card of any play, two-sided postcards (two-up with cut lines, or one per 4 × 6 in sheet), a one-page flyer of six featured plays, and a playbook file to hand to an assistant coach. The **demo tour** (`/demo`) covers the full workflow in five short clips. PDFs are written by a small in-repo writer; nothing is uploaded and it all works offline.

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

Live at **https://arc-play-flag.vercel.app**. Hosted on Vercel: every push to `main` deploys production; pull requests get preview URLs. No environment variables are needed: the app has no backend, plays live in `localStorage`.

Manual deploy from a machine with the Vercel CLI:

```sh
bunx vercel --prod
```

## Layout

- `app/` — Next.js App Router: the designer (`/`), the playbooks screen (`/playbooks`, one static shell that also shows a single book via `?book=<id>` so it opens offline), the video tour (`/demo`), shared plays (`/p/[id]`), root layout, `globals.css` with the design tokens in `@theme`.
- `components/` — Header, PlaySidebar, RouteSidebar, Field, PlayerToken, RouteLayer, Hint, PlayThumb; `components/playbooks/` holds the playbook list, book editor and export panel, while `components/demo/` defines the tour chapters and player cards.
- `lib/play/` — pure domain code (routes, geometry, zones, history, storage, library, the derived call) with `bun test` coverage. Plays are keyed by a generated id (`ffpd.plays.v2`); the prototype's name-keyed `ffpd.plays.v1` is migrated on first read.
- `e2e/` — Playwright browser journeys (`*.journey.ts`) that drive the production build through the saving, history, playbook, import, sharing and export flows with fictional fixtures; they run on every pull request.
- `lib/render/` — the play as static SVG markup, drawn from the same geometry as the live field (thumbnails, cards, printed pages).
- `lib/export/` — page composition in points, the zero-dependency PDF writer, the rasteriser, and the wristband, binder, card, postcard, flyer and playbook-file formats. Export code is loaded on demand. `video.ts` records a 4:5 clip from the designer with a 1.5-second formation still, deterministic completed run, and 1.5-second final hold. The play name and selected playbook number stay visible; the browser records WebM or MP4. Keep the tab visible during recording; exports can be cancelled.
- `public/icons/` — the sticker PNGs, pre-optimised (≤ 8 KB each). New tool stickers are drawn by `scripts/tool-stickers.ts` (run with `node`).
- `public/demos/` — lazy-loaded 960×540 tour clips: WebM first, MP4 fallback, and a WebP poster per chapter. The complete set is kept under 1.25 MB.

See [`DEMO_WORKFLOW.md`](DEMO_WORKFLOW.md) to record, encode, extend, and verify the tour reproducibly.
