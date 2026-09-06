Green field surface with faint 5-yard lines and a heavy line of scrimmage at 74% height; place PlayerTokens absolutely inside.

```jsx
<FieldCard width={420}>
  <PlayerToken team="offense" label="QB" style={{ position: 'absolute', left: '48%', top: '86%' }} />
</FieldCard>
```

- The real app draws the field in SVG; this card is the cosmetic stand-in for mocks and decks.
