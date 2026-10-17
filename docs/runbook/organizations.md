# Organizations: database setup

Organizations ([ADR 013](../adr/013-organizations.md)) keep their teams, memberships and invites in Postgres; a coach's own teams and the share links stay in the Redis of the [accounts](accounts.md) and [sharing](sharing.md) runbooks, and so does who-is-where presence. Without a database the app says organizations aren't set up and everything else works, so a fork or a preview deploys fine without one.

## Configure the database

1. Make a Postgres database. On Vercel, **Neon** from the Marketplace is the natural pick; any Postgres 14+ works. Use the **pooled** connection string when there is one: the app opens few connections and never prepares statements, which a transaction pooler needs.
2. Add it to the Vercel environment, production and preview each with a database of their own:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `postgres://user:password@host/db?sslmode=require`; server only |

   Accounts must be on too (the Clerk keys and the Redis store): organizations are a layer over them.
3. Apply the migrations, once per database, from a machine with the connection string:

   ```sh
   DATABASE_URL=… bun run db:migrate
   ```

   `db/migrations/*.sql` apply in name order, each once, each in its own transaction, remembered in a `migrations` table; running it again applies only what is new. Run it before deploying a change that adds a migration.
4. Redeploy. `GET /api/orgs` answers `{"mode":"on","orgs":[]}` for a signed-in coach; signed out it is a 401, and without the database `{"mode":"off"}`.

## What is stored, where

- `orgs`, `memberships` (role, the teams a member sees, heads and assists), `invites` (a link until it expires, or one email address, lower-cased), `org_teams` (settings and lineups as JSON, the write count `rev`), `org_plays` and `org_books` (one row each, the record as JSON, the rev it last changed at, who made and changed it and when by their own clock, and `deleted` for a tombstone). An organization's deletion cascades to all of it.
- Presence is `ffpd:presence:<team>` in Redis, a hash of coach → where they are, entries older than 30 seconds ignored, the key expiring after two minutes idle.
- Caps: 10 organizations per coach, 50 members and 24 teams per organization, 20 open invites, invites expire in 7 days, tombstones are swept after 30 days, a play or book is at most 256 KB and a team's settings and roster 1 MB; a team holds up to 1,000 plays and 1,000 playbooks, as an account's does.
- Rate limits: every request but the poll counts against the account's buckets (600 writes and 1,200 reads an hour). The poll has its own, 90 a minute per coach per team, in Redis; a Redis that is down limits nothing and shows nobody, and the poll still answers from the database.

## Failure and recovery

- **503** is a missing or unreachable database. The device keeps working on its copy; nothing is half-written, since every change is one transaction.
- **A move that half happened** (the team is in the organization and still in the account): the next "move" of that team finds it in the organization and only finishes the delete from the account.
- **A coach who lost access** (removed, or the organization deleted) keeps a read-only copy on their device and gets 404 on every request for the team; nothing of theirs outside the organization changes.
- **Operator removal**: `delete from orgs where id = …` takes the organization and everything in it; `delete from memberships where org = … and coach = …` removes one coach. Presence needs nothing: it expires.
- **Rotating Clerk keys** signs everyone out and changes nothing here: memberships are keyed by Clerk's stable user id.

## Local and CI verification

The organization journey drives the API as the fixture coaches (`ACCOUNT_FIXTURE=1`, never on Vercel) against the disposable Redis adapter of the sharing journeys and a disposable Postgres on the loopback; `playwright.config.ts` migrates it in its global setup when `DATABASE_URL` is set.

```sh
redis-server --port 6379 --save "" &
export SHARING_TEST_REDIS_URL=redis://127.0.0.1:6379/15 UPSTASH_REDIS_REST_URL=http://127.0.0.1:3134 UPSTASH_REDIS_REST_TOKEN=fixture-only
export DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres
bun run build && bunx playwright test e2e/journeys/organization.journey.ts --project=chromium
```
