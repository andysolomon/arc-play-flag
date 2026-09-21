export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16}$/;
export const SHARE_TTL_SECONDS = 60 * 60 * 24 * 90;

export function tokenFromUrl(input: string, origin: string): string | null {
  try {
    const url = new URL(input);
    if (![origin, "https://arc-play-flag.vercel.app"].includes(url.origin) || url.username || url.password || url.search || url.hash) return null;
    const token = /^\/s\/([A-Za-z0-9_-]{16})\/?$/.exec(url.pathname)?.[1];
    return token ?? null;
  } catch { return null; }
}
