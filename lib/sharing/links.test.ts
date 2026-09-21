import { expect, test } from "bun:test";
import { tokenFromUrl } from "./links";
import { scrubRoute, scrubText } from "@/lib/diagnostics";

test("only app share URLs are accepted; local book links and arbitrary fetch targets are refused", () => {
  const token = "abcdefghijklmnop";
  expect(tokenFromUrl(`https://arc-play-flag.vercel.app/s/${token}`, "http://localhost:3000")).toBe(token);
  expect(tokenFromUrl(`http://localhost:3000/s/${token}`, "http://localhost:3000")).toBe(token);
  for (const value of [`https://evil.test/s/${token}`, `https://arc-play-flag.vercel.app/playbooks?book=${token}`, `https://arc-play-flag.vercel.app/s/${token}?url=http://internal`, "javascript:alert(1)", "https://user@arc-play-flag.vercel.app/s/abcdefghijklmnop"]) expect(tokenFromUrl(value, "http://localhost:3000")).toBeNull();
  expect(scrubRoute(`/s/${token}`)).not.toContain(token);
  expect(scrubText(`/api/shares/${token} Bearer ${"x".repeat(32)}`)).not.toContain(token);
});
