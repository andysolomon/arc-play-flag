import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { DEMOS } from "../../components/demo/demos";
import { numbered } from "../../lib/export/numbered";
import { BAND_PRESETS, wristbandCard } from "../../lib/export/wristband";
import { GOAL_YARD } from "../../lib/play/field";
import { S, VW } from "../../lib/play/geometry";
import { BLITZ_DEPTH } from "../../lib/play/routes";
import { DRAFT_KEY, type DraftRecord } from "../../lib/play/storage";
import { advertisedFeatures, CoverageLedger } from "./coverage";
import { BUNCH_CORNER, DEMO_PLAYBOOK, DEMO_PLAYS, DEMO_TEAM, JET_FAKE_POST, JET_SWEEP, TWINS_SLANT } from "./fixtures";
import { hasAttributeNow, retryStatefulInteraction } from "./interactions";
import { CAPTION_BAND, DEFAULT_FPS, ZOOM, type FrameRate } from "./media";
import type { ChapterSlug } from "./options";

/**
 * selector: a visible control changed or disappeared.
 * state: the control was used but the expected result did not land.
 * export: an in-app download did not happen or produced the wrong file.
 * recording: navigation, capture, encoding, duration or output validation failed.
 * coverage: the chapter finished without demonstrating something its /demo card promises.
 */
export type BeatKind = "selector" | "state" | "export" | "recording" | "coverage";

export class ChapterBeatError extends Error {
  readonly slug: ChapterSlug;
  readonly beat: string;
  readonly kind: BeatKind;

  constructor(slug: ChapterSlug, beat: string, kind: BeatKind, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`chapter "${slug}" beat "${beat}" failed (${kind}): ${detail}`, { cause });
    this.name = "ChapterBeatError";
    this.slug = slug;
    this.beat = beat;
    this.kind = kind;
  }
}

/** What the harness page (./harness.ts) lets the recorder draw: the caption band, the cover and the touch. */
interface DemoHarness {
  caption: (text: string) => void;
  cover: (on: boolean) => void;
  touch: (phase: "tap" | "down" | "move" | "up", x: number, y: number) => void;
}
declare global {
  interface Window { __demo: DemoHarness }
}

const SIDEBARS = { "Play tools": "play-sidebar", "Route palette": "route-sidebar", "Roster panel": "route-sidebar" } as const;
type SidebarName = keyof typeof SIDEBARS;
type Team = "Offense" | "Defense";
interface Point { x: number; y: number }

const ASSERT_TIMEOUT = 5_000;
/** How far past its promised length a chapter's last beat may end: a sliver of its final hold. */
const OVERRUN_SECONDS = 0.25;
/**
 * The most a chapter may end early: the recorder holds the last frame to the promised length, and a
 * longer hold than this is dead time a viewer sits through. Shorten the chapter's `time` instead.
 */
const MAX_TAIL_SECONDS = 1.5;
/** Cut this much more off the front of a clip than the lead-in measured, so its first frame is never the cover. */
const LEAD_IN_MARGIN = 0.08;
/** The touch shows on the control this long before the tap lands, so the viewer sees where it goes. */
const TOUCH_LEAD = 150;
/** Where the recorder's overlay of an export (a wristband insert) sits in the app's frame. */
const OVERLAY_ID = "arc-demo-recorder-overlay";

/**
 * Drives one chapter the way a coach would: through visible, accessible controls, in the
 * app's phone layout. The app is in a frame under the recorder's caption band, so a caption
 * can never cover a control or a toast, and a dialog can never cover a caption. The two
 * sidebars are drawers that cover most of the field one at a time, and picking a route folds
 * the palette away, so every payoff is shown with the drawers closed. Every helper waits on
 * what a person would see, and draws the touch where a person would tap.
 *
 * Each beat may declare the /demo features it demonstrates. A feature is only counted once
 * the beat has completed, so a chapter can never be published claiming something the clip
 * does not show.
 */
export class ChapterDriver {
  private posterTaken = false;
  private readonly ledger: CoverageLedger;
  /** the captions shown so far: they must be the manifest's, in its order */
  readonly captions: string[] = [];
  /** when the chapter's first screen was on camera; the clip starts here */
  clockStart: number | null = null;

  constructor(
    readonly slug: ChapterSlug,
    readonly page: Page,
    readonly app: Frame,
    readonly baseUrl: string,
    private readonly posterSink: (png: Buffer) => void,
    private readonly trace: (line: string) => void = () => undefined,
  ) {
    this.ledger = new CoverageLedger(slug, advertisedFeatures(slug));
  }

  /** Seconds since the chapter's first screen was on camera. */
  elapsed(): number {
    return this.clockStart === null ? 0 : (Date.now() - this.clockStart) / 1000;
  }

  get field(): Locator {
    return this.app.locator("[aria-label='Play diagram']");
  }

  /** The app's toast. */
  get toast(): Locator {
    return this.app.locator("div[role='status']");
  }

  /** The ball in flight on ▶ (a lateral's own glyph on the whiteboard is also an image, but prints). */
  get ball(): Locator {
    return this.field.locator("image[data-export='skip']");
  }

  /** Wraps a failure with the chapter, beat and class unless it is already classified. */
  private fail(kind: BeatKind, beat: string, cause: unknown): ChapterBeatError {
    return cause instanceof ChapterBeatError ? cause : new ChapterBeatError(this.slug, beat, kind, cause);
  }

  async beat(kind: BeatKind, name: string, action: () => Promise<void>, hold = 240, proves: readonly string[] = []): Promise<void> {
    try {
      await action();
      this.ledger.prove(proves);
      this.trace(`[${this.slug} ${this.elapsed().toFixed(2)}s] ${name}${proves.length ? ` — shows ${proves.join(", ")}` : ""}`);
      await this.hold(hold);
    } catch (error) {
      throw this.fail(kind, name, error);
    }
  }

  private async harness<T extends keyof DemoHarness>(call: T, ...args: Parameters<DemoHarness[T]>): Promise<void> {
    await this.page.evaluate(([name, list]) => {
      (window.__demo[name] as (...a: unknown[]) => void)(...list);
    }, [call, args] as const);
  }

  /** Changes the caption in the band over the app; it stays until the next story beat. */
  async say(text: string): Promise<void> {
    this.captions.push(text);
    await this.beat("recording", `caption "${text}"`, async () => { await this.harness("caption", text); }, 0);
  }

  /** Holds a beat's result on screen. */
  async hold(milliseconds: number): Promise<void> {
    if (milliseconds > 0) await this.page.waitForTimeout(milliseconds);
  }

  /**
   * Opens a screen behind the cover, so the clip never shows a blank or half-laid-out page, and
   * starts the chapter's clock the first time a screen is ready: the clip starts there.
   */
  async goto(path: string): Promise<void> {
    await this.beat("recording", `open ${path}`, async () => {
      await this.harness("cover", true);
      const response = await this.app.goto(`${this.baseUrl}${path}`, { waitUntil: "load" });
      if (!response?.ok()) throw new Error(`app returned HTTP ${String(response?.status() ?? "no response")}`);
      // the first control each screen hydrates: the designer, the playbooks home, one book, the reader, a shared play
      const ready = this.app.getByRole("button", { name: "Play tools", exact: true })
        .or(this.app.getByRole("button", { name: /backup settings/ }))
        .or(this.app.getByRole("textbox", { name: "Playbook name" }))
        .or(this.app.getByRole("button", { name: "Full screen", exact: true }))
        .or(this.app.getByRole("link", { name: /Open in designer/ }));
      await expect(ready.first()).toBeVisible({ timeout: ASSERT_TIMEOUT });
      await this.app.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
      });
      await this.harness("cover", false);
      this.clockStart ??= Date.now();
    }, 120);
  }

  async visible(locator: Locator, description: string): Promise<Locator> {
    try {
      await expect(locator, description).toBeVisible({ timeout: ASSERT_TIMEOUT });
      return locator;
    } catch (error) {
      throw this.fail("selector", description, error);
    }
  }

  /**
   * The middle of a control, in the page's coordinates (where the touch is drawn and the tap lands).
   * A box in the app's frame is in the app's own pixels; the frame is zoomed, so the page's are ZOOM
   * times that, band included (the band is zoomed too).
   */
  private async centre(locator: Locator, description: string): Promise<Point> {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`${description} has no box to tap`);
    return { x: (box.x + box.width / 2) * ZOOM, y: (box.y + box.height / 2) * ZOOM };
  }

  /** Taps a point of the page: the touch shows there first, then the tap lands with its ripple. */
  private async tapAt(point: Point): Promise<void> {
    await this.harness("touch", "down", point.x, point.y);
    await this.page.waitForTimeout(TOUCH_LEAD);
    await this.harness("touch", "tap", point.x, point.y);
    await this.page.mouse.click(point.x, point.y);
  }

  async click(locator: Locator, description: string, hold?: number, proves: readonly string[] = []): Promise<void> {
    await this.beat("selector", description, async () => {
      await this.visible(locator, description);
      await this.tapAt(await this.centre(locator, description));
    }, hold, proves);
  }

  /**
   * Taps a control until the client-owned state confirms that React handled it. This covers
   * the brief window where a fresh profile can see a control before hydration has attached
   * its event handler. A state already reached is left alone: no tap, no touch, no hold.
   */
  async clickUntilState(locator: Locator, description: string, isSatisfied: () => Promise<boolean>, hold?: number): Promise<void> {
    if (await isSatisfied()) return;
    await this.beat("selector", description, async () => {
      await this.visible(locator, description);
      const point = await this.centre(locator, description);
      await this.harness("touch", "down", point.x, point.y);
      await this.page.waitForTimeout(TOUCH_LEAD);
      await retryStatefulInteraction(
        async () => {
          await this.harness("touch", "tap", point.x, point.y);
          await this.page.mouse.click(point.x, point.y);
        },
        isSatisfied,
        { wait: async (milliseconds) => { await this.page.waitForTimeout(milliseconds); } },
      );
    }, hold);
  }

  /** Types into a field on camera, at a readable speed, after tapping it. */
  async type(locator: Locator, description: string, text: string, hold = 260, proves: readonly string[] = []): Promise<void> {
    await this.beat("selector", description, async () => {
      const field = await this.visible(locator, description);
      await this.tapAt(await this.centre(field, description));
      await field.fill("");
      await field.pressSequentially(text, { delay: 22 });
    }, hold, proves);
  }

  /** Picks an option from a native select. The open list is the browser's, not the page's, so the video shows the tap and then the result. */
  async choose(locator: Locator, description: string, value: string, hold = 260, proves: readonly string[] = []): Promise<void> {
    await this.beat("selector", description, async () => {
      const select = await this.visible(locator, description);
      const point = await this.centre(select, description);
      await this.harness("touch", "down", point.x, point.y);
      await this.page.waitForTimeout(TOUCH_LEAD);
      await this.harness("touch", "tap", point.x, point.y);
      await select.selectOption(value);
    }, hold, proves);
  }

  /** Ticks or unticks a checkbox, tapping the label a coach taps. */
  async setChecked(locator: Locator, description: string, checked: boolean, hold = 260, proves: readonly string[] = []): Promise<void> {
    await this.beat("selector", description, async () => {
      const box = await this.visible(locator, description);
      const label = box.locator("xpath=ancestor::label[1]");
      const point = await this.centre(await label.count() ? label : box, description);
      await this.harness("touch", "down", point.x, point.y);
      await this.page.waitForTimeout(TOUCH_LEAD);
      await this.harness("touch", "tap", point.x, point.y);
      if (await box.isChecked() !== checked) await box.evaluate((element: HTMLInputElement) => { element.click(); });
      await expect(box).toBeChecked({ checked, timeout: ASSERT_TIMEOUT });
    }, hold, proves);
  }

  /** Opens a folded Play tools section (Theme, End zone) by its heading. */
  async unfold(label: "Theme" | "End zone"): Promise<void> {
    await this.openPanel("Play tools");
    const heading = this.app.locator("#play-sidebar").getByRole("button", { name: new RegExp(`^${label}\\b`) });
    await heading.scrollIntoViewIfNeeded().catch(() => undefined);
    await this.clickUntilState(heading, `Unfold ${label}`, async () => hasAttributeNow(heading, "aria-expanded", "true"), 160);
  }

  /**
   * Picks a look (a theme or an end zone) from its swatch and waits for the "Switching to …"
   * interstitial to come down, so the next beat starts on the new look.
   */
  async pickLook(radio: Locator, description: string, hold = 360): Promise<void> {
    await this.beat("selector", description, async () => {
      const swatch = await this.visible(radio.locator("xpath=ancestor::label[1]"), description);
      const point = await this.centre(swatch, description);
      await this.harness("touch", "down", point.x, point.y);
      await this.page.waitForTimeout(TOUCH_LEAD);
      await this.harness("touch", "tap", point.x, point.y);
      await radio.evaluate((element: HTMLInputElement) => { element.click(); });
      await expect(radio).toBeChecked({ timeout: ASSERT_TIMEOUT });
      await expect(this.app.locator("[data-repainting]")).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
    }, hold);
  }

  /**
   * Confirms an expected result landed; the assertion itself names what was expected.
   * This is where a chapter records what it has demonstrated, so an unmet expectation
   * can never count as coverage.
   */
  async expectState(description: string, assertion: () => Promise<void>, hold = 120, proves: readonly string[] = []): Promise<void> {
    await this.beat("state", description, assertion, hold, proves);
  }

  private toggle(name: SidebarName): Locator {
    return this.app.getByRole("button", { name, exact: true });
  }

  async openPanel(name: SidebarName): Promise<void> {
    const toggle = this.toggle(name);
    const panel = this.app.locator(`#${SIDEBARS[name]}`);
    const open = async () => await hasAttributeNow(toggle, "aria-expanded", "true") && await hasAttributeNow(panel, "aria-hidden", "false");
    await this.clickUntilState(toggle, `Open ${name.toLowerCase()}`, open, 200);
    await this.expectState(`${name} is open`, async () => {
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: ASSERT_TIMEOUT });
      await expect(panel).toHaveAttribute("aria-hidden", "false", { timeout: ASSERT_TIMEOUT });
    }, 0);
  }

  /** Folds both drawers away so the whole field is visible and tappable. */
  async closePanels(): Promise<void> {
    for (const name of ["Play tools", "Route palette", "Roster panel"] as const) {
      const toggle = this.toggle(name);
      if (await toggle.count() && await hasAttributeNow(toggle, "aria-expanded", "true")) {
        await this.clickUntilState(toggle, `Close ${name.toLowerCase()}`, async () => (
          await hasAttributeNow(toggle, "aria-expanded", "false")
        ), 120);
      }
    }
  }

  player(label: string, team: Team): Locator {
    return this.field.getByRole("button", { name: `${team} ${label}`, exact: true });
  }

  /** Tapping a player selects it and opens the palette (or, in roster mode, the roster panel) for it. */
  async selectPlayer(label: string, team: Team, panel: "Route palette" | "Roster panel" = "Route palette"): Promise<void> {
    await this.closePanels();
    const player = this.player(label, team);
    await this.clickUntilState(player, `Select ${team.toLowerCase()} ${label || "player"}`, async () => (
      await hasAttributeNow(player, "aria-pressed", "true")
      && await hasAttributeNow(this.toggle(panel), "aria-expanded", "true")
    ), 160);
  }

  /** Picks a route or coverage tile for the selected player. */
  async pick(label: string, hold = 260): Promise<void> {
    await this.openPanel("Route palette");
    const tile = this.app.locator("#route-sidebar").getByRole("group").getByRole("button", { name: label, exact: true });
    await this.click(tile, `Pick ${label}`, hold);
  }

  /** A pill in the palette that is not a route tile: the primary read or the mirror. */
  async paletteAction(name: RegExp | string, description: string, hold = 260): Promise<void> {
    await this.openPanel("Route palette");
    await this.click(this.app.locator("#route-sidebar").getByRole("button", { name }), description, hold);
  }

  /** Client coordinates of a yard point on the field, read from the SVG's own viewBox. */
  private async yardPoint(x: number, y: number): Promise<Point> {
    const box = await this.field.boundingBox();
    const viewBox = await this.field.getAttribute("viewBox");
    if (!box || !viewBox) throw new Error("the field has not laid out");
    const vh = Number(viewBox.split(" ")[3]);
    const top = 8 - vh / S;
    return { x: (box.x + ((x * S) / VW) * box.width) * ZOOM, y: (box.y + (((y - top) * S) / vh) * box.height) * ZOOM };
  }

  /** Taps a yard point on the open field, for custom-route waypoints. */
  async tapField(x: number, y: number, description: string, hold = 220): Promise<void> {
    await this.closePanels();
    await this.beat("selector", description, async () => {
      await this.tapAt(await this.yardPoint(x, y));
    }, hold);
  }

  /** Drags from one point of the page to another, in steps, the touch following, so the move reads as a move on camera. */
  private async drag(from: Point, to: Point, steps = 16): Promise<void> {
    await this.harness("touch", "down", from.x, from.y);
    await this.page.mouse.move(from.x, from.y);
    await this.page.waitForTimeout(TOUCH_LEAD);
    await this.page.mouse.down();
    for (let step = 1; step <= steps; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / steps;
      const y = from.y + ((to.y - from.y) * step) / steps;
      await this.page.mouse.move(x, y);
      await this.harness("touch", "move", x, y);
      await this.page.waitForTimeout(24);
    }
    await this.page.waitForTimeout(120);
    await this.page.mouse.up();
    await this.harness("touch", "up", to.x, to.y);
  }

  /** Drags a player to a yard spot. */
  async dragPlayer(label: string, team: Team, x: number, y: number, description: string, hold = 260): Promise<void> {
    await this.closePanels();
    await this.beat("selector", description, async () => {
      const from = await this.centre(await this.visible(this.player(label, team), description), description);
      await this.drag(from, await this.yardPoint(x, y));
    }, hold);
  }

  /** Drags a handle on the field (a lateral's catch) to a yard spot. */
  async dragHandle(handle: Locator, x: number, y: number, description: string, hold = 260): Promise<void> {
    await this.closePanels();
    await this.beat("selector", description, async () => {
      const from = await this.centre(await this.visible(handle, description), description);
      await this.drag(from, await this.yardPoint(x, y));
    }, hold);
  }

  /**
   * Runs the play and waits for the whiteboard to come back, the way a coach watches it. The
   * poster can be taken mid-play, at the moment that best says what the chapter shows.
   */
  async runPlay(description: string, proves: readonly string[], o: { posterAt?: number; hold?: number; andSay?: string } = {}): Promise<void> {
    const run = this.app.getByRole("button", { name: "Run the play", exact: true });
    const stop = this.app.getByRole("button", { name: "Stop the play", exact: true });
    await this.closePanels();
    await this.clickUntilState(run, description, async () => hasAttributeNow(stop, "aria-pressed", "true"), 0);
    const pressed = Date.now();
    if (o.andSay !== undefined) await this.say(o.andSay);
    await this.expectState(`${description}: the ball is in view`, async () => {
      await expect(this.ball).toBeVisible({ timeout: ASSERT_TIMEOUT });
    }, 0);
    if (o.posterAt !== undefined) {
      const until = pressed + o.posterAt * 1000;
      if (until > Date.now()) await this.page.waitForTimeout(until - Date.now());
      await this.poster();
    }
    await this.expectState(`${description}: the play finishes`, async () => {
      await expect(run).toBeVisible({ timeout: 15_000 });
      await expect(this.ball).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
    }, o.hold ?? 260, proves);
  }

  /**
   * Taps a download control and checks that the browser received the named file. Something can be
   * shown while the export draws (an overlay of what it draws), since a whole PDF takes seconds.
   */
  async download(label: string, expected: RegExp, proves: readonly string[] = [], o: { hold?: number; timeout?: number; during?: () => Promise<void> } = {}): Promise<void> {
    await this.beat("export", label, async () => {
      const button = await this.visible(this.app.getByRole("button", { name: label, exact: true }), label);
      const point = await this.centre(button, label);
      const pending = this.page.waitForEvent("download", { timeout: o.timeout ?? 30_000 });
      await this.tapAt(point);
      await o.during?.();
      const download = await pending;
      const name = download.suggestedFilename();
      if (!expected.test(name)) throw new Error(`unexpected download name: ${name}`);
      const failure = await download.failure();
      if (failure) throw new Error(`download "${name}" failed: ${failure}`);
      await download.delete();
    }, o.hold ?? 240, proves);
  }

  /**
   * Lays a picture of an export (an SVG the app itself draws, such as one wristband insert) over
   * the app, as a card on the paper, so a clip shows what a download holds; `null` takes it down.
   */
  async overlay(svg: string | null, description: string, hold = 0): Promise<void> {
    await this.beat("recording", description, async () => {
      await this.app.evaluate(([id, markup]) => {
        document.getElementById(id)?.remove();
        if (!markup) return;
        const card = document.createElement("div");
        card.id = id;
        Object.assign(card.style, {
          position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%) rotate(-1.5deg)", width: "92vw",
          zIndex: "2147483000", background: "#ffffff", border: "2.5px solid #1b1a17", borderRadius: "6px",
          boxShadow: "4px 5px 0 #1b1a17", padding: "4px", boxSizing: "border-box", pointerEvents: "none",
        });
        card.innerHTML = markup;
        const picture = card.querySelector("svg");
        if (picture) { picture.setAttribute("width", "100%"); picture.removeAttribute("height"); picture.style.display = "block"; }
        document.body.append(card);
      }, [OVERLAY_ID, svg] as const);
    }, hold);
  }

  /** The stored draft, which autosave writes after every committed change. */
  async draft(): Promise<DraftRecord | null> {
    return this.app.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null") as DraftRecord | null, DRAFT_KEY);
  }

  /** Captures the poster frame now: the moment that best says what the chapter shows. */
  async poster(): Promise<void> {
    await this.beat("recording", "capture poster frame", async () => {
      this.posterSink(await this.page.screenshot({ type: "png" }));
      this.posterTaken = true;
    }, 0);
  }

  /**
   * Holds the final frame until the chapter reaches its target length, then makes sure a poster
   * exists, every feature the tour advertises was demonstrated, and the captions were the
   * manifest's.
   */
  async finish(targetSeconds: number): Promise<number> {
    const unproven = this.ledger.problem();
    if (unproven) throw new ChapterBeatError(this.slug, "cover the advertised features", "coverage", new Error(unproven));
    const promised = DEMOS.find((demo) => demo.slug === this.slug)?.captions ?? [];
    if (JSON.stringify(promised) !== JSON.stringify(this.captions)) {
      throw new ChapterBeatError(this.slug, "show the promised captions", "coverage", new Error(
        `the /demo card lists captions ${JSON.stringify(promised)} but the chapter showed ${JSON.stringify(this.captions)}`,
      ));
    }
    if (!this.posterTaken) await this.poster();
    // encoding trims every clip to the promised length, so a chapter that runs over would
    // lose its last beats, and with them things its card promises, without a word
    const over = this.elapsed() - targetSeconds;
    if (over > OVERRUN_SECONDS) {
      throw new ChapterBeatError(this.slug, "fit the promised length", "recording", new Error(
        `the beats took ${this.elapsed().toFixed(2)}s but the tour promises ${String(targetSeconds)}s, so the clip would cut them off; shorten the holds (--trace shows where the time goes) or lengthen the chapter`,
      ));
    }
    const remaining = targetSeconds - this.elapsed();
    if (remaining > MAX_TAIL_SECONDS) {
      throw new ChapterBeatError(this.slug, "end on the payoff", "recording", new Error(
        `the beats took ${this.elapsed().toFixed(2)}s of the ${String(targetSeconds)}s promised: ${remaining.toFixed(1)}s of a held last frame is dead time; set the chapter's time to ${String(Math.ceil(this.elapsed() + 0.6))}s or show more`,
      ));
    }
    if (remaining > 0) await this.page.waitForTimeout(remaining * 1000);
    return this.elapsed();
  }
}

const tools = (d: ChapterDriver): Locator => d.app.locator("#play-sidebar");
const primaryPath = (d: ChapterDriver): Locator => d.field.locator("path[stroke='#c2261a']");
const routeOf = async (d: ChapterDriver, id: string) => (await d.draft())?.players.find((p) => p.id === id)?.route ?? null;

/** Draw a play, press play: a fresh play, one drag into Twins Left, routes by the tap, the read starred, then ▶. */
async function firstPlay(d: ChapterDriver): Promise<void> {
  await d.say("Start a fresh play");
  await d.goto("/");
  await d.openPanel("Play tools");
  await d.click(tools(d).getByRole("button", { name: "New play", exact: true }), "New play", 200);
  await d.click(tools(d).getByRole("group", { name: "New play" }).getByRole("button", { name: "Offense", exact: true }), "Offense", 120);
  await d.closePanels();
  await d.expectState("A fresh offensive play is on the board", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.every((p) => !p.route))).toBe(true);
    await expect(d.player("Z", "Offense")).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 240, ["Create plays"]);

  await d.say("Drag Z over: Twins Left");
  await d.dragPlayer("Z", "Offense", 9, 1.5, "Drag Z into the left slot", 200);
  await d.expectState("Z lines up in the slot beside X", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o5")?.x)).toBeLessThan(11);
  }, 300, ["Moving players"]);

  await d.say("Tap a player, tap a route");
  await d.selectPlayer("X", "Offense");
  await d.pick("Slant", 200);
  await d.selectPlayer("Z", "Offense");
  await d.pick("Go", 200);
  await d.expectState("X and Z each have a route", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.filter((p) => p.team === "offense" && p.route).length)).toBe(2);
  }, 300, ["Quick routes"]);

  await d.say("Star the read, then press play");
  await d.selectPlayer("X", "Offense");
  await d.paletteAction(/Mark primary/, "Mark X as the primary read", 160);
  await d.closePanels();
  await d.expectState("The slant is drawn as the primary read", async () => {
    await expect(primaryPath(d)).toHaveCount(1, { timeout: ASSERT_TIMEOUT });
  }, 200, ["Primary read"]);
  await d.runPlay("Press play", ["Play playback"], { andSay: "The ball finds the read", posterAt: 2.0, hold: 700 });
}

/** Put your players on the play: the roster on the field, a depth chart, the names on the play, the second string. */
async function roster(d: ChapterDriver): Promise<void> {
  const rosterTile = tools(d).getByRole("group", { name: "Roster" }).getByRole("button", { name: "Roster", exact: true });
  await d.say("Roster: who plays where");
  await d.goto(`/?open=${BUNCH_CORNER.id}`);
  await d.openPanel("Play tools");
  await d.click(rosterTile, "Roster", 120);
  await d.closePanels();
  await d.expectState("The roster stands on the field with the starters' names", async () => {
    await expect(d.field.getByText("Maya", { exact: true })).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(d.field.getByText("Sam", { exact: true })).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 1300, ["Roster"]);

  await d.say("Every position has a depth chart");
  await d.selectPlayer("X", "Offense", "Roster panel");
  await d.expectState("X's depth chart lists its starter and the next up", async () => {
    const chart = d.app.locator("#route-sidebar").getByRole("group", { name: "Depth chart at X" });
    await expect(chart.getByRole("button", { name: "Starter at X: Maya" })).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(chart.getByRole("button", { name: "2nd at X: Devon" })).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 1500, ["Depth charts"]);
  await d.closePanels();

  await d.say("Their names on the play");
  await d.openPanel("Play tools");
  await d.click(rosterTile, "Back to the play", 120);
  await d.setChecked(tools(d).getByRole("checkbox", { name: "Show player names" }), "Show player names", true, 120);
  await d.closePanels();
  await d.expectState("The starters' names sit under the tags on the play", async () => {
    await expect(d.field.getByText("Maya", { exact: true })).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(d.field.locator("text", { hasText: /^X$/ })).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 1200, ["Player names"]);

  await d.say("The second string, made for you");
  await d.openPanel("Play tools");
  await d.choose(tools(d).getByRole("combobox", { name: "Lineup" }), "Lineup", "second", 120);
  await d.closePanels();
  await d.expectState("The Secondary Lineup starts the next player up at every position", async () => {
    await expect(d.field.getByText("Devon", { exact: true })).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(d.field.getByText("Jordan", { exact: true })).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 1500, ["Lineups"]);
  await d.poster();
}

/** It knows your league's rules: the ball on their 5, the dive flagged, made a pass, and the zones switched off. */
async function leagueRules(d: ChapterDriver): Promise<void> {
  const stamp = d.field.getByText("RUN IN NO-RUN ZONE", { exact: true });
  await d.say("Spot the ball on their 5");
  await d.goto("/?open=demo-pistol-dive");
  await d.openPanel("Play tools");
  await d.choose(tools(d).getByRole("combobox", { name: "Line of scrimmage" }), "Line of scrimmage", String(GOAL_YARD - 5), 120);
  await d.closePanels();
  await d.expectState("The ball is on their 5 with the end zone in view", async () => {
    await expect(d.field.locator("text", { hasText: "LOS 5" })).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 900, ["Line of scrimmage"]);

  await d.say("A run from here is flagged");
  await d.expectState("The dive is stamped as a run in the no-run zone", async () => {
    await expect(stamp).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 1600, ["Running plays", "No-run zones"]);
  await d.poster();

  await d.say("Make it a pass: flag gone");
  await d.selectPlayer("Z", "Offense");
  await d.pick("Flat", 160);
  await d.closePanels();
  await d.expectState("A pass from the 5 is legal, so the stamp is gone", async () => {
    await expect(stamp).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  }, 1300);

  await d.say("No zones in your league? Off");
  await d.openPanel("Play tools");
  await d.setChecked(tools(d).getByRole("checkbox", { name: "No-run zones" }), "No-run zones", false, 120);
  await d.closePanels();
  await d.expectState("The hatched no-run bands are gone", async () => {
    await expect(d.field.locator('rect[fill^="url(#"]')).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  }, 1400);
}

/** Run it, then fake it: the jet sweep to the open side, then the same look faked for the post. */
async function runGame(d: ChapterDriver): Promise<void> {
  await d.say("Jet sweep: Z takes it on the move");
  await d.goto(`/?open=${JET_SWEEP.id}`);
  await d.runPlay("Run the jet sweep", ["Jet sweep"], { posterAt: 1.4, hold: 200 });

  await d.say("Same look, fake it, hit the post");
  await d.goto(`/?open=${JET_FAKE_POST.id}`);
  await d.expectState("The faded defense lines up against it", async () => {
    await expect(d.player("S", "Defense")).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(primaryPath(d)).toHaveCount(1, { timeout: ASSERT_TIMEOUT });
  }, 0, ["Shadow defense"]);
  await d.runPlay("Run the jet fake", ["Play-action", "Passing plays"], { hold: 500 });
}

/** Call a Cover 1, then watch it move: the safety deep, man on X off the faded offense, a legal rusher, then ▶. */
async function defense(d: ChapterDriver): Promise<void> {
  await d.say("The safety plays deep");
  await d.goto("/");
  await d.selectPlayer("S", "Defense");
  await d.pick("Zone deep", 160);
  await d.closePanels();
  await d.expectState("The safety drops into a deep zone", async () => {
    await expect.poll(() => routeOf(d, "d5").then((route) => route?.type)).toBe("zoneDeep");
  }, 500, ["Zones", "Defensive plays"]);

  await d.say("Man on X: tap the faded offense");
  await d.selectPlayer("LC", "Defense");
  await d.pick("Man", 160);
  await d.click(d.app.getByRole("button", { name: "Offense X, man coverage target", exact: true }), "Choose X as the man target", 200);
  await d.expectState("LC covers X, picked from the shadow offense", async () => {
    await expect.poll(() => routeOf(d, "d1")).toEqual({ type: "man", target: "o3" });
  }, 500, ["Shadow offense", "Man coverage"]);

  await d.say("A rusher, held 7 yards off");
  await d.selectPlayer("R", "Defense");
  await d.pick("Blitz", 160);
  await d.closePanels();
  await d.expectState(`The rusher is moved back to ${String(BLITZ_DEPTH)} yards off the ball`, async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "d3")?.y)).toBeLessThanOrEqual(-BLITZ_DEPTH);
  }, 600, ["Blitz"]);

  await d.say("Press play: the defense reacts");
  await d.runPlay("Run the call", ["Defense in motion"], { posterAt: 1.5, hold: 500 });
}

/** Build the book, call it from the sideline: a play added and ordered, then the game-day reader. */
async function gameDay(d: ChapterDriver): Promise<void> {
  const items = d.app.getByRole("list").getByRole("listitem");
  await d.say("Add a play to the game plan");
  await d.goto(`/playbooks?book=${DEMO_PLAYBOOK.id}`);
  await d.click(d.app.getByRole("button", { name: "+ Add plays", exact: true }), "+ Add plays", 160);
  await d.click(d.app.getByTitle(`Add ${TWINS_SLANT.name}`), `Add ${TWINS_SLANT.name}`, 300);
  await d.click(d.app.getByRole("button", { name: "Done", exact: true }), "Done", 400);
  const last = items.nth(DEMO_PLAYBOOK.plays.length);
  await d.beat("selector", "Bring the new play into view", async () => {
    await (await d.visible(last, "The book's last play")).evaluate((element) => { element.scrollIntoView({ block: "center" }); });
  }, 0);
  await d.expectState(`${TWINS_SLANT.name} is play ${String(DEMO_PLAYBOOK.plays.length + 1)} of the book`, async () => {
    await expect(last).toContainText(TWINS_SLANT.name, { timeout: ASSERT_TIMEOUT });
  }, 1100, ["Playbooks"]);

  await d.say("Calling order sets the numbers");
  await d.click(last.getByRole("button", { name: "Move up", exact: true }), "Move the new play up", 200);
  await d.expectState("The new play takes the number above", async () => {
    await expect(items.nth(DEMO_PLAYBOOK.plays.length - 1)).toContainText(TWINS_SLANT.name, { timeout: ASSERT_TIMEOUT });
  }, 1200, ["Play ordering"]);

  await d.say("Game-day reader: hear 4, type 4");
  const reader = d.app.getByRole("link", { name: /Game-day reader/ });
  await d.beat("selector", "Back up to the reader link", async () => {
    await (await d.visible(reader, "Game-day reader link")).evaluate((element) => { element.scrollIntoView({ block: "center" }); });
  }, 0);
  await d.click(reader, "Game-day reader ›", 600);
  await d.type(d.app.getByRole("searchbox", { name: "Find a call" }), "Find a call", "4", 500);
  const fourth = DEMO_PLAYS.find((p) => p.id === DEMO_PLAYBOOK.plays[3]);
  if (!fourth) throw new Error("the book has no fourth play");
  await d.click(d.app.getByRole("list", { name: "Matching calls" }).getByRole("button").first(), "Open call 4", 200);
  await d.expectState("The reader opens call 4 on a big field", async () => {
    await expect(d.app.getByRole("heading", { name: fourth.name, exact: true })).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(d.app.getByText(`Play 4 of ${String(DEMO_PLAYBOOK.plays.length + 1)}`, { exact: true })).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 1400, ["Game-day reader", "Call search"]);

  await d.say("Full screen on the sideline");
  await d.click(d.app.getByRole("button", { name: "Full screen", exact: true }), "Full screen", 200);
  await d.expectState("The reader fills the screen with the play", async () => {
    await expect(d.app.locator("[data-full-screen]")).toHaveCount(1, { timeout: ASSERT_TIMEOUT });
  }, 1600, ["Full screen"]);
  await d.poster();
}

/** Every player gets their own wristband: the band picked, X's insert, Z's insert, then the binder and the slides. */
async function wristbands(d: ChapterDriver): Promise<void> {
  const adult = BAND_PRESETS.find((preset) => preset.key === "adultSlim");
  if (!adult) throw new Error("the adult slim band preset is gone");
  const items = numbered(DEMO_PLAYBOOK, DEMO_PLAYS);
  const options = { size: adult, paper: "letter" as const, bookName: DEMO_PLAYBOOK.name, team: DEMO_TEAM };
  const insert = (position: string) => {
    const svg = wristbandCard(items, options, position);
    if (!svg) throw new Error(`no wristband insert is titled ${position}`);
    return svg;
  };
  const sizes = d.app.getByRole("combobox", { name: "Wristband size" });
  await d.say("Pick the band your team wears");
  await d.goto(`/playbooks?book=${DEMO_PLAYBOOK.id}`);
  await d.beat("selector", "Bring the wristbands up", async () => {
    await (await d.visible(sizes, "Wristband size")).evaluate((element) => { element.scrollIntoView({ block: "center" }); });
  }, 120);

  await d.choose(sizes, "Wristband size", adult.key, 120);
  await d.expectState("The whole book fits one adult slim insert per player", async () => {
    await expect(d.app.getByText(/8 plays per insert/)).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 900, ["Band sizes"]);

  await d.say("X's card: X's route in bold");
  await d.download("Download wristbands PDF", /-wristbands\.pdf$/, ["Wristbands"], {
    hold: 0,
    during: async () => {
      await d.page.waitForTimeout(500);
      await d.overlay(insert("X"), "Show X's insert", 0);
    },
  });
  await d.expectState("X's insert is on screen", async () => {
    await expect(d.app.locator(`#${OVERLAY_ID} svg`).first()).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 1800);
  await d.poster();

  await d.say("Z's card: Z's route in bold");
  await d.overlay(insert("Z"), "Show Z's insert", 1800);

  await d.say("Binder pages and meeting slides too");
  await d.overlay(null, "Take the insert down", 0);
  await d.download("Download binder PDF", /-binder\.pdf$/, ["Binder PDF"], { hold: 200 });
  await d.download("Download slides", /-slides\.pptx$/, ["Slides"], { hold: 500 });
  await d.expectState("Both exports were saved", async () => {
    await expect(d.toast).toHaveText("Saved", { timeout: ASSERT_TIMEOUT });
  }, 600);
}

/** Send it to your staff: save, the coaching points, a link, and what the assistant opens. */
async function share(d: ChapterDriver): Promise<void> {
  await d.say("Save the play");
  await d.goto("/");
  await d.openPanel("Play tools");
  await d.click(tools(d).getByRole("button", { name: "Save", exact: true }), "Save", 120);
  await d.expectState("The app confirms the save", async () => {
    await expect(d.toast).toHaveText("Saved", { timeout: ASSERT_TIMEOUT });
  }, 800, ["Saving"]);

  await d.say("Add the coaching points");
  await d.click(tools(d).getByRole("button", { name: "Notes", exact: true }), "Notes", 120);
  await d.type(d.app.getByRole("textbox", { name: "Coaching points" }), "Coaching points", "X wins inside off Z's seam.", 700, ["Notes"]);

  await d.say("Copy a link");
  await d.click(tools(d).getByRole("button", { name: "Copy share link", exact: true }), "Copy share link", 400);
  await d.click(d.app.getByRole("dialog", { name: "Share snapshot" }).getByRole("button", { name: "Copy snapshot link", exact: true }), "Copy snapshot link", 120);
  await d.expectState("The link is on the clipboard", async () => {
    await expect(d.toast).toHaveText("Link copied", { timeout: ASSERT_TIMEOUT });
  }, 800, ["Share link"]);

  await d.say("What your assistant opens");
  const link = await d.app.evaluate(() => navigator.clipboard.readText());
  const path = new URL(link).pathname + new URL(link).search;
  if (!path.startsWith("/p/")) throw new ChapterBeatError(d.slug, "read the copied link", "state", new Error(`the clipboard holds ${link}`));
  await d.goto(path);
  await d.expectState("The shared page shows the play, the notes and a way into the designer", async () => {
    await expect(d.app.getByRole("heading", { name: TWINS_SLANT.name })).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(d.app.getByText("X wins inside off Z's seam.")).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(d.app.getByRole("link", { name: /Open in designer/ })).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 2000, ["Shared play page"]);
  await d.poster();
}

/** Score in your own end zone: a lettered end zone, X's own route into it, then the catch and the celebration. */
async function touchdown(d: ChapterDriver): Promise<void> {
  // the field's design sits on its own layer beside the diagram, never inside it
  const art = d.field.locator("xpath=..").locator(":scope > [data-ez-backdrop] [data-ez-art]");
  await d.say("Pick an end zone, lettered for your team");
  await d.goto("/");
  await d.unfold("End zone");
  await d.pickLook(tools(d).getByRole("radiogroup", { name: "End zone" }).getByRole("radio", { name: "Synthwave '84", exact: true }), "Synthwave '84", 120);
  await d.closePanels();
  await d.expectState("Their end zone is painted Synthwave with the team's name across it", async () => {
    await expect(art).toHaveAttribute("data-ez-art", "synthwave", { timeout: ASSERT_TIMEOUT });
    await expect(art.locator("[data-ez-name]")).toHaveAttribute("data-ez-name", DEMO_TEAM.name.toUpperCase(), { timeout: ASSERT_TIMEOUT });
  }, 800, ["End zones", "Team lettering"]);

  await d.say("Draw X a route of your own");
  await d.selectPlayer("X", "Offense");
  await d.pick("Custom", 120);
  await d.tapField(9, -5, "Tap the first waypoint");
  await d.tapField(13.5, -13, "Tap the second waypoint, in the end zone");
  await d.click(d.app.getByRole("button", { name: "Finish", exact: true }), "Finish the route", 120);
  await d.expectState("X has a two-point route of its own, ending in the end zone", async () => {
    await expect.poll(() => routeOf(d, "o3").then((route) => route?.pts?.length)).toBe(2);
  }, 300, ["Custom routes"]);

  await d.say("Press play and score");
  await d.selectPlayer("X", "Offense");
  await d.paletteAction(/Mark primary/, "Mark X as the read", 120);
  await d.closePanels();
  const run = d.app.getByRole("button", { name: "Run the play", exact: true });
  const stop = d.app.getByRole("button", { name: "Stop the play", exact: true });
  await d.clickUntilState(run, "Run the play", async () => hasAttributeNow(stop, "aria-pressed", "true"), 0);
  const party = d.app.locator("[data-celebration]");
  await d.expectState("The catch in the end zone is celebrated in Synthwave and opens Sakura", async () => {
    await expect(party).toHaveAttribute("data-celebration", "synthwave", { timeout: 10_000 });
    await expect(party.locator("[data-unlocked]")).toHaveText("New end zone: Sakura", { timeout: ASSERT_TIMEOUT });
  }, 500, ["Touchdowns"]);
  await d.poster();
  await d.hold(700);
}

/** Trick plays, legal by design: a lateral to Z who throws it, a catch that will not go forward, then ▶. */
async function trickPlays(d: ChapterDriver): Promise<void> {
  await d.say("QB laterals to Z, who throws it");
  await d.goto("/");
  await d.selectPlayer("QB", "Offense");
  await d.pick("Lateral", 120);
  await d.click(d.app.getByRole("button", { name: "Offense Z, can take the lateral", exact: true }), "Z takes the lateral", 200);
  await d.pick("Throw", 160);
  await d.closePanels();
  await d.expectState("The call reads as a double pass", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o2")?.laterals?.[0]?.to)).toBe("o5");
    await expect.poll(() => routeOf(d, "o5").then((route) => route?.type)).toBe("throw");
  }, 600, ["Laterals", "Double pass"]);

  await d.say("A lateral never goes forward");
  const handle = d.field.locator("[data-catch='0']");
  const before = await d.draft().then((draft) => draft?.players.find((p) => p.id === "o2")?.laterals?.[0]?.catch);
  await d.dragHandle(handle, 11, 0.5, "Drag the catch up to the line", 200);
  await d.expectState("The catch snaps back behind where the ball was let go, and says why", async () => {
    await expect(d.toast).toContainText(/behind|never ahead|forward/i, { timeout: ASSERT_TIMEOUT });
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o2")?.laterals?.[0]?.catch?.[1] ?? before?.[1] ?? 99)).toBeGreaterThanOrEqual(4.9);
  }, 700, ["Lateral rules"]);

  await d.say("Press play: double pass");
  await d.runPlay("Run the double pass", [], { posterAt: 1.0, hold: 500 });
}

export interface ChapterDefinition {
  slug: ChapterSlug;
  /** the length the tour promises for this chapter; the recorder holds the last frame to reach it */
  targetSeconds: number;
  run: (driver: ChapterDriver) => Promise<void>;
  /**
   * Live ▶ playback is a simulation (the primary read gets the ball most of the time). A chapter
   * that narrates the primary pins every coin flip; it must never save a play, so nothing else
   * draws on Math.random.
   */
  pinRandom?: true;
  /** the delivery frame rate: 12 where ▶ plays a ball in flight, else the default */
  fps?: FrameRate;
}

export const CHAPTERS: Readonly<Record<ChapterSlug, ChapterDefinition>> = {
  "first-play": { slug: "first-play", targetSeconds: 12, run: firstPlay, pinRandom: true, fps: 12 },
  roster: { slug: "roster", targetSeconds: 11, run: roster },
  "league-rules": { slug: "league-rules", targetSeconds: 10, run: leagueRules },
  "run-game": { slug: "run-game", targetSeconds: 12, run: runGame, pinRandom: true, fps: 12 },
  defense: { slug: "defense", targetSeconds: 11, run: defense, pinRandom: true, fps: 12 },
  "game-day": { slug: "game-day", targetSeconds: 11, run: gameDay },
  wristbands: { slug: "wristbands", targetSeconds: 11, run: wristbands },
  share: { slug: "share", targetSeconds: 9, run: share },
  touchdown: { slug: "touchdown", targetSeconds: 11, run: touchdown, pinRandom: true, fps: 12 },
  "trick-plays": { slug: "trick-plays", targetSeconds: 10, run: trickPlays, pinRandom: true, fps: 12 },
};

export interface ChapterRun {
  /** seconds the chapter took on screen, before encoding */
  seconds: number;
  poster: Buffer;
  /** seconds of video before the chapter's first screen was on camera: the browser launching, the first load */
  leadIn: number;
}

/** Plays a chapter's beats on an already-seeded page and returns its poster frame. */
export async function recordChapterActions(slug: ChapterSlug, page: Page, app: Frame, baseUrl: string, videoT0: number, trace?: (line: string) => void): Promise<ChapterRun> {
  const definition = CHAPTERS[slug];
  const captured: { poster: Buffer | null } = { poster: null };
  const driver = new ChapterDriver(slug, page, app, baseUrl, (png) => { captured.poster = png; }, trace);
  await definition.run(driver);
  const seconds = await driver.finish(definition.targetSeconds);
  trace?.(`[${slug} ${seconds.toFixed(2)}s] finished (target ${String(definition.targetSeconds)}s, ${String(definition.fps ?? DEFAULT_FPS)} fps)`);
  if (!captured.poster) throw new ChapterBeatError(slug, "capture poster frame", "recording", new Error("no poster frame was captured"));
  if (driver.clockStart === null) throw new ChapterBeatError(slug, "open the first screen", "recording", new Error("the chapter never opened a screen"));
  return { seconds, poster: captured.poster, leadIn: (driver.clockStart - videoT0) / 1000 + LEAD_IN_MARGIN };
}

/** The caption band's height, for anything that must stay under it. */
export { CAPTION_BAND };
