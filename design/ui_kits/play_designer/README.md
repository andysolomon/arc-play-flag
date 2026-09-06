# Play Designer — UI kit

Cosmetic recreation of the one screen in the app (`Flag Football Play Designer.dc.html`): header, Play sidebar, field, Routes sidebar.
Click a player to open the route palette; pick a tile; use Show to filter teams; toggle panels from the header.

Files
- `index.html` — mounts the screen; loads styles.css and the component bundle.
- `Header.jsx` — panel toggles, football + play name, Undo/Redo.
- `PlaySidebar.jsx` — Play / Field / Show tile groups.
- `RoutesSidebar.jsx` — empty state, or the route palette for the selected player.
- `Field.jsx` — turf with ten tokens, laid out from the app's default formation.

Source of truth: the DC template and logic class. Routes are not drawn here; the real app renders them in SVG.
