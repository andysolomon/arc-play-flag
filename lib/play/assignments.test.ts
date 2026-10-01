import { describe, expect, test } from "bun:test";
import { assignments, callLine, callName, chainLine, headerLine } from "./assignments";
import { defaults } from "./routes";
import type { Route, SavedPlay } from "./types";

/**
 * The default formation (C · QB · X on the left · Y on the right · Z beside the QB) with routes on the
 * named players and the quarterback's laterals, each hop the id of who takes it.
 */
const play = (r: Record<string, Route>, hops: readonly string[] = [], name = "Otter Trick"): SavedPlay => ({
  id: "p", name, notes: "", side: "offense",
  players: defaults().map((p) => {
    const q = r[p.id] ? { ...p, route: r[p.id] ?? null } : p;
    return p.id === "o2" && hops.length ? { ...q, laterals: hops.map((to) => ({ to })) } : q;
  }),
});
const jobs = (p: SavedPlay): Record<string, string> => Object.fromEntries(assignments(p).map((a) => [a.who, a.job]));

describe("a lateral chain in words (W1)", () => {
  test("one lateral, then a throw, is a double pass", () => {
    const p = play({ o5: { type: "throw" }, o4: { type: "go", primary: true }, o3: { type: "go" } }, ["o5"]);
    expect(callName(p)).toBe("Double pass");
    expect(callLine(p)).toBe("Double pass: QB laterals to Z, Z throws. Primary read: Y (Go).");
    expect(jobs(p)).toEqual({ C: "Snap", QB: "Lateral to Z", X: "Go", Y: "Go", Z: "Take the lateral, throw, look to Y first" });
    expect(assignments(p).find((a) => a.who === "Y")?.primary).toBe(true);
    expect(chainLine(p)).toBe("QB › Z › Y");
    expect(headerLine({ n: 4, play: p })).toBe("4 · Otter Trick · Double pass");
  });
  test("two laterals or more, then a throw, is a lateral pass", () => {
    const p = play({ o3: { type: "throw" }, o4: { type: "go", primary: true } }, ["o5", "o3"]);
    expect(callName(p)).toBe("Lateral pass");
    expect(callLine(p)).toBe("Lateral pass: QB laterals to Z, Z laterals to X, X throws. Primary read: Y (Go).");
    expect(jobs(p)).toMatchObject({ QB: "Lateral to Z", Z: "Lateral to X", X: "Take the lateral, throw, look to Y first" });
    expect(chainLine(p)).toBe("QB › Z › X › Y");
  });
  test("a throw with no read marked still names the thrower", () => {
    const p = play({ o5: { type: "throw" }, o4: { type: "go" } }, ["o5"]);
    expect(callLine(p)).toBe("Double pass: QB laterals to Z, Z throws.");
    expect(jobs(p).Z).toBe("Take the lateral, throw");
    expect(chainLine(p)).toBe("QB › Z › throw");
  });
  test("a chain that ends in a keep is a lateral run", () => {
    const p = play({ o5: { type: "reverse" }, o4: { type: "go" } }, ["o5"]);
    expect(callName(p)).toBe("Lateral run");
    expect(callLine(p)).toBe("Lateral run: QB laterals to Z, Z keeps it (Reverse).");
    expect(jobs(p).Z).toBe("Take the lateral, keep it: Reverse");
    expect(chainLine(p)).toBe("QB › Z keeps");
  });
  test("a last carrier with no job leaves the lateral unfinished, and says so", () => {
    const p = play({ o4: { type: "go" } }, ["o5"]);
    expect(callName(p)).toBe("Lateral · unfinished");
    expect(callLine(p)).toBe("Lateral: QB laterals to Z. Z still needs a job: throw, lateral again or keep it.");
    const z = assignments(p).find((a) => a.who === "Z");
    expect(z?.job).toBe("Takes the lateral · no job yet");
    expect(z?.missing).toBe(true);
    expect(z?.idle).toBe(false);
    expect(chainLine(p)).toBe("QB › Z › ?");
  });
  test("a play with no lateral has no chain line, and its words are what they were", () => {
    const p = play({ o3: { type: "go", primary: true }, o5: { type: "dive" } });
    expect(chainLine(p)).toBeNull();
    expect(callName(p)).toBe("Play-action");
    expect(assignments(p).every((a) => !a.missing)).toBe(true);
  });
});

describe("the read and the names", () => {
  test("a read marked inside the chain is not the read (W2)", () => {
    // stored that way by hand: the designer never lets a carrier be the read
    const p = play({ o5: { type: "throw", primary: true }, o4: { type: "go" } }, ["o5"]);
    expect(callLine(p)).toBe("Double pass: QB laterals to Z, Z throws.");
    expect(assignments(p).some((a) => a.primary)).toBe(false);
  });
  test("an unlabelled carrier is named like any unlabelled player (W3)", () => {
    const p = play({ o5: { type: "throw" }, o4: { type: "go", primary: true } }, ["o5"]);
    const unnamed = { ...p, players: p.players.map((q) => (q.id === "o5" ? { ...q, label: "" } : q)) };
    expect(callLine(unnamed)).toBe("Double pass: QB laterals to Player 1, Player 1 throws. Primary read: Y (Go).");
    expect(chainLine(unnamed)).toBe("QB › Player 1 › Y");
  });
});

describe("a chain that comes back to a player (R12)", () => {
  test("QB → Z → QB → X, X throws: each toss is named, and the QB's job says both of theirs", () => {
    const p = play({ o3: { type: "throw" }, o4: { type: "go", primary: true } }, ["o5", "o2", "o3"]);
    expect(callName(p)).toBe("Lateral pass");
    expect(callLine(p)).toBe("Lateral pass: QB laterals to Z, Z laterals to QB, QB laterals to X, X throws. Primary read: Y (Go).");
    expect(jobs(p)).toMatchObject({ QB: "Lateral to Z, then lateral to X", Z: "Lateral to QB", X: "Take the lateral, throw, look to Y first" });
    expect(chainLine(p)).toBe("QB › Z › QB › X › Y");
  });
  test("the QB takes it back and throws it, or keeps it", () => {
    const back = play({ o2: { type: "throw" }, o4: { type: "go", primary: true } }, ["o5", "o2"]);
    expect(callName(back)).toBe("Lateral pass");
    expect(callLine(back)).toBe("Lateral pass: QB laterals to Z, Z laterals to QB, QB throws. Primary read: Y (Go).");
    expect(jobs(back)).toMatchObject({ QB: "Lateral to Z, then take the lateral, throw, look to Y first", Z: "Lateral to QB" });
    expect(chainLine(back)).toBe("QB › Z › QB › Y");
    const keep = play({ o2: { type: "dive" } }, ["o5", "o2"]);
    expect(callName(keep)).toBe("Lateral run");
    expect(jobs(keep).QB).toBe("Lateral to Z, then take the lateral, keep it: Dive");
    expect(chainLine(keep)).toBe("QB › Z › QB keeps");
  });
  test("taken back with no job yet is unfinished, and said so", () => {
    const p = play({ o4: { type: "go" } }, ["o5", "o2"]);
    expect(callName(p)).toBe("Lateral · unfinished");
    expect(callLine(p)).toBe("Lateral: QB laterals to Z, Z laterals to QB. QB still needs a job: throw, lateral again or keep it.");
    const qb = assignments(p).find((a) => a.who === "QB");
    expect(qb?.job).toBe("Lateral to Z, then takes the lateral · no job yet");
    expect(qb?.missing).toBe(true);
  });
});

