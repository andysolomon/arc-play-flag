import { describe, expect, test } from "bun:test";
import { advertisedFeatures, chapterListProblem, CoverageLedger, coverageProblem } from "./coverage";
import type { ChapterSlug } from "./options";

describe("demo chapter coverage", () => {
  test("the tour and the recorder name the same chapters", () => {
    expect(chapterListProblem()).toBeNull();
  });

  test("advertised features come from the /demo card", () => {
    expect(advertisedFeatures("share")).toEqual(["Saving", "Notes", "Share link", "Shared play page"]);
    expect(() => advertisedFeatures("nope" as ChapterSlug)).toThrow(/no \/demo chapter/);
  });

  test("names the promises a recording did not keep", () => {
    expect(coverageProblem("share", ["Notes", "Share link"], new Set(["Notes"])))
      .toBe('chapter "share" advertises Share link on /demo but no beat demonstrated it');
    expect(coverageProblem("share", ["Notes", "Share link"], new Set(["Notes", "Share link"]))).toBeNull();
  });

  test("a ledger is only satisfied once every advertised feature is proven", () => {
    const ledger = new CoverageLedger("share", ["Notes", "Share link"]);
    expect(ledger.problem()).toContain("Notes, Share link");
    ledger.prove(["Notes"]);
    expect(ledger.problem()).toContain("Share link");
    ledger.prove(["Share link", "Share link"]);
    expect(ledger.problem()).toBeNull();
    expect([...ledger.proven].sort()).toEqual(["Notes", "Share link"]);
  });

  test("a beat cannot prove something the chapter never advertised", () => {
    const ledger = new CoverageLedger("share", ["Notes"]);
    expect(() => { ledger.prove(["Wristbands"]); }).toThrow(/does not list/);
  });
});
