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
 *  - the Matrix rain moves at rest (it is to hold still until a touchdown, only the cursor
 *    blinking), so the band repaints on nearly every frame again; or its touchdown clocks fall
 *    off the lattice: a column on a clock of its own, a speed that doesn't divide 12, or a
 *    cursor off the beat → "the Matrix rain"
 *  - a Matrix touchdown drops frames (ARC-186), measured on a scoring play at 4× CPU throttle
 *    against Classic on the same play: every column draws two loops of code above the band where
 *    one covers its fall, or its rush and its own clock add up past one loop so a gap opens at the
 *    top of the band; something in the band scales or shears while it plays, so its text is laid
 *    out again on every frame; each glyph of the confetti is its own font size, so the first frame
 *    builds a font for every one; the band shares a layer with the players; or the whole
 *    touchdown lays out for far longer than Classic's → "a Matrix touchdown"
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
 * browser, and the Matrix clocks; and each touchdown's frames a second, 95th percentile and worst
 * frame, the frames around the celebration's arrival, long tasks, layout and style ms and the
 * band's glyphs at rest and in the celebration, for Classic and Matrix, with how far the Matrix
 * columns fall; asserted against the budgets below before it is written.
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
/** How many times a second the Matrix band may lay out at rest, in the browser (a blink is a paint, not a layout), and the lattice its touchdown clocks tick on. */
const MATRIX_REPAINTS_PER_SECOND = 4;
const MATRIX_LATTICE_HZ = 12;
/** No design draws more elements than this on the deep band. */
const MOST_ELEMENTS = 450;
/**
 * A touchdown with the ball on the 5, measured under this CPU throttle, this many times for each of
 * Classic and Matrix. Matrix may draw this many glyphs in the band during it (1,527 when a column
 * drew two loops of code above the band, 1,167 now), and lay out for at most this many times as
 * long as Classic over the same plays. Classic's own layout time differs more from machine to
 * machine than Matrix's: 2 to 2.5 times it on one machine where Matrix was 5.4 to 6 times it
 * before, 3.5 to 4.1 times it on CI's runners where Classic lays out in half the time. Matrix as
 * it was (1,148ms against 197ms) is well past the budget on either.
 */
const TOUCHDOWN_THROTTLE = 4;
const TOUCHDOWN_RUNS = 2;
const MATRIX_PARTY_GLYPHS = 1250;
const MATRIX_LAYOUT_VS_CLASSIC = 6;

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

/** ▶ throws to the primary read when Math.random() < 0.8: pinned, every run is the same scoring play. */
async function pinRandom(page: Page): Promise<void> {
  await page.addInitScript(() => { Math.random = () => 0.1; });
}

interface Band {
  /** every character of every <text> in the band, and the animations running in it */
  glyphs: number;
  animations: number;
  /** whether a celebration is on screen */
  celebrated: boolean;
  /** each animation in the band whose keyframes scale, skew, rotate or set a matrix */
  scalingTransforms: string[];
  /** the distinct font sizes of the confetti's glyphs */
  confettiFontSizes: string[];
  /** the band's own layer's will-change */
  bandWillChange: string;
}

/** What the band holds, and what the celebration over it is drawn with. */
const bandLoad = (page: Page): Promise<Band> => page.evaluate(() => {
  const band = document.querySelector("[data-ez-backdrop]");
  const texts = band ? Array.from(band.querySelectorAll("text")) : [];
  const inBand = document.getAnimations().filter((a) => a.effect instanceof KeyframeEffect && a.effect.target instanceof Element && band?.contains(a.effect.target));
  return {
    glyphs: texts.reduce((n, t) => n + Array.from(t.textContent ?? "").length, 0),
    animations: inBand.length,
    celebrated: document.querySelector("[data-celebration]") !== null,
    scalingTransforms: inBand.flatMap((a) => {
      const frames = a.effect instanceof KeyframeEffect ? a.effect.getKeyframes() : [];
      const bad = frames.map((k) => String(k.transform ?? "")).filter((t) => /scale|skew|rotate|matrix/.test(t));
      return bad.length > 0 ? [`${a instanceof CSSAnimation ? a.animationName : "script"}: ${bad.join(" / ")}`] : [];
    }),
    confettiFontSizes: [...new Set(Array.from(document.querySelectorAll("[data-confetti='glyph']"), (p) => getComputedStyle(p).fontSize))],
    bandWillChange: band ? getComputedStyle(band).willChange : "",
  };
});

/** How the Matrix rain's columns fall in a touchdown, against the code each one drew. */
interface Columns {
  /** the band's rows, and how many columns were checked */
  rows: number;
  columns: number;
  /** the furthest any column falls, rush and its own clock together, in rows */
  furthest: number;
  /** "<column x> +<rows fallen>: row <band row>" for each row brought into the band whose glyph was never drawn */
  missing: string[];
}

/**
 * Mid-touchdown, steps the Matrix band's own animations through the whole celebration (and a
 * second more, should its end be late) and, at every step, checks that each column drew the glyph
 * of every row its fall brings into the band. The code repeats every PERIOD rows, so a row is
 * owed a glyph wherever the rows a loop above or below it drew one.
 */
const matrixColumns = (page: Page): Promise<Columns> => page.evaluate(() => {
  /** PERIOD and ROW in components/endzone/art/matrix.tsx */
  const PERIOD = 24;
  const ROW = 10;
  const mod = (a: number, n: number): number => ((a % n) + n) % n;
  const band = document.querySelector("[data-ez-backdrop] [data-ez-art='matrix']");
  if (!band) throw new Error("no Matrix band");
  const k = Number(/scale\(([\d.]+)\)/.exec(band.querySelector("g[transform^='scale']")?.getAttribute("transform") ?? "")?.[1]);
  const h = Number(band.querySelector("rect")?.getAttribute("height"));
  const rows = Math.round(h / k / ROW);
  const seconds = parseFloat(getComputedStyle(document.querySelector("[data-touchdown]") ?? document.body).animationDuration) + 1;
  const animations = document.getAnimations().filter((a): a is CSSAnimation => a instanceof CSSAnimation && a.effect instanceof KeyframeEffect && a.effect.target instanceof Element && band.contains(a.effect.target));
  const rush = band.querySelector(".ez-matrix-rush");
  const falls = Array.from(band.querySelectorAll(".ez-matrix-fall"));
  for (const a of animations) a.pause();
  const rowsDown = (el: Element | null): number => (el ? new DOMMatrix(getComputedStyle(el).transform).f / ROW : 0);
  // every distinct fall of each clock over the celebration
  const offsets = falls.map(() => new Set<number>());
  for (let t = 0; t <= seconds; t += 1 / 96) {
    for (const a of animations) a.currentTime = t * 1000;
    const r = rowsDown(rush);
    falls.forEach((f, i) => offsets[i]?.add(Math.round((r + rowsDown(f)) * 1000) / 1000));
  }
  const missing: string[] = [];
  let columns = 0;
  falls.forEach((f, i) => {
    for (const col of Array.from(f.children)) {
      columns++;
      const [, x = "?", y = "0"] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(col.getAttribute("transform") ?? "") ?? [];
      const shift = Math.round(Number(y) / ROW);
      for (const text of Array.from(col.querySelectorAll("text"))) {
        const drawn = new Set((text.getAttribute("y") ?? "").split(" ").filter(Boolean).map((v) => Math.floor(Number(v) / ROW)));
        const phases = new Set([...drawn].map((r) => mod(r, PERIOD)));
        for (const down of offsets[i] ?? []) {
          // the band's rows, and a row's grace either side for a glyph's own height
          for (let b = -1; b <= rows; b++) {
            const r = b - shift - down;
            if (Number.isInteger(r) && phases.has(mod(r, PERIOD)) && !drawn.has(r)) missing.push(`${x} +${String(down)}: row ${String(b)}`);
          }
        }
      }
    }
  });
  for (const a of animations) a.play();
  return { rows, columns, furthest: Math.max(0, ...offsets.flatMap((o) => [...o])), missing: [...new Set(missing)].slice(0, 20) };
});

interface Touchdown {
  /** frames a second from ▶ to the whiteboard coming back, the 95th percentile and worst frame, in ms */
  fps: number;
  p95Ms: number;
  worstMs: number;
  /** the slowest frame around the one the celebration first shows on, in ms */
  touchdownFrameMs: number;
  longTasksMs: number[];
  /** main-thread ms of layout and of style over the whole run, from the browser's own counters */
  layoutMs: number;
  styleMs: number;
  /** the band at rest and in the celebration */
  rest: Band;
  party: Band;
}

/**
 * Presses ▶ on a scoring play under CPU throttle and records every frame in the page until the
 * whiteboard comes back, with the frames around the celebration's arrival, long tasks, and the
 * browser's layout and style time over the run.
 */
async function touchdown(page: Page): Promise<Touchdown> {
  const rest = await bandLoad(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const read = async (): Promise<Record<string, number>> => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };
  await page.evaluate(() => {
    const w = window as unknown as { __td: { frames: number[]; party: number | null; long: number[]; done: boolean } };
    w.__td = { frames: [], party: null, long: [], done: false };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__td.long.push(Math.round(e.duration)); }).observe({ type: "longtask" });
    const tick = (t: number): void => {
      if (w.__td.done) return;
      w.__td.frames.push(t);
      if (w.__td.party === null && document.querySelector("[data-celebration]")) w.__td.party = w.__td.frames.length - 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await new Designer(page).foldOverlays();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: TOUCHDOWN_THROTTLE });
  const a = await read();
  await page.getByRole("button", { name: "Run the play" }).click();
  await expect(page.locator("[data-celebration]")).toBeVisible({ timeout: 20_000 });
  const party = await bandLoad(page);
  await expect(page.getByRole("button", { name: "Run the play" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-celebration]")).toHaveCount(0, { timeout: 10_000 });
  const b = await read();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await cdp.detach();
  const { frames, party: at, long } = await page.evaluate(() => {
    const w = window as unknown as { __td: { frames: number[]; party: number | null; long: number[]; done: boolean } };
    w.__td.done = true;
    return w.__td;
  });
  const gaps = frames.slice(1).map((t, i) => t - (frames[i] ?? t));
  const sorted = [...gaps].sort((x, y) => x - y);
  const d = (k: string): number => Math.round(((b[k] ?? 0) - (a[k] ?? 0)) * 1000);
  const span = (frames.at(-1) ?? 0) - (frames[0] ?? 0);
  const round = (x: number): number => Math.round(x * 10) / 10;
  return {
    fps: round((gaps.length / span) * 1000),
    p95Ms: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    worstMs: round(sorted.at(-1) ?? 0),
    touchdownFrameMs: at === null ? -1 : round(Math.max(...gaps.slice(Math.max(0, at - 1), at + 2))),
    longTasksMs: long,
    layoutMs: d("LayoutDuration"),
    styleMs: d("RecalcStyleDuration"),
    rest,
    party,
  };
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
    touchdown: {
      throttle: number;
      budgets: { partyGlyphs: number; layoutVsClassic: number };
      runs: Record<"classic" | "matrix", Touchdown[]>;
      columns: Columns;
    } | null;
  } = { project: "", windows: null, budgets: BUDGETS, matrixRepaintsPerSecondBudget: MATRIX_REPAINTS_PER_SECOND, zones: {}, matrix: null, touchdown: null };

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
    await d.unfold("End zone");
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

  test("a Matrix touchdown, at 4× CPU throttle, draws every column whole with a fraction of the old glyphs and lays out within a small multiple of Classic's", async ({ page }, testInfo) => {
    test.slow();
    await page.setViewportSize(testInfo.project.use.viewport ?? PHONE);
    await pinRandom(page);
    const d = new Designer(page);
    const runs: Record<"classic" | "matrix", Touchdown[]> = { classic: [], matrix: [] };
    // turn about, so a runner slowing down part way weighs on both alike
    for (let run = 0; run < TOUCHDOWN_RUNS; run++) {
      for (const zone of ["classic", "matrix"] as const) {
        await store(page, zone);
        await d.goto(`?open=${GOAL_LINE_FADE.id}`);
        if (zone === "matrix") await expect(art(page)).toBeVisible();
        await d.settle();
        runs[zone].push(await touchdown(page));
      }
    }
    // and one more, unmeasured, to step the rain through its celebration column by column
    await d.goto(`?open=${GOAL_LINE_FADE.id}`);
    await expect(art(page)).toBeVisible();
    await d.settle();
    await d.foldOverlays();
    await page.getByRole("button", { name: "Run the play" }).click();
    await expect(page.locator("[data-celebration]")).toBeVisible({ timeout: 20_000 });
    const columns = await matrixColumns(page);
    const layout = (z: "classic" | "matrix"): number => runs[z].reduce((n, r) => n + r.layoutMs, 0);
    const [classicLayout, matrixLayout] = [layout("classic"), layout("matrix")];
    manifest.touchdown = { throttle: TOUCHDOWN_THROTTLE, budgets: { partyGlyphs: MATRIX_PARTY_GLYPHS, layoutVsClassic: MATRIX_LAYOUT_VS_CLASSIC }, runs, columns };
    const matrix = runs.matrix[0];
    if (!matrix) throw new Error("no Matrix touchdown was measured");

    // the play scores, and the band holds what a touchdown draws
    expect(matrix.party.animations, "the Matrix band's touchdown animations").toBeGreaterThan(matrix.rest.animations);
    expect(matrix.party.glyphs, `the Matrix band drew ${String(matrix.party.glyphs)} glyphs in its touchdown`).toBeLessThanOrEqual(MATRIX_PARTY_GLYPHS);
    // no column ever falls further than it drew code for: a gap would open at the top of the band
    expect(columns.columns, "Matrix columns checked").toBeGreaterThan(10);
    expect(columns.furthest, "the rain falls in a touchdown").toBeGreaterThan(0);
    expect(columns.missing, `rows the Matrix rain brings into the band without a glyph (furthest fall ${String(columns.furthest)} rows)`).toEqual([]);
    // nothing in the band scales, shears or turns while it plays: SVG text is laid out afresh at every new scale
    expect(matrix.party.scalingTransforms, "animations in the band that scale, skew or rotate").toEqual([]);
    // every glyph of the confetti is the same font, sized by a transform: a font per size is built on the touchdown's first frame
    expect(matrix.party.confettiFontSizes.length, `the confetti's font sizes: ${matrix.party.confettiFontSizes.join(", ")}`).toBe(1);
    // the band is its own compositor layer: players crossing it don't repaint the design, nor its steps them
    expect(matrix.party.bandWillChange).toContain("transform");
    for (const r of runs.classic) expect(r.party.celebrated, "Classic celebrates").toBe(true);
    for (const r of runs.matrix) expect(r.party.celebrated, "Matrix celebrates").toBe(true);
    expect(
      matrixLayout,
      `Matrix laid out for ${String(matrixLayout)}ms over its touchdowns against Classic's ${String(classicLayout)}ms`,
    ).toBeLessThanOrEqual(classicLayout * MATRIX_LAYOUT_VS_CLASSIC);
  });

  test("the Matrix rain holds still at rest, only the cursor blinking, and its touchdown clocks sit on a 12 Hz lattice", async ({ page }, testInfo) => {
    await store(page, "matrix");
    const d = new Designer(page);
    await d.goto(`?open=${MIDFIELD.id}`);
    await expect(art(page)).toHaveAttribute("data-ez-art", "matrix");
    await expect(art(page)).toBeVisible();
    await d.settle();
    const timing = await page.evaluate(() => {
      const band = document.querySelector("[data-ez-backdrop] [data-ez-art='matrix']");
      if (!band) throw new Error("no Matrix band");
      // what runs at rest, and what the columns are set to fall at in a touchdown (their own inline durations)
      const running: string[] = [];
      const clocks: { durationS: number; stepsPerSecond: number; delayS: number }[] = [];
      let cursorS: number | null = null;
      for (const el of Array.from(band.querySelectorAll("*"))) {
        const s = getComputedStyle(el);
        if (s.animationName !== "none") running.push(s.animationName);
        if (s.animationName === "ez-matrix-blink") cursorS = parseFloat(s.animationDuration);
        if (el.classList.contains("ez-matrix-fall")) {
          const durationS = parseFloat((el as HTMLElement).style.animationDuration);
          clocks.push({ durationS, stepsPerSecond: Math.round((24 / durationS) * 1000) / 1000, delayS: parseFloat(s.animationDelay) || 0 });
        }
      }
      return { running: [...new Set(running)].sort(), clocks, cursorS };
    });
    manifest.matrix = { clocks: timing.clocks, cursorS: timing.cursorS, latticeHz: MATRIX_LATTICE_HZ };
    expect(timing.running, "at rest only the cursor animates").toEqual(["ez-matrix-blink"]);
    expect(timing.clocks.length, "columns fall in three clock groups").toBeLessThanOrEqual(3);
    expect(timing.clocks.length).toBeGreaterThan(0);
    for (const c of timing.clocks) {
      expect(Number.isInteger(c.stepsPerSecond), `a clock steps ${String(c.stepsPerSecond)} times a second`).toBe(true);
      expect(MATRIX_LATTICE_HZ % c.stepsPerSecond, `a clock of ${String(c.stepsPerSecond)} steps a second is off the lattice`).toBe(0);
      expect(Math.round(c.delayS * MATRIX_LATTICE_HZ * 1000) / 1000 % 1, "a clock's delay is off the lattice").toBe(0);
    }
    expect(timing.cursorS, "the cursor blinks on the beat").toBe(1);
    // and in the browser: layouts a second at rest (a moving column is one each; sixty would be every frame)
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
    expect(manifest.touchdown, "the touchdowns were measured").toBeTruthy();
    writeFileSync(`test-results/end-zones-perf-${testInfo.project.name}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  });
});
