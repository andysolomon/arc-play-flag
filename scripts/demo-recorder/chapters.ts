import { expect, type Locator, type Page } from "@playwright/test";
import { S, VW } from "../../lib/play/geometry";
import { BLITZ_DEPTH } from "../../lib/play/routes";
import { DRAFT_KEY, type DraftRecord } from "../../lib/play/storage";
import { DEMO_PLAYBOOK, PLAY_ACTION_WHEEL, QUICK_SLANT } from "./fixtures";
import { hasAttributeNow, retryStatefulInteraction } from "./interactions";
import type { ChapterSlug } from "./options";

/**
 * selector: a visible control changed or disappeared.
 * state: the control was used but the expected result did not land.
 * export: an in-app download did not happen or produced the wrong file.
 * recording: navigation, capture, encoding, duration or output validation failed.
 */
export type BeatKind = "selector" | "state" | "export" | "recording";

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

/** A caption pill drawn over the app, under the header, so a viewer knows what each moment demonstrates. */
const CAPTION_ID = "arc-demo-recorder-caption";

const SIDEBARS = { "Play tools": "play-sidebar", "Route palette": "route-sidebar" } as const;
type SidebarName = keyof typeof SIDEBARS;
type Team = "Offense" | "Defense";

const ASSERT_TIMEOUT = 5_000;

/**
 * Drives one chapter the way a coach would: through visible, accessible controls.
 * The 960px viewport puts the app in its compact layout, so the two sidebars are
 * drawers that overlay the field one at a time, and picking a route folds the
 * palette away. Every helper waits on what a person would see.
 */
export class ChapterDriver {
  private posterTaken = false;
  /** where the caption sits: under the header on the designer, along the bottom on list screens */
  captionEdge: "top" | "bottom" = "top";

  constructor(
    readonly slug: ChapterSlug,
    readonly page: Page,
    readonly baseUrl: string,
    private readonly startedAt: number,
    private readonly posterSink: (png: Buffer) => void,
    private readonly trace: (line: string) => void = () => undefined,
  ) {}

  /** Seconds since the video started recording. */
  elapsed(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  get field(): Locator {
    return this.page.locator("[aria-label='Play diagram']");
  }

  /** Wraps a failure with the chapter, beat and class unless it is already classified. */
  private fail(kind: BeatKind, beat: string, cause: unknown): ChapterBeatError {
    return cause instanceof ChapterBeatError ? cause : new ChapterBeatError(this.slug, beat, kind, cause);
  }

  async beat(kind: BeatKind, name: string, action: () => Promise<void>, hold = 240): Promise<void> {
    try {
      await action();
      this.trace(`[${this.slug} ${this.elapsed().toFixed(2)}s] ${name}`);
      await this.page.waitForTimeout(hold);
    } catch (error) {
      throw this.fail(kind, name, error);
    }
  }

  /** Changes the on-screen caption; it stays until the next story beat. */
  async say(text: string): Promise<void> {
    await this.beat("recording", `caption "${text}"`, async () => {
      await this.page.evaluate(([id, value, edge]) => {
        let element = document.getElementById(id);
        if (!element) {
          element = document.createElement("div");
          element.id = id;
          Object.assign(element.style, {
            position: "fixed", left: "50%", zIndex: "2147483647",
            transform: "translateX(-50%)", maxWidth: "720px", padding: "8px 18px",
            border: "2px solid #1b1a17", borderRadius: "999px", background: "#fffdf6",
            boxShadow: "2px 3px 0 #1b1a17", color: "#1b1a17", font: "600 22px/1.2 sans-serif",
            textAlign: "center", pointerEvents: "none", whiteSpace: "nowrap",
          });
          // under the header the pill sits in the field's no-run band, clear of the hint toast and the field toolbar
          if (edge === "top") element.style.top = "104px";
          else element.style.bottom = "14px";
          document.body.append(element);
        }
        element.textContent = value;
      }, [CAPTION_ID, text, this.captionEdge] as const);
    }, 100);
  }

  async goto(path: string): Promise<void> {
    await this.beat("recording", `open ${path}`, async () => {
      const response = await this.page.goto(`${this.baseUrl}${path}`, { waitUntil: "load" });
      if (!response?.ok()) throw new Error(`app returned HTTP ${String(response?.status() ?? "no response")}`);
      await expect(this.page.getByRole("button", { name: "Play tools", exact: true }).or(this.page.getByRole("textbox", { name: "Team name" }))).toBeVisible({ timeout: ASSERT_TIMEOUT });
    }, 160);
  }

  async visible(locator: Locator, description: string): Promise<Locator> {
    try {
      await expect(locator, description).toBeVisible({ timeout: ASSERT_TIMEOUT });
      return locator;
    } catch (error) {
      throw this.fail("selector", description, error);
    }
  }

  async click(locator: Locator, description: string, hold?: number): Promise<void> {
    await this.beat("selector", description, async () => {
      await this.visible(locator, description);
      await locator.hover();
      await this.page.waitForTimeout(60);
      await locator.click();
    }, hold);
  }

  /**
   * Clicks a server-rendered control until the client-owned state confirms that
   * React handled it. This covers the brief window where a fresh profile can see
   * a control before hydration has attached its event handler.
   */
  async clickUntilState(locator: Locator, description: string, isSatisfied: () => Promise<boolean>, hold?: number): Promise<void> {
    await this.beat("selector", description, async () => {
      await this.visible(locator, description);
      await locator.hover();
      await this.page.waitForTimeout(60);
      await retryStatefulInteraction(
        async () => { await locator.click(); },
        isSatisfied,
        { wait: async (milliseconds) => { await this.page.waitForTimeout(milliseconds); } },
      );
    }, hold);
  }

  /** Confirms an expected result landed; the assertion itself names what was expected. */
  async expectState(description: string, assertion: () => Promise<void>, hold = 120): Promise<void> {
    await this.beat("state", description, assertion, hold);
  }

  private toggle(name: SidebarName): Locator {
    return this.page.getByRole("button", { name, exact: true });
  }

  async openPanel(name: SidebarName): Promise<void> {
    const toggle = this.toggle(name);
    const panel = this.page.locator(`#${SIDEBARS[name]}`);
    await this.clickUntilState(toggle, `Open ${name.toLowerCase()}`, async () => (
      await hasAttributeNow(toggle, "aria-expanded", "true")
      && await hasAttributeNow(panel, "aria-hidden", "false")
    ), 120);
    await this.expectState(`${name} is open`, async () => {
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: ASSERT_TIMEOUT });
      await expect(panel).toHaveAttribute("aria-hidden", "false", { timeout: ASSERT_TIMEOUT });
    }, 160);
  }

  /** Folds both drawers away so the whole field is visible and tappable. */
  async closePanels(): Promise<void> {
    for (const name of Object.keys(SIDEBARS) as SidebarName[]) {
      const toggle = this.toggle(name);
      if (await hasAttributeNow(toggle, "aria-expanded", "true")) {
        await this.clickUntilState(toggle, `Close ${name.toLowerCase()}`, async () => (
          await hasAttributeNow(toggle, "aria-expanded", "false")
        ), 120);
        await this.expectState(`${name} is closed`, async () => {
          await expect(toggle).toHaveAttribute("aria-expanded", "false", { timeout: ASSERT_TIMEOUT });
        }, 0);
      }
    }
  }

  player(label: string, team: Team): Locator {
    return this.field.getByRole("button", { name: `${team} ${label}`, exact: true });
  }

  /** Tapping a player selects it and opens the palette for it. */
  async selectPlayer(label: string, team: Team): Promise<void> {
    await this.closePanels();
    const player = this.player(label, team);
    await this.clickUntilState(player, `Select ${team.toLowerCase()} ${label || "player"}`, async () => (
      await hasAttributeNow(player, "aria-pressed", "true")
      && await hasAttributeNow(this.toggle("Route palette"), "aria-expanded", "true")
    ), 120);
    await this.expectState(`Route palette follows ${team.toLowerCase()} ${label || "player"}`, async () => {
      await expect(player).toHaveAttribute("aria-pressed", "true", { timeout: ASSERT_TIMEOUT });
      await expect(this.toggle("Route palette")).toHaveAttribute("aria-expanded", "true", { timeout: ASSERT_TIMEOUT });
    }, 160);
  }

  /** Picks a route or coverage tile for the selected player. */
  async pick(label: string): Promise<void> {
    await this.openPanel("Route palette");
    const tile = this.page.locator("#route-sidebar").getByRole("group").getByRole("button", { name: label, exact: true });
    await this.click(tile, `Pick ${label}`, 300);
  }

  /** A pill in the palette that is not a route tile: the primary read or the mirror. */
  async paletteAction(name: RegExp | string, description: string): Promise<void> {
    await this.openPanel("Route palette");
    await this.click(this.page.locator("#route-sidebar").getByRole("button", { name }), description, 300);
  }

  /** Client coordinates of a yard point on the field, read from the SVG's own viewBox. */
  private async yardPoint(x: number, y: number): Promise<{ x: number; y: number }> {
    const box = await this.field.boundingBox();
    const viewBox = await this.field.getAttribute("viewBox");
    if (!box || !viewBox) throw new Error("the field has not laid out");
    const vh = Number(viewBox.split(" ")[3]);
    const top = 8 - vh / S;
    return { x: box.x + ((x * S) / VW) * box.width, y: box.y + (((y - top) * S) / vh) * box.height };
  }

  /** Taps a yard point on the open field, for custom-route waypoints. */
  async tapField(x: number, y: number, description: string): Promise<void> {
    await this.closePanels();
    await this.beat("selector", description, async () => {
      const point = await this.yardPoint(x, y);
      await this.page.mouse.move(point.x, point.y);
      await this.page.waitForTimeout(60);
      await this.page.mouse.click(point.x, point.y);
    }, 200);
  }

  /** Clicks a download control and checks that the browser received the named file. */
  async download(label: string, expected: RegExp): Promise<void> {
    await this.beat("export", label, async () => {
      const button = await this.visible(this.page.getByRole("button", { name: label, exact: true }), label);
      const [download] = await Promise.all([
        this.page.waitForEvent("download", { timeout: 20_000 }),
        button.click(),
      ]);
      const name = download.suggestedFilename();
      if (!expected.test(name)) throw new Error(`unexpected download name: ${name}`);
      const failure = await download.failure();
      if (failure) throw new Error(`download "${name}" failed: ${failure}`);
      await download.delete();
    }, 240);
  }

  /** The stored draft, which autosave writes after every committed change. */
  async draft(): Promise<DraftRecord | null> {
    return this.page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null") as DraftRecord | null, DRAFT_KEY);
  }

  /** Captures the poster frame now: the moment that best says what the chapter shows. */
  async poster(): Promise<void> {
    await this.beat("recording", "capture poster frame", async () => {
      this.posterSink(await this.page.screenshot({ type: "png" }));
      this.posterTaken = true;
    }, 0);
  }

  /** Holds the final frame until the chapter reaches its target length, then makes sure a poster exists. */
  async finish(targetSeconds: number): Promise<number> {
    if (!this.posterTaken) await this.poster();
    const remaining = targetSeconds - this.elapsed();
    if (remaining > 0) await this.page.waitForTimeout(remaining * 1000);
    return this.elapsed();
  }
}

/** Draw the offense: name, quick route, primary read, custom route, mirror, undo and redo. */
async function buildPlay(d: ChapterDriver): Promise<void> {
  await d.goto("/");
  await d.say("Name the play");
  await d.openPanel("Play tools");
  await d.beat("selector", "Play name", async () => {
    const name = await d.visible(d.page.getByRole("textbox", { name: "Play name" }), "Play name");
    await name.pressSequentially(QUICK_SLANT.name, { delay: 16 });
  }, 200);

  await d.say("Quick route: X runs a slant");
  await d.selectPlayer("X", "Offense");
  await d.pick("Slant");
  await d.expectState("X has a slant", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o3")?.route?.type)).toBe("slant");
  });

  await d.say("Mark X as the primary read");
  await d.selectPlayer("X", "Offense");
  await d.paletteAction(/Mark primary/, "Mark the primary read");
  await d.expectState("The slant is drawn as the primary read", async () => {
    await expect(d.field.locator("path[stroke='#c2261a']")).toHaveCount(1, { timeout: ASSERT_TIMEOUT });
  });

  await d.say("Custom route: tap waypoints for Z");
  await d.selectPlayer("Z", "Offense");
  await d.pick("Custom");
  const [first, second] = QUICK_SLANT.players.find((p) => p.id === "o5")?.route?.pts ?? [];
  if (!first || !second) throw new Error("the fixture custom route needs two waypoints");
  await d.tapField(first[0], first[1], "Tap the first waypoint");
  await d.tapField(second[0], second[1], "Tap the second waypoint");
  await d.click(d.page.getByRole("button", { name: "Finish", exact: true }), "Finish the custom route");
  await d.expectState("Z has a two-point custom route", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o5")?.route?.pts?.length)).toBe(2);
  });
  await d.poster();

  await d.say("Mirror the custom route");
  await d.selectPlayer("Z", "Offense");
  await d.paletteAction("⇄ Mirror route", "Mirror the custom route");
  await d.expectState("The custom route now bends the other way", async () => {
    // the route mirrors around Z, so its second waypoint moves from Z's left to Z's right
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o5")?.route?.pts?.[1]?.[0])).toBeGreaterThan(first[0]);
  });

  await d.say("Undo and redo any change");
  await d.closePanels();
  await d.click(d.page.getByRole("button", { name: "Undo", exact: true }), "Undo the mirror", 360);
  await d.click(d.page.getByRole("button", { name: "Redo", exact: true }), "Redo the mirror", 360);
}

/** Watch plays run: the snap, the play-action fake, and the ball finishing with the primary read. */
async function runPlay(d: ChapterDriver): Promise<void> {
  await d.goto(`/?open=${PLAY_ACTION_WHEEL.id}`);
  await d.expectState("The primary wheel anchors the teaching path", async () => {
    await expect(d.field.locator("path[stroke='#c2261a']")).toHaveCount(1, { timeout: ASSERT_TIMEOUT });
  });
  await d.say("Snap, sell the handoff, hit Z on the wheel");
  const run = d.page.getByRole("button", { name: "Run the play", exact: true });
  await d.clickUntilState(run, "Run the play", async () => (
    await hasAttributeNow(d.page.getByRole("button", { name: "Stop the play", exact: true }), "aria-pressed", "true")
  ), 0);
  await d.expectState("The play is running with the ball in view", async () => {
    await expect(d.page.getByRole("button", { name: "Stop the play", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: ASSERT_TIMEOUT });
    await expect(d.field.locator("image")).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 0);
  await d.page.waitForTimeout(1_400);
  await d.poster();
  await d.expectState("The play finishes and the whiteboard returns", async () => {
    await expect(run).toBeVisible({ timeout: 15_000 });
    await expect(d.field.locator("image")).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  }, 500);
}

/** Build the defense: offense only, both teams, a deep zone, man coverage and a legal blitz. */
async function buildDefense(d: ChapterDriver): Promise<void> {
  await d.goto("/?open=demo-defense");
  await d.say("Offense only, or both teams");
  await d.openPanel("Play tools");
  const show = d.page.locator("#play-sidebar").getByRole("group", { name: "Show" });
  await d.click(show.getByRole("button", { name: "Offense", exact: true }), "Show the offense only", 420);
  await d.expectState("Defenders are hidden", async () => {
    await expect(d.player("d1", "Defense")).toBeHidden({ timeout: ASSERT_TIMEOUT });
  });
  await d.click(show.getByRole("button", { name: "Both", exact: true }), "Show both teams", 420);

  await d.say("Deep zone");
  await d.selectPlayer("d1", "Defense");
  await d.pick("Zone deep");
  await d.expectState("d1 drops into a deep zone", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "d1")?.route?.type)).toBe("zoneDeep");
  }, 400);

  await d.say("Man coverage on X");
  await d.selectPlayer("d2", "Defense");
  await d.pick("Man");
  await d.click(d.page.getByRole("button", { name: "Offense X, man coverage target", exact: true }), "Choose X as the man target", 380);
  await d.expectState("d2 covers X", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "d2")?.route)).toEqual({ type: "man", target: "o3" });
  });

  await d.say("Blitz from a legal depth");
  await d.selectPlayer("d3", "Defense");
  await d.pick("Blitz");
  await d.expectState(`The blitzer lines up at least ${String(BLITZ_DEPTH)} yards off the ball`, async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "d3")?.y)).toBeLessThanOrEqual(-BLITZ_DEPTH);
  });
  await d.poster();
}

/** Save, share and export: save, coaching notes, duplicate, a share link, then picture and video export. */
async function saveExport(d: ChapterDriver): Promise<void> {
  await d.goto(`/?open=${PLAY_ACTION_WHEEL.id}`);
  const tools = d.page.locator("#play-sidebar");
  const toast = d.page.locator("div[role='status']");
  await d.say("Save the play");
  await d.openPanel("Play tools");
  await d.click(tools.getByRole("button", { name: "Save", exact: true }), "Save", 200);
  await d.expectState("The app confirms the save", async () => {
    await expect(toast).toHaveText("Saved", { timeout: ASSERT_TIMEOUT });
  }, 500);

  await d.say("Add coaching notes");
  await d.click(tools.getByRole("button", { name: "Notes", exact: true }), "Notes", 160);
  await d.beat("selector", "Coaching points", async () => {
    const notes = await d.visible(d.page.getByRole("textbox", { name: "Coaching points" }), "Coaching points");
    await notes.fill("");
    await notes.pressSequentially("Sell the handoff first.", { delay: 22 });
  }, 500);

  await d.say("Duplicate it");
  await d.click(tools.getByRole("button", { name: "Duplicate", exact: true }), "Duplicate", 200);
  await d.expectState("The copy is saved under its own name", async () => {
    await expect(toast).toHaveText("Saved a copy", { timeout: ASSERT_TIMEOUT });
    await expect(d.page.getByRole("textbox", { name: "Play name" })).toHaveValue(`${PLAY_ACTION_WHEEL.name} copy`, { timeout: ASSERT_TIMEOUT });
  }, 600);

  await d.say("Copy a share link");
  await d.click(tools.getByRole("button", { name: "Copy share link", exact: true }), "Copy share link", 700);
  await d.click(d.page.getByRole("dialog", { name: "Share snapshot" }).getByRole("button", { name: "Copy snapshot link", exact: true }), "Copy snapshot link", 200);
  await d.expectState("The link is on the clipboard", async () => {
    await expect(toast).toHaveText("Link copied", { timeout: ASSERT_TIMEOUT });
  }, 500);

  await d.say("Export a picture card or a video clip");
  await d.click(tools.getByRole("button", { name: "Export", exact: true }), "Export", 200);
  await d.beat("selector", "Export panel", async () => {
    await (await d.visible(tools.locator("[aria-label='Export play']"), "Export play panel")).scrollIntoViewIfNeeded();
  }, 200);
  await d.poster();
  await d.download("Save picture card", /\.png$/);
  await d.expectState("Video export is ready", async () => {
    await expect(d.page.getByRole("button", { name: "Save video clip", exact: true })).toBeEnabled({ timeout: ASSERT_TIMEOUT });
  }, 300);
}

/** Build a playbook: team setup, a new book, add and order plays, then wristbands, binder or a file. */
async function playbooks(d: ChapterDriver): Promise<void> {
  d.captionEdge = "bottom";
  await d.goto("/playbooks");
  const items = d.page.getByRole("list").getByRole("listitem");
  await d.say("Team setup and saved playbooks");
  await d.expectState("The fictional team and its playbook are shown", async () => {
    await expect(d.page.getByRole("textbox", { name: "Team name" })).toHaveValue("Riverside Otters", { timeout: ASSERT_TIMEOUT });
    await expect(d.page.getByRole("link", { name: new RegExp(DEMO_PLAYBOOK.name) })).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(d.page.getByLabel("Import a playbook file")).toBeAttached({ timeout: ASSERT_TIMEOUT });
  }, 700);

  await d.say("Start a new playbook");
  await d.clickUntilState(d.page.getByRole("button", { name: "+ New playbook", exact: true }), "+ New playbook", async () => (
    await d.page.getByRole("textbox", { name: "Playbook name" }).isVisible()
  ), 200);
  await d.beat("selector", "Playbook name", async () => {
    const name = await d.visible(d.page.getByRole("textbox", { name: "Playbook name" }), "Playbook name");
    await name.fill("");
    await name.pressSequentially("Otter Red Zone", { delay: 22 });
  }, 200);
  await d.expectState("The new playbook carries its name", async () => {
    await expect(d.page.getByRole("textbox", { name: "Playbook name" })).toHaveValue("Otter Red Zone", { timeout: ASSERT_TIMEOUT });
  }, 300);

  await d.say("Add plays, then put them in order");
  await d.click(d.page.getByTitle(`Add ${QUICK_SLANT.name}`), `Add ${QUICK_SLANT.name}`, 300);
  await d.click(d.page.getByTitle(`Add ${PLAY_ACTION_WHEEL.name}`), `Add ${PLAY_ACTION_WHEEL.name}`, 400);
  await d.click(items.nth(0).getByRole("button", { name: "Move down", exact: true }), "Move the opener down", 200);
  await d.expectState("The wheel now opens the playbook", async () => {
    await expect(items).toHaveText([new RegExp(PLAY_ACTION_WHEEL.name), new RegExp(QUICK_SLANT.name)], { timeout: ASSERT_TIMEOUT });
  }, 700);

  await d.say("Wristbands, binder pages or a playbook file");
  await d.beat("selector", "Export playbook panel", async () => {
    const panel = await d.visible(d.page.locator("[aria-label='Export playbook']"), "Export playbook panel");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.getByRole("button", { name: "Download wristbands PDF", exact: true })).toBeEnabled({ timeout: ASSERT_TIMEOUT });
    await expect(panel.getByRole("button", { name: "Download binder PDF", exact: true })).toBeEnabled({ timeout: ASSERT_TIMEOUT });
  }, 300);
  await d.poster();
  await d.download("Download playbook file", /\.playbook\.json$/);
}

export interface ChapterDefinition {
  slug: ChapterSlug;
  /** the length the tour promises for this chapter; the recorder holds the last frame to reach it */
  targetSeconds: number;
  run: (driver: ChapterDriver) => Promise<void>;
}

export const CHAPTERS: Readonly<Record<ChapterSlug, ChapterDefinition>> = {
  "build-play": { slug: "build-play", targetSeconds: 11, run: buildPlay },
  "run-play": { slug: "run-play", targetSeconds: 7, run: runPlay },
  "build-defense": { slug: "build-defense", targetSeconds: 9, run: buildDefense },
  "save-export": { slug: "save-export", targetSeconds: 10, run: saveExport },
  playbooks: { slug: "playbooks", targetSeconds: 7, run: playbooks },
};

export interface ChapterRun {
  /** seconds the chapter took on screen, before encoding */
  seconds: number;
  poster: Buffer;
}

/** Plays a chapter's beats on an already-seeded page and returns its poster frame. */
export async function recordChapterActions(slug: ChapterSlug, page: Page, baseUrl: string, startedAt: number, trace?: (line: string) => void): Promise<ChapterRun> {
  const definition = CHAPTERS[slug];
  const captured: { poster: Buffer | null } = { poster: null };
  const driver = new ChapterDriver(slug, page, baseUrl, startedAt, (png) => { captured.poster = png; }, trace);
  await definition.run(driver);
  const seconds = await driver.finish(definition.targetSeconds);
  trace?.(`[${slug} ${seconds.toFixed(2)}s] finished (target ${String(definition.targetSeconds)}s)`);
  if (!captured.poster) throw new ChapterBeatError(slug, "capture poster frame", "recording", new Error("no poster frame was captured"));
  return { seconds, poster: captured.poster };
}
