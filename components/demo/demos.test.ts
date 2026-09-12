import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { MAX_SET_BYTES } from "../../scripts/demo-recorder/media";
import { COVERED_FEATURES, DEMOS, TOUR_SECONDS } from "./demos";

describe("demo tour", () => {
  test("keeps every chapter short, uniquely named and fully described", () => {
    expect(DEMOS).toHaveLength(8);
    expect(new Set(DEMOS.map((demo) => demo.slug)).size).toBe(DEMOS.length);
    for (const demo of DEMOS) {
      expect(demo.summary.length).toBeGreaterThan(40);
      expect(demo.covers.length).toBeGreaterThan(2);
      // a chapter that promises more than this is doing too much to stay legible
      expect(demo.covers.length).toBeLessThanOrEqual(6);
      expect(Number.parseInt(demo.time, 10)).toBeGreaterThanOrEqual(6);
      expect(Number.parseInt(demo.time, 10)).toBeLessThanOrEqual(12);
    }
  });

  test("promises each feature exactly once across the tour", () => {
    const claims = DEMOS.flatMap((demo) => demo.covers);
    expect(claims).toHaveLength(COVERED_FEATURES.size);
    expect(TOUR_SECONDS).toBeLessThanOrEqual(90);
  });

  test("covers the requested primary features", () => {
    for (const feature of [
      "Create plays", "Running plays", "Passing plays", "Play-action", "Primary routes", "Quick routes", "Custom routes",
      "Moving players", "Formations", "Without defense", "With defense", "Defensive plays", "Zones", "Man coverage",
      "Play playback", "Saving", "Picture export", "Video export", "Playbook creation", "Team setup", "Import",
      "Wristbands", "Binder PDF",
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

    expect(totalBytes).toBeLessThan(MAX_SET_BYTES);
  });
});
