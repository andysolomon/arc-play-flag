import { describe, expect, test } from "bun:test";
import { advertisedFeatures, chapterListProblem, CoverageLedger, coverageProblem } from "./coverage";
import type { ChapterSlug } from "./options";

describe("demo chapter coverage", () => {
  test("the tour and the recorder name the same chapters", () => {
    expect(chapterListProblem()).toBeNull();
  });

  test("advertised features come from the /demo card", () => {
    expect(advertisedFeatures("custom-routes")).toEqual(["Custom routes", "Mirror", "Undo / redo"]);
    expect(() => advertisedFeatures("nope" as ChapterSlug)).toThrow(/no \/demo chapter/);
  });

  test("names the promises a recording did not keep", () => {
    expect(coverageProblem("custom-routes", ["Mirror", "Undo / redo"], new Set(["Mirror"])))
      .toBe('chapter "custom-routes" advertises Undo / redo on /demo but no beat demonstrated it');
    expect(coverageProblem("custom-routes", ["Mirror", "Undo / redo"], new Set(["Mirror", "Undo / redo"]))).toBeNull();
  });

  test("a ledger is only satisfied once every advertised feature is proven", () => {
    const ledger = new CoverageLedger("custom-routes", ["Custom routes", "Mirror"]);
    expect(ledger.problem()).toContain("Custom routes, Mirror");
    ledger.prove(["Custom routes"]);
    expect(ledger.problem()).toContain("Mirror");
    ledger.prove(["Mirror", "Mirror"]);
    expect(ledger.problem()).toBeNull();
    expect([...ledger.proven].sort()).toEqual(["Custom routes", "Mirror"]);
  });

  test("a beat cannot prove something the chapter never advertised", () => {
    const ledger = new CoverageLedger("custom-routes", ["Mirror"]);
    expect(() => { ledger.prove(["Wristbands"]); }).toThrow(/does not list/);
  });
});
