import type { Page } from "@playwright/test";

/**
 * Records the markup of every SVG page the app rasterises, exactly as it draws it: each one is set as
 * an image's `src` on its way to the canvas, so the recorder sits on that setter.
 */
export async function recordPages(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __ffpdPages?: string[] };
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .call below
    const set = src?.set;
    if (!src || !set) return;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...src,
      set(this: HTMLImageElement, v: string) {
        if (v.startsWith("data:image/svg+xml")) (w.__ffpdPages ??= []).push(decodeURIComponent(v.slice(v.indexOf(",") + 1)));
        set.call(this, v);
      },
    });
  });
}

/** Drops the pages recorded so far, so the next export's pages are the only ones read. */
export const forgetPages = (page: Page): Promise<void> =>
  page.evaluate(() => { (window as unknown as { __ffpdPages?: string[] }).__ffpdPages = []; });

/** The pages recorded since the last `forgetPages`, in the order they were drawn. */
export const recorded = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __ffpdPages?: string[] }).__ffpdPages ?? []);
