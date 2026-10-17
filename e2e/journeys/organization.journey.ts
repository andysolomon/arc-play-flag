import { writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { runId } from "../support/account";
import { ago, applied, body, coach, createOrg, invite, join, listOrgs, moveTeam, names, ownTeam, poll, readOrg, readTeam, writePlay } from "../support/org";
import { COVER_TWO, OTTERS, SLANT_LEFT, WHEEL_RIGHT, play, playbook } from "../support/fixtures";
import type { AccountResponse } from "../../lib/account/types";
import type { OrgTeamSummary, PlayWrite } from "../../lib/org/types";

/**
 * An organization's server (docs/adr/013-organizations.md), driven over the API by the fixture coaches
 * against the disposable Redis and database, the way the app's own screens will: Otter makes the
 * organization and moves a team in, Heron joins by link as its head coach, Ibis by an email invite
 * narrowed to that team as a viewer. How this could break, and the test that catches each:
 *  - a moved team stays in the coach's account, or arrives without its plays, books or roster     → "an organization owns a team"
 *  - a link invite doesn't join, or joins with the wrong grants; an email invite isn't claimed on
 *    the coach's next visit, or is claimed by the wrong address (rule 4, O6)                     → "an organization owns a team"
 *  - a viewer can change something, or can't look (rule 9, O13)                                  → "an organization owns a team", "a viewer"
 *  - two coaches on different plays overwrite each other (the reason for tier 3)                 → "two coaches"
 *  - the earlier of two changes to one play wins, or the loser's work is gone (rule 5, O2)       → "two coaches"
 *  - a change from an offline device replaces a newer one instead of standing beside it (O3)     → "two coaches"
 *  - an older delete removes a newer change, or an older change revives a newer delete (O4)      → "two coaches"
 *  - a poll misses a change, or shows a coach who left the team, or the coach asking (rule 8)    → "two coaches"
 *  - a removed coach still reads the team, or an admin can't remove in one tap (O1, O5)          → "a viewer"
 *  - deleting the organization takes a coach's own teams with it (rule 1)                        → "a viewer"
 *  - the owner leaves with others in, or can't hand the organization on (O8)                     → "a viewer"
 * Leaves `organization-<test>.json` (each step: who did what, and what the server answered) in
 * test-results/, uploaded as `organization`.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(!process.env.SHARING_TEST_REDIS_URL || !process.env.DATABASE_URL, "Requires the disposable Redis adapter and database; enabled in CI");
  test.skip(testInfo.project.name !== "chromium", "The API is the same from every device; the desktop project covers it");
});

interface Step { step: string; by: string; result: unknown }
const steps: Step[] = [];
const note = (step: string, by: string, result: unknown): void => { steps.push({ step, by, result }); };
const save = (name: string): void => { writeFileSync(`test-results/organization-${name}.json`, `${JSON.stringify({ steps: steps.splice(0) }, null, 2)}\n`); };

const BOOK = playbook("fx-week", "Otter Week", [SLANT_LEFT]);
const teamNames = (t: OrgTeamSummary[]): string[] => t.map((x) => `${x.name}:${String(x.level)}`);

/** Otter's organization with the Otters moved in, and Heron joined by link as its head coach. */
async function program(run: string): Promise<{ otter: APIRequestContext; heron: APIRequestContext; org: string; team: string }> {
  const otter = await coach("otter", run);
  const heron = await coach("heron", run);
  const own = await ownTeam(otter, [SLANT_LEFT, WHEEL_RIGHT], [BOOK], OTTERS);
  const org = (await createOrg(otter, "Riverside Youth Flag")).id;
  const team = (await moveTeam(otter, org, own.id)).id;
  const link = await invite(otter, org, { heads: [team] });
  await join(heron, link.token);
  return { otter, heron, org, team };
}

test("an organization owns a team moved in, and its coaches see it by their roles", async () => {
  const run = runId();
  const otter = await coach("otter", run);
  const own = await ownTeam(otter, [SLANT_LEFT, WHEEL_RIGHT], [BOOK], OTTERS);

  // the coach's own team becomes the organization's, and leaves the account (rule 1, T9)
  const org = await createOrg(otter, "Riverside Youth Flag");
  expect(org.role).toBe("owner");
  note("Otter makes the organization", "otter", org);
  const moved = await moveTeam(otter, org.id, own.id);
  expect(moved).toMatchObject({ id: own.id, name: "Riverside Otters", plays: 2, playbooks: 1, level: 3 });
  const account = await body<AccountResponse>(await otter.get("/api/account"), 200, "account");
  expect("teams" in account ? account.teams.map((t) => t.id) : null).toEqual([]);
  note("Otter moves the Otters in: gone from the account", "otter", { moved, account });
  const again = await moveTeam(otter, org.id, own.id);
  expect(again.id).toBe(own.id);

  // a link makes Heron a head coach; an email invite narrowed to the team makes Ibis a viewer (rule 4)
  const link = await invite(otter, org.id, { heads: [own.id] });
  const email = await invite(otter, org.id, { email: `Ibis.${run}@Example.test`, teams: [own.id] });
  expect(email.email).toBe(`ibis.${run}@example.test`);
  const preview = await body<{ org: string }>(await otter.get(`/api/orgs/join?token=${link.token}`), 200, "preview");
  expect(preview.org).toBe("Riverside Youth Flag");
  note("Otter invites: a link for a head coach, an email for a viewer", "otter", { link: { expires: link.expires }, email, preview });

  const heron = await coach("heron", run);
  const joined = await join(heron, link.token);
  expect(joined).toMatchObject({ id: org.id, role: "member", members: 2 });
  const heronTeam = await readTeam(heron, org.id, own.id);
  expect(heronTeam.level).toBe(3);
  expect(names(heronTeam)).toEqual(["Otter Slant Left", "Otter Wheel Right"]);
  expect(heronTeam.playbooks.map((b) => [b.name, b.plays])).toEqual([["Otter Week", ["fx-slant-left"]]]);
  expect(heronTeam.team).toEqual(OTTERS);
  expect(heronTeam.lineups.lineups.length).toBeGreaterThan(0);
  note("Heron joins by the link and opens the team whole, roster included", "heron", { joined, team: { level: heronTeam.level, plays: names(heronTeam), books: heronTeam.playbooks.length } });

  const ibis = await coach("ibis", run);
  const ibisOrgs = await listOrgs(ibis);
  expect(ibisOrgs.mode === "on" ? ibisOrgs.orgs.map((o) => [o.name, o.role]) : null).toEqual([["Riverside Youth Flag", "member"]]);
  const ibisView = await readOrg(ibis, org.id);
  expect(ibisView.me.teams).toEqual([own.id]);
  expect(ibisView.members).toBeUndefined();
  expect(teamNames(ibisView.teams)).toEqual(["Riverside Otters:1"]);
  const ibisTeam = await readTeam(ibis, org.id, own.id);
  expect(names(ibisTeam)).toEqual(["Otter Slant Left", "Otter Wheel Right"]);
  const refused = await writePlay(ibis, org.id, own.id, COVER_TWO, ago(0));
  expect(refused.status()).toBe(403);
  const why = (await refused.json()) as { error: string };
  expect(why).toEqual({ error: "You can look at this team but not change it. Ask an admin of Riverside Youth Flag." });
  note("Ibis's email invite is claimed on their first visit: a viewer who can look, not change", "ibis", { orgs: ibisOrgs, me: ibisView.me, teams: ibisView.teams, refused: why });

  // the admin's view: everyone, and the link still open, the email invite used up (S7)
  const view = await readOrg(otter, org.id);
  expect(view.members?.map((m) => [m.name, m.role, m.heads, m.teams])).toEqual([
    ["Coach Otter", "owner", [own.id], null], ["Coach Heron", "member", [own.id], null], ["Coach Ibis", "member", [], [own.id]],
  ]);
  expect(view.invites?.map((i) => i.email)).toEqual([null]);
  note("Otter, as owner, sees everyone and the one invite still open", "otter", { members: view.members, invites: view.invites });
  save("an-organization-owns-a-team");
});

test("two coaches draw at once: the later change wins and the earlier stands beside it", async () => {
  const run = runId();
  const { otter, heron, org, team } = await program(run);
  const start = await readTeam(otter, org, team);

  // different plays: both land (the reason for tier 3)
  const a = await body<PlayWrite>(await writePlay(otter, org, team, play("fx-otter-a", "Otter Mesh"), ago(2)), 200, "otter's play");
  const b = await body<PlayWrite>(await writePlay(heron, org, team, play("fx-heron-b", "Heron Smash"), ago(1)), 200, "heron's play");
  expect([applied(a), applied(b)]).toEqual(["Coach Otter", "Coach Heron"]);
  expect(names(await readTeam(otter, org, team))).toEqual(["Heron Smash", "Otter Mesh", "Otter Slant Left", "Otter Wheel Right"]);
  note("each coach saves a play of their own: both are in the team", "both", { a: applied(a), b: applied(b), revs: [a.rev, b.rev] });

  // the same play: the later change wins; the earlier, arriving second, is a sideline version (rule 5, O2)
  const first = await body<PlayWrite>(await writePlay(otter, org, team, play("fx-slant-left", "Otter Slant Left v2"), ago(30)), 200, "otter's change");
  const later = await body<PlayWrite>(await writePlay(heron, org, team, play("fx-slant-left", "Heron Slant Left"), ago(20)), 200, "heron's later change");
  expect([applied(first), applied(later)]).toEqual(["Coach Otter", "Coach Heron"]);
  const stale = await body<PlayWrite>(await writePlay(otter, org, team, play("fx-slant-left", "Otter Slant Left v3"), ago(25)), 200, "otter's older change");
  expect(applied(stale)).toBe('Coach Heron + sideline "Otter Slant Left v3 (your sideline version)"');
  expect("deleted" in stale.play ? null : stale.play.name).toBe("Heron Slant Left");
  expect(names(await readTeam(heron, org, team))).toContain("Otter Slant Left v3 (your sideline version)");
  note("one play, three changes: Heron's later one stands, Otter's older one is a sideline version", "both", { first: applied(first), later: applied(later), stale: applied(stale) });

  // the coach's own older change over their own newer one is applied (T4): nobody else's work is at stake
  const mine = await body<PlayWrite>(await writePlay(heron, org, team, play("fx-heron-b", "Heron Smash v2"), ago(60)), 200, "heron over heron");
  expect(applied(mine)).toBe("Coach Heron");

  // a delete and a change: the later by the coaches' clocks wins (O4)
  const gone = await body<{ rev: number; play: { deleted?: string } | null }>(await heron.delete(`/api/orgs/${org}/teams/${team}/plays/fx-otter-a?at=${ago(0)}`), 200, "heron deletes");
  expect(gone.play?.deleted).toBeTruthy();
  const olderEdit = await body<PlayWrite>(await writePlay(otter, org, team, play("fx-otter-a", "Otter Mesh v2"), ago(10)), 200, "otter's older change over the delete");
  expect(applied(olderEdit)).toBe('deleted + sideline "Otter Mesh v2 (your sideline version)"');
  const olderDelete = await body<{ play: { deleted?: string; name?: string } | null }>(await otter.delete(`/api/orgs/${org}/teams/${team}/plays/fx-heron-b?at=${ago(90)}`), 200, "otter's older delete of heron's play");
  expect(olderDelete.play?.name).toBe("Heron Smash v2");
  const revived = await body<PlayWrite>(await writePlay(otter, org, team, play("fx-otter-a", "Otter Mesh v3"), ago(0)), 200, "otter's newer change over the delete");
  expect(applied(revived)).toBe("Coach Otter");
  note("a delete and a change: the later wins each time, and nothing is lost", "both", { gone: gone.play, olderEdit: applied(olderEdit), olderDelete: olderDelete.play?.name, revived: applied(revived) });

  // the poll: everything since the rev a device read, tombstones included, and who else is here (rule 8)
  const otterPoll = await poll(otter, org, team, b.rev, "fx-otter-a");
  const heronPoll = await poll(heron, org, team, b.rev, null);
  expect(otterPoll.presence).toEqual([]);
  expect(heronPoll.presence.map((p) => [p.name, p.play])).toEqual([["Coach Otter", "fx-otter-a"]]);
  expect(heronPoll.rev).toBe(revived.rev);
  expect(heronPoll.plays.map((p) => ("deleted" in p ? `${p.id}:deleted` : `${p.id}:${p.name}`)).sort()).toEqual([
    "fx-heron-b:Heron Smash v2", "fx-otter-a:Otter Mesh v3", "fx-slant-left:Heron Slant Left",
    ...["Otter Mesh v2 (your sideline version)", "Otter Slant Left v3 (your sideline version)"].map((n) => `${String(heronPoll.plays.find((p) => !("deleted" in p) && p.name === n)?.id)}:${n}`),
  ].sort());
  expect(heronPoll.level).toBe(3);
  expect(heronPoll.settings).toBeNull();
  const everything = await poll(heron, org, team, 0, null);
  expect(everything.settings?.team).toEqual(OTTERS);
  expect(everything.plays.length).toBe(start.plays.length + 4);
  note("a poll since the rev each read: the changes, and the other coach on their play", "both", { otter: otterPoll.presence, heron: heronPoll.presence, since: b.rev, changed: heronPoll.plays.length, rev: heronPoll.rev });
  save("two-coaches");
});

test("a viewer looks and can't change; removal is at once; deleting the organization spares a coach's own teams", async () => {
  const run = runId();
  const otter = await coach("otter", run);
  const heron = await coach("heron", run);
  const own = await ownTeam(otter, [SLANT_LEFT], [], OTTERS);
  const org = (await createOrg(otter, "Riverside Youth Flag")).id;
  const team = (await moveTeam(otter, org, own.id)).id;
  await join(heron, (await invite(otter, org, {})).token);

  // a viewer: every team in view, nothing to change (rule 2, 9; T1)
  const asViewer = await readTeam(heron, org, team);
  expect(asViewer.level).toBe(1);
  const refusals = [
    (await writePlay(heron, org, team, COVER_TWO, ago(0))).status(),
    (await heron.put(`/api/orgs/${org}/teams/${team}/settings`, { data: { team: { ...OTTERS, name: "Herons" }, lineups: asViewer.lineups } })).status(),
    (await heron.delete(`/api/orgs/${org}/teams/${team}`)).status(),
    (await heron.post(`/api/orgs/${org}/invites`, { data: {} })).status(),
  ];
  expect(refusals).toEqual([403, 403, 403, 403]);
  note("Heron, a viewer: reads the team, and every change is refused", "heron", { level: asViewer.level, refusals });

  // re-scoped to assistant: plays yes, settings no; a copy from their own team says where it came from (rule 3, 10)
  await body(await otter.put(`/api/orgs/${org}/members/${encodeURIComponent(`fx_heron_${run}`)}`, { data: { assists: [team] } }), 200, "re-scope");
  const herons = await ownTeam(heron, [WHEEL_RIGHT], [], { name: "Heron Hollow", color: "#123456" });
  const copied = await body<{ plays: { name: string; from?: unknown }[] }>(await heron.post(`/api/orgs/${org}/teams/${team}/copy`, { data: { plays: [WHEEL_RIGHT], from: herons.id } }), 201, "copy");
  expect(copied.plays.map((p) => [p.name, p.from])).toEqual([["Otter Wheel Right", { team: herons.id, play: "fx-wheel-right" }]]);
  expect((await writePlay(heron, org, team, COVER_TWO, ago(0))).status()).toBe(200);
  expect((await heron.put(`/api/orgs/${org}/teams/${team}/settings`, { data: { team: OTTERS, lineups: asViewer.lineups } })).status()).toBe(403);
  note("Heron, now an assistant: draws and copies a play in, still can't touch the settings", "heron", { copied: copied.plays.map((p) => p.name), settings: 403 });

  // the owner can't leave with others in; removal takes effect on the next request (O1, O8)
  expect((await otter.post(`/api/orgs/${org}/leave`)).status()).toBe(409);
  await body(await otter.delete(`/api/orgs/${org}/members/${encodeURIComponent(`fx_heron_${run}`)}`), 204, "remove");
  expect((await heron.get(`/api/orgs/${org}/teams/${team}`)).status()).toBe(404);
  expect((await poll(heron, org, team, 0).catch(() => null))).toBeNull();
  const heronOrgs = await listOrgs(heron);
  expect(heronOrgs.mode === "on" ? heronOrgs.orgs : null).toEqual([]);
  note("Otter removes Heron: the team is gone from them at once", "otter", { leaveRefused: 409, heronReads: 404, heronOrgs });

  // deleting the organization takes its team, and nothing of Heron's own (rule 1)
  await body(await otter.delete(`/api/orgs/${org}`), 204, "delete org");
  const otterOrgs = await listOrgs(otter);
  expect(otterOrgs.mode === "on" ? otterOrgs.orgs : null).toEqual([]);
  const heronAccount = await body<AccountResponse>(await heron.get("/api/account"), 200, "heron's account");
  expect("teams" in heronAccount ? heronAccount.teams.map((t) => [t.name, t.plays]) : null).toEqual([["Heron Hollow", 1]]);
  const otterAccount = await body<AccountResponse>(await otter.get("/api/account"), 200, "otter's account");
  expect("teams" in otterAccount ? otterAccount.teams : null).toEqual([]);
  note("Otter deletes the organization: its team goes, Heron's own team stays", "otter", { otterOrgs, heronTeams: "teams" in heronAccount ? heronAccount.teams : null });
  save("a-viewer");
});
