import { describe, expect, test } from "bun:test";
import { defaults } from "@/lib/play/routes";
import { playArt, playSvg } from "./play-svg";

const play = defaults().map((p) =>
  p.id === "o3" ? { ...p, route: { type: "post" as const, primary: true } }
  : p.id === "o4" ? { ...p, route: { type: "out" as const } }
  : p.id === "d5" ? { ...p, route: { type: "zoneDeep" as const } }
  : p,
);

describe("play art", () => {
  test("frames tightly by default and deeper when the box is tall", () => {
    const tight = playArt(defaults());
    expect(tight.height).toBe(24 * 22);
    const tall = playArt(defaults(), { box: { pw: 100, ph: 150 } });
    expect(tall.height).toBe(45 * 22);
    const cell = playArt(defaults(), { box: { pw: 150, ph: 90 }, minDepth: 14, show: "offense" });
    expect(cell.height).toBe(18 * 22);
  });
  test("simple art has tokens and routes but no names or star", () => {
    const a = playArt(play);
    expect(a.body).toContain("<path");
    expect(a.body).toContain(">QB<");
    expect(a.body).not.toContain(">Post<");
    expect(a.body).not.toContain("★");
  });
  test("detailed art names routes and stars the read", () => {
    const a = playArt(play, { level: "detailed" });
    expect(a.body).toContain(">Post<");
    expect(a.body).toContain(">Out<");
    expect(a.body).toContain(">Zone deep<");
    expect(a.body).toContain("★");
  });
  test("highlight fades the others and rings the player", () => {
    const a = playArt(play, { highlight: "o4" });
    expect(a.body.match(/opacity="0.28"/g)?.length).toBe(2);
    expect(a.body).toContain('r="33"');
  });
  test("defence can be left off", () => {
    const a = playArt(play, { show: "offense" });
    expect(a.body).not.toContain("#4a8fe0");
    expect(a.body).toContain("#e5675e");
  });
  test("or shown on its own", () => {
    const a = playArt(play, { show: "defense" });
    expect(a.body).toContain("#4a8fe0");
    expect(a.body).not.toContain("#e5675e");
  });
  test("escapes labels and produces a standalone document", () => {
    const svg = playSvg(defaults().map((p) => (p.id === "o1" ? { ...p, label: "<&>" } : p)));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain("&lt;&amp;&gt;");
    expect(svg).not.toContain("><&><");
  });
});
