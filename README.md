# Flag Football Play Designer

A 5v5 flag-football whiteboard. Drag players on a green field, tap one to give it a route (offense) or a coverage (defense), save plays, export a PNG.

The design system and functional prototype live in [`design/`](design/readme.md); the app is a faithful port of `design/Flag Football Play Designer.dc.html`.

## Develop

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
bun dev          # http://localhost:3000
bun test         # unit tests for lib/play
bun run lint     # eslint (typescript-eslint strict)
bun run typecheck
bun run build
bun run icons    # re-encode design/assets/icons → public/icons (already committed)
```

## Deploy

Hosted on Vercel. Every push to `main` deploys production; pull requests get preview URLs. No environment variables are needed: the app has no backend, plays live in `localStorage`.

Manual deploy from a machine with the Vercel CLI:

```sh
bunx vercel --prod
```

## Layout

- `app/` — Next.js App Router: one static route (`/`), root layout, `globals.css` with the design tokens in `@theme`.
- `components/` — Header, PlaySidebar, RouteSidebar, Field, PlayerToken, RouteLayer, Hint.
- `lib/play/` — pure domain code (routes, geometry, zones, history, storage) with `bun test` coverage.
- `public/icons/` — the 32 sticker PNGs, pre-optimised (≤ 8 KB each).
