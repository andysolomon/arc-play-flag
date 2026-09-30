import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Designer } from "../support/designer";

/**
 * On a phone the route palette floats over the field and fits the screen (ARC-183: at 390×844 it
 * once ran past the right edge, clipping In, Corner, Post and Cross, and squeezed the field into a
 * strip). How this could break, and the check that catches each:
 *  - the drawer is wider than the screen, or sits past its right edge                → "drawer" inside the viewport
 *  - a tile is clipped at the edge, or the drawer's own content scrolls sideways     → every tile inside the viewport, no sideways scroll in the drawer
 *  - the page itself scrolls sideways, so the palette only fits once scrolled         → no ancestor scrolled, document no wider than the screen
 *  - a tile is on screen but something is drawn over it, so a tap misses            → a hit test at each tile's centre lands on that tile
 *  - the palette squeezes the field into a strip instead of floating over it         → the field's box is the same with the palette open as closed
 *  - Play tools and the palette open side by side and push each other off screen     → opening one folds the other
 *  - a right-column choice looks fine but a real tap does not assign it              → tap Post (offense) and Zone flat (defense), then see it pressed (and Post drawn)
 * Checked for the offense palette (routes and runs) and the defense palette (coverages), at the
 * issue's 390×844 and the narrowest phone the app supports, 320×568, on every device project.
 * Leaves `phone-palette-<device>-<width>.json` (the viewport, the field closed and open, the drawer,
 * and every tile's box and hit test) and a picture of each palette in test-results/.
 */

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface Tile extends Box { label: string; group: string; hit: boolean }
interface Layout {
  viewport: { width: number; height: number };
  documentScrollWidth: number;
  scrolledAncestors: string[];
  drawer: Box;
  drawerScrollWidth: number;
  drawerClientWidth: number;
  tiles: Tile[];
}
interface FieldBox { x: number; y: number; width: number; height: number }
interface Report {
  palette: "offense" | "defense";
  fieldClosed: FieldBox | null;
  fieldOpen: FieldBox | null;
  layout: Layout;
  tapped: string;
}

/**
 * Reads the open palette as it sits: every box is taken before anything scrolls, so a scroll can't
 * bring a clipped tile back on screen. The hit tests then scroll only the drawer, up and down.
 */
async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 10) / 10;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) };
    };
    const drawer = document.getElementById("route-sidebar") as HTMLElement;
    const scroller = drawer.firstElementChild as HTMLElement;
    const buttons = [...drawer.querySelectorAll<HTMLElement>("[role='group'] button")].map((b) => ({ b, at: box(b) }));
    const scrolledAncestors: string[] = [];
    for (let el: Element | null = drawer; el; el = el.parentElement) {
      if (el.scrollLeft !== 0) scrolledAncestors.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} scrollLeft=${String(el.scrollLeft)}`);
    }
    const tiles = buttons.map(({ b, at }) => {
      // bring the tile into the drawer's view vertically, never sideways
      const s = scroller.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      if (r.top < s.top || r.bottom > s.bottom) scroller.scrollTop += r.top - s.top - 8;
      const now = b.getBoundingClientRect();
      const hit = document.elementFromPoint(now.left + now.width / 2, now.top + now.height / 2);
      return {
        label: (b.textContent ?? "").trim(),
        group: b.closest("[role='group']")?.getAttribute("aria-label") ?? "",
        ...at,
        hit: !!hit && b.contains(hit),
      };
    });
    scroller.scrollTop = 0;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      scrolledAncestors,
      drawer: box(drawer),
      drawerScrollWidth: scroller.scrollWidth,
      drawerClientWidth: scroller.clientWidth,
      tiles,
    };
  });
}

function expectFits(l: Layout, groups: string[]): void {
  const vw = l.viewport.width;
  expect(l.documentScrollWidth, "the page does not scroll sideways").toBeLessThanOrEqual(vw);
  expect(l.scrolledAncestors, "nothing was scrolled sideways to show the palette").toEqual([]);
  expect(l.drawer.left, "the drawer starts on screen").toBeGreaterThanOrEqual(0);
  expect(l.drawer.right, "the drawer ends on screen").toBeLessThanOrEqual(vw);
  expect(l.drawerScrollWidth, "the drawer's content does not scroll sideways").toBeLessThanOrEqual(l.drawerClientWidth);
  expect([...new Set(l.tiles.map((t) => t.group))].sort()).toEqual([...groups].sort());
  for (const t of l.tiles) {
    expect(t.left, `${t.label} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(t.right, `${t.label} ends on screen`).toBeLessThanOrEqual(vw);
    expect(t.width, `${t.label} is a 44px target`).toBeGreaterThanOrEqual(44);
    expect(t.hit, `a tap at the centre of ${t.label} lands on it`).toBe(true);
  }
}

/** The three columns hold: the right-hand one is where ARC-183 clipped. */
function rightColumn(l: Layout, group: string): string[] {
  const tiles = l.tiles.filter((t) => t.group === group);
  const right = Math.max(...tiles.map((t) => t.left));
  return tiles.filter((t) => t.left === right).map((t) => t.label);
}

for (const size of SIZES) {
  test(`at ${String(size.width)}×${String(size.height)} the route palette fits the screen, every choice can be tapped, and the field keeps its size`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    const d = new Designer(page);
    const reports: Report[] = [];
    const shot = (name: string) => `test-results/phone-palette-${testInfo.project.name}-${String(size.width)}-${name}.png`;
    const drawer = page.locator("#route-sidebar");
    const tile = (group: string, label: string) => drawer.getByRole("group", { name: group }).getByRole("button", { name: label, exact: true });

    // offense: the passing tree and the run game
    await d.goto();
    await d.settle();
    const fieldClosed = await d.field.boundingBox();
    await d.select("C");
    await d.settle();
    const offense = await layout(page);
    const fieldOpen = await d.field.boundingBox();
    await page.screenshot({ path: shot("offense") });
    expectFits(offense, ["Routes", "Runs"]);
    expect(rightColumn(offense, "Routes"), "the right-hand column ARC-183 clipped").toEqual(["In", "Post", "Cross"]);
    expect(fieldOpen, "the palette floats over the field instead of squeezing it").toEqual(fieldClosed);

    // Play tools and the palette take turns: opening one folds the other
    await d.tools();
    await expect(drawer).toHaveAttribute("aria-hidden", "true");
    await d.palette();
    await expect(page.locator("#play-sidebar")).toHaveAttribute("aria-hidden", "true");

    // a real tap on a right-column route assigns it (the palette folds away on a phone, so open it again to read it)
    const routes = await d.routes.count();
    await tile("Routes", "Post").click();
    await expect(d.routes).toHaveCount(routes + 1);
    await d.palette();
    await expect(tile("Routes", "Post")).toHaveAttribute("aria-pressed", "true");
    reports.push({ palette: "offense", fieldClosed, fieldOpen, layout: offense, tapped: "Post" });

    // defense: the coverages
    await d.newPlay("Defense");
    await d.foldOverlays();
    await d.settle();
    const defClosed = await d.field.boundingBox();
    await d.select("LC", "Defense");
    await d.settle();
    const defense = await layout(page);
    const defOpen = await d.field.boundingBox();
    await page.screenshot({ path: shot("defense") });
    expectFits(defense, ["Coverages"]);
    expect(rightColumn(defense, "Coverages")).toEqual(["Zone flat", "Blitz", "Done"]);
    expect(defOpen, "the palette floats over the field instead of squeezing it").toEqual(defClosed);

    await tile("Coverages", "Zone flat").click();
    await d.palette();
    await expect(tile("Coverages", "Zone flat")).toHaveAttribute("aria-pressed", "true");
    reports.push({ palette: "defense", fieldClosed: defClosed, fieldOpen: defOpen, layout: defense, tapped: "Zone flat" });

    writeFileSync(
      `test-results/phone-palette-${testInfo.project.name}-${String(size.width)}.json`,
      `${JSON.stringify({ issue: "ARC-183", device: testInfo.project.name, size, reports }, null, 2)}\n`,
    );
  });
}
