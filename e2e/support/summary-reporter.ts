import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { appendFileSync } from "node:fs";

interface Row {
  title: string;
  file: string;
  status: TestResult["status"] | "flaky";
  error: string;
}

/**
 * A concise CI summary: one line per journey, failures with their first error line,
 * written to the GitHub step summary when there is one (and to stdout otherwise).
 */
export default class SummaryReporter implements Reporter {
  private readonly rows: Row[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const outcome = test.outcome();
    const status: Row["status"] = outcome === "flaky" ? "flaky" : outcome === "expected" ? "passed" : outcome === "skipped" ? "skipped" : result.status;
    // a retried test ends more than once; keep the last word
    const file = test.location.file.split("/").slice(-1)[0] ?? test.location.file;
    const row: Row = { title: test.titlePath().slice(3).join(" › "), file, status, error: result.error?.message?.split("\n")[0] ?? "" };
    const i = this.rows.findIndex((r) => r.title === row.title && r.file === row.file);
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
  }

  onEnd(result: FullResult): void {
    const count = (s: Row["status"]): number => this.rows.filter((r) => r.status === s).length;
    const failed = this.rows.filter((r) => r.status === "failed" || r.status === "timedOut" || r.status === "interrupted");
    const lines = [
      `## Browser journeys: ${result.status === "passed" ? "passed" : result.status}`,
      "",
      "| Passed | Failed | Flaky | Skipped |",
      "| --- | --- | --- | --- |",
      `| ${String(count("passed"))} | ${String(failed.length)} | ${String(count("flaky"))} | ${String(count("skipped"))} |`,
      "",
    ];
    if (failed.length) {
      lines.push("### Failed", "");
      for (const r of failed) lines.push(`- **${r.title}** (${r.file})${r.error ? `: ${r.error}` : ""}`);
      lines.push("", "Traces and screenshots are in the `browser-journeys` artifact of this run.", "");
    }
    const flaky = this.rows.filter((r) => r.status === "flaky");
    if (flaky.length) {
      lines.push("### Passed on retry", "");
      for (const r of flaky) lines.push(`- ${r.title} (${r.file})`);
      lines.push("");
    }
    const text = lines.join("\n");
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) appendFileSync(summary, text + "\n");
    else process.stdout.write(text + "\n");
  }

  printsToStdio(): boolean {
    return false;
  }
}
