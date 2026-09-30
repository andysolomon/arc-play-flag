import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { assignments, callLine } from "../../lib/play/assignments";
import { buildMotion, ballAt, positionsAt } from "../../lib/play/motion";
import { encodePlayFile, readTransfer } from "../../lib/export/transfer";
import { decodeShare } from "../../lib/play/share";
import { playSvg } from "../../lib/render/play-svg";
import { Designer } from "../support/designer";
import { downloadText } from "../support/designer";
import { formation, jsonUpload, seed, storedDraft, storedPlays } from "../support/fixtures";
import type { BallStep, SavedPlay } from "../../lib/play/types";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

// Failure cases, written before implementation: a receiver cannot become the passer;
// a second lateral loses possession; revisiting QB loops forever; a long list truncates;
// a sideways toss consumes the forward pass; release/catch ahead of LOS or a return
// across LOS is accepted; forward-moving tosses are mislabeled; a second pass is legal;
// invalid targets/NaN delays crash; routes, undo, clear, reload, snapshots and imports
// lose the sequence; exports call a lateral-to-pass a run; mobile controls overflow.
const fixture = (ballPlan: BallStep[], players = formation({ o3: { type: "go", primary: true } })): SavedPlay =>
  ({ id: "fx-laterals", name: "Otter Flea Flicker", side: "offense", notes: "Stay behind the line.", players, ballPlan });

test("a coach builds an uncapped lateral chain, returns to QB, passes, undoes, saves and shares it", async ({ page }, info) => {
  await seed(page, { draft: { ...fixture([]) } });
  const d = new Designer(page);
  await d.goto();
  await d.palette();
  await page.getByText("Ball assignments", { exact: true }).click();
  for (let i = 0; i < 16; i++) await page.getByRole("button", { name: "Add lateral", exact: true }).click();
  await expect(page.getByRole("group", { name: /^Ball step \d+$/ })).toHaveCount(16);
  await page.getByRole("button", { name: "Add forward pass", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add lateral", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add forward pass", exact: true })).toBeDisabled();
  const plan = (await storedDraft(page))?.ballPlan;
  expect(plan).toHaveLength(17);
  expect(plan?.slice(0, 16).map(s => s.target)).toEqual(Array.from({ length: 16 }, (_, i) => i % 2 ? "o2" : "o5"));
  expect(plan?.[16]).toEqual({ type: "pass", target: "o3", delay: 0.2 });
  await d.undo.click();
  await expect.poll(async () => (await storedDraft(page))?.ballPlan?.length).toBe(16);
  await d.redo.click();
  await expect.poll(async () => (await storedDraft(page))?.ballPlan?.length).toBe(17);
  await d.save();
  const saved = Object.values(await storedPlays(page))[0];
  if (!saved) throw new Error("The play was not saved");
  expect(saved.ballPlan).toEqual(plan);
  await page.reload();
  await expect.poll(async () => (await storedDraft(page))?.ballPlan).toEqual(plan);
  await d.palette();
  await page.getByText("Ball assignments", { exact: true }).click();
  await page.getByRole("group", { name: "Ball step 17", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("lateral-controls.png") });

  const transfer = readTransfer(encodePlayFile(saved));
  expect(transfer.ok && transfer.file.kind === "ffpd.play" && transfer.file.play.ballPlan).toEqual(plan);
  await d.clickTool("Copy share link");
  await page.getByRole("dialog", { name: "Share snapshot" }).getByRole("button", { name: "Copy snapshot link" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const snapshot = new URL(url).pathname.split("/").at(-1) ?? "";
  expect(decodeShare(snapshot)?.ballPlan).toEqual(plan);
  await page.goto(`/p/${snapshot}`);
  await expect(page.getByRole("img", { name: "Play diagram" }).locator("[data-ball-step]")).toHaveCount(17);
  await expect(page.getByText(/Ball: QB lateral to Z/)).toBeVisible();
  await page.getByRole("link", { name: "Open in designer" }).click();
  await expect.poll(async () => (await storedDraft(page))?.ballPlan).toEqual(plan);
  await writeFile(info.outputPath("lateral-chain.json"), JSON.stringify({ saved, transfer, call: callLine(saved), assignments: assignments(saved) }, null, 2));
});

test("playback shows every transfer in order and the lateral recipient throws from their own hands", async ({ page }, info) => {
  const f = fixture([{ type: "lateral", target: "o5", delay: 0.2 }, { type: "lateral", target: "o2", delay: 0.2 }, { type: "lateral", target: "o5", delay: 0.2 }, { type: "pass", target: "o3", delay: 0.2 }]);
  await seed(page, { draft: f });
  const d = new Designer(page);
  await d.goto();
  await d.closeSidebars();
  await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T12:00:01Z"));
  const m = buildMotion(f.players, -16, undefined, f.ballPlan);
  expect(m.ballError).toBeNull();
  expect(m.passer).toBe("o5");
  expect(m.exchanges.map(e => [e.from, e.to, e.type])).toEqual([["o2", "o5", "lateral"], ["o5", "o2", "lateral"], ["o2", "o5", "lateral"], ["o5", "o3", "pass"]]);
  const first = m.exchanges[0];
  if (!first) throw new Error("Missing lateral in playback");
  await page.getByRole("button", { name: "Run the play", exact: true }).click();
  await page.clock.runFor(Math.ceil((first.catchAt + 0.05) * 1000));
  await expect(d.field).toHaveAttribute("data-ball-holder", "o5");
  await page.screenshot({ path: info.outputPath("lateral-receiver-passing.png") });
  let previous = first.catchAt + 0.05;
  for (const exchange of m.exchanges.slice(1)) {
    const now = exchange.catchAt + 0.05;
    await page.clock.runFor(Math.ceil((now - previous) * 1000));
    await expect(d.field).toHaveAttribute("data-ball-holder", exchange.to);
    previous = now;
  }
  await expect(d.field).toHaveAttribute("data-ball-holder", "o3");
  const frames = m.exchanges.flatMap(e => [e.releaseAt, (e.releaseAt + e.catchAt) / 2, e.catchAt].map(t => ({ t, ball: ballAt(m, positionsAt(m, f.players, t), t) })));
  await writeFile(info.outputPath("lateral-playback.json"), JSON.stringify({ motion: m, frames }, null, 2));
});

test("illegal transfers are explained and cannot run, including a carrier returning behind LOS", async ({ page }, info) => {
  const cases = [
    fixture([{ type: "lateral", target: "o3", delay: 0 }], formation()), // behind LOS, but forward from QB
    fixture([{ type: "pass", target: "o3", delay: 2 }], formation({ o2: { type: "go" }, o3: { type: "go" } })),
    fixture([{ type: "lateral", target: "o5", delay: 2 }], formation({ o5: { type: "custom", pts: [[19, 0]] } })),
    fixture([{ type: "lateral", target: "o5", delay: 2 }], formation({ o5: { type: "go" } })),
    fixture([{ type: "lateral", target: "o5", delay: 0 }, { type: "pass", target: "o3", delay: 4 }], formation({ o5: { type: "custom", pts: [[28, 7.4], [28, -1], [28, 7.4]] }, o3: { type: "go" } }).map(p => p.id === "o5" ? { ...p, y: 7.4 } : p)),
    fixture([{ type: "pass", target: "o3", delay: 0 }, { type: "pass", target: "o4", delay: 0 }]),
    fixture([{ type: "lateral", target: "missing", delay: 0 }]),
  ];
  const outcomes = [];
  for (const f of cases) {
    const m = buildMotion(f.players, -16, undefined, f.ballPlan);
    expect(m.ballError).toBeTruthy();
    expect(m.kind).toBe("hold");
    await seed(page, { draft: f });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Run the play", exact: true })).toBeDisabled();
    await expect(page.getByText(m.ballError ?? "missing validation", { exact: true }).first()).toBeVisible();
    outcomes.push({ plan: f.ballPlan, error: m.ballError });
  }
  await page.screenshot({ path: info.outputPath("lateral-validation.png") });
  await writeFile(info.outputPath("lateral-validation.json"), JSON.stringify(outcomes, null, 2));
});

test("a chain can finish with a run; its diagrams and no-run flag agree with the assignment", async ({ page }, info) => {
  const f = { ...fixture([{ type: "lateral", target: "o5", delay: 0.2 }]), los: 35 };
  await seed(page, { draft: f });
  const d = new Designer(page);
  await d.goto();
  await expect(d.field.locator("[data-no-run-flag]")).toHaveCount(1);
  expect(buildMotion(f.players, -16, undefined, f.ballPlan).kind).toBe("run");
  const svg = playSvg(f.players, { side: f.side, ballPlan: f.ballPlan, los: f.los });
  expect(svg).toContain("data-no-run-flag");
  expect(svg).toContain('data-ball-step="1"');
  await d.palette();
  await page.getByText("Ball assignments", { exact: true }).click();
  await page.getByRole("button", { name: "Clear ball assignments", exact: true }).click();
  await expect.poll(async () => (await storedDraft(page))?.ballPlan).toBeUndefined();
  await d.undo.click();
  await expect.poll(async () => (await storedDraft(page))?.ballPlan).toEqual(f.ballPlan);
  await writeFile(info.outputPath("lateral-run.svg"), svg);
});

test("export and import on another device preserve the chain and distinguish changed ball assignments", async ({ page, browser }, info) => {
  const f = fixture([{ type: "lateral", target: "o5", delay: 0.2 }, { type: "pass", target: "o3", delay: 0.2 }]);
  await seed(page, { plays: [f] });
  await page.goto("/playbooks");
  await page.getByRole("button", { name: `More actions for ${f.name}` }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export play file", exact: true }).click()]);
  const text = await downloadText(download);
  const read = readTransfer(text);
  expect(read.ok && read.file.kind === "ffpd.play" && read.file.play.ballPlan).toEqual(f.ballPlan);
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const recipient = await other.newPage();
    await recipient.goto("/playbooks");
    await recipient.getByLabel("Import a play file").setInputFiles(jsonUpload("laterals.play.json", text));
    await recipient.getByRole("button", { name: "Import play", exact: true }).click();
    await expect.poll(async () => (await storedPlays(recipient))[f.id]?.ballPlan).toEqual(f.ballPlan);
    // Same routes, id and name; only the ball plan changed. Import must create a copy.
    const changed = { ...f, ballPlan: [{ type: "lateral" as const, target: "o5", delay: 0.4 }] };
    await recipient.getByLabel("Import a play file").setInputFiles(jsonUpload("changed.play.json", encodePlayFile(changed)));
    await expect(recipient.getByRole("region", { name: "Import preview" })).toContainText("1 copied");
    await recipient.getByRole("button", { name: "Import play", exact: true }).click();
    await expect.poll(async () => Object.keys(await storedPlays(recipient)).length).toBe(2);
    await recipient.reload();
    expect(Object.values(await storedPlays(recipient)).map(p => p.ballPlan)).toEqual([f.ballPlan, changed.ballPlan]);
    await writeFile(info.outputPath("lateral-export-import.json"), JSON.stringify(await storedPlays(recipient), null, 2));
  } finally { await other.close(); }
});
