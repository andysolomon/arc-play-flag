/**
 * The identity of a build, shared by the app bundle (`NEXT_PUBLIC_RELEASE`), the error
 * report, and the service worker. Every production deploy is a new commit, so the
 * short SHA is enough to tell two releases apart; a local build is just "local".
 */
export function resolveRelease(env: Record<string, string | undefined> = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? env.GITHUB_SHA;
  return sha ? sha.slice(0, 7) : "local";
}

/** The token in lib/offline/sw.js that scripts/stamp-sw.ts replaces before `next build`. */
export const RELEASE_PLACEHOLDER = "__FFPD_RELEASE__";

/**
 * Bakes a release into the worker source so each deploy ships a byte-different
 * `/sw.js`: that difference is what makes a browser install the new worker and lets
 * an open tab find out a release happened.
 */
export function stampWorker(source: string, release: string): string {
  if (!source.includes(RELEASE_PLACEHOLDER)) throw new Error(`worker source has no ${RELEASE_PLACEHOLDER} to stamp`);
  if (!/^[\w.-]+$/.test(release)) throw new Error(`release "${release}" is not a plain token`);
  return source.replaceAll(RELEASE_PLACEHOLDER, release);
}
