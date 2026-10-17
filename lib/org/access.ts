import { ASSIST, HEAD, VIEW, type Grants, type Level, type OrgRole } from "./types";

/**
 * What a member may do on a team (docs/adr/013-organizations.md, rule 3): the owner and admins run every
 * team; a head coach runs theirs; an assistant draws on theirs; anyone else sees the teams their
 * grants list, or every team when the list is null. Heading or assisting a team shows it whatever the
 * list says. The server decides this on every request, never the UI alone (O13).
 */
export function levelOf(m: Grants & { role: OrgRole }, team: string): Level {
  if (m.role === "owner" || m.role === "admin") return HEAD;
  if (m.heads.includes(team)) return HEAD;
  if (m.assists.includes(team)) return ASSIST;
  if (m.teams === null || m.teams.includes(team)) return VIEW;
  return 0;
}

export const isAdmin = (role: OrgRole): boolean => role === "owner" || role === "admin";
