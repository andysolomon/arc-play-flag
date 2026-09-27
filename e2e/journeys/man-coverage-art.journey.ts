import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Designer, downloadBytes } from "../support/designer";
import { BUNCH_MAN_D, COVER_ONE_D, OTTERS, SLANT_LEFT, playbook, seed, storedDraft, storedPlays } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * Man coverage in play art. A man defender whose receiver is not in the picture wears a name
 * tag ("on X") instead of an arrow to nobody, and a defensive call carries a Madden-style
 * coverage stamp. A play can include the other team, faded, in its pictures; then the arrows
 * point at real receivers again. Each test leaves a manifest of what every surface drew
 * (test-results/man-coverage-*.json, asserted equal to the literal below before it is written),
 * the snapshot previews' exact SVG with their sha256, and screenshots, a grey one for mono print.
 */

/** Man arrows are the only paths with the man dash. */
const manArrows = (l: Locator) => l.locator('path[stroke-dasharray="10 8"]');
const tags = (l: Locator) => l.locator("[data-man-tag]");
const stamp = (l: Locator) => l.locator("[data-coverage]");
const shadowTile = (page: Page) =>
  page.getByRole("group", { name: "Shadow offense" }).getByRole("button", { name: "Shadow offense", exact: true });
const inArt = (page: Page, team: "Offense" | "Defense") => page.locator("#play-sidebar").getByRole("checkbox", { name: `${team} in play art` });

interface Drawn {
  manArrows: number;
  tags: { id: string; text: string; place: string }[];
  stamp: string | null;
  offense: number;
  defense: number;
  /** offensive players drawn at the shadow's fade */
  fadedOffense: number;
}

/** What a picture drew, read off its markup: the same reading for static art and the live field. */
async function drawn(l: Locator): Promise<Drawn> {
  return l.evaluate((root) => {
    const faded = (el: Element): boolean => {
      for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
        const o = e.getAttribute("opacity") ?? getComputedStyle(e).opacity;
        if (o && Number(o) < 1) return true;
      }
      return false;
    };
    const tokens = (fill: string) => Array.from(root.querySelectorAll(`circle[r="23"][fill="${fill}"]`));
    return {
      manArrows: root.querySelectorAll('path[stroke-dasharray="10 8"]').length,
      tags: Array.from(root.querySelectorAll("[data-man-tag]")).map((g) => ({
        id: g.getAttribute("data-man-tag") ?? "", text: g.textContent ?? "", place: g.getAttribute("data-place") ?? "",
      })),
      stamp: root.querySelector("[data-coverage]")?.textContent ?? null,
      offense: tokens("#e5675e").length,
      defense: tokens("#4a8fe0").length,
      fadedOffense: tokens("#e5675e").filter(faded).length,
    };
  });
}

interface Geometry {
  id: string;
  /** inside the art, 0..660 across and 0..its height down */
  inside: boolean;
  /** touches its own defender's ring */
  attached: boolean;
  /** clear of every other tag, every other player and every zone bubble */
  clear: boolean;
  /** the letters, measured in the real face, sit inside the tag */
  fits: boolean;
}

/** Where each tag landed, measured in the page against the picture's own players and bubbles. */
async function geometry(svg: Locator): Promise<Geometry[]> {
  return svg.evaluate(async (el) => {
    await document.fonts.ready;
    const root = el instanceof SVGSVGElement ? el : el.querySelector("svg");
    if (!root) return [];
    const [, , vw, vh] = (root.getAttribute("viewBox") ?? "0 0 0 0").split(" ").map(Number);
    const spot = (g: Element) => /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform") ?? "");
    const tokens = Array.from(root.querySelectorAll('circle[r="23"]')).flatMap((c) => {
      const m = c.parentElement && spot(c.closest("g[transform]") ?? c.parentElement);
      return m ? [{ cx: Number(m[1]), cy: Number(m[2]), id: (c.closest("[aria-label]")?.getAttribute("aria-label") ?? "").replace(/^Defense /, "") }] : [];
    });
    const bubbles = Array.from(root.querySelectorAll("ellipse")).map((e) => ({
      cx: Number(e.getAttribute("cx")), cy: Number(e.getAttribute("cy")), rx: Number(e.getAttribute("rx")), ry: Number(e.getAttribute("ry")),
    }));
    const boxes = Array.from(root.querySelectorAll("[data-man-tag]")).map((g) => {
      const r = g.querySelector("rect"), t = g.querySelector("text");
      const n = (k: string) => Number(r?.getAttribute(k));
      return { id: g.getAttribute("data-man-tag") ?? "", x: n("x"), y: n("y"), w: n("width"), h: n("height"), text: t?.getBBox() };
    });
    const hitsCircle = (b: { x: number; y: number; w: number; h: number }, cx: number, cy: number, r: number) => {
      const nx = Math.max(b.x, Math.min(cx, b.x + b.w)), ny = Math.max(b.y, Math.min(cy, b.y + b.h));
      return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r;
    };
    const gap = (b: { x: number; y: number; w: number; h: number }, t: { cx: number; cy: number }) =>
      Math.hypot(Math.max(b.x, Math.min(t.cx, b.x + b.w)) - t.cx, Math.max(b.y, Math.min(t.cy, b.y + b.h)) - t.cy);
    // the live field names each token "Defense d1"; static art has no names, so its own token is the closest one
    const own = (b: (typeof boxes)[number]) => tokens.find((t) => t.id === b.id)
      ?? tokens.reduce((m, t) => (gap(b, t) < gap(b, m) ? t : m));
    return boxes.map((b) => {
      const mine = own(b);
      const others = tokens.filter((t) => t !== mine);
      const overlapsTag = boxes.some((o) => o !== b && o.x < b.x + b.w && b.x < o.x + o.w && o.y < b.y + b.h && b.y < o.y + o.h);
      const overlapsBubble = bubbles.some((e) => hitsCircle({ x: (b.x - e.cx) / e.rx, y: (b.y - e.cy) / e.ry, w: b.w / e.rx, h: b.h / e.ry }, 0, 0, 1));
      return {
        id: b.id,
        inside: b.x >= 0 && b.y >= 0 && b.x + b.w <= (vw ?? 0) && b.y + b.h <= (vh ?? 0),
        attached: hitsCircle(b, mine.cx, mine.cy, 24),
        clear: !overlapsTag && !overlapsBubble && !others.some((t) => hitsCircle(b, t.cx, t.cy, 23)),
        fits: !!b.text && b.text.x >= b.x && b.text.x + b.text.width <= b.x + b.w,
      };
    });
  });
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Screenshots the picture as printed in colour and in grey, the way a mono printer sees it. */
async function shoot(l: Locator, path: string): Promise<void> {
  await l.screenshot({ path: `${path}.png` });
  await l.evaluate((el) => { (el as HTMLElement).style.filter = "grayscale(1)"; });
  await l.screenshot({ path: `${path}-mono.png` });
  await l.evaluate((el) => { (el as HTMLElement).style.filter = ""; });
}

const TAGS_COVER_ONE = [
  { id: "d1", text: "on X", place: "below" },
  { id: "d2", text: "on C", place: "below" },
  { id: "d4", text: "on Y", place: "below" },
];
const TAGGED: Drawn = { manArrows: 0, tags: TAGS_COVER_ONE, stamp: "MAN", offense: 0, defense: 5, fadedOffense: 0 };
const WITH_OFFENSE: Drawn = { manArrows: 3, tags: [], stamp: "MAN", offense: 5, defense: 5, fadedOffense: 5 };

test("a man defender wears a name tag, not an arrow to nobody, wherever the offense is left off", async ({ page }, testInfo) => {
  const out = `test-results/man-coverage-${testInfo.project.name}`;
  await seed(page, { plays: [COVER_ONE_D, SLANT_LEFT], playbooks: [playbook("fx-mca", "Otter Coverage Book", [COVER_ONE_D, SLANT_LEFT])], team: OTTERS });
  const d = new Designer(page);
  const manifest: Record<string, unknown> = {};

  // a defensive call opens with the shadow offense, so the arrows have someone to point at
  await d.goto("?open=fx-cover-one-d");
  await expect(manArrows(d.field)).toHaveCount(3);
  await expect(tags(d.field)).toHaveCount(0);
  manifest.designerWithShadow = await drawn(d.field);

  // hide it, and each man defender says who they have instead
  await d.tools();
  await shadowTile(page).click();
  await expect(shadowTile(page)).toHaveAttribute("aria-pressed", "false");
  await expect(inArt(page, "Offense")).not.toBeChecked();
  await d.closeSidebars();
  await expect(manArrows(d.field)).toHaveCount(0);
  await expect(tags(d.field)).toHaveCount(3);
  await expect(d.field.locator('[data-man-tag="d1"]')).toHaveText("on X");
  await expect(d.field.locator('[data-man-tag="d2"]')).toHaveText("on C");
  await expect(d.field.locator('[data-man-tag="d4"]')).toHaveText("on Y");
  // the blitzer's arrow and the deep zone are drawn as ever; the designer shows no stamp
  await expect(d.routes).toHaveCount(2);
  await expect(stamp(d.field)).toHaveCount(0);
  await expect(d.field.locator("desc")).toContainText("Man coverage: Defender 1 on X; Defender 2 on C; Defender 5 on Y.");
  manifest.designer = await drawn(d.field);
  manifest.designerGeometry = await geometry(d.field);
  await d.field.screenshot({ path: `${out}-designer.png` });

  // a tag never takes a tap from the defender it hangs off
  await d.select("d1", "Defense");
  await expect(page.getByRole("heading", { name: "Pick a coverage" })).toBeVisible();
  await expect(page.locator("#route-sidebar").getByRole("button", { name: "Man", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // the share snapshot, where the confusing picture was noticed
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  const preview = dialog.getByRole("img", { name: /^Defense snapshot preview/ });
  await expect(dialog.getByRole("checkbox", { name: "Offense in play art" })).not.toBeChecked();
  await expect(tags(preview)).toHaveCount(3);
  manifest.snapshot = await drawn(preview);
  manifest.snapshotGeometry = await geometry(preview);
  const svg = await preview.innerHTML();
  writeFileSync(`${out}-snapshot.svg`, svg);
  manifest.snapshotSha256 = sha(svg);
  await shoot(preview, `${out}-snapshot`);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(Buffer.from(url.split("/p/")[1] ?? "", "base64url").toString("utf8"))).not.toHaveProperty("artShadow");

  // the link: the call, its coverage in words, the tags; still no offense
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(page.getByText("Defensive call · Man coverage · Snapshot")).toBeAttached();
  await expect(shared.getByRole("img", { name: /^Offense / })).toHaveCount(0);
  await expect(tags(shared)).toHaveCount(3);
  manifest.sharePage = await drawn(shared);

  // the gallery, the playbook's export preview, and a printout
  await page.goto("/playbooks");
  const thumb = page.getByRole("img", { name: "Otter Cover One, man coverage" }).first();
  await expect(thumb).toBeVisible();
  manifest.thumbnail = await drawn(thumb);
  const slant = page.getByRole("img", { name: "Otter Slant Left" }).first();
  await expect(slant).toBeVisible();
  manifest.offensiveThumbnail = await drawn(slant);

  await page.goto("/playbooks?book=fx-mca");
  const exportPreview = page.getByRole("img", { name: "Playbook PDF preview" });
  await expect(exportPreview).toBeVisible();
  manifest.exportPreview = await drawn(exportPreview);
  const [pdf] = await Promise.all([page.waitForEvent("download", { timeout: 40_000 }), page.getByRole("button", { name: "Download binder PDF" }).click()]);
  expect((await downloadBytes(pdf)).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  const ok = { id: "", inside: true, attached: true, clear: true, fits: true };
  expect(manifest).toEqual({
    designerWithShadow: { ...WITH_OFFENSE, stamp: null },
    designer: { ...TAGGED, stamp: null },
    designerGeometry: ["d1", "d2", "d4"].map((id) => ({ ...ok, id })),
    snapshot: TAGGED,
    snapshotGeometry: ["d1", "d2", "d4"].map((id) => ({ ...ok, id })),
    snapshotSha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    sharePage: { ...TAGGED, stamp: null },
    thumbnail: TAGGED,
    offensiveThumbnail: { manArrows: 0, tags: [], stamp: null, offense: 5, defense: 0, fadedOffense: 0 },
    exportPreview: TAGGED,
  });
  writeFileSync(`${out}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
});

test("a coach includes the offense in a defensive call's play art, and the saved play, pictures and link follow", async ({ page }, testInfo) => {
  const out = `test-results/man-coverage-${testInfo.project.name}-included`;
  await seed(page, { plays: [COVER_ONE_D, SLANT_LEFT], team: OTTERS });
  const d = new Designer(page);
  const manifest: Record<string, unknown> = {};

  await d.goto("?open=fx-cover-one-d");
  await d.tools();
  await shadowTile(page).click();
  await expect(shadowTile(page)).toHaveAttribute("aria-pressed", "false");

  // ticking it puts the offense back on the field too, so the coach sees what prints
  await inArt(page, "Offense").check();
  await expect(shadowTile(page)).toHaveAttribute("aria-pressed", "true");
  // the play now differs from its saved record: the draft keeps it until Save
  await expect(page.getByText("Draft autosaved", { exact: true })).toBeVisible();
  await expect.poll(async () => (await storedDraft(page))?.artShadow).toBe(true);
  // hiding the field's shadow while editing leaves the pictures' choice alone
  await shadowTile(page).click();
  await expect(inArt(page, "Offense")).toBeChecked();
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  expect((await storedPlays(page))["fx-cover-one-d"]?.artShadow).toBe(true);

  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  const preview = dialog.getByRole("img", { name: "Defense snapshot preview, the offense faded" });
  await expect(dialog.getByRole("checkbox", { name: "Offense in play art" })).toBeChecked();
  await expect(manArrows(preview)).toHaveCount(3);
  manifest.snapshot = await drawn(preview);
  const svg = await preview.innerHTML();
  writeFileSync(`${out}-snapshot.svg`, svg);
  manifest.snapshotSha256 = sha(svg);
  await shoot(preview, `${out}-snapshot`);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(Buffer.from(url.split("/p/")[1] ?? "", "base64url").toString("utf8"))).toMatchObject({ artShadow: true, side: "defense" });

  // the link draws the offense faded, arrows to them, and opens back with the choice kept
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared.getByRole("img", { name: /^Offense / })).toHaveCount(5);
  await expect(shared.getByRole("img", { name: "Offense X" })).toHaveCSS("opacity", "0.4");
  manifest.sharePage = await drawn(shared);
  await page.getByRole("link", { name: "Open in designer ›" }).click();
  await expect(d.field).toBeVisible();
  await d.tools();
  await expect(inArt(page, "Offense")).toBeChecked();
  await expect.poll(async () => (await storedDraft(page))?.artShadow).toBe(true);

  await page.goto("/playbooks");
  const thumb = page.getByRole("img", { name: "Otter Cover One, man coverage" }).first();
  await expect(thumb).toBeVisible();
  manifest.thumbnail = await drawn(thumb);

  // unticked from the share dialog: the snapshot drops the offense, and the saved play carries no trace of the choice
  await d.goto("?open=fx-cover-one-d");
  await d.clickTool("Copy share link");
  await dialog.getByRole("checkbox", { name: "Offense in play art" }).uncheck();
  await expect(dialog.getByRole("img", { name: "Defense snapshot preview" })).not.toHaveAccessibleName(/faded/);
  manifest.snapshotUnticked = await drawn(dialog.getByRole("img", { name: /^Defense snapshot preview/ }));
  await dialog.getByRole("button", { name: "Close share dialog" }).click();
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  expect(Object.keys((await storedPlays(page))["fx-cover-one-d"] ?? {})).not.toContain("artShadow");

  // an offensive play can include the defense the same way
  await d.goto("?open=fx-slant-left");
  await d.tools();
  await inArt(page, "Defense").check();
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  await page.goto("/playbooks");
  const slant = page.getByRole("img", { name: "Otter Slant Left" }).first();
  await expect(slant).toBeVisible();
  manifest.offensiveThumbnail = await drawn(slant);
  await expect(slant.locator('g[opacity="0.4"] circle[fill="#4a8fe0"]')).toHaveCount(5);

  expect(manifest).toEqual({
    snapshot: WITH_OFFENSE,
    snapshotSha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    sharePage: { ...WITH_OFFENSE, stamp: null },
    thumbnail: WITH_OFFENSE,
    snapshotUnticked: TAGGED,
    // the defense is faded context on an offensive play: no stamp, and every man target is drawn
    offensiveThumbnail: { manArrows: 0, tags: [], stamp: null, offense: 5, defense: 5, fadedOffense: 0 },
  });
  writeFileSync(`${out}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
});

test("bunched man defenders keep their tags on the field, clear of each other, the players and the zones", async ({ page }, testInfo) => {
  const out = `test-results/man-coverage-${testInfo.project.name}-bunch`;
  await seed(page, { plays: [BUNCH_MAN_D], team: OTTERS });
  const d = new Designer(page);
  await d.goto("?open=fx-bunch-man-d");
  await d.tools();
  await shadowTile(page).click();
  await d.closeSidebars();
  await expect(tags(d.field)).toHaveCount(4);

  await page.goto("/playbooks");
  const thumb = page.getByRole("img", { name: "Otter Bunch Man, man and zone coverage" }).first();
  await expect(thumb).toBeVisible();

  // left to right: the defender beside two others and a flat bubble goes over the top
  const bunch = [
    { id: "d5", text: "on C", place: "below" },
    { id: "d3", text: "on Y", place: "below" },
    { id: "d2", text: "on Player 1", place: "above" },
    { id: "d1", text: "on X", place: "below" },
  ];
  const manifest = { thumbnail: await drawn(thumb), thumbnailGeometry: await geometry(thumb) };
  await thumb.screenshot({ path: `${out}.png` });
  expect(manifest).toEqual({
    thumbnail: { manArrows: 0, tags: bunch, stamp: "MAN + ZONE", offense: 0, defense: 5, fadedOffense: 0 },
    thumbnailGeometry: bunch.map(({ id }) => ({ id, inside: true, attached: true, clear: true, fits: true })),
  });
  writeFileSync(`${out}.json`, `${JSON.stringify(manifest, null, 2)}\n`);

  await d.goto("?open=fx-bunch-man-d");
  await d.tools();
  await shadowTile(page).click();
  await d.closeSidebars();
  // the designer lays them out with the same rule
  expect(await drawn(d.field)).toMatchObject({ manArrows: 0, tags: bunch, offense: 0 });
  expect((await geometry(d.field)).every((g) => g.inside && g.attached && g.clear && g.fits)).toBe(true);
});
