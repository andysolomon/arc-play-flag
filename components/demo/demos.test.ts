import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { MAX_SET_BYTES } from "../../scripts/demo-recorder/media";
import { DEMOS } from "./demos";

describe("demo tour", () => {
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
