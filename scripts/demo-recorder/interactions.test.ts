import { describe, expect, test } from "bun:test";
import type { Locator } from "@playwright/test";
import { hasAttributeNow, retryStatefulInteraction } from "./interactions";

describe("hydration-safe recorder interactions", () => {
  test("an absent client-rendered control is an immediate false state probe", async () => {
    let observations = 0;
    const absent = {
      evaluateAll<Result, Arg>(callback: (elements: Element[], argument: Arg) => Result, argument: Arg): Promise<Result> {
        observations += 1;
        return Promise.resolve(callback([], argument));
      },
    } as unknown as Locator;

    expect(await hasAttributeNow(absent, "aria-pressed", "true")).toBe(false);
    expect(observations).toBe(1);
  });

  test("retries a click ignored before hydration and stops when state lands", async () => {
    let hydrated = false;
    let expanded = false;
    const clicks: number[] = [];
    const waits: number[] = [];

    const attempt = await retryStatefulInteraction(
      (number) => {
        clicks.push(number);
        if (hydrated) expanded = true;
        return Promise.resolve();
      },
      () => Promise.resolve(expanded),
      {
        attempts: 4,
        pollsPerAttempt: 2,
        pollDelayMs: 25,
        wait: (milliseconds) => {
          waits.push(milliseconds);
          hydrated = true;
          return Promise.resolve();
        },
      },
    );

    expect(attempt).toBe(2);
    expect(clicks).toEqual([1, 2]);
    expect(waits).toEqual([25, 25]);
  });

  test("does not click an already-satisfied control and keeps failures bounded", async () => {
    let clicks = 0;
    expect(await retryStatefulInteraction(() => { clicks += 1; return Promise.resolve(); }, () => Promise.resolve(true))).toBe(0);
    expect(clicks).toBe(0);

    let failure: unknown;
    try {
      await retryStatefulInteraction(
        () => { clicks += 1; return Promise.resolve(); },
        () => Promise.resolve(false),
        { attempts: 3, pollsPerAttempt: 1, pollDelayMs: 0, wait: () => Promise.resolve() },
      );
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("after 3 interaction attempts");
    expect(clicks).toBe(3);
  });
});
