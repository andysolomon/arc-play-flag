# ADR 002: playbook slides as a hand-written .pptx

Status: implemented.

## Decision

A playbook exports as a slide deck for team meetings: `<book>-slides.pptx`, written in the browser with no dependency, offline, like the PDFs. PowerPoint, Keynote, Google Slides and LibreOffice Impress all open `.pptx`; Keynote's own `.key` format is proprietary and out of scope.

The deck is a title slide, "Plays at a glance" slides of six plays each (only for two or more plays), then one slide per play in book order, numbered as on the wristbands and binder. A play slide carries the number badge, name and call pill, the detailed field with route names and the primary-read star, a "who does what" panel with every player on the play's side left to right, and the coach's notes. There are no options.

**Every slide face is one 1920 × 1080 PNG**, composed as SVG in points by the same helpers as the printed pages (`lib/export/slides.ts`) and rasterised with the self-hosted Patrick Hand face. Only Google Slides renders Patrick Hand as text: PowerPoint substitutes it silently and Keynote shows a missing-font banner. A picture looks the same in every app and never rewraps. Native DrawingML routes would lose the hatching, dashes and label halos, and Google Slides cannot show SVG. 1080p matches a TV or projector pixel for pixel, costs about 200 KB a slide, and keeps a phone to one 8 MB canvas at a time.

**The text is real text where it matters.** Behind each picture sits a title placeholder (`<n> · <name>`, never truncated), so the outline, slide list and screen readers have it; the picture has alt text; every slide has speaker notes with the call, the primary read, the coach's full notes and each player's job (`lib/play/assignments.ts`, shared by the panel, alt text and notes so they never disagree). The package names only Arial (theme fonts), so no app raises a font warning. The master has the paper background and the team strip, so a slide the coach adds matches the deck.

To change a slide, the coach edits the play in the app and exports again.

## The package

`lib/export/pptx.ts` writes one master, one "Title Only" layout, one theme (written again as `theme2` for the notes master), one notes master, and per slide the slide, its picture and a notes slide: 17 + 5n parts, `[Content_Types].xml` first. The fixed parts were validated against the ECMA-376 Transitional schemas, the OPC relationship rules, PowerPoint's id ranges (`sldId` from 256; master and layout ids from 2³¹), python-pptx read-back and a LibreOffice render. `lib/export/zip.ts` stores every entry (method 0): PNGs are compressed already, the XML is small beside them, and there is no DEFLATE branch to fail on a browser without `deflate-raw`. The file is a Blob of chunks, so it is never copied whole into one buffer.

Text from storage or an imported file is cleaned of characters XML forbids (C0 controls, U+FFFE/U+FFFF, lone surrogates) before it is measured, drawn or written (`lib/export/xml.ts`); `rasterise()` strips them from every face too, so no export can fail on a stored control character. The only time input is one `Date`, written as UTC, so the same book on the same clock is the same file.

The failure modes each module guards against are listed in its header comment.

## Validation

`e2e/journeys/slides.journey.ts` downloads a seven-play book on all four device projects and reads the file with an independent reader (`e2e/support/pptx.ts`, which imports nothing from `lib/`): the ZIP structure, every XML part parsed by the browser, content types, relationships, ids and notes links, then every title, alt text and speaker note against the book, hostile text, the picture sizes, and a byte-identical second export. A slide that cannot be drawn, first or mid-deck, reports the failure and downloads nothing. The deck, a manifest of hashes and every slide face are kept in `test-results/slides-<project>.*`, and CI uploads them as `slide-decks`.

Opening the deck in PowerPoint, Keynote, Google Slides and iOS Safari are manual release checks (see `e2e/README.md`): no automated check here runs those apps.

## Left out

- Native editable text on the faces, and embedded fonts: only desktop PowerPoint reads embedded fonts.
- Glance-to-play links, a closing slide, transitions, and options such as 4K or a per-deck play picker (a coach makes a "Meeting" book instead).
- DEFLATE, SVG pictures (`svgBlip`) and JPEG, which smears hairlines.
