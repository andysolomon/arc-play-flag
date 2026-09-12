export interface DemoChapter {
  slug: string;
  title: string;
  time: string;
  summary: string;
  covers: readonly string[];
}

/**
 * Eight short chapters, each one small enough to watch on a phone at the field.
 * Every entry in `covers` is a promise: `scripts/demo-recorder` refuses to record a
 * chapter unless each one was demonstrated by an action that completed on camera.
 */
export const DEMOS: readonly DemoChapter[] = [
  {
    slug: "build-play",
    title: "Draw the offense",
    time: "9 sec",
    summary: "Name a new play, slide a receiver out to set the formation, then give X a quick slant and mark it as the primary read.",
    covers: ["Create plays", "Moving players", "Formations", "Quick routes", "Primary routes"],
  },
  {
    slug: "custom-routes",
    title: "Draw a route of your own",
    time: "9 sec",
    summary: "Tap waypoints on the field to draw a route the palette does not have, mirror it to the other side, then undo and redo the change.",
    covers: ["Custom routes", "Mirror", "Undo / redo"],
  },
  {
    slug: "run-play",
    title: "Watch plays run",
    time: "11 sec",
    summary: "Watch a handoff carry the ball, then watch play-action sell the fake before the pass finds the primary read on the wheel.",
    covers: ["Running plays", "Play-action", "Passing plays", "Play playback"],
  },
  {
    slug: "build-defense",
    title: "Build the defense",
    time: "11 sec",
    summary: "Switch between offense only and the full field, then assign a deep zone, man coverage and a legal blitz.",
    covers: ["Without defense", "With defense", "Defensive plays", "Zones", "Man coverage", "Blitz"],
  },
  {
    slug: "save-share",
    title: "Save, note and share",
    time: "8 sec",
    summary: "Save the play, add coaching notes, duplicate it, then copy a share link that shows only the side you chose.",
    covers: ["Saving", "Notes", "Duplicate", "Share link", "Share visibility"],
  },
  {
    slug: "export-play",
    title: "Export a card or a clip",
    time: "10 sec",
    summary: "Pick which teams an export shows, save the play as a picture card, and record it as a video clip for the team chat.",
    covers: ["Export visibility", "Picture export", "Video export"],
  },
  {
    slug: "playbooks",
    title: "Build a playbook",
    time: "8 sec",
    summary: "Name the team, take a book handed over as a file, start one of your own, then add plays and put them in calling order.",
    covers: ["Team setup", "Import", "Playbook creation", "Play ordering"],
  },
  {
    slug: "print-playbook",
    title: "Print it for the sideline",
    time: "9 sec",
    summary: "Turn a playbook into wristband inserts, binder pages, two-sided postcards and a parents' flyer, or hand the whole book over as a file.",
    covers: ["Wristbands", "Binder PDF", "Postcards", "Flyer", "Playbook file"],
  },
] as const;

export const COVERED_FEATURES = new Set(DEMOS.flatMap((demo) => demo.covers));

/** The whole tour end to end, for the "how long is this?" promise on the Demo screen. */
export const TOUR_SECONDS = DEMOS.reduce((total, demo) => total + Number.parseInt(demo.time, 10), 0);
