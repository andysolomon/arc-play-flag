import { afterEach, describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { THEME_COLOR, THEME_KEY, getThemeChoice, parseThemeChoice, setThemeChoice, subscribeThemeChoice, themeScript } from "./theme";

type Listener = (e: { key: string | null }) => void;

type Meta = { attributes: Record<string, string>; setAttribute: (name: string, value: string) => void };

/** Just enough of a browser for the theme code: storage, the dark-mode query, <html> and the tags in <head>. */
function browser({ saved = null as string | null, dark = false, blocked = false } = {}) {
  const data = new Map<string, string>();
  if (saved !== null) data.set(THEME_KEY, saved);
  const media: { matches: boolean; listeners: (() => void)[] } = { matches: dark, listeners: [] };
  const on = new Map<string, Listener[]>();
  const head: Meta[] = [];
  const refuse = (): never => { throw new DOMException("blocked", "SecurityError"); };
  const html = { dataset: {} as Record<string, string> };
  const env = {
    localStorage: blocked
      ? { getItem: refuse, setItem: refuse, removeItem: refuse }
      : {
          getItem: (k: string) => data.get(k) ?? null,
          setItem: (k: string, v: string) => { data.set(k, v); },
          removeItem: (k: string) => { data.delete(k); },
        },
    matchMedia: (query: string) => {
      expect(query).toBe("(prefers-color-scheme: dark)");
      return { get matches() { return media.matches; }, addEventListener: (_t: string, f: () => void) => { media.listeners.push(f); } };
    },
    document: {
      documentElement: html,
      head: { append: (meta: Meta) => { head.push(meta); } },
      querySelector: (selector: string) => {
        expect(selector).toBe('meta[name="theme-color"]');
        return head.find((m) => m.attributes.name === "theme-color") ?? null;
      },
      createElement: (tag: string): Meta => {
        expect(tag).toBe("meta");
        const attributes: Record<string, string> = {};
        return { attributes, setAttribute: (name, value) => { attributes[name] = value; } };
      },
    },
    addEventListener: (type: string, f: Listener) => { on.set(type, [...(on.get(type) ?? []), f]); },
    removeEventListener: (type: string, f: Listener) => { on.set(type, (on.get(type) ?? []).filter((g) => g !== f)); },
  };
  return {
    env, data, html,
    /** what the browser chrome would be tinted: every theme-color tag's colour */
    chrome: () => head.filter((m) => m.attributes.name === "theme-color").map((m) => m.attributes.content),
    /** runs the exact script the root layout inlines */
    boot: () => { runInNewContext(themeScript, { ...env }); },
    setDeviceDark: (next: boolean) => { media.matches = next; media.listeners.forEach((f) => { f(); }); },
    storageEvent: (key: string | null) => { (on.get("storage") ?? []).forEach((f) => { f({ key }); }); },
    listening: (type: string) => (on.get(type) ?? []).length,
  };
}

const installed: string[] = [];
function install(env: Record<string, unknown>) {
  for (const [k, v] of Object.entries(env)) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    installed.push(k);
  }
}
afterEach(() => {
  for (const k of installed.splice(0)) Reflect.deleteProperty(globalThis, k);
});

describe("theme choice", () => {
  test("only light and dark are kept; anything else follows the device", () => {
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    for (const raw of [null, "", "auto", "Dark", "system", 1, {}]) expect(parseThemeChoice(raw)).toBe("auto");
  });
});

describe("the inlined theme script", () => {
  test("follows the device when nothing is chosen, and tints the browser chrome with the header colour", () => {
    const light = browser();
    light.boot();
    expect(light.html.dataset.theme).toBe("light");
    expect(light.chrome()).toEqual([THEME_COLOR.light]);

    const dark = browser({ dark: true });
    dark.boot();
    expect(dark.html.dataset.theme).toBe("dark");
    expect(dark.chrome()).toEqual([THEME_COLOR.dark]);
  });

  test("a saved choice beats the device setting", () => {
    const light = browser({ saved: "light", dark: true });
    light.boot();
    expect(light.html.dataset.theme).toBe("light");
    const dark = browser({ saved: "dark", dark: false });
    dark.boot();
    expect(dark.html.dataset.theme).toBe("dark");
  });

  test("a junk saved value or blocked storage falls back to the device", () => {
    const junk = browser({ saved: "purple", dark: true });
    junk.boot();
    expect(junk.html.dataset.theme).toBe("dark");
    const blocked = browser({ blocked: true, dark: true });
    blocked.boot();
    expect(blocked.html.dataset.theme).toBe("dark");
  });

  test("redraws when the device switches, unless a theme was chosen, reusing one theme-color tag", () => {
    const auto = browser();
    auto.boot();
    auto.setDeviceDark(true);
    expect(auto.html.dataset.theme).toBe("dark");
    expect(auto.chrome()).toEqual([THEME_COLOR.dark]);
    auto.setDeviceDark(false);
    expect(auto.html.dataset.theme).toBe("light");
    expect(auto.chrome()).toEqual([THEME_COLOR.light]);

    const chosen = browser({ saved: "light" });
    chosen.boot();
    chosen.setDeviceDark(true);
    expect(chosen.html.dataset.theme).toBe("light");
  });

  test("redraws when another tab changes the choice or clears storage, and ignores other keys", () => {
    const b = browser();
    b.boot();
    b.data.set(THEME_KEY, "dark");
    b.storageEvent("ffpd.plays.v2");
    expect(b.html.dataset.theme).toBe("light");
    b.storageEvent(THEME_KEY);
    expect(b.html.dataset.theme).toBe("dark");
    b.data.clear();
    b.storageEvent(null);
    expect(b.html.dataset.theme).toBe("light");
  });
});

describe("choosing a theme", () => {
  test("saves the choice, redraws now and tells subscribers; auto forgets it", () => {
    const b = browser();
    install(b.env);
    let heard = 0;
    const stop = subscribeThemeChoice(() => { heard++; });
    expect(getThemeChoice()).toBe("auto");

    setThemeChoice("dark");
    expect(b.data.get(THEME_KEY)).toBe("dark");
    expect(getThemeChoice()).toBe("dark");
    expect(b.html.dataset.theme).toBe("dark");
    expect(b.chrome()).toEqual([THEME_COLOR.dark]);

    setThemeChoice("auto");
    expect(b.data.has(THEME_KEY)).toBe(false);
    expect(getThemeChoice()).toBe("auto");
    expect(b.html.dataset.theme).toBe("light");
    expect(heard).toBe(2);

    b.storageEvent(THEME_KEY);
    expect(heard).toBe(3);
    stop();
    setThemeChoice("light");
    b.storageEvent(THEME_KEY);
    expect(heard).toBe(3);
    expect(b.listening("storage")).toBe(0);
    setThemeChoice("auto");
  });

  test("with storage blocked the choice still applies for this visit", () => {
    const blocked = browser({ blocked: true });
    install(blocked.env);
    setThemeChoice("dark");
    expect(blocked.html.dataset.theme).toBe("dark");
    expect(getThemeChoice()).toBe("dark");

    // once storage works again, a saved choice takes over from the remembered one
    const working = browser();
    install(working.env);
    setThemeChoice("light");
    expect(working.data.get(THEME_KEY)).toBe("light");
    expect(getThemeChoice()).toBe("light");
    setThemeChoice("auto");
  });
});
