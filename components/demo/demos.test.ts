import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { COVERED_FEATURES, DEMOS } from "./demos";

describe("demo tour", () => {
  test("keeps the tour short, uniquely named and fully described", () => {
    expect(DEMOS).toHaveLength(5);
    expect(new Set(DEMOS.map((demo) => demo.slug)).size).toBe(DEMOS.length);
    for (const demo of DEMOS) {
      expect(demo.summary.length).toBeGreaterThan(40);
      expect(demo.covers.length).toBeGreaterThan(2);
    }
  });

  test("covers the requested primary features", () => {
    for (const feature of [
      "Create plays", "Running plays", "Passing plays", "Play-action", "Primary routes", "Quick routes", "Custom routes",
      "Without defense", "With defense", "Defensive plays", "Zones", "Man coverage", "Play playback", "Saving",
      "Picture export", "Video export", "Playbook creation",
    ]) expect(COVERED_FEATURES.has(feature)).toBe(true);
  });

  test("ships a lightweight poster and both video formats for every chapter", () => {
    const demoDir = join(import.meta.dir, "../../public/demos");
    let totalBytes = 0;

    for (const demo of DEMOS) {
      for (const extension of ["webm", "mp4", "webp"]) {
        const bytes = statSync(join(demoDir, `${demo.slug}.${extension}`)).size;
        expect(bytes).toBeGreaterThan(1_000);
        totalBytes += bytes;
      }
    }

    expect(totalBytes).toBeLessThan(1_250_000);
  });
});
