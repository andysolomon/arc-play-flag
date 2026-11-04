# Infrastructure verification — November 3, 2026

## Repeatable local verification

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run test:e2e:local
```

Verified against PostgreSQL 18 and Redis 7 in disposable Docker Compose containers: **11 passed, 9 intentionally skipped, 0 failed** (39.3 seconds for Playwright). The API cases run once on desktop; the screen journeys also run on Pixel 7, iPhone 15 and iPad. Each test's evidence is retained in `test-results/organization-*.json` with screenshots beside it and the HTML report in `playwright-report/`. All test containers, volumes and their network were removed after the run.

The journeys cover organization ownership and invitations, head/assistant/viewer permissions, two coaches changing different plays, conflicting edits preserved as sideline versions, polling and presence, removal of access, and deletion that leaves personal teams intact.

The full PR suite exposed two end zone journeys whose setup still relied on a saved play moving the board's ball spot. Updated both to seed the board setting explicitly, as ADR 015 requires. Both complete journey files then passed across all four device projects: **32 passed** (51.9 seconds), with the assertions unchanged. Repeat with `bunx playwright test e2e/journeys/offline.journey.ts e2e/journeys/switching.journey.ts --workers=2` after a production build. `test-results/offline-end-zones-*.json` records the board spot, every design drawn offline, cached chunks and failed requests; screenshots accompany it. CI uploads this evidence as `offline-end-zones`, alongside the existing `switching` evidence.

`bun run lint`, `bun run typecheck`, the production build, `docker compose config --quiet`, `terraform fmt -check infra`, and backend-free Terraform initialization/validation also passed. A local development smoke check reached `/sign-in` and the Redis adapter; terminating the launcher stopped both processes. Development containers were stopped afterward while retaining their volumes.

## Hosted verification

Separate Neon production and preview databases were provisioned in `iad1` on the free plan. Both report PostgreSQL 18.6, use pooled TLS connections, and applied `001-organizations.sql`. A second migration run on each reported zero new migrations. No fixture coaches or test records were written to either hosted database.

Production deployment `dpl_7ZSYLaMzt8zkQ3u22veJ4iV9YAxs` reached Ready and was aliased to [the app](https://arc-play-flag.vercel.app).

- `GET /` returned 200.
- Signed-out `GET /api/orgs` returned 401.
- `POST /api/account/fixture` returned 404: fixture sign-in is disabled on Vercel.
- A valid-format, nonexistent invite token returned the expected expired-invite response, exercising the configured PostgreSQL store.

These are production smoke checks. Full signed-in multi-coach behavior is covered by the disposable local journeys, not by production fixture writes.

## Terraform

The provider is pinned and its lockfile is included. After receiving an HCP user token privately and confirming the organization with the user, created [`natgeo_andysolomon / arc-play-flag-infrastructure`](https://app.terraform.io/app/natgeo_andysolomon/workspaces/arc-play-flag-infrastructure), workspace ID `ws-jQi2rgqkxuSzp7un`, in local execution mode with shared state in HCP.

The authenticated HCP plan reported **1 to import, 0 to add, 0 to change, 0 to destroy**. Applied that exact saved plan: **1 imported, 0 added, 0 changed, 0 destroyed**. A subsequent plan with `-detailed-exitcode` returned 0 and reported **No changes**. `terraform state list` returned exactly `vercel_project.app`. A credential-free summary is in `test-results/infrastructure-terraform-plan.json`.

The organization and workspace are recorded in `infra/main.tf`. Tokens were supplied only to CLI processes; credentials and state are not stored in repository files. The native Vercel Marketplace integration continues to own Neon resources and their generated connection variables.
