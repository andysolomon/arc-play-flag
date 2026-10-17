import { execFileSync } from "node:child_process";

/** Applies the organizations' migrations to the disposable database before the journeys, when there is one (docs/runbook/organizations.md). */
export default function globalSetup(): void {
  if (!process.env.DATABASE_URL) return;
  if (!/^postgres(ql)?:\/\/[^@/]*@?(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL)) throw new Error("A disposable loopback DATABASE_URL is required for the journeys");
  execFileSync("bun", ["run", "db:migrate"], { stdio: "inherit", env: process.env });
}
