import { describe, expect, test } from "bun:test";
import { defaults } from "@/lib/play/routes";
import { playArt, playSvg } from "./play-svg";

describe("play art", () => {
  test("frames tightly by default and deeper when the box is tall", () => {
    const tight = playArt(defaults());
    expect(tight.height).toBe(24 * 22);
    const tall = playArt(defaults(), { box: { pw: 100, ph: 150 } });
    expect(tall.height).toBe(45 * 22);
    const cell = playArt(defaults(), { box: { pw: 150, ph: 90 }, minDepth: 14, show: "offense" });
    expect(cell.height).toBe(18 * 22);
  });
  test("escapes labels and produces a standalone document", () => {
    const svg = playSvg(defaults().map((p) => (p.id === "o1" ? { ...p, label: "<&>" } : p)));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain("&lt;&amp;&gt;");
    expect(svg).not.toContain("><&><");
  });
});
