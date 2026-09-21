# ADR 001: versioned transfers and hosted playbook snapshots

Status: implemented for issue #66.

## Decision

Keep editing and the library in localStorage. A standalone `ffpd.play` v1 file contains one complete saved play; existing `ffpd.playbook` v1 files keep their current shape. A single reader/planner handles files and hosted snapshots. Preview/confirmation precedes persistence. Repeated unchanged imports reuse records, including copies previously created for ID conflicts. Book references follow the resulting IDs. Legacy recovery files and device backups remain supported.

Short links use `/s/<16 random base64url characters>` (96 bits). Production URLs are 49 characters, regardless of play count. JSON stays in durable Redis, accessed through Next route handlers and the Upstash HTTPS REST API. Compression inside a URL cannot give a size-independent short link; browser-local IDs cannot transfer data between devices.

A link is an immutable snapshot, not synchronization. A recipient explicitly imports an independent local copy. A changed sender book needs a new link. File transfer remains fully offline. Hosted links require connectivity and are never cached by the service worker or API; already imported books remain available offline. Existing payload-based `/p/` links continue to work.

## Retention, access and limits

Anyone possessing the public link may read/import it. No account is required. The upload preview states that both teams' routes and notes are included; team name/colour is opt-in. Only the selected book and referenced plays are published. Public responses contain no management credential.

Each snapshot expires 90 days after creation. A separate random 192-bit revoke capability is returned only to its creator and saved in `ffpd.shares.v1` in that browser. Redis stores its SHA-256 digest. Revocation is authorized by that capability and atomically deletes the snapshot. Losing site data loses management capabilities; expiry still applies. Revocation cannot erase already imported copies. Capabilities are excluded from device backup and transfer formats. Treat browser access as access to local management controls.

Server-side stream limits enforce 4,000,000 UTF-8 bytes and at most 500 plays. Invalid, future-version, normalized, missing-reference or unrelated-play uploads are refused before storage. File imports retain legacy normalization, but disclose repairs/skips and preview the result. Schema reading excludes unknown uploaded top-level fields.

Atomic Lua scripts implement create-if-absent with collision retries, a maximum of 1,000 active snapshots, and a 64 MiB aggregate stored-value budget. The budget includes the JSON envelope, not Redis metadata. Expired capacity is reclaimed on subsequent creates; revocation frees capacity immediately. Each request performs a Redis rate check: 20 create/revoke attempts and 600 reads per hour per hashed Vercel client IP. Outside Vercel there is a single shared bucket; configure a trusted ingress before using another production host. Vercel's `x-vercel-forwarded-for` is used only when its system `VERCEL` flag is set. No raw IP is stored in rate-limit keys. These limits are an initial service budget, not an abuse-proof public publishing platform; configure provider spend/traffic alerts.

## Operations

See [sharing runbook](../runbook/sharing.md). The REST transport has a 10-second timeout and returns explicit unavailable states on missing configuration/provider failure; it never falls back to process-memory storage. Secrets stay server-side. APIs use `no-store`, noindex and no-referrer; share pages are noindex/no-referrer. Diagnostics scrub both share and management tokens. Hosting access logs can contain public share paths, so restrict log access/retention.

No provider package is added to the shipped app. The adapter follows [Upstash's command-array REST protocol](https://upstash.com/docs/redis/features/restapi), including EVAL. Client-IP behavior follows [Vercel request headers](https://vercel.com/docs/headers/request-headers).

## Validation

Unit tests exercise standalone and book round-trips, order, metadata, conflict reuse, UTF-8 bounds, invalid versions and repair disclosure. Integration tests run the production route handlers and Lua against disposable real Redis through a test-only REST adapter. They cover independent app connections, revocation authorization, expiry, count/byte limits, rate limits and a 500-play snapshot. CI provisions Redis for both unit/API tests and browser journeys. Browser journeys cover two isolated contexts, confirmation/cancel, storage failure, file transfer, short-link import, persistence and revocation.

Physical iPad/iPhone Safari verification and actual production Redis provisioning remain deployment checks; browser viewport tests do not certify physical devices.
