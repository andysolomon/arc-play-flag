import { expect, type Locator, type Page } from "@playwright/test";
import { S, VW } from "../../lib/play/geometry";

/**
 * The designer as a coach drives it: the two sidebars, the field, the palette, and the
 * toast under the header. Every helper waits on what a person would see.
 */
export class Designer {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  /** The toast pill. The export panel also has role=status, but only the toast is a div. */
  get toast(): Locator {
    return this.page.locator("div[role='status']");
  }
  get field(): Locator {
    return this.page.locator("[aria-label='Play diagram']");
  }
  get nameInput(): Locator {
    return this.page.getByRole("textbox", { name: "Play name" });
  }
  get openSelect(): Locator {
    return this.page.getByRole("combobox", { name: "Open a saved play" });
  }
  get undo(): Locator {
    return this.page.getByRole("button", { name: "Undo", exact: true });
  }
  get redo(): Locator {
    return this.page.getByRole("button", { name: "Redo", exact: true });
  }
  /** Routes drawn on the field (route paths are round-capped; the dashed draft path is not). */
  get routes(): Locator {
    return this.field.locator("path[stroke-linecap='round']");
  }
  /** The primary read is drawn in its own red. */
  get primaryRoutes(): Locator {
    return this.field.locator("path[stroke='#c2261a']");
  }

  async goto(query = ""): Promise<void> {
    await this.page.goto(`/${query}`);
    await expect(this.field).toBeVisible();
  }

  /** Opens a sidebar from its header toggle unless it is already open. */
  private async open(name: "Play tools" | "Route palette", id: string): Promise<void> {
    const toggle = this.page.getByRole("button", { name });
    // the first tap after a navigation can land before React has hydrated; tap again if it did
    await expect(async () => {
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass();
    await expect(this.page.locator(`#${id}`)).toHaveAttribute("aria-hidden", "false");
    await this.settle();
  }

  /** Folds both sidebars away so the field sits still where a tap will land. */
  async closeSidebars(): Promise<void> {
    for (const name of ["Play tools", "Route palette"] as const) {
      const toggle = this.page.getByRole("button", { name });
      if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    await this.settle();
  }

  /** Waits until the field stops moving (sidebars fold, the pane re-measures). */
  async settle(): Promise<void> {
    await expect(async () => {
      const a = await this.field.boundingBox();
      await this.page.waitForTimeout(60);
      const b = await this.field.boundingBox();
      expect(a).toEqual(b);
    }).toPass();
  }
  async tools(): Promise<void> {
    await this.open("Play tools", "play-sidebar");
  }
  async palette(): Promise<void> {
    await this.open("Route palette", "route-sidebar");
  }

  /** A tile or pill in the Play tools sidebar, by its visible label. */
  async tool(label: string): Promise<Locator> {
    await this.tools();
    return this.page.locator("#play-sidebar").getByRole("button", { name: label, exact: true });
  }
  async clickTool(label: string): Promise<void> {
    await (await this.tool(label)).click();
  }

  async setName(name: string): Promise<void> {
    await this.tools();
    await this.nameInput.fill(name);
  }

  async save(): Promise<void> {
    await this.clickTool("Save");
  }

  /** Tapping a player selects it and opens the palette. */
  player(label: string, team: "Offense" | "Defense" = "Offense"): Locator {
    return this.field.getByRole("button", { name: `${team} ${label}`, exact: true });
  }
  async select(label: string, team: "Offense" | "Defense" = "Offense"): Promise<void> {
    await expect(async () => {
      await this.player(label, team).click();
      await expect(this.player(label, team)).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass();
    await this.palette();
  }

  /** Picks a route or coverage tile for the selected player. */
  async pick(label: string): Promise<void> {
    await this.palette();
    const groups = this.page.locator("#route-sidebar").getByRole("group");
    await groups.getByRole("button", { name: label, exact: true }).click();
  }

  get primaryButton(): Locator {
    return this.page.locator("#route-sidebar").getByRole("button", { name: /Primary read|Mark primary/ });
  }
  get mirrorButton(): Locator {
    return this.page.locator("#route-sidebar").getByRole("button", { name: "⇄ Mirror route" });
  }

  /**
   * Client coordinates of a yard point on the field, from the SVG's own viewBox
   * (`0 0 660 depth×22`), so a click lands where the app will read it back.
   */
  async yardPoint(x: number, y: number): Promise<{ x: number; y: number }> {
    const box = await this.field.boundingBox();
    const viewBox = await this.field.getAttribute("viewBox");
    if (!box || !viewBox) throw new Error("the field has not laid out");
    const vh = Number(viewBox.split(" ")[3]);
    const top = 8 - vh / S;
    return {
      x: box.x + ((x * S) / VW) * box.width,
      y: box.y + (((y - top) * S) / vh) * box.height,
    };
  }
  /** Taps a yard point on the open field. A tap outside a sidebar folds it away, so they are closed first. */
  async tapField(x: number, y: number): Promise<void> {
    await this.closeSidebars();
    const pt = await this.yardPoint(x, y);
    await this.page.mouse.click(pt.x, pt.y);
  }
  async doubleTapField(x: number, y: number): Promise<void> {
    await this.closeSidebars();
    const pt = await this.yardPoint(x, y);
    await this.page.mouse.dblclick(pt.x, pt.y);
  }

  /** Opens a saved play from the sidebar's select. */
  async openSaved(name: string): Promise<void> {
    await this.tools();
    await this.openSelect.selectOption({ label: name });
  }

  /** The x position (in yards) a player is drawn at, read from its transform. */
  async playerX(label: string, team: "Offense" | "Defense" = "Offense"): Promise<number> {
    const t = await this.player(label, team).getAttribute("transform");
    const m = /translate\(([-\d.]+),/.exec(t ?? "");
    if (!m?.[1]) throw new Error(`no transform on ${team} ${label}`);
    return Number(m[1]) / S;
  }
}

/** A flag the app's storage or canvas checks, set by the test to make a write or a draw fail. */
export type Sabotage = "quota" | "noCanvas";

/**
 * Installed before any page script runs. Storage writes throw QuotaExceededError while
 * the quota flag is up, and canvases refuse a 2D context while the noCanvas flag is up,
 * so the tests can exercise the app's failure states without filling a real disk.
 */
export async function armSabotage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, boolean | undefined>;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .call below
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (w.__ffpdQuota) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      setItem.call(this, key, value);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .apply below
    const getContext = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...a: unknown[]) => unknown;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...a: unknown[]) {
      if (w.__ffpdNoCanvas) return null;
      return getContext.apply(this, a);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

export async function sabotage(page: Page, what: Sabotage, on: boolean): Promise<void> {
  await page.evaluate(
    ([k, v]) => { (window as unknown as Record<string, boolean>)[k] = v; },
    [what === "quota" ? "__ffpdQuota" : "__ffpdNoCanvas", on] as const,
  );
}

/** Reads a download the app produced, as text. */
export async function downloadText(download: { path: () => Promise<string> }): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(await download.path(), "utf8");
}
export async function downloadBytes(download: { path: () => Promise<string> }): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(await download.path());
}
