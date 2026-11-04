/**
 * Local development and browser journeys with real PostgreSQL and Redis.
 * Failure cases considered before implementation:
 * - Docker is unavailable or a port is busy: fail before migrating or starting the app.
 * - A shell contains production credentials: replace database/Redis URLs and disable Clerk.
 * - Journeys overwrite a developer's records: use a separate Compose project and ports.
 * - A build/test fails or is interrupted: stop child processes and remove only the test volumes.
 * - A developer stops the app: keep their local service volumes for the next session.
 * - A test server is already running: CI mode prevents Playwright silently reusing it.
 * Existing organization journeys verify permissions, concurrent writes and offline conflicts,
 * and leave JSON/screenshot evidence in test-results/.
 */
import { resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "e2e") {
  console.error("Usage: bun scripts/local-services.ts dev|e2e [Playwright arguments]");
  process.exit(1);
}
const testing = mode === "e2e";
const root = resolve(import.meta.dir, "..");
const project = testing ? `arc-play-flag-e2e-${String(process.pid)}` : "arc-play-flag-local";
const postgresPort = process.env.LOCAL_POSTGRES_PORT ?? (testing ? "55433" : "55432");
const redisPort = process.env.LOCAL_REDIS_PORT ?? (testing ? "56380" : "56379");
for (const port of [postgresPort, redisPort]) {
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Local service ports must be between 1024 and 65535");
}
const env = {
  ...process.env,
  LOCAL_POSTGRES_PORT: postgresPort,
  LOCAL_REDIS_PORT: redisPort,
  DATABASE_URL: `postgres://postgres:local-only@127.0.0.1:${postgresPort}/arc_play_flag`,
  SHARING_TEST_REDIS_URL: `redis://127.0.0.1:${redisPort}/15`,
  UPSTASH_REDIS_REST_URL: "http://127.0.0.1:3134",
  UPSTASH_REDIS_REST_TOKEN: "fixture-only",
  ACCOUNT_FIXTURE: "1",
  CLERK_SECRET_KEY: "",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  VERCEL: "",
  VERCEL_ENV: "development",
  ...(testing ? { CI: "1" } : {}),
};
const compose = ["docker", "compose", "--file", resolve(root, "compose.yaml"), "--project-name", project];
const children = new Set<ReturnType<typeof Bun.spawn>>();
let interrupted = false;
let started = false;

async function run(command: string[]): Promise<number> {
  const child = Bun.spawn(command, { cwd: root, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  children.add(child);
  try { return await child.exited; }
  finally { children.delete(child); }
}

async function requireSuccess(command: string[]): Promise<void> {
  const code = await run(command);
  if (code !== 0) throw new Error(`${command[0] ?? "command"} exited with ${String(code)}`);
  if (interrupted) throw new Error("Interrupted");
}

function stop(): void {
  interrupted = true;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

let exitCode = 0;
try {
  await requireSuccess(["docker", "info", "--format", "{{.ServerVersion}}"]);
  started = true;
  await requireSuccess([...compose, "up", "--detach", "--wait", "--wait-timeout", "90"]);
  if (testing) {
    await requireSuccess(["bun", "run", "build"]);
    const args = process.argv.slice(3).filter((arg) => arg !== "--");
    exitCode = await run(["bunx", "playwright", "test", ...(args.length ? args : ["e2e/journeys/organization.journey.ts"])]);
  } else {
    await requireSuccess(["bun", "run", "db:migrate"]);
    const adapter = run(["bun", "e2e/support/redis-rest.ts"]);
    const app = run(["bun", "run", "dev", "--hostname", "127.0.0.1"]);
    exitCode = await Promise.race([adapter, app]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all([...children].map((child) => child.exited));
  if (testing && started) {
    const cleanup = await run([...compose, "down", "--volumes"]);
    if (cleanup !== 0) exitCode = 1;
  }
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
process.exit(interrupted ? 130 : exitCode);
