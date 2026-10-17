export interface DemoChapter {
  slug: string;
  title: string;
  time: string;
  summary: string;
  /**
   * The captions the clip shows, in order: the text alternative to a silent video, and a promise
   * the recorder keeps (a chapter's captions must be exactly these, in this order).
   */
  captions: readonly string[];
  covers: readonly string[];
}

/** Every clip is this size: a phone-shaped 4:5 frame, the app's own phone layout under a caption band. */
export const DEMO_VIDEO = { width: 576, height: 720 } as const;

/**
 * Ten short chapters, in the order of a coach's week: draw a play and watch it run, put the
 * players on it, set the league's rules, install the run game and the defense, build the book
 * and call it from the sideline, print the wristbands, send it to the staff, score, then the
 * trick plays. Each one is small enough to watch on a phone at the field, and each opens on a
 * different formation.
 *
 * Every entry in `covers` is a promise: `scripts/demo-recorder` refuses to record a chapter
 * unless each one was demonstrated by an action that completed on camera, with its result on
 * screen; `captions` is checked the same way.
 */
export const DEMOS: readonly DemoChapter[] = [
  {
    slug: "first-play",
    title: "Draw a play, press play",
    time: "12 sec",
    summary: "Start a fresh play, slide Z over into Twins Left, give X and Z a route with a tap each, star the read, then press play and watch the ball find it.",
    captions: ["Start a fresh play", "Drag Z over: Twins Left", "Tap a player, tap a route", "Star the read, then press play", "The ball finds the read"],
    covers: ["Create plays", "Moving players", "Quick routes", "Primary read", "Play playback"],
  },
  {
    slug: "roster",
    title: "Put your players on the play",
    time: "11 sec",
    summary: "Lay the roster out on the field, open a position's depth chart, then show the starters' names on the play and switch to the Secondary Lineup the app makes from the depth charts.",
    captions: ["Roster: who plays where", "Every position has a depth chart", "Their names on the play", "The second string, made for you"],
    covers: ["Roster", "Depth charts", "Player names", "Lineups"],
  },
  {
    slug: "league-rules",
    title: "It knows your league's rules",
    time: "10 sec",
    summary: "Spot the ball on their 5: the field moves with it and the dive is flagged as a run in the no-run zone. Make it a pass and the flag goes; a league without the zones switches them off.",
    captions: ["Spot the ball on their 5", "A run from here is flagged", "Make it a pass: flag gone", "No zones in your league? Off"],
    covers: ["Line of scrimmage", "Running plays", "No-run zones"],
  },
  {
    slug: "run-game",
    title: "Run it, then fake it",
    time: "12 sec",
    summary: "Z is already crossing when the ball is snapped and takes the jet sweep to the open side. Then the same look fakes it, and the post comes open behind a faded defense.",
    captions: ["Jet sweep: Z takes it on the move", "Same look, fake it, hit the post"],
    covers: ["Jet sweep", "Play-action", "Passing plays", "Shadow defense"],
  },
  {
    slug: "defense",
    title: "Call a Cover 1, then watch it move",
    time: "11 sec",
    summary: "Drop the safety deep, put the corner on X by tapping the faded offense, send a rusher the app holds at 7 yards, then press play and watch the defense react.",
    captions: ["The safety plays deep", "Man on X: tap the faded offense", "A rusher, held 7 yards off", "Press play: the defense reacts"],
    covers: ["Defensive plays", "Zones", "Man coverage", "Shadow offense", "Blitz", "Defense in motion"],
  },
  {
    slug: "game-day",
    title: "Build the book, call it from the sideline",
    time: "11 sec",
    summary: "Add a play to the game plan and put it in calling order, then open the game-day reader: hear \"4\", type 4, and go full screen on the sideline.",
    captions: ["Add a play to the game plan", "Calling order sets the numbers", "Game-day reader: hear 4, type 4", "Full screen on the sideline"],
    covers: ["Playbooks", "Play ordering", "Game-day reader", "Call search", "Full screen"],
  },
  {
    slug: "wristbands",
    title: "Every player gets their own wristband",
    time: "11 sec",
    summary: "Pick the band your team wears and download: X's insert has X's route bold on every play, and Z's insert has Z's. The binder pages and the meeting slides print from the same book.",
    captions: ["Pick the band your team wears", "X's card: X's route in bold", "Z's card: Z's route in bold", "Binder pages and meeting slides too"],
    covers: ["Wristbands", "Band sizes", "Binder PDF", "Slides"],
  },
  {
    slug: "share",
    title: "Send it to your staff",
    time: "9 sec",
    summary: "Save the play, add the coaching points, copy a link, then open what your assistant sees: the play, your notes, and a way into the designer.",
    captions: ["Save the play", "Add the coaching points", "Copy a link", "What your assistant opens"],
    covers: ["Saving", "Notes", "Share link", "Shared play page"],
  },
  {
    slug: "touchdown",
    title: "Score in your own end zone",
    time: "11 sec",
    summary: "Pick an end zone painted with your team's name, draw X a route of your own into it, then press play: the catch sets off the celebration and opens the next design.",
    captions: ["Pick an end zone, lettered for your team", "Draw X a route of your own", "Press play and score"],
    covers: ["End zones", "Team lettering", "Custom routes", "Touchdowns"],
  },
  {
    slug: "trick-plays",
    title: "Trick plays, legal by design",
    time: "10 sec",
    summary: "The QB laterals to Z, who throws it on: a double pass. Drag the catch forward and it snaps back behind the line, because a lateral never goes forward. Then press play.",
    captions: ["QB laterals to Z, who throws it", "A lateral never goes forward", "Press play: double pass"],
    covers: ["Laterals", "Double pass", "Lateral rules"],
  },
] as const;

export const COVERED_FEATURES = new Set(DEMOS.flatMap((demo) => demo.covers));

/** The whole tour end to end, for the "how long is this?" promise on the Demo screen. */
export const TOUR_SECONDS = DEMOS.reduce((total, demo) => total + Number.parseInt(demo.time, 10), 0);

const [first] = DEMOS;
if (!first) throw new Error("the tour has no chapters");
/** The clip a new coach should watch first: the one the Demo screen shows full width. */
export const HERO: DemoChapter = first;
