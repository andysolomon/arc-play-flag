import { expect, type Locator } from "@playwright/test";

/**
 * Fails if any words inside `scope` are drawn cut off with no way to read them whole: a box that hides or
 * scrolls its overflow and is narrower than its words (or, hiding it, shorter), unless its title holds those
 * words, as <NameText oneLine> does. A text field is left out, since its whole text is a caret away, and so
 * are words drawn for a screen reader alone (`sr-only`, one pixel wide).
 * Returns what it read, for the journey's evidence file.
 */
export async function expectNoClippedText(scope: Locator): Promise<{ checked: number; clipped: string[] }> {
  const seen = await scope.evaluate((root) => {
    const boxes = [root, ...root.querySelectorAll("*")].filter((el): el is HTMLElement =>
      el instanceof HTMLElement && !el.matches("input, textarea, select") && el.clientWidth > 1 && (el.textContent?.trim() ?? "") !== "");
    const clipped = boxes.filter((el) => {
      const style = getComputedStyle(el);
      const wide = style.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1;
      const tall = (style.overflowY === "hidden" || style.overflowY === "clip") && el.scrollHeight > el.clientHeight + 1;
      return (wide || tall) && el.title.trim() !== el.textContent?.trim();
    });
    return { checked: boxes.length, clipped: clipped.map((el) => `“${el.textContent?.trim() ?? ""}” in <${el.tagName.toLowerCase()} class="${el.className}">`) };
  });
  expect(seen.clipped, "words drawn cut off, with no title holding them whole").toEqual([]);
  return seen;
}
