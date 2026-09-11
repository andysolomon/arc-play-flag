export interface StatefulRetryOptions {
  /** Maximum number of times the interaction may be dispatched. */
  attempts?: number;
  /** State observations made after each dispatch. */
  pollsPerAttempt?: number;
  /** Delay between state observations. */
  pollDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

/**
 * Reads attribute state from the elements that exist now. Unlike Locator#getAttribute,
 * evaluateAll does not wait for an element to appear, so a client-rendered control
 * that is absent between React renders is simply an unsatisfied retry probe.
 */
export async function hasAttributeNow(locator: Locator, name: string, expected: string): Promise<boolean> {
  return locator.evaluateAll(
    (elements, [attribute, value]) => elements.some((element) => element.getAttribute(attribute) === value),
    [name, expected] as const,
  );
}

/**
 * Dispatches an interaction until its observable UI state lands. Server-rendered
 * controls can be visible before React attaches their handlers, so the first click
 * may be ignored. Checking state before and after every bounded retry also avoids
 * toggling a control that has already reached the requested state.
 */
export async function retryStatefulInteraction(
  action: (attempt: number) => Promise<void>,
  isSatisfied: () => Promise<boolean>,
  options: StatefulRetryOptions = {},
): Promise<number> {
  const attempts = options.attempts ?? 5;
  const pollsPerAttempt = options.pollsPerAttempt ?? 4;
  const pollDelayMs = options.pollDelayMs ?? 100;
  const wait = options.wait ?? delay;
  if (attempts < 1 || pollsPerAttempt < 1 || pollDelayMs < 0) throw new Error("invalid stateful interaction retry options");

  if (await isSatisfied()) return 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await action(attempt);
    for (let poll = 0; poll < pollsPerAttempt; poll += 1) {
      if (await isSatisfied()) return attempt;
      if (poll < pollsPerAttempt - 1 || attempt < attempts) await wait(pollDelayMs);
    }
  }
  throw new Error(`expected UI state did not land after ${String(attempts)} interaction attempts`);
}
import type { Locator } from "@playwright/test";
