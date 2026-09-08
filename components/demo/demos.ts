export interface DemoChapter {
  slug: string;
  title: string;
  time: string;
  summary: string;
  covers: readonly string[];
}

/** Five short chapters cover the whole app without turning the tour into a course. */
export const DEMOS: readonly DemoChapter[] = [
  {
    slug: "build-play",
    title: "Draw the offense",
    time: "11 sec",
    summary: "Move players, add quick and custom routes, choose the primary read, mirror a route and undo a change.",
    covers: ["Create plays", "Formations", "Quick routes", "Custom routes", "Primary routes", "Mirror", "Undo / redo"],
  },
  {
    slug: "run-play",
    title: "Watch plays run",
    time: "7 sec",
    summary: "Watch the center snap, the quarterback sell play-action, and the ball finish with the primary runner or receiver.",
    covers: ["Running plays", "Passing plays", "Play-action", "Play playback"],
  },
  {
    slug: "build-defense",
    title: "Build the defense",
    time: "9 sec",
    summary: "Switch between offense and the full field, then assign zones, man coverage and a legal blitz.",
    covers: ["Without defense", "With defense", "Defensive plays", "Zones", "Man coverage", "Blitz"],
  },
  {
    slug: "save-export",
    title: "Save, share and export",
    time: "10 sec",
    summary: "Name and save the play, add coaching notes, duplicate it, copy a share link and export a picture or video.",
    covers: ["Saving", "Notes", "Duplicate", "Share link", "Picture export", "Video export"],
  },
  {
    slug: "playbooks",
    title: "Build a playbook",
    time: "7 sec",
    summary: "Create a team playbook, add and order plays, then make wristbands, binder pages or a portable playbook file.",
    covers: ["Playbook creation", "Team setup", "Play ordering", "Wristbands", "Binder PDF", "Import / export"],
  },
] as const;

export const COVERED_FEATURES = new Set(DEMOS.flatMap((demo) => demo.covers));
