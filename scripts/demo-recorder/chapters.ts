import { expect, type Locator, type Page } from "@playwright/test";
import { S, VW } from "../../lib/play/geometry";
import { BLITZ_DEPTH } from "../../lib/play/routes";
import { DRAFT_KEY, type DraftRecord } from "../../lib/play/storage";
import { advertisedFeatures, CoverageLedger } from "./coverage";
import { DEMO_PLAYBOOK, INSIDE_HANDOFF, PLAY_ACTION_WHEEL, QUICK_SLANT, SHARED_BOOK, sharedBookFile } from "./fixtures";
import { hasAttributeNow, retryStatefulInteraction } from "./interactions";
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

/** A caption pill drawn over the app, under the header, so a viewer knows what each moment demonstrates. */
const CAPTION_ID = "arc-demo-recorder-caption";
/** A ring around the control a beat is using, so the action is legible on a phone. */
const SPOTLIGHT_ID = "arc-demo-recorder-spotlight";

const SIDEBARS = { "Play tools": "play-sidebar", "Route palette": "route-sidebar" } as const;
type SidebarName = keyof typeof SIDEBARS;
type Team = "Offense" | "Defense";

const ASSERT_TIMEOUT = 5_000;

/**
 * Drives one chapter the way a coach would: through visible, accessible controls.
 * The 960px viewport puts the app in its compact layout, so the two sidebars are
 * drawers that overlay the field one at a time, and picking a route folds the
 * palette away. Every helper waits on what a person would see.
 *
 * Each beat may declare the /demo features it demonstrates. A feature is only counted
 * once the beat has completed, so a chapter can never be published claiming something
 * the clip does not show.
 */
export class ChapterDriver {
  private posterTaken = false;
  private readonly ledger: CoverageLedger;
  /** where the caption sits: under the header on the designer, along the bottom on list screens */
  captionEdge: "top" | "bottom" = "top";

  constructor(
    readonly slug: ChapterSlug,
    readonly page: Page,
    readonly baseUrl: string,
    private readonly startedAt: number,
    private readonly posterSink: (png: Buffer) => void,
    private readonly trace: (line: string) => void = () => undefined,
  ) {
    this.ledger = new CoverageLedger(slug, advertisedFeatures(slug));
  }

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

  async beat(kind: BeatKind, name: string, action: () => Promise<void>, hold = 240, proves: readonly string[] = []): Promise<void> {
    try {
      await action();
      this.ledger.prove(proves);
      this.trace(`[${this.slug} ${this.elapsed().toFixed(2)}s] ${name}${proves.length ? ` — shows ${proves.join(", ")}` : ""}`);
      await this.page.waitForTimeout(hold);
    } catch (error) {
      throw this.fail(kind, name, error);
    }
  }

  /** Changes the on-screen caption; it stays until the next story beat. */
  async say(text: string): Promise<void> {
    await this.spotlight(null);
    await this.beat("recording", `caption "${text}"`, async () => {
      await this.page.evaluate(([id, value, edge]) => {
        let element = document.getElementById(id);
        if (!element) {
          element = document.createElement("div");
          element.id = id;
          Object.assign(element.style, {
            position: "fixed", left: "50%", zIndex: "2147483647",
            transform: "translateX(-50%)", maxWidth: "760px", padding: "9px 22px",
            border: "3px solid #1b1a17", borderRadius: "26px", background: "#fffdf6",
            boxShadow: "3px 4px 0 #1b1a17", color: "#1b1a17", font: "700 27px/1.22 sans-serif",
            textAlign: "center", pointerEvents: "none",
          });
          // under the header the pill sits in the field's no-run band, clear of the hint toast and the field toolbar
          if (edge === "top") element.style.top = "100px";
          else element.style.bottom = "14px";
          document.body.append(element);
        }
        element.textContent = value;
      }, [CAPTION_ID, text, this.captionEdge] as const);
    }, 100);
  }

  /**
   * Rings the control a beat is about to use, so a viewer on a phone can see which
   * small control was tapped. It is a ring rather than a spotlight with a dimmed
   * surround: dimming the whole page changes most of the frame on every beat, which
   * costs more bytes than the whole extra chapter it would be paying for. Passing null
   * clears it, which every beat does once its hold is over — a control the app then
   * folds away (picking a route closes the palette) must never leave a ring in space.
   */
  private async spotlight(locator: Locator | null): Promise<void> {
    const box = locator ? await locator.boundingBox() : null;
    await this.page.evaluate(([id, rect]) => {
      const existing = document.getElementById(id);
      if (!rect) { existing?.remove(); return; }
      const element = existing ?? document.createElement("div");
      if (!existing) {
        element.id = id;
        Object.assign(element.style, {
          position: "fixed", zIndex: "2147483646", borderRadius: "16px",
          border: "5px solid #f0b429", pointerEvents: "none",
          boxShadow: "0 0 0 2px #1b1a17, inset 0 0 0 2px #1b1a17",
        });
        document.body.append(element);
      }
      const pad = 7;
      element.style.left = `${String(rect.x - pad)}px`;
      element.style.top = `${String(rect.y - pad)}px`;
      element.style.width = `${String(rect.width + pad * 2)}px`;
      element.style.height = `${String(rect.height + pad * 2)}px`;
    }, [SPOTLIGHT_ID, box] as const);
  }

  async goto(path: string): Promise<void> {
    await this.beat("recording", `open ${path}`, async () => {
      const response = await this.page.goto(`${this.baseUrl}${path}`, { waitUntil: "load" });
      if (!response?.ok()) throw new Error(`app returned HTTP ${String(response?.status() ?? "no response")}`);
      // the first control each screen hydrates: the designer, the playbooks home, one book
      const ready = this.page.getByRole("button", { name: "Play tools", exact: true })
        .or(this.page.getByRole("textbox", { name: "Team name" }))
        .or(this.page.getByRole("textbox", { name: "Playbook name" }));
      await expect(ready).toBeVisible({ timeout: ASSERT_TIMEOUT });
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
      await this.spotlight(locator);
      await this.page.waitForTimeout(140);
      await locator.click();
    }, hold);
    await this.spotlight(null);
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
      await this.spotlight(locator);
      await this.page.waitForTimeout(140);
      await retryStatefulInteraction(
        async () => { await locator.click(); },
        isSatisfied,
        { wait: async (milliseconds) => { await this.page.waitForTimeout(milliseconds); } },
      );
    }, hold);
    await this.spotlight(null);
  }

  /** Types into a field on camera, at a readable speed, after ringing it. */
  async type(locator: Locator, description: string, text: string, hold = 260, proves: readonly string[] = []): Promise<void> {
    await this.beat("selector", description, async () => {
      const field = await this.visible(locator, description);
      await this.spotlight(field);
      await field.fill("");
      await field.pressSequentially(text, { delay: 18 });
    }, hold, proves);
    await this.spotlight(null);
  }

  /**
   * Confirms an expected result landed; the assertion itself names what was expected.
   * This is where a chapter records what it has demonstrated, so an unmet expectation
   * can never count as coverage.
   */
  async expectState(description: string, assertion: () => Promise<void>, hold = 120, proves: readonly string[] = []): Promise<void> {
    await this.spotlight(null);
    await this.beat("state", description, assertion, hold, proves);
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

  /** Drags a player to a yard spot, in steps, so the move reads as a move on camera. */
  async dragPlayer(label: string, team: Team, x: number, y: number, description: string): Promise<void> {
    await this.closePanels();
    await this.beat("selector", description, async () => {
      const from = await this.visible(this.player(label, team), description).then((locator) => locator.boundingBox());
      if (!from) throw new Error(`${team} ${label} has no box to drag`);
      const to = await this.yardPoint(x, y);
      await this.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await this.page.mouse.down();
      await this.page.mouse.move(to.x, to.y, { steps: 18 });
      await this.page.waitForTimeout(140);
      await this.page.mouse.up();
    }, 260);
  }

  /** Runs the play and waits for the whiteboard to come back, the way a coach watches it. */
  async runPlay(description: string, proves: readonly string[]): Promise<void> {
    const run = this.page.getByRole("button", { name: "Run the play", exact: true });
    const stop = this.page.getByRole("button", { name: "Stop the play", exact: true });
    await this.closePanels();
    await this.clickUntilState(run, description, async () => hasAttributeNow(stop, "aria-pressed", "true"), 0);
    await this.expectState(`${description}: the ball is in view`, async () => {
      await expect(this.field.locator("image")).toBeVisible({ timeout: ASSERT_TIMEOUT });
    }, 0);
    await this.expectState(`${description}: the play finishes`, async () => {
      await expect(run).toBeVisible({ timeout: 15_000 });
      await expect(this.field.locator("image")).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
    }, 260, proves);
  }

  /** Chooses which teams a share or export shows, inside the named group of radios. */
  async chooseVisibility(group: string, choice: string, proves: readonly string[]): Promise<void> {
    const radio = this.page.getByRole("group", { name: group }).getByRole("radio", { name: choice, exact: true });
    await this.click(radio, `Show ${choice.toLowerCase()} only`, 260);
    await this.expectState(`The preview shows ${choice.toLowerCase()} only`, async () => {
      await expect(radio).toBeChecked({ timeout: ASSERT_TIMEOUT });
    }, 420, proves);
  }

  /** Clicks a download control and checks that the browser received the named file. */
  async download(label: string, expected: RegExp, proves: readonly string[] = [], { hold = 240, timeout = 20_000 }: { hold?: number; timeout?: number } = {}): Promise<void> {
    await this.beat("export", label, async () => {
      const button = await this.visible(this.page.getByRole("button", { name: label, exact: true }), label);
      await this.spotlight(button);
      await this.page.waitForTimeout(140);
      const pending = this.page.waitForEvent("download", { timeout });
      await button.click();
      // an export that takes seconds (the video clip) must not sit behind a ring
      await this.page.waitForTimeout(240);
      await this.spotlight(null);
      const download = await pending;
      const name = download.suggestedFilename();
      if (!expected.test(name)) throw new Error(`unexpected download name: ${name}`);
      const failure = await download.failure();
      if (failure) throw new Error(`download "${name}" failed: ${failure}`);
      await download.delete();
    }, hold, proves);
    await this.spotlight(null);
  }

  /** Hands the app a playbook file through its own file chooser, as a coach would. */
  async importPlaybookFile(json: string, proves: readonly string[]): Promise<void> {
    await this.beat("export", "Import a file…", async () => {
      const button = await this.visible(this.page.getByRole("button", { name: "Import a file…", exact: true }), "Import a file…");
      await this.spotlight(button);
      await this.page.waitForTimeout(140);
      const [chooser] = await Promise.all([this.page.waitForEvent("filechooser", { timeout: 10_000 }), button.click()]);
      await chooser.setFiles({ name: "otter-red-zone.playbook.json", mimeType: "application/json", buffer: Buffer.from(json, "utf8") });
    }, 200);
    await this.spotlight(null);
    // a successful import opens the book it just added, so its name is in the editor
    await this.expectState(`“${SHARED_BOOK.name}” opens as a playbook on this device`, async () => {
      await expect(this.page.getByRole("textbox", { name: "Playbook name" })).toHaveValue(SHARED_BOOK.name, { timeout: ASSERT_TIMEOUT });
    }, 420, proves);
  }

  /** The stored draft, which autosave writes after every committed change. */
  async draft(): Promise<DraftRecord | null> {
    return this.page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null") as DraftRecord | null, DRAFT_KEY);
  }

  /** Captures the poster frame now: the moment that best says what the chapter shows. */
  async poster(): Promise<void> {
    await this.spotlight(null);
    await this.beat("recording", "capture poster frame", async () => {
      this.posterSink(await this.page.screenshot({ type: "png" }));
      this.posterTaken = true;
    }, 0);
  }

  /**
   * Holds the final frame until the chapter reaches its target length, then makes sure a
   * poster exists and every feature the tour advertises was actually demonstrated.
   */
  async finish(targetSeconds: number): Promise<number> {
    const unproven = this.ledger.problem();
    if (unproven) throw new ChapterBeatError(this.slug, "cover the advertised features", "coverage", new Error(unproven));
    await this.spotlight(null);
    if (!this.posterTaken) await this.poster();
    const remaining = targetSeconds - this.elapsed();
    if (remaining > 0) await this.page.waitForTimeout(remaining * 1000);
    return this.elapsed();
  }
}

/** Draw the offense: name the play, set the formation, add a quick route and mark the read. */
async function buildPlay(d: ChapterDriver): Promise<void> {
  await d.goto("/");
  await d.say("Name a new play");
  await d.openPanel("Play tools");
  await d.type(d.page.getByRole("textbox", { name: "Play name" }), "Play name", QUICK_SLANT.name, 200);
  await d.expectState("The new play carries its name", async () => {
    await expect(d.page.getByRole("textbox", { name: "Play name" })).toHaveValue(QUICK_SLANT.name, { timeout: ASSERT_TIMEOUT });
  }, 200, ["Create plays"]);

  await d.say("Drag Z out to set the formation");
  await d.dragPlayer("Z", "Offense", 25, 2, "Drag Z out to the slot");
  await d.expectState("Z lines up wider than it did", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o5")?.x)).toBeGreaterThan(22);
  }, 260, ["Moving players", "Formations"]);

  await d.say("Quick route: X runs a slant");
  await d.selectPlayer("X", "Offense");
  await d.pick("Slant");
  await d.expectState("X has a slant", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o3")?.route?.type)).toBe("slant");
  }, 260, ["Quick routes"]);

  await d.say("Mark X as the primary read");
  await d.selectPlayer("X", "Offense");
  await d.paletteAction(/Mark primary/, "Mark the primary read");
  await d.closePanels();
  await d.expectState("The slant is drawn as the primary read", async () => {
    await expect(d.field.locator("path[stroke='#c2261a']")).toHaveCount(1, { timeout: ASSERT_TIMEOUT });
  }, 260, ["Primary routes"]);
  await d.poster();
}

/** A route the palette does not have: waypoints, a mirror, then undo and redo. */
async function customRoutes(d: ChapterDriver): Promise<void> {
  await d.goto("/");
  const [first, second] = QUICK_SLANT.players.find((p) => p.id === "o5")?.route?.pts ?? [];
  if (!first || !second) throw new Error("the fixture custom route needs two waypoints");

  await d.say("Custom route: tap waypoints for Z");
  await d.selectPlayer("Z", "Offense");
  await d.pick("Custom");
  await d.tapField(first[0], first[1], "Tap the first waypoint");
  await d.tapField(second[0], second[1], "Tap the second waypoint");
  await d.click(d.page.getByRole("button", { name: "Finish", exact: true }), "Finish the custom route");
  await d.expectState("Z has a two-point custom route", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o5")?.route?.pts?.length)).toBe(2);
  }, 300, ["Custom routes"]);
  await d.poster();

  await d.say("Mirror it to the other side");
  await d.selectPlayer("Z", "Offense");
  await d.paletteAction("⇄ Mirror route", "Mirror the custom route");
  await d.closePanels();
  await d.expectState("The custom route now bends the other way", async () => {
    // the route mirrors around Z, so its second waypoint moves from Z's left to Z's right
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o5")?.route?.pts?.[1]?.[0])).toBeGreaterThan(first[0]);
  }, 300);

  await d.say("Undo and redo any change");
  await d.click(d.page.getByRole("button", { name: "Undo", exact: true }), "Undo the mirror", 360);
  await d.expectState("The mirror is undone", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o5")?.route?.pts?.[1]?.[0])).toBeLessThan(first[0]);
  }, 200);
  await d.click(d.page.getByRole("button", { name: "Redo", exact: true }), "Redo the mirror", 360);
  await d.expectState("The mirror is back", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "o5")?.route?.pts?.[1]?.[0])).toBeGreaterThan(first[0]);
  }, 260, ["Mirror", "Undo / redo"]);
}

/** Watch plays run: a handoff the runner carries, then play-action to the primary read. */
async function runPlay(d: ChapterDriver): Promise<void> {
  await d.goto(`/?open=${INSIDE_HANDOFF.id}`);
  await d.say("A run: Z takes the handoff");
  await d.runPlay("Run the handoff", ["Running plays", "Play playback"]);
  await d.poster();

  await d.goto(`/?open=${PLAY_ACTION_WHEEL.id}`);
  await d.say("Play-action: sell the fake, hit the wheel");
  await d.expectState("The primary wheel anchors the teaching path", async () => {
    await expect(d.field.locator("path[stroke='#c2261a']")).toHaveCount(1, { timeout: ASSERT_TIMEOUT });
  }, 0);
  await d.runPlay("Run the play-action pass", ["Play-action", "Passing plays"]);
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
  }, 240, ["Without defense"]);
  await d.click(show.getByRole("button", { name: "Both", exact: true }), "Show both teams", 420);
  await d.expectState("Both teams are on the field", async () => {
    await expect(d.player("d1", "Defense")).toBeVisible({ timeout: ASSERT_TIMEOUT });
  }, 200, ["With defense"]);

  await d.say("Deep zone");
  await d.selectPlayer("d1", "Defense");
  await d.pick("Zone deep");
  await d.expectState("d1 drops into a deep zone", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "d1")?.route?.type)).toBe("zoneDeep");
  }, 400, ["Zones", "Defensive plays"]);

  await d.say("Man coverage on X");
  await d.selectPlayer("d2", "Defense");
  await d.pick("Man");
  await d.click(d.page.getByRole("button", { name: "Offense X, man coverage target", exact: true }), "Choose X as the man target", 380);
  await d.expectState("d2 covers X", async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "d2")?.route)).toEqual({ type: "man", target: "o3" });
  }, 240, ["Man coverage"]);

  await d.say("Blitz from a legal depth");
  await d.selectPlayer("d3", "Defense");
  await d.pick("Blitz");
  await d.closePanels();
  await d.expectState(`The blitzer lines up at least ${String(BLITZ_DEPTH)} yards off the ball`, async () => {
    await expect.poll(() => d.draft().then((draft) => draft?.players.find((p) => p.id === "d3")?.y)).toBeLessThanOrEqual(-BLITZ_DEPTH);
  }, 240, ["Blitz"]);
  await d.poster();
}

/** Save, note and share: save, coaching notes, a duplicate, and a link that shows one side. */
async function saveShare(d: ChapterDriver): Promise<void> {
  await d.goto(`/?open=${PLAY_ACTION_WHEEL.id}`);
  const tools = d.page.locator("#play-sidebar");
  const toast = d.page.locator("div[role='status']");
  await d.say("Save the play");
  await d.openPanel("Play tools");
  await d.click(tools.getByRole("button", { name: "Save", exact: true }), "Save", 200);
  await d.expectState("The app confirms the save", async () => {
    await expect(toast).toHaveText("Saved", { timeout: ASSERT_TIMEOUT });
  }, 420, ["Saving"]);

  await d.say("Add coaching notes");
  await d.click(tools.getByRole("button", { name: "Notes", exact: true }), "Notes", 160);
  await d.type(d.page.getByRole("textbox", { name: "Coaching points" }), "Coaching points", "Sell the handoff first.", 420, ["Notes"]);

  await d.say("Duplicate it");
  await d.click(tools.getByRole("button", { name: "Duplicate", exact: true }), "Duplicate", 200);
  await d.expectState("The copy is saved under its own name", async () => {
    await expect(toast).toHaveText("Saved a copy", { timeout: ASSERT_TIMEOUT });
    await expect(d.page.getByRole("textbox", { name: "Play name" })).toHaveValue(`${PLAY_ACTION_WHEEL.name} copy`, { timeout: ASSERT_TIMEOUT });
  }, 440, ["Duplicate"]);

  await d.say("Share a snapshot of the offense only");
  await d.click(tools.getByRole("button", { name: "Copy share link", exact: true }), "Copy share link", 400);
  await d.chooseVisibility("Teams visible in shared snapshot", "Offense", ["Share visibility"]);
  await d.poster();
  await d.click(d.page.getByRole("dialog", { name: "Share snapshot" }).getByRole("button", { name: "Copy snapshot link", exact: true }), "Copy snapshot link", 200);
  await d.expectState("The link is on the clipboard", async () => {
    await expect(toast).toHaveText("Link copied", { timeout: ASSERT_TIMEOUT });
  }, 400, ["Share link"]);
}

/** Export: choose what an export shows, save the picture card, then record the clip. */
async function exportPlay(d: ChapterDriver): Promise<void> {
  await d.goto(`/?open=${INSIDE_HANDOFF.id}`);
  const tools = d.page.locator("#play-sidebar");
  await d.say("Choose what an export shows");
  await d.openPanel("Play tools");
  await d.click(tools.getByRole("button", { name: "Export", exact: true }), "Export", 160);
  await d.beat("selector", "Export panel", async () => {
    await (await d.visible(tools.locator("[aria-label='Export play']"), "Export play panel")).scrollIntoViewIfNeeded();
  }, 160);
  await d.chooseVisibility("Teams visible in picture and video exports", "Offense", ["Export visibility"]);
  await d.poster();

  await d.say("Save it as a picture card");
  await d.download("Save picture card", /\.png$/, ["Picture export"]);

  await d.say("Or record it as a video clip");
  await d.download("Save video clip", /\.(webm|mp4)$/, ["Video export"], { timeout: 40_000 });
  await d.expectState("The clip is saved", async () => {
    await expect(d.page.getByRole("status")).toHaveText("Clip saved", { timeout: 10_000 });
  }, 200);
}

/** Playbooks: name the team, take a book from another coach, start one, and order it. */
async function playbooks(d: ChapterDriver): Promise<void> {
  d.captionEdge = "bottom";
  await d.goto("/playbooks");
  const items = d.page.getByRole("list").getByRole("listitem");

  await d.say("Your team name goes on every export");
  await d.type(d.page.getByRole("textbox", { name: "Team name" }), "Team name", "Riverside Otters", 260);
  await d.expectState("The team is named", async () => {
    await expect(d.page.getByRole("textbox", { name: "Team name" })).toHaveValue("Riverside Otters", { timeout: ASSERT_TIMEOUT });
  }, 260, ["Team setup"]);

  await d.say("Take a playbook from another coach");
  await d.importPlaybookFile(sharedBookFile(), ["Import"]);

  await d.say("Start a playbook of your own");
  await d.click(d.page.getByRole("link", { name: /All playbooks/ }), "Back to all playbooks", 200);
  await d.clickUntilState(d.page.getByRole("button", { name: "+ New playbook", exact: true }), "+ New playbook", async () => (
    await d.page.getByRole("textbox", { name: "Playbook name" }).isVisible()
  ), 160);
  await d.type(d.page.getByRole("textbox", { name: "Playbook name" }), "Playbook name", "Otter Goal Line", 200);
  await d.expectState("The new playbook carries its name", async () => {
    await expect(d.page.getByRole("textbox", { name: "Playbook name" })).toHaveValue("Otter Goal Line", { timeout: ASSERT_TIMEOUT });
  }, 260, ["Playbook creation"]);

  await d.say("Add plays, then put them in calling order");
  await d.click(d.page.getByTitle(`Add ${QUICK_SLANT.name}`), `Add ${QUICK_SLANT.name}`, 200);
  await d.click(d.page.getByTitle(`Add ${PLAY_ACTION_WHEEL.name}`), `Add ${PLAY_ACTION_WHEEL.name}`, 300);
  await d.click(items.nth(0).getByRole("button", { name: "Move down", exact: true }), "Move the opener down", 200);
  await d.expectState("The wheel now opens the playbook", async () => {
    await expect(items).toHaveText([new RegExp(PLAY_ACTION_WHEEL.name), new RegExp(QUICK_SLANT.name)], { timeout: ASSERT_TIMEOUT });
  }, 500, ["Play ordering"]);
  await d.poster();
}

/** Print it: everything the playbook screen puts on paper, then the book as a file. */
async function printPlaybook(d: ChapterDriver): Promise<void> {
  d.captionEdge = "bottom";
  await d.goto(`/playbooks?book=${DEMO_PLAYBOOK.id}`);
  await d.beat("selector", "Export playbook panel", async () => {
    await (await d.visible(d.page.locator("[aria-label='Export playbook']"), "Export playbook panel")).scrollIntoViewIfNeeded();
  }, 200);

  await d.say("Wristband inserts, at actual size");
  await d.download("Download wristbands PDF", /\.pdf$/, ["Wristbands"], { hold: 620 });
  await d.poster();

  await d.say("Binder pages for the coach's folder");
  await d.download("Download binder PDF", /\.pdf$/, ["Binder PDF"], { hold: 620 });

  await d.say("Two-sided postcards, two-up with cut lines");
  await d.download("Download postcards PDF", /\.pdf$/, ["Postcards"], { hold: 620 });

  await d.say("A one-page flyer for parents and players");
  await d.download("Download flyer PDF", /\.pdf$/, ["Flyer"], { hold: 620 });

  await d.say("Or hand the whole book to an assistant");
  await d.download("Download playbook file", /\.playbook\.json$/, ["Playbook file"], { hold: 620 });
}

export interface ChapterDefinition {
  slug: ChapterSlug;
  /** the length the tour promises for this chapter; the recorder holds the last frame to reach it */
  targetSeconds: number;
  run: (driver: ChapterDriver) => Promise<void>;
}

export const CHAPTERS: Readonly<Record<ChapterSlug, ChapterDefinition>> = {
  "build-play": { slug: "build-play", targetSeconds: 9, run: buildPlay },
  "custom-routes": { slug: "custom-routes", targetSeconds: 9, run: customRoutes },
  "run-play": { slug: "run-play", targetSeconds: 11, run: runPlay },
  "build-defense": { slug: "build-defense", targetSeconds: 11, run: buildDefense },
  "save-share": { slug: "save-share", targetSeconds: 8, run: saveShare },
  "export-play": { slug: "export-play", targetSeconds: 10, run: exportPlay },
  playbooks: { slug: "playbooks", targetSeconds: 8, run: playbooks },
  "print-playbook": { slug: "print-playbook", targetSeconds: 9, run: printPlaybook },
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
