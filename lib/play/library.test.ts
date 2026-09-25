import { describe, expect, test } from "bun:test";
import { defaults } from "./routes";
import { discoverPlays, playMatchesFilter } from "./library";
import type { Route, SavedPlay } from "./types";

function saved(id: string, name: string, route: Route | null, team: "offense" | "defense" = "offense", notes = ""): SavedPlay {
  const players = defaults().map((player) => player.id === (team === "offense" ? "o3" : "d1") ? { ...player, route } : player);
  return { id, name, notes, side: team, players };
}

describe("saved-play discovery", () => {
  const pass = saved("pass", "Alpha Pass", { type: "slant" }, "offense", "Attack the seam");
  const run = saved("run", "Bravo Run", { type: "handoff" });
  const defense = saved("def", "Charlie Cloud", { type: "zoneDeep" }, "defense");
  const blank = saved("blank", "Empty Canvas", null);

  test("searches names and notes, filters route types, and sorts without changing the source", () => {
    const source = [pass, run, defense, blank];
    expect(discoverPlays(source, { query: "SEAM" }).map((p) => p.id)).toEqual(["pass"]);
    expect(discoverPlays(source, { filter: "run" }).map((p) => p.id)).toEqual(["run"]);
    expect(discoverPlays(source, { filter: "pass" }).map((p) => p.id)).toEqual(["pass"]);
    expect(discoverPlays(source, { filter: "defense" }).map((p) => p.id)).toEqual(["def"]);
    expect(discoverPlays(source, { sort: "name" }).map((p) => p.name)).toEqual(["Alpha Pass", "Bravo Run", "Charlie Cloud", "Empty Canvas"]);
    expect(source.map((p) => p.id)).toEqual(["pass", "run", "def", "blank"]);
    expect(playMatchesFilter(blank, "run")).toBe(false);
  });

  test("recent order and filtering stay responsive for a 100-play fixture", () => {
    const plays = Array.from({ length: 100 }, (_, index) => saved(`p${String(index)}`, `Play ${String(index).padStart(3, "0")}`, { type: index % 2 ? "go" : "handoff" }));
    const result = discoverPlays(plays, { query: "Play 0", filter: "run", sort: "recent" });
    expect(result).toHaveLength(50);
    expect(result[0]?.id).toBe("p98");
    expect(result.at(-1)?.id).toBe("p0");
  });
});
