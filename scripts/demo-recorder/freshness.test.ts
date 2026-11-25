import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fingerprint, freshnessProblem, restamp, restampDrift, stampFor } from "./freshness";

/*
 * The clips show the UI as it was when they were recorded; `components/demo/recorded-from.json`
 * says which UI that was. Ways the check could fail, and the test that catches each:
 *
 *  - a watched file changes after recording and the check still passes      → "a changed file"
 *  - a file is added to or removed from the watched UI, or renamed, and the
 *    check still passes (a path is part of what was recorded)                → "an added, removed or renamed file"
 *  - the check fails on a checkout where nothing changed: CRLF line endings
 *    from a Windows checkout, or the directory read in another order        → "an unchanged tree"
 *  - a test beside the UI, or the /demo page itself (never in a clip), trips
 *    it                                                                      → "what is watched"
 *  - a missing or garbled stamp passes, or throws something unreadable
 *    instead of saying how to make one                                       → "a missing or garbled stamp"
 *  - the failure doesn't name the files or the two ways out                  → "a changed file"
 *  - a restamp goes through with no reason, with nothing to restamp, or
 *    leaves no trace of what it waved through or what it compared            → "restamping"
 *  - a restamp passes once a clip it compared is replaced, or one that
 *    compared nothing passes                                                 → "restamping", "compared no clips"
 */

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "arc-demo-fresh-"));
  temporary.push(root);
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  return root;
}

const UI = {
  "components/App.tsx": "export const App = 1;\n",
  "components/endzone/EndZonePicker.tsx": "export const Picker = 2;\n",
  "app/globals.css": ":root { --ink: #1b1a17; }\n",
};

const CLIPS = { "first-play": "a".repeat(64), roster: "c".repeat(64) };
const COMPARED = { tolerance: { blockShare: 0.15 }, clips: { "first-play": { webm: CLIPS["first-play"], worst: 0.02 }, roster: { webm: CLIPS.roster, worst: 0.04 } } };

describe("demo clip freshness", () => {
  test("an unchanged tree matches its stamp, whatever its line endings and read order", async () => {
    const recorded = JSON.stringify(stampFor(await fingerprint(await tree(UI))));
    const crlf = Object.fromEntries(Object.entries(UI).reverse().map(([path, body]) => [path, body.replace(/\n/g, "\r\n")]));
    expect(freshnessProblem(recorded, await fingerprint(await tree(crlf)), CLIPS)).toBeNull();
  });

  test("a changed file fails, naming it and the two ways out", async () => {
    const recorded = JSON.stringify(stampFor(await fingerprint(await tree(UI))));
    const problem = freshnessProblem(recorded, await fingerprint(await tree({ ...UI, "components/App.tsx": "export const App = 2;\n" })), CLIPS);
    expect(problem).toContain("components/App.tsx (changed)");
    expect(problem).toContain("bun run demo:record --chapter all");
    expect(problem).toContain("publish the whole set, its recorded-from.json to components/demo/recorded-from.json.");
    expect(problem).toContain('`bun run demo:restamp --reason "<what changed>"` builds this checkout, takes every chapter again');
  });

  test("an added, removed or renamed file fails", async () => {
    const recorded = JSON.stringify(stampFor(await fingerprint(await tree(UI))));
    expect(freshnessProblem(recorded, await fingerprint(await tree({ ...UI, "components/Fold.tsx": "fold\n" })), CLIPS)).toContain("components/Fold.tsx (added)");
    const { "components/App.tsx": app, ...rest } = UI;
    expect(freshnessProblem(recorded, await fingerprint(await tree(rest)), CLIPS)).toContain("components/App.tsx (removed)");
    const renamed = freshnessProblem(recorded, await fingerprint(await tree({ ...rest, "components/Main.tsx": app })), CLIPS);
    expect(renamed).toContain("components/App.tsx (removed)");
    expect(renamed).toContain("components/Main.tsx (added)");
  });

  test("what is watched: the components and the stylesheet, not tests, the tour page or anything else", async () => {
    const watched = await fingerprint(await tree({
      ...UI,
      "components/demo/demos.ts": "tour\n",
      "components/demo/DemoScreen.tsx": "tour page\n",
      "components/App.test.ts": "test\n",
      "components/Field.spec.tsx": "test\n",
      "app/api/shares/route.ts": "server\n",
      "lib/play/field.ts": "lib\n",
    }));
    expect(Object.keys(watched).sort()).toEqual(Object.keys(UI).sort());
  });

  test("a missing or garbled stamp fails and says how to make one", async () => {
    const current = await fingerprint(await tree(UI));
    for (const stamp of [null, "", "{", "[]", JSON.stringify({ files: "nope" }), JSON.stringify({ files: { "components/App.tsx": 3 } })]) {
      expect(freshnessProblem(stamp, current, CLIPS)).toContain("bun run demo:record --chapter all");
    }
  });

  test("restamping needs a reason, a drift and a comparison of the clips served, and records all three", async () => {
    const recorded = JSON.stringify(stampFor(await fingerprint(await tree(UI))));
    const current = await fingerprint(await tree({ ...UI, "app/globals.css": ":root { --ink: #000; }\n" }));
    expect(() => restamp(recorded, current, "  ", COMPARED)).toThrow(/reason/);
    const unchanged = await fingerprint(await tree(UI));
    expect(() => restamp(recorded, unchanged, "a comment", COMPARED)).toThrow(/nothing to restamp/);
    const next = restamp(recorded, current, "only print colours changed", COMPARED);
    expect(next.restamped).toEqual({ reason: "only print colours changed", files: ["app/globals.css (changed)"], compared: COMPARED });
    expect(freshnessProblem(JSON.stringify(next), current, CLIPS)).toBeNull();
    // a clip replaced after the comparison is one it never saw
    expect(freshnessProblem(JSON.stringify(next), current, { ...CLIPS, roster: "b".repeat(64) })).toContain("restamped without comparing these published clips with a take of this UI: roster");
    // a fresh recording carries no restamp note
    expect(stampFor(current).restamped).toBeUndefined();
  });

  test("a restamp that compared no clips fails, and the next restamp covers what it waved through", async () => {
    const current = await fingerprint(await tree(UI));
    const unchecked = JSON.stringify({ ...stampFor(current), restamped: { reason: "trust me", files: ["components/App.tsx (changed)"] } });
    expect(freshnessProblem(unchecked, current, CLIPS)).toContain("restamped without comparing these published clips with a take of this UI: first-play, roster");
    expect(restampDrift(unchecked, current)).toEqual(["components/App.tsx (changed)"]);
  });
});
