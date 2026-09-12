import { DEMOS } from "../../components/demo/demos";
import { CHAPTER_SLUGS, type ChapterSlug } from "./options";

/**
 * The /demo card for a chapter lists the features it covers. Those pills are a promise
 * to a coach, so the recorder treats them as an obligation: a chapter may only be
 * published once every feature it advertises has been demonstrated by an action that
 * completed on camera. Drift in either direction — an unkept promise, or a beat proving
 * something the card never claimed — fails the recording instead of shipping quietly.
 */

/** What the tour promises this chapter demonstrates. */
export function advertisedFeatures(slug: ChapterSlug): readonly string[] {
  const demo = DEMOS.find((chapter) => chapter.slug === slug);
  if (!demo) throw new Error(`no /demo chapter is named "${slug}"`);
  return demo.covers;
}

/** The tour and the recorder must describe the same chapters, in the same order. */
export function chapterListProblem(): string | null {
  const tour = DEMOS.map((demo) => demo.slug).join(", ");
  const recorder = CHAPTER_SLUGS.join(", ");
  if (tour === recorder) return null;
  return `components/demo/demos.ts lists ${tour}; the recorder lists ${recorder}`;
}

export function coverageProblem(slug: ChapterSlug, advertised: readonly string[], proven: ReadonlySet<string>): string | null {
  const unproven = advertised.filter((feature) => !proven.has(feature));
  if (!unproven.length) return null;
  return `chapter "${slug}" advertises ${unproven.join(", ")} on /demo but no beat demonstrated ${unproven.length === 1 ? "it" : "them"}`;
}

/** Collects the promises one chapter's beats have kept. */
export class CoverageLedger {
  private readonly kept = new Set<string>();

  constructor(readonly slug: ChapterSlug, readonly advertised: readonly string[]) {}

  /**
   * Marks a feature demonstrated. Called only after the beat that shows it has
   * completed, so a failed assertion can never count as coverage.
   */
  prove(features: readonly string[]): void {
    for (const feature of features) {
      if (!this.advertised.includes(feature)) {
        throw new Error(`chapter "${this.slug}" proved "${feature}", which its /demo card does not list`);
      }
      this.kept.add(feature);
    }
  }

  get proven(): ReadonlySet<string> {
    return this.kept;
  }

  /** The reason this chapter may not be published, or null when every promise is kept. */
  problem(): string | null {
    return coverageProblem(this.slug, this.advertised, this.kept);
  }
}
