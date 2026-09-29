import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { END_ZONES, ENDZONE_KEY, TOUCHDOWNS_KEY, type EndZoneId } from "../../lib/endzone";
import { MIDFIELD_YARD } from "../../lib/play/field";
import type { SavedPlay } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { GOAL_LINE_FADE, OTTERS, SLANT_LEFT, seed } from "../support/fixtures";

/*
 * End zone performance. A design lives inside the field's one SVG, and every frame its animation
 * moves the band is rasterised again, on the main thread, so a design that is dear to paint makes
 * the whole app feel slow: Matrix once cost three times any other design a frame and moved on
 * nearly every frame, and a coach who picked it saw the app crawl. What could go wrong, and the
 * test (by the start of its title) that catches each:
 *
 *  - a design's band costs more than its budget to paint, on a phone-sized screen: a sliver of the
 *    end zone (a short window cutting the card) or the whole ten yards → "every design's band"
 *  - a design leans on what costs the most to repaint: a <pattern> or <filter>, a stroke painted
 *    with a gradient, or hundreds upon hundreds of elements → "every design's band"
 *  - the picker's swatches, drawn all at once, cost more than their budget → "the picker's swatches"
 *  - the Matrix rain falls off its lattice: a column on a clock of its own, a speed that doesn't
 *    divide 12 or a cursor that blinks off the beat, so the band repaints on nearly every frame
 *    again; or it repaints more than a dozen times a second in the browser → "the Matrix rain"
 *
 * Paint cost is measured in the page, by drawing the band's own SVG onto a canvas at its size on
 * this screen, and taken against a fixed calibration picture drawn the same way at the same
 * moment, so a budget holds on a slow runner and a fast one alike: "3 frames" means three times
 * what the calibration picture costs here. The budgets are about twice the most each design cost
 * across the four devices when they were set; what Matrix and Home Team cost before they were
 * drawn for repainting would fail theirs.
 *
 * Artifact, in test-results/: end-zones-perf-<device>.json, every design's cost (in ms and in
 * calibration frames) for the shallow band, the deep band and its swatch, with its budget, the
 * calibration frame's own cost, each design's element counts, how often each repaints in the
 * browser, and the Matrix clocks; asserted against the budgets below before it is written.
 */

/** A phone's window, and a short one: from midfield the tall one shows the whole end zone, the short one cuts the card to a sliver of it. */
const PHONE = { width: 412, height: 915 };
const SHORT_PHONE = { width: 412, height: 520 };
const WINDOWS = { shallow: SHORT_PHONE, deep: PHONE } as const;
/** A play spotted at midfield: the end zone is in the card on a phone. */
const MIDFIELD: SavedPlay = { ...SLANT_LEFT, los: MIDFIELD_YARD };

/** Paint budgets, in calibration frames, for the band with the ball on the 5 and near their goal, and for the swatch. */
const BUDGETS: Readonly<Record<EndZoneId, { shallow: number; deep: number; swatch: number }>> = {
  classic: { shallow: 0.3, deep: 0.3, swatch: 0.3 },
  home: { shallow: 1.3, deep: 4, swatch: 0.5 },
  synthwave: { shallow: 4.8, deep: 9, swatch: 3 },
  sakura: { shallow: 8, deep: 15, swatch: 6.5 },
  matrix: { shallow: 2.4, deep: 3.6, swatch: 1.3 },
  "great-wave": { shallow: 4.8, deep: 5.4, swatch: 2.6 },
  "eight-bit": { shallow: 0.7, deep: 0.6, swatch: 0.5 },
  "event-horizon": { shallow: 4, deep: 6.5, swatch: 2.6 },
};
/** How many times a second the Matrix band may repaint, in the browser, and the lattice its clocks tick on. */
const MATRIX_REPAINTS_PER_SECOND = 14;
const MATRIX_LATTICE_HZ = 12;
/** No design draws more elements than this on the deep band. */
const MOST_ELEMENTS = 450;

const art = (page: Page) => page.locator("[data-ez-backdrop] [data-ez-art]");

async function store(page: Page, zone: EndZoneId): Promise<void> {
  await page.evaluate(([keys, z]) => {
    if (z === "classic") localStorage.removeItem(keys[0]);
    else localStorage.setItem(keys[0], z);
    localStorage.setItem(keys[1], "9");
  }, [[ENDZONE_KEY, TOUCHDOWNS_KEY], zone] as const);
}

interface Frame {
  /** the band's depth in field units */
  h: number;
  /** the band's size on this screen, in device pixels */
  px: string;
  /** one frame of the design, in ms */
  ms: number;
  /** one frame of the calibration picture, drawn the same way at the same moment, in ms */
  calibrationMs: number;
  /** the design's frame in calibration frames */
  frames: number;
  elements: number;
  text: number;
  patterns: number;
  filters: number;
  uses: number;
  gradientStrokes: number;
}

/**
 * How long a frame of the band takes to paint, measured in the page: the band's own SVG (the
 * box the field draws the design in) is drawn onto a canvas at its size on this screen, several
 * rounds of it, and the median round is the frame. The calibration picture, the same every time
 * (a sky of circles, a few stroked curves and a run of monospace glyphs), is drawn the same way
 * in the same rounds, so the two are measured under the same load.
 */
async function frame(page: Page, box: "field" | number): Promise<Frame> {
  return page.evaluate(async ([box]) => {
    const inField = box === "field";
    const holder = (box === "field"
      ? document.querySelector("[data-ez-backdrop] [data-ez-art]")?.parentElement
      : document.querySelectorAll("[role=radiogroup][aria-label='End zone'] [data-ez-art]")[box]?.parentElement) as SVGSVGElement | null | undefined;
    if (!holder) throw new Error("no end zone art to measure");
    const design = holder.querySelector("[data-ez-art]") as SVGGElement;
    // the band's size on this screen: a swatch is its own <svg>; the field's box is scaled with the field
    let W: number;
    let H: number;
    let w = 660;
    let h = Number(holder.getAttribute("height"));
    if (inField) {
      const field = document.querySelector("[aria-label='Play diagram']") as SVGSVGElement;
      const k = field.getBoundingClientRect().width / field.viewBox.baseVal.width;
      W = Math.round(660 * k * devicePixelRatio);
      H = Math.round(h * k * devicePixelRatio);
    } else {
      const r = holder.getBoundingClientRect();
      [w, h] = [holder.viewBox.baseVal.width, holder.viewBox.baseVal.height];
      W = Math.round(r.width * devicePixelRatio);
      H = Math.round(r.height * devicePixelRatio);
    }
    const load = async (inner: string): Promise<HTMLImageElement> => {
      const xml = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${String(w)} ${String(h)}" width="${String(W)}" height="${String(H)}">${inner}</svg>`;
      const img = new Image();
      const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      return img;
    };
    // the calibration picture, in the band's box: 160 filled circles, 30 stroked curves and 60 monospace glyphs
    const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';
    let cal = `<rect width="${String(w)}" height="${String(h)}" fill="#12233a"/>`;
    for (let i = 0; i < 160; i++) cal += `<circle cx="${String((i * 37) % w)}" cy="${String(((i * 53) % 100) / 100 * h)}" r="${String(3 + (i % 5))}" fill="hsl(${String((i * 23) % 360)} 70% 60%)"/>`;
    for (let i = 0; i < 30; i++) cal += `<path d="M${String((i * 41) % w)} 0Q${String((i * 67) % w)} ${String(h / 2)} ${String((i * 89) % w)} ${String(h)}" fill="none" stroke="#fff" stroke-width="1.5"/>`;
    cal += `<text font-family='${mono}' font-size="11" font-weight="700" fill="#9f9" x="${Array.from({ length: 60 }, (_, i) => String((i * 11) % w)).join(" ")}" y="${Array.from({ length: 60 }, (_, i) => String(((i * 7) % 10) / 10 * h + 8)).join(" ")}">${Array.from({ length: 60 }, (_, i) => "0123456789ABCDEF".charAt((i * 7) % 16)).join("")}</text>`;
    const [design_, calibration] = await Promise.all([load(holder.innerHTML), load(cal)]);
    const canvas = document.createElement("canvas");
    canvas.width = W + 8;
    canvas.height = H + 8;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no 2D context");
    // a drawn frame is one drawImage at a size the browser has not cached a bitmap for; a round is four of them
    const time = (img: HTMLImageElement, round: number): number => {
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) g.drawImage(img, 0, 0, W + ((round * 4 + i) % 4), H + ((round * 4 + i) % 4));
      g.getImageData(0, 0, 1, 1);
      return (performance.now() - t0) / 4;
    };
    time(design_, 0);
    time(calibration, 0);
    const rounds = 7;
    const a: number[] = [];
    const b: number[] = [];
    for (let r = 1; r <= rounds; r++) {
      a.push(time(design_, r));
      b.push(time(calibration, r));
    }
    const median = (xs: number[]): number => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? 0;
    const ms = median(a);
    const calibrationMs = median(b);
    const count = (sel: string): number => design.querySelectorAll(sel).length;
    return {
      h, px: `${String(W)}x${String(H)}`,
      ms: Math.round(ms * 100) / 100, calibrationMs: Math.round(calibrationMs * 100) / 100, frames: Math.round((ms / calibrationMs) * 100) / 100,
      elements: count("*"), text: count("text"), patterns: count("pattern"), filters: count("filter"), uses: count("use"),
      gradientStrokes: Array.from(design.querySelectorAll("*")).filter((e) => /^url\(/.test(getComputedStyle(e).stroke)).length,
    };
  }, [box] as const);
}

/**
 * How many layouts and how much main-thread work a second the page does while the band animates,
 * from the browser's own counters, with a frame callback running so the browser really draws
 * every frame it can, as it does with a coach looking on.
 */
async function repaints(page: Page, seconds = 2): Promise<{ layoutsPerSecond: number; mainThreadMsPerSecond: number }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const read = async (): Promise<Record<string, number>> => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };
  const a = await read();
  await page.evaluate((ms) => new Promise<void>((resolve) => {
    const t0 = performance.now();
    const tick = (): void => { if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(); };
    requestAnimationFrame(tick);
  }), seconds * 1000);
  const b = await read();
  await cdp.detach();
  const d = (k: string): number => (b[k] ?? 0) - (a[k] ?? 0);
  return { layoutsPerSecond: Math.round(d("LayoutCount") / seconds), mainThreadMsPerSecond: Math.round((d("TaskDuration") * 1000) / seconds) };
}

test.describe("end zone performance", () => {
  test.describe.configure({ mode: "serial" });
  // the designs animate: this is what they cost with motion allowed
  test.use({ reducedMotion: "no-preference" });

  const manifest: {
    project: string;
    windows: typeof WINDOWS | null;
    budgets: typeof BUDGETS;
    matrixRepaintsPerSecondBudget: number;
    zones: Record<string, { shallow?: Frame; deep?: Frame; swatch?: Frame; repaints?: { layoutsPerSecond: number; mainThreadMsPerSecond: number } }>;
    matrix: { clocks: { durationS: number; stepsPerSecond: number; delayS: number }[]; cursorS: number | null; latticeHz: number } | null;
  } = { project: "", windows: null, budgets: BUDGETS, matrixRepaintsPerSecondBudget: MATRIX_REPAINTS_PER_SECOND, zones: {}, matrix: null };

  test.beforeEach(async ({ page }, testInfo) => {
    manifest.project = testInfo.project.name;
    await page.setViewportSize(PHONE);
    manifest.windows = WINDOWS;
    // a play from midfield for the sliver, and one with the ball on their 5 for the whole end zone
    await seed(page, { plays: [MIDFIELD, GOAL_LINE_FADE], team: OTTERS });
  });

  test("every design's band paints within its budget, shallow and deep, without a pattern, filter or gradient stroke, and how often each repaints", async ({ page }) => {
    test.slow();
    const d = new Designer(page);
    for (const z of END_ZONES) {
      await store(page, z.id);
      const entry = (manifest.zones[z.id] ??= {});
      for (const depth of ["shallow", "deep"] as const) {
        await page.setViewportSize(WINDOWS[depth]);
        await d.goto(`?open=${depth === "deep" ? GOAL_LINE_FADE.id : MIDFIELD.id}`);
        if (z.id === "classic") {
          await expect(art(page)).toHaveCount(0);
          continue;
        }
        await expect(art(page)).toHaveAttribute("data-ez-art", z.id);
        // an empty box is not visible: the design's own chunk has to have arrived
        await expect(art(page)).toBeVisible();
        await d.settle();
        const f = await frame(page, "field");
        entry[depth] = f;
        expect(f.h, `${z.id} ${depth} band depth`).toBeGreaterThan(depth === "deep" ? 100 : 20);
        expect(f.patterns, `${z.id} ${depth} patterns`).toBe(0);
        expect(f.filters, `${z.id} ${depth} filters`).toBe(0);
        expect(f.gradientStrokes, `${z.id} ${depth} gradient strokes`).toBe(0);
        expect(f.elements, `${z.id} ${depth} elements`).toBeLessThanOrEqual(MOST_ELEMENTS);
        expect(f.frames, `${z.id} ${depth}: ${String(f.ms)}ms against a ${String(f.calibrationMs)}ms calibration frame`).toBeLessThanOrEqual(BUDGETS[z.id][depth]);
        if (depth === "deep") entry.repaints = await repaints(page);
      }
    }
  });

  test("the picker's swatches, drawn all at once, each paint within their budget", async ({ page }) => {
    const d = new Designer(page);
    await d.goto(`?open=${SLANT_LEFT.id}`);
    await d.tools();
    const swatches = page.locator("[role=radiogroup][aria-label='End zone'] [data-ez-art]");
    await expect(swatches).toHaveCount(END_ZONES.length);
    for (const [i, z] of END_ZONES.entries()) {
      await expect(swatches.nth(i)).toHaveAttribute("data-ez-art", z.id);
      await expect(swatches.nth(i)).toBeVisible();
      const f = await frame(page, i);
      (manifest.zones[z.id] ??= {}).swatch = f;
      expect(f.patterns, `${z.id} swatch patterns`).toBe(0);
      expect(f.filters, `${z.id} swatch filters`).toBe(0);
      expect(f.frames, `${z.id} swatch: ${String(f.ms)}ms against a ${String(f.calibrationMs)}ms calibration frame`).toBeLessThanOrEqual(BUDGETS[z.id].swatch);
    }
  });

  test("the Matrix rain falls on three shared clocks that tick on a 12 Hz lattice, so its band repaints a dozen times a second at most", async ({ page }, testInfo) => {
    await store(page, "matrix");
    const d = new Designer(page);
    await d.goto(`?open=${MIDFIELD.id}`);
    await expect(art(page)).toHaveAttribute("data-ez-art", "matrix");
    await expect(art(page)).toBeVisible();
    await d.settle();
    const timing = await page.evaluate(() => {
      const band = document.querySelector("[data-ez-backdrop] [data-ez-art='matrix']");
      if (!band) throw new Error("no Matrix band");
      const falls: { durationS: number; stepsPerSecond: number; delayS: number }[] = [];
      let cursorS: number | null = null;
      for (const el of Array.from(band.querySelectorAll("*"))) {
        const s = getComputedStyle(el);
        if (s.animationName === "ez-matrix-fall") {
          const durationS = parseFloat(s.animationDuration);
          const steps = /steps\((\d+)/.exec(s.animationTimingFunction)?.[1];
          falls.push({ durationS, stepsPerSecond: Math.round((Number(steps) / durationS) * 1000) / 1000, delayS: parseFloat(s.animationDelay) });
        }
        if (s.animationName === "ez-matrix-blink") cursorS = parseFloat(s.animationDuration);
      }
      return { falls, cursorS };
    });
    manifest.matrix = { clocks: timing.falls, cursorS: timing.cursorS, latticeHz: MATRIX_LATTICE_HZ };
    expect(timing.falls.length, "columns fall in three clock groups").toBeLessThanOrEqual(3);
    expect(timing.falls.length).toBeGreaterThan(0);
    for (const c of timing.falls) {
      expect(Number.isInteger(c.stepsPerSecond), `a clock steps ${String(c.stepsPerSecond)} times a second`).toBe(true);
      expect(MATRIX_LATTICE_HZ % c.stepsPerSecond, `a clock of ${String(c.stepsPerSecond)} steps a second is off the lattice`).toBe(0);
      expect(Math.round(c.delayS * MATRIX_LATTICE_HZ * 1000) / 1000 % 1, "a clock's delay is off the lattice").toBe(0);
    }
    expect(timing.cursorS, "the cursor blinks on the beat").toBe(1);
    // and in the browser: layouts a second while it rains (every step is one; sixty would be every frame)
    const r = await repaints(page, 3);
    (manifest.zones.matrix ??= {}).repaints = r;
    expect(r.layoutsPerSecond, `the Matrix band laid out ${String(r.layoutsPerSecond)} times a second`).toBeLessThanOrEqual(MATRIX_REPAINTS_PER_SECOND);

    for (const z of END_ZONES) {
      const zone = manifest.zones[z.id];
      expect(zone, z.id).toBeTruthy();
      if (z.id !== "classic") {
        expect(zone?.shallow, `${z.id} shallow`).toBeTruthy();
        expect(zone?.deep, `${z.id} deep`).toBeTruthy();
      }
      expect(zone?.swatch, `${z.id} swatch`).toBeTruthy();
    }
    writeFileSync(`test-results/end-zones-perf-${testInfo.project.name}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  });
});
