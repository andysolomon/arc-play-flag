Single-line pill input; the play name and the player tag are its two uses.

```jsx
<TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Play name" />
<TextInput compact maxLength={3} placeholder="Tag" style={{ width: 58 }} />
```

- No focus ring beyond the ink border; no floating labels. Placeholder text is the label.
