# Play and playbook transfers / short-link setup

## Configure deployment

1. Provision a durable Upstash Redis database for this app. Use a **separate database for previews** so PR deployments cannot read/revoke production snapshots. Select a plan supporting EVAL and REST requests larger than the maximum 4 MB upload (the command/envelope adds overhead). Disable data eviction so stored snapshots remain until revoked/expired; arrange capacity and alerts above the app's 64 MiB value budget plus metadata.
2. Give the route handlers server-only credentials in one of two ways:

   - **Vercel Marketplace (recommended).** Create the store from the project's Storage tab (product `upstash/upstash-kv`) or the CLI, then connect it to the project. Connect the production store to **Production only** and a second store to **Preview only**; the Marketplace injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` (plus `KV_URL`, `REDIS_URL`, and a read-only token the app ignores), and the app reads those names automatically.

     ```sh
     vercel integration-resource connect <production-store> arc-play-flag -e production --yes
     vercel integration add upstash/upstash-kv --name arc-play-flag-preview --plan free \
       -m eviction=false -m autoUpgrade=false -e preview --no-env-pull
     ```

   - **Manual.** Add these variables to the corresponding Vercel environment. They take precedence over the `KV_*` names when both exist.

     | Variable | Value |
     | --- | --- |
     | `UPSTASH_REDIS_REST_URL` | Database HTTPS REST endpoint |
     | `UPSTASH_REDIS_REST_TOKEN` | Write-capable database REST token |

   Never prefix these with `NEXT_PUBLIC_`, commit credentials, or share a production token with the browser. Do not connect one store to both Preview and Production.
3. Redeploy that environment so the route handlers receive the settings. Without configuration, local files still work and link creation explains that sharing is unavailable.
4. Create a fictional playbook, use **Share playbook… → Create link**, and open the link in a fresh browser. Confirm that preview does not write local data, import works, sender edits do not update the snapshot, and the imported book survives reload. Revoke from the original browser and confirm the link is unavailable while the imported copy remains.
5. Verify the same existing link after a redeploy. Check provider availability/capacity alerts. No account or full-library migration is involved.

## Coach workflow

- On **Playbooks**, each saved play has **Export play**, producing `*.play.json`.
- **Import play / playbook…** accepts standalone plays and existing `*.playbook.json` files. Review counts, repairs, and notes, then confirm. Importing a standalone play does not create a book.
- A book's existing **Download playbook file** exports only that book with its referenced plays. Full-device backups remain separate.
- **Share playbook…** shows included plays/notes and an optional team checkbox before creating the hosted snapshot. **Copy link** and **Share link** offer clipboard/native sharing; the URL field is selectable if those APIs are unavailable.
- Open a share link directly or paste it into **Playbook share URL → Preview link**. Local `?book=` URLs are not share links.
- Links expire in 90 days. Sender controls survive reload on the same browser; **Revoke link** stops future access. Clearing that browser's site data loses its revoke controls. It does not delete already imported copies.

## Failure and recovery

429 means the hourly bucket is exhausted. 503 means missing configuration, provider failure, or the 1,000-snapshot/64 MiB capacity cap. File export remains the fallback. Failed upload or local import must not report success. Repeated successful imports reuse unchanged records; conflicting records become copies.

Snapshot keys are `ffpd:share:<token>`. `ffpd:shares` tracks expiry, and `ffpd:shares:sizes` accounts for stored bytes. The create/revoke Lua scripts update all three. Do not delete an individual index independently; for emergency operator removal, delete its snapshot and corresponding sorted-set/hash entries together. Database credential rotation does not invalidate public or revoke tokens; it resets the hashed IP bucket identities. Provider loss/outage cannot be repaired from localStorage on another device; retain local/file backups.

Rollback changes the Vercel deployment, not Redis data. An older build will not support `/s/`; restore a compatible build to serve existing links. Do not flush production Redis when rolling back. Version 1 snapshots must remain readable across releases until their retention window ends.

## Local / CI verification

Normal file tests need no backend:

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun test
bun run build
```

For API and short-link browser tests, start an **isolated disposable Redis** on loopback (the API suite flushes database 15). With Docker, for example:

```sh
docker run --rm -p 6397:6379 redis:7-alpine
```

In another terminal:

```sh
SHARING_TEST_REDIS_URL=redis://127.0.0.1:6397/15 bun test
SHARING_TEST_REDIS_URL=redis://127.0.0.1:6397/15 \
UPSTASH_REDIS_REST_URL=http://127.0.0.1:3134 \
UPSTASH_REDIS_REST_TOKEN=fixture-only \
bun run test:e2e
```

Playwright starts both the test-only REST bridge and the production Next server. The bridge executes actual Redis commands/Lua; it is never imported by production code. CI supplies a disposable Redis service in each job. Without the test Redis variable, API integration and the hosted-link browser journey are explicitly skipped. The standard file, backup, legacy-link and offline tests still run. Local browser verification can use an installed Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; CI uses the pinned Playwright browser.
