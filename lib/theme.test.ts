import { describe, expect, test } from "bun:test";
import { parseThemeChoice } from "./theme";

// Drawing, saving and following the device are proven in the browser: e2e/journeys/theme.journey.ts.
describe("theme choice", () => {
  test("only themes the app draws are kept; anything else follows the device", () => {
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    for (const raw of [null, "", "auto", "Dark", "system", 1, {}]) expect(parseThemeChoice(raw)).toBe("auto");
  });
});
