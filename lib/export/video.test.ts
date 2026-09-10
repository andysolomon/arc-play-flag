import { describe, expect, test } from "bun:test";
import { ballAt, buildMotion, HOLD, positionsAt, type Motion } from "@/lib/play/motion";
import { defaults } from "@/lib/play/routes";
import type { Player } from "@/lib/play/types";
import { cardField, cardSvg, type CardOptions } from "./card";
import { clipExtension, clipMotion, clipTime, recordingType, STILL_SECONDS } from "./video";

const options = (players: Player[]): CardOptions => ({ players, name: "Cross & go", n: 7, team: { name: "Bills", color: "#ffe9a8" } });
const mixed = (primary: "pass" | "run" | null): Player[] => defaults().map((p) => {
  if (p.id === "o3") return { ...p, route: { type: "go", primary: primary === "pass" } };
  if (p.id === "o5") return { ...p, route: { type: "dive", primary: primary === "run" } };
  return p;
});

describe("clip playback", () => {
  test("the primary pass completes every time, and an unmarked mixed call is play-action", () => {
    for (const primary of ["pass", null] as const) {
      const o = options(mixed(primary));
      const m = clipMotion(o);
      expect(m.kind).toBe("pass");
      expect(m.runner).toBe("o5");
      expect(m.receiver).toBe("o3");
      expect(clipMotion(o)).toEqual(m);
      const t = m.dur - HOLD;
      const pos = positionsAt(m, o.players, t);
      if (!pos.o3) throw new Error("Missing receiver");
      expect(ballAt(m, pos, t)).toEqual({ ...pos.o3, lift: 0 });
    }
  });
  test("a primary runner receives the ball", () => {
    const o = options(mixed("run"));
    const m = clipMotion(o);
    expect(m.kind).toBe("run");
    expect(m.runner).toBe("o5");
    const t = m.dur - HOLD;
    const pos = positionsAt(m, o.players, t);
    if (!pos.o5) throw new Error("Missing runner");
    expect(ballAt(m, pos, t)).toEqual({ ...pos.o5, lift: 0 });
  });
  test("designer and export choose the same teaching path for pass, run, play-action, and pitch", () => {
    const scenarios: Array<{
      players: Player[];
      expected: Pick<Motion, "kind" | "runner" | "passer" | "receiver">;
    }> = [
      {
        players: defaults().map((p) => {
          if (p.id === "o3") return { ...p, route: { type: "go" as const, primary: true } };
          if (p.id === "o4") return { ...p, route: { type: "slant" as const } };
          return p;
        }),
        expected: { kind: "pass", runner: null, passer: "o2", receiver: "o3" },
      },
      { players: mixed("run"), expected: { kind: "run", runner: "o5", passer: "o2", receiver: null } },
      { players: mixed("pass"), expected: { kind: "pass", runner: "o5", passer: "o2", receiver: "o3" } },
      {
        players: mixed("pass").map((p) => p.id === "o5" ? { ...p, route: { type: "pitch" as const } } : p),
        expected: { kind: "pass", runner: "o5", passer: "o5", receiver: "o3" },
      },
    ];
    for (const { players, expected } of scenarios) {
      const o = options(players);
      const designer = buildMotion(players, cardField(players).top);
      const clip = clipMotion(o);
      const teachingPath = { kind: clip.kind, runner: clip.runner, passer: clip.passer, receiver: clip.receiver };
      expect(teachingPath).toEqual(expected);
      expect(teachingPath)
        .toEqual({ kind: designer.kind, runner: designer.runner, passer: designer.passer, receiver: designer.receiver });
    }
  });
  test("long routes finish before the final still; formation and final holds freeze time", () => {
    const o = options(defaults().map((p) => p.id === "o3" ? { ...p, route: { type: "custom", pts: [[3, 1], [27, 1], [3, -10], [27, -10]], primary: true } } : p));
    const m = clipMotion(o);
    const end = m.dur - HOLD;
    expect(end).toBeGreaterThan(5);
    expect(clipTime(m, 0)).toBe(0);
    expect(clipTime(m, STILL_SECONDS)).toBe(0);
    expect(clipTime(m, STILL_SECONDS + 1)).toBe(1);
    expect(clipTime(m, STILL_SECONDS + end)).toBe(end);
    expect(clipTime(m, 2 * STILL_SECONDS + end)).toBe(end);
    const track = m.tracks.o3;
    expect(positionsAt(m, o.players, end).o3).toEqual(track?.pts.at(-1));
  });
  test("frames keep the card labels and viewport while moving tokens and embedding the ball", () => {
    const o = options(mixed("pass"));
    const m = clipMotion(o);
    const positions = positionsAt(m, o.players, 1);
    const before = cardSvg(o).svg;
    const after = cardSvg(o, { positions, ball: ballAt(m, positions, 1), footballHref: "data:image/png;base64,AA==" }).svg;
    for (const svg of [before, after]) {
      expect(svg).toContain('viewBox="0 0 1080 1350"');
      expect(svg).toContain("Cross &amp; go");
      expect(svg).toContain(">7</text>");
    }
    expect(after).toContain('href="data:image/png;base64,AA=="');
    expect(after).not.toContain('href="/icons/football.png"');
    expect(after).not.toBe(before);
    expect(after).toContain(`viewBox="0 0 660 ${String((8 - cardField(o.players).top) * 22)}"`);
  });
  test("defense-only clip frames omit offense and its football", () => {
    const o = { ...options(mixed("pass")), vis: "defense" as const };
    const m = clipMotion(o);
    const positions = positionsAt(m, o.players, 1);
    const svg = cardSvg(o, { positions, ball: ballAt(m, positions, 1), footballHref: "data:image/png;base64,AA==" }).svg;
    expect(svg).toContain("#4a8fe0");
    expect(svg).not.toContain("#e5675e");
    expect(svg).not.toContain("data:image/png;base64,AA==");
  });
});

describe("browser containers", () => {
  test("selects WebM or MP4 only when supported, otherwise lets the recorder choose", () => {
    expect(recordingType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp8");
    expect(recordingType((t) => t === "video/mp4")).toBe("video/mp4");
    expect(recordingType(() => false)).toBeUndefined();
    expect(clipExtension("video/mp4;codecs=avc1")).toBe("mp4");
    expect(clipExtension("video/webm;codecs=vp8")).toBe("webm");
    expect(() => clipExtension("")).toThrow();
  });
});
