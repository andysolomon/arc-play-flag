/**
 * Model-checks every TLA+ model under verification/ with TLC. Each `<Module>.cfg` must pass; each
 * `<Module>.<variant>.cfg` replays a past bug and must break the invariant its `\* expect:` line names,
 * so a model that can no longer catch the bug fails the run as surely as a model the code breaks.
 *
 *   bun run verify:models                        every model
 *   bun run verify:models verification/account-push
 *
 * tla2tools.jar is fetched once into ~/.cache/tla2tools and checked by hash.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const TLA_VERSION = "1.8.0";
const TLA_SHA256 = "fdffef247f563ef6edbfd44958d2a82db79e7564e07cb673262d896353fa6713";
const JAR = join(homedir(), ".cache", "tla2tools", `tla2tools-${TLA_VERSION}.jar`);

async function jar(): Promise<string> {
  const java = Bun.which("java") ? Bun.spawnSync(["java", "-version"]) : null;
  const major = Number(/version "(\d+)/.exec(java?.stderr.toString() ?? "")?.[1] ?? 0);
  if (major < 17) throw new Error("TLC needs Java 17 or newer on PATH: mise use java@temurin-21, or install a JDK 21");
  if (!existsSync(JAR)) {
    mkdirSync(dirname(JAR), { recursive: true });
    const res = await fetch(`https://github.com/tlaplus/tlaplus/releases/download/v${TLA_VERSION}/tla2tools.jar`);
    if (!res.ok) throw new Error(`tla2tools.jar download failed: ${String(res.status)}`);
    writeFileSync(JAR, Buffer.from(await res.arrayBuffer()));
  }
  const sha = createHash("sha256").update(readFileSync(JAR)).digest("hex");
  if (sha !== TLA_SHA256) throw new Error(`${JAR} has sha256 ${sha}, expected ${TLA_SHA256}; delete it and rerun`);
  return JAR;
}

function configs(roots: string[]): string[] {
  return roots.flatMap((root) =>
    readdirSync(root, { withFileTypes: true }).flatMap((e) => {
      const path = join(root, e.name);
      if (e.isDirectory()) return configs([path]);
      return e.name.endsWith(".cfg") ? [path] : [];
    }),
  ).sort();
}

function expectation(cfg: string): string {
  const m = /^\\\* expect: (\S+)/m.exec(readFileSync(cfg, "utf8"));
  if (!m?.[1]) throw new Error(`${cfg} has no "\\* expect: pass" or "\\* expect: <Invariant>" line`);
  return m[1];
}

async function check(cfg: string, tlaJar: string): Promise<boolean> {
  const spec = `${basename(cfg).split(".")[0] ?? ""}.tla`;
  const expect = expectation(cfg);
  const proc = Bun.spawn(
    ["java", "-XX:+UseParallelGC", "-cp", tlaJar, "tlc2.TLC", "-noGenerateSpecTE", "-workers", "auto", "-cleanup", "-metadir", join(tmpdir(), `tlc-${String(process.pid)}`), "-config", basename(cfg), spec],
    { cwd: dirname(cfg), stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  await proc.exited;
  const violated = /Invariant (\w+) is violated/.exec(out)?.[1];
  const passed = out.includes("Model checking completed. No error has been found.");
  const ok = expect === "pass" ? passed : violated === expect;
  const got = passed ? "pass" : violated ? `${violated} violated` : "TLC error";
  console.log(`${ok ? "ok  " : "FAIL"} ${cfg}: expected ${expect === "pass" ? "pass" : `${expect} violated`}, got ${got}`);
  if (!ok) console.log(out);
  return ok;
}

const roots = process.argv.slice(2);
const tlaJar = await jar();
const all = configs(roots.length ? roots : ["verification"]);
if (!all.length) throw new Error("no .cfg files found");
let failed = 0;
for (const cfg of all) if (!(await check(cfg, tlaJar))) failed++;
process.exit(failed ? 1 : 0);
