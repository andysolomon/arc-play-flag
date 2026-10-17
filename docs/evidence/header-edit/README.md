# Duplicate and rename from the main screen

The header's **Duplicate** saves a new play with ` copy` appended and opens that copy for editing. It preserves the current diagram and notes, including changes not yet saved, while leaving the original library record alone.

Tap the title or pencil above the field to rename. Enter or leaving the input finishes editing; Escape restores the name from before editing. Changes use the same draft and Save behavior as Play tools, including Ctrl+S / ⌘S while typing. Roster and shared views keep plain titles.

The header stays on one row with seven controls, each at least 44×44 CSS pixels, at 320, 375, 393, 480, 600, 768 and 810 pixels. A failed duplicate opens the storage warning; **Try again** retries creating a copy.

## Verification

Production build, full ESLint, TypeScript and the Bun suite passed (339 passed, 7 Redis-dependent tests skipped). Merge verification passed 68 browser checks with 12 device-specific skips across desktop, Pixel 7, iPhone 15 and iPad Chromium projects. This covers phone headers, roster Back to play and focus, deep-field sizing, Duplicate, renaming and Save. The field now measures the complete title row so the editable title cannot make the diagram overflow.

Repeat the final browser checks with:

```sh
bun run build
bun run test:e2e e2e/journeys/header-edit.journey.ts e2e/journeys/header-save.journey.ts --workers=2
```

`header-edit` in CI retains screenshots and stored-play/geometry JSON manifests. These projects emulate devices in Chromium; they do not establish real Safari behavior.

The tour was refreshed again after merging the latest main and fixing title sizing. The final complete set passed coverage, duration, codec, resolution and size checks at 1,869,936 bytes, below the unchanged 2 MB limit. Every published clip comes from this complete set. Earlier capture results and the merge follow-up are recorded in the validation summary. The recorder uses CRF 53/38 and longer reading pauses in the league rules and wristband chapters.

## Screenshots

Dark phone layout and inline rename:

![Duplicate in the dark phone header](iphone-dark.png)

![Editing the play name above the field](iphone-rename.png)

Phone at 320 CSS pixels, with a long name:

![320px header and editable title](phone-320.png)

iPad portrait, after duplicating, renaming, saving and reloading:

![iPad header and renamed copy](ipad.png)
