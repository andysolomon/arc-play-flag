# Hosted infrastructure

The app stays on Vercel. PostgreSQL is managed by the Neon native Marketplace integration; Redis and Clerk keep their existing responsibilities. Organizations share tables in their environment's database, scoped by organization and team IDs. Creating an organization inserts rows; it never provisions infrastructure.

## Current resources

Provisioned November 3, 2026 under Vercel team `andrewsolomonedus-projects` (`team_1h9Xca1fcyThRFdpK9runicq`), project `arc-play-flag` (`prj_E2RpFSkEDMnfpXuhUfISNTUzBuaf`):

| Environment | Neon resource | Marketplace ID | Region | Plan |
| --- | --- | --- | --- | --- |
| Production | `arc-play-flag-production` | `store_aFu3pqlvclfRbcEK` | `iad1` | `free_v3` |
| Preview | `arc-play-flag-preview` | `store_yh8aYVLLyAaByEpn` | `iad1` | `free_v3` |

Both databases run PostgreSQL 18, matching Compose and CI. Neon auth and realtime are disabled: Clerk handles sign-in, and the app already implements synchronization. The integration owns the generated connection variables, including `DATABASE_URL`. Production is connected only to the production resource, and preview only to the preview resource. Preview deployments share the preview database; per-PR database isolation is not configured. Local development uses Docker Compose.

To inspect these resources without printing credentials:

```sh
vercel integration list arc-play-flag
vercel integration resource inspect arc-play-flag-production
vercel integration resource inspect arc-play-flag-preview
```

The resources were created with the following commands. These are a provisioning record, **not** idempotent update commands; do not rerun them to manage an existing database:

```sh
vercel integration add neon --name arc-play-flag-production --plan free_v3 --metadata region=iad1 --metadata auth=false --metadata realtime=false --environment production --no-env-pull
vercel integration add neon --name arc-play-flag-preview --plan free_v3 --metadata region=iad1 --metadata auth=false --metadata realtime=false --environment preview --no-env-pull
```

Apply SQL migrations separately using `bun run db:migrate`, with the correct environment's connection string. See [organizations](../docs/runbook/organizations.md) for deployment and recovery. Provisioning database resources and connecting variables do not update an existing deployment: deploy a new build to use them.

## Terraform with HCP shared state

`main.tf` adopts the existing Vercel project using a declarative import. It records the repository, production branch and Node.js version, pins the provider, and prevents Terraform from destroying the project. SQL migrations and Git-driven application deployments remain separate.

Shared state is initialized in [`natgeo_andysolomon / arc-play-flag-infrastructure`](https://app.terraform.io/app/natgeo_andysolomon/workspaces/arc-play-flag-infrastructure), workspace ID `ws-jQi2rgqkxuSzp7un`. It uses **Local** execution mode: Terraform runs on your machine, while HCP stores state and handles locking. The organization and workspace are recorded in `main.tf`. The existing Vercel project has been imported; the post-import plan reports no changes.

For a new CLI session, authenticate with `terraform login`; supply `VERCEL_API_TOKEN` through your shell's secret manager. Do not put either token in `.tf` files or committed variable files.

```sh
terraform -chdir=infra init
terraform -chdir=infra plan
```

An unchanged checkout should produce a plan with no changes. Check any proposed updates against the current Vercel settings before applying the reviewed plan. The import block can stay: it has no effect when that resource is already in state. No Terraform apply is needed to deploy the application or run migrations.

To validate configuration without HCP access or creating production state:

```sh
terraform fmt -check infra
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
```

Do not commit credentials, plan files or state. Terraform state may contain credentials even when output values are marked sensitive. Keep the included provider lockfile in version control for repeatable installation.

The native Marketplace integration currently provisions and owns the Neon resources and their generated Vercel variables. Do not also manage those variables with Terraform. Neon's community Terraform provider requires separate Neon API access; Vercel's authenticated CLI is not that credential. Confirm how the native resources can be adopted before introducing that provider.

References: [Vercel Terraform](https://vercel.com/kb/guide/integrating-terraform-with-vercel), [Neon Terraform](https://neon.com/docs/reference/terraform), [Terraform state](https://developer.hashicorp.com/terraform/language/state).

Kubernetes is deferred. The current app has no requirement for a cluster.
