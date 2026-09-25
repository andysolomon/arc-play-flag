import { describe, expect, test } from "bun:test";
import { CoverageLedger } from "./coverage";

describe("demo chapter coverage", () => {
  test("a ledger is only satisfied once every advertised feature is proven", () => {
    const ledger = new CoverageLedger("custom-routes", ["Custom routes", "Mirror"]);
    expect(ledger.problem()).toContain("Custom routes, Mirror");
    ledger.prove(["Custom routes"]);
    expect(ledger.problem()).toContain("Mirror");
    ledger.prove(["Mirror", "Mirror"]);
    expect(ledger.problem()).toBeNull();
    expect([...ledger.proven].sort()).toEqual(["Custom routes", "Mirror"]);
  });
});
