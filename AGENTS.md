# Agent guidelines

## Testing

- Never write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, first write down all the ways it could fail, then write the code.

The E2E suite is the Playwright browser journeys in `e2e/journeys/*.journey.ts`; see [`e2e/README.md`](e2e/README.md) for how to run them and what they cover.
