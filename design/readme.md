# Flag Football Play Designer — Design System

A single-product design system for the **Flag Football Play Designer**, a 5v5 flag-football whiteboard: drag players on a green field, tap one to hand them a route or a coverage, save and export the play. The app itself lives at the project root as `Flag Football Play Designer.dc.html` and is the source of truth for every value here.

Sources
- `Flag Football Play Designer.dc.html` — the live app (template + logic). All colors, sizes, radii, shadows and copy were lifted from it.
- `uploads/ChatGPT Image … .png` — three icon sheets (offense routes, defense coverages, play/field tools) plus an Export sheet, supplied by the owner and cut into `assets/icons/*.png`.
- No Figma, no repository, no brand guide. No logo exists; the football sticker stands in for a mark.

## Content fundamentals

- **Voice:** a coach at a whiteboard. Short imperative sentences, second person, present tense. "Tap a player to give them a route." "Cover who? Tap a red player."
- **Casing:** sentence case everywhere — "Clear routes", "Zone deep", "Pick a coverage". The only uppercase is the 13px eyebrow that heads a sidebar group (PLAY, FIELD, SHOW, ROUTES).
- **Length:** tile labels are 1–2 words; hints are one sentence; there are no paragraphs.
- **Football words are used plainly:** LOS, no-run zone, end zone, QB, blitz, spy. Players are "red" and "blue" when pointing at the field.
- **No emoji.** Unicode arrows and stars are allowed as glyphs inside buttons: ↶ ↷ ⇄ ★ ☆ ‹ ›.
- **No warnings, no confirmations.** Destructive actions (Clear, Reset) are undoable, so they just happen. Nothing says "Are you sure?"
- Helper copy explains scope in one line: "Clear and reset only touch the team you're showing."

## Visual foundations

- **Mood:** a hand-drawn playbook — paper, black marker ink, one yellow highlighter, sticker icons. Fun, not childish; every line is crisp.
- **Color:** warm parchment page (`--paper #f4efe2`), cream panels (`--cream #fffdf6`), white controls, near-black ink (`--ink #1b1a17`) for all text and borders. One accent: highlighter yellow (`--yellow #f2b705`) means *selected / active*; its soft cousin (`--yellow-soft`) is hover. Offense is red, defense is blue, turf is mint green. Route inks are a small set of dark hues chosen for ≥4.5:1 on turf. No greys in borders; muted text is warm (`--ink-muted #6f6c66`).
- **Type:** one family, Patrick Hand, regular weight only, at 13–20px in the UI (17px yard numbers on the field). Hierarchy comes from size and casing, never weight. Line-height 1.1 for labels, 1.35 for helper copy.
- **Borders:** 2px solid ink on every control; 2.5px on player tokens; 3px on the field card. Dividers are ink at 14% opacity.
- **Radii:** pills (999px) for text controls and inputs; 14px for icon tiles, empty states and notes; 7px for the field card; circles for players.
- **Shadows:** hard, zero-blur offsets in ink at ~14%: tiles 0 3px, toasts 0 4px, the field 0 7px. Nothing glows or blurs.
- **Backgrounds:** flat fills only. The field has a 45° hatched no-run band and a darker end-zone strip. No gradients, no photography, no textures.
- **Spacing:** 4/6/8/10/12/14/18px. Sidebars are 264px wide with 14px 12px padding and a 10px stack gap; tile grids are 3-up with an 8px gap; the header is 6px 12px.
- **Layout:** fixed header, two collapsible sidebars (width animates 180ms ease), the field fills the middle and is letterboxed to its aspect. Hints float centred under the header as an ink pill.
- **Hover:** tiles lift 2px (`translateY(-2px)`); pills turn soft yellow; dark buttons go to `--ink-2`. **Press:** no extra state. **Disabled:** `--paper-2` fill, `--ink-faint` text.
- **Motion:** playful and short — *boing* (360ms, overshoot cubic-bezier(.34,1.56,.64,1)) when a player is dropped; *pulse* ring (1.25s loop) on the selected player; routes *draw* on in 320ms ease-out; panels slide in 180ms.
- **Transparency/blur:** none, apart from the 14% divider and the 75% empty state.
- **Cards:** cream or white, ink border, 14px radius, hard shadow. A dashed ink border marks an empty state.

## Iconography

- Icons are **PNG stickers** with transparent backgrounds, 192×192px, shown at 40px in tiles, 26px in the header, 56px in the empty state. They were cut from owner-supplied sheets; there is no icon font, no SVG set, no emoji.
- Style: thick black outlines, flat red/blue fills, light-blue zone blobs, hand-drawn feel — matching Patrick Hand.
- Naming mirrors the app's route keys: `go out in slant corner post curl flat cross wheel handoff customOff deselectOff` (offense), `man zoneDeep zoneFlat curlFlat midRead blitz spy customDef deselectDef` (defense), `football save duplicate export flip clear reset offOnly defOnly` (tools).
- Missing glyphs: Undo/Redo, panel toggles and Mirror/Primary use unicode (↶ ↷ ‹ › ⇄ ★ ☆). Ask the owner for stickers if these need to match.
- Never draw new icons by hand; request a sticker in the same style.

## Intentional additions

- `TileGrid` — the 3-column wrapper IconTiles always live in.
- `FieldCard` — an HTML stand-in for the SVG field, for mocks and decks only.
- `Note` — the yellow in-panel hint, split out from Toast because the app renders both.

## Index

- `styles.css` → `tokens/fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `effects.css`
- `assets/icons/` — 32 sticker PNGs
- `guidelines/` — specimen cards: colors (surfaces, accent, teams, routes), type (family, scale), spacing, borders/shadows, motion, icons (offense, defense, tools), brand (voice, mark)
- `components/core/` — Button, IconTile + TileGrid, SectionLabel + Divider
- `components/forms/` — TextInput, Select
- `components/feedback/` — Toast + Note, EmptyState
- `components/field/` — PlayerToken, FieldCard
- `ui_kits/play_designer/` — click-through recreation of the designer screen
- `SKILL.md` — agent entry point
- Fonts: Patrick Hand is loaded from Google Fonts; no binaries were supplied.
