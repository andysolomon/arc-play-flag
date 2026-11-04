# Local PostgreSQL and Redis

Production runs on Vercel with managed PostgreSQL and Redis. Docker Compose supplies only the local services, using the same major versions as CI (PostgreSQL 18 and Redis 7). PostgreSQL matches the managed Neon databases. Run the app with Bun on the host.

## Develop with organizations

Install Bun 1.4+ and Docker with Compose, and make sure `docker info` succeeds as your user. Then:

```sh
bun install --frozen-lockfile
bun run dev:local
```

The launcher waits for PostgreSQL and Redis to be healthy, applies migrations, starts the local Redis HTTP adapter, and runs Next.js bound to `127.0.0.1:3000`. Sign in at `/sign-in` as a fictional coach to try organizations without Clerk credentials. This mode is for local development: the fixture accounts and Redis adapter are never production services.

On this machine, publish the app over Tailscale to view it from another device:

```sh
tailscale serve --bg --https=8444 http://127.0.0.1:3000
```

Open `https://omarchy.tail1b9428.ts.net:8444`. Next.js allows the `.ts.net` development origin. Port 443 belongs to T3 Code and 8443 to the SICP book. Remove this forward when finished with `tailscale serve --https=8444 off`.

Ctrl+C stops the app and HTTP adapter. The local databases remain available and their data survives container restarts. Stop the containers with `bun run services:down`; start just the services with `bun run services:up`.

Defaults:

| Service | Host address |
| --- | --- |
| PostgreSQL | `postgres://postgres:local-only@127.0.0.1:55432/arc_play_flag` |
| Redis | `redis://127.0.0.1:56379/15` |
| Redis HTTP adapter | `http://127.0.0.1:3134`, token `fixture-only` |

All service ports bind to loopback. The password and fixture token above are local-only values. `dev:local` overrides inherited database and Redis URLs and disables Clerk so an existing shell configuration cannot direct fixture writes to hosted services. It does not modify `.env.local`.

`LOCAL_POSTGRES_PORT` and `LOCAL_REDIS_PORT` override the published ports. Use the same overrides for startup and shutdown. The development Compose project is `arc-play-flag-local`, shared by this repository's worktrees.

## Repeat the organization journeys

```sh
bunx playwright install chromium # first time only
bun run test:e2e:local
```

This starts a separate Compose project named `arc-play-flag-e2e-<pid>`, on ports 55433 (PostgreSQL) and 56380 (Redis), builds the production app, and runs the existing organization journey on desktop, phones and tablet. Playwright migrates the test database in its global setup. The launcher sets CI mode so Playwright refuses to reuse an unrelated app or adapter, and removes only this run's containers and volumes afterward, including on failure or Ctrl+C. Local development records are untouched. The app and Redis adapter ports (3123 and 3134) must be free; stop `dev:local` before running journeys.

Pass a narrower selection or another journey explicitly:

```sh
bun run test:e2e:local e2e/journeys/organization.journey.ts --project=chromium
bun run test:e2e:local e2e/journeys/account.journey.ts --project=chromium
```

Inspect the repeatable evidence in `test-results/organization-*.json`, screenshots in `test-results/`, and `playwright-report/index.html`. `bun run test:e2e:report` opens the report. CI continues using GitHub Actions' disposable service containers; it does not need Docker-in-Docker or a hosted database.

## Troubleshooting

- If Docker reports permission denied for its socket, configure your user's Docker access or use a session that already has it. The launcher does not change system permissions or run the app as root.
- If a service port is occupied, set `LOCAL_POSTGRES_PORT` and `LOCAL_REDIS_PORT` to unused ports. Parallel E2E runs still require separate app/adapter ports, which the existing suite fixes at 3123/3134.
- If the process is forcibly killed before cleanup, list projects with `docker compose ls`. Remove only the abandoned test project with `docker compose --project-name arc-play-flag-e2e-<pid> down --volumes` from this repository.
- To deliberately erase local development data, run `docker compose down --volumes`. Ordinary `services:down` preserves it.
