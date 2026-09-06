Icon-led action or option tile (route picker, play tools, Show filter); always inside a TileGrid, 3 across in a 264px sidebar.

```jsx
<TileGrid>
  <IconTile icon="assets/icons/go.png" label="Go" active onClick={pick} />
  <IconTile icon="assets/icons/out.png" label="Out" />
  <IconTile icon="assets/icons/deselectOff.png" label="Done" />
</TileGrid>
```

- Labels are one or two short words at 14px; they may wrap to two lines.
- Icons are 40px PNG stickers with transparent backgrounds — never inline SVG or emoji.
- Hover lifts the tile 2px; the hard 3px shadow stays put.
