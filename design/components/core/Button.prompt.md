Pill-shaped text button with a 2px ink border; use for every text action (Save, Undo, Mirror route). Never for icon-led actions — that is IconTile.

```jsx
<Button onClick={save}>Save</Button>
<Button variant="active">Both</Button>
<Button variant="dark">Export PNG</Button>
<Button size="sm" disabled>Redo ↷</Button>
```

- Hover turns the fill soft yellow (`--yellow-soft`); active is full yellow. Dark hovers to `--ink-2`.
- One dark button per panel at most.
- Unicode arrows (↶ ↷ ⇄) are fine inside the label; no emoji.
