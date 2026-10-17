import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { S } from "../../lib/play/geometry";
import { buildMotion, simulationPlayback } from "../../lib/play/motion";
import { LOS_GAP } from "../../lib/play/routes";
import type { SavedPlay } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { moved, play, seed } from "../support/fixtures";

// The backfield target reproduces the reported defender crossing the LOS. A real
// exchange releases every man defender; a snap, keeper or play-action fake does not.
const base: SavedPlay = { ...moved(play("fx-man-los", "Otter Man LOS", {
  d3: { type: "man", target: "o5" },
  d1: { type: "man", target: "o3" },
  d2: { type: "blitz" },
  o3: { type: "go", primary: true },
}), { d2: { y: -8 } }), artShadow: true };

const cases: { name: string; call: SavedPlay; release: boolean }[] = [
  { name: "pass", call: base, release: false },
  { name: "retreating-receiver", call: { ...base, players: base.players.map(p => p.id === "o5"
    ? { ...p, route: { type: "custom", pts: [[24, 7]] } } : p) }, release: false },
  { name: "fake", call: { ...base, players: base.players.map(p => p.id === "o4"
    ? { ...p, route: { type: "handoff" } } : p) }, release: false },
  { name: "keeper", call: { ...base, players: base.players.map(p => p.id === "o2"
    ? { ...p, route: { type: "dive", primary: true } } : p.id === "o3" ? { ...p, route: null } : p) }, release: false },
  ...(["handoff", "jet"] as const).map(type => ({
    name: type, release: true,
    call: { ...base, los: 35, players: base.players.map(p => p.id === "o4"
      ? { ...p, route: { type, primary: true } } : p.id === "o3" ? { ...p, route: null } : p) },
  })),
  { name: "motion-handoff", release: true, call: { ...base, players: base.players.map(p => p.id === "o4"
    ? { ...p, preSnap: { pts: [[20, 4]] }, route: { type: "handoff", primary: true } }
    : p.id === "o3" ? { ...p, route: null } : p) } },
];

for (const c of cases) test(`man stays behind the LOS until an actual handoff: ${c.name}`, async ({ page }, info) => {
  await page.addInitScript(() => { Math.random = () => 0.1; });
  await seed(page, { plays: [c.call] });
  const d = new Designer(page);
  await d.goto(`?open=${c.call.id}`);
  await d.closeSidebars();
  const top = 8 - Number((await d.field.getAttribute("viewBox"))?.split(" ")[3]) / S;
  const m = buildMotion(c.call.players, top, simulationPlayback(() => 0.1));
  const releaseAt = c.release ? m.handAt + m.handFor : Infinity;
  expect(m.kind).toBe(c.release || c.name === "keeper" ? "run" : "pass");
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole("button", { name: "Run the play" }).click();
  const samples: { t: number; man: number; downfield: number; blitz: number }[] = [];
  let now = 0;
  async function y(label: string): Promise<number> {
    const transform = await d.player(label, "Defense").getAttribute("transform");
    const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(transform ?? "");
    if (!match?.[2]) throw new Error(`no token for ${label}`);
    return Number(match[2]) / S + top;
  }
  // Read the actual rendered tokens throughout playback, including the exchange.
  const times = Array.from({ length: Math.floor((m.dur - 0.2) / 0.1) }, (_, i) => (i + 1) * 0.1);
  if (c.release) times.push(releaseAt - 0.04, releaseAt + 0.04);
  for (const t of times.filter(t => t > 0).sort((a, b) => a - b)) {
    const ms = Math.round(t * 1000);
    await page.clock.runFor(ms - now);
    now = ms;
    samples.push({ t, man: await y("R"), downfield: await y("LC"), blitz: await y("LB") });
  }
  const path = `test-results/man-los-${info.project.name}-${c.name}`;
  await writeFile(`${path}.json`, JSON.stringify({ case: c.name, releaseAt: c.release ? releaseAt : null, samples }, null, 2));
  await page.screenshot({ path: `${path}.png` });
  for (const sample of samples.filter(s => s.t < releaseAt)) {
    expect(sample.man, `man at ${String(sample.t)}s before the exchange`).toBeLessThanOrEqual(-LOS_GAP + 0.015);
  }
  if (c.release) expect(samples.some(s => s.t > releaseAt && s.man > 0)).toBe(true);
  // Legal downfield coverage and the separately assigned rusher still run.
  if (c.name === "pass") expect(Math.min(...samples.map(s => s.downfield))).toBeLessThan(-8);
  expect(Math.max(...samples.map(s => s.blitz))).toBeGreaterThan(0);
  await page.clock.runFor(Math.ceil(m.dur * 1000) - now + 100);
  await expect(page.getByRole("button", { name: "Run the play" })).toBeVisible();
  await page.clock.resume();
});
