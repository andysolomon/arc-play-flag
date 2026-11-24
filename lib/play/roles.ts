import type { Player } from "./types";

/**
 * Who plays quarterback and centre. Tags are editable, so a coach can tag two players QB or none;
 * every rule that needs the quarterback or the centre asks here and never compares a tag itself
 * (eslint.config.mjs bans `label === "QB"` and `label === "C"` everywhere else).
 */

/** The quarterback: the first offensive player tagged QB, else the default QB slot. */
export function quarterback(players: readonly Player[]): Player | undefined {
  return players.find((q) => q.team === "offense" && q.label === "QB") ?? players.find((q) => q.id === "o2" && q.team === "offense");
}

/** The centre, who snaps the ball: the first offensive player tagged C, else the default centre slot. */
export function centre(players: readonly Player[]): Player | undefined {
  return players.find((q) => q.team === "offense" && q.label === "C") ?? players.find((q) => q.id === "o1" && q.team === "offense");
}
