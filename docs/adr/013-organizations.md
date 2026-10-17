# ADR 013: organizations, with coaches who share teams

Status: the server side is implemented (the store, the routes and the journey); the app's side is next. It adds an organization over the coach accounts of [ADR 012](012-coach-accounts.md) without changing what a signed-out device stores, how any screen reads it, or how a coach's own teams are kept.

## Why

A coach's account holds their own teams, and nobody else's. A flag program is more than one coach: a head coach and two assistants on the 10U side, a coordinator who draws for every age group, a parent who prints the wristbands. Today they pass playbook files and share links around, and every copy drifts.

This change gives a program an **organization** that owns teams. Its coaches are **members** who see every team in it, draw on the ones they coach, and see each other at work.

## Three tiers, each a superset of the last

1. **Signed out.** The device is the library, exactly as before. Nothing in this ADR runs.
2. **A coach's own teams.** Signed in, outside any organization: ADR 012 unchanged. A team is one record under one rev, pushed whole, merged whole.
3. **An organization's teams.** A team the organization owns keeps its plays and playbooks as individual records, so two coaches drawing different plays never overwrite each other, and so a device can ask for what changed since it last looked.

A coach moves between tiers by moving a team, never by changing how they sign in. "Move to the organization" on one of their own teams converts it to tier 3 and makes them its head coach; it cannot be moved back, since the organization owns it from then on.

## Rules

1. **An organization owns its teams.** A team in the organization is nobody's; the coach who made it, moved it or coaches it can leave and the team stays. Deleting the organization deletes its teams, and nothing of any coach's own.
2. **Every member sees every team**, plays, playbooks and rosters alike, unless the admin who invited them narrowed it to a list of teams. Narrowed visibility never includes a team made after the invite until an admin adds it.
3. **Three roles in the organization**: the *owner* (one; can delete the organization and hand it on), *admins* (invite, remove and re-scope members, make and delete teams) and *members*. Two roles on a team, on top of seeing it: *head coach* (everything: plays, playbooks, roster, lineups, team settings, deleting the team, and naming the other head coaches and assistants) and *assistant* (plays and playbooks; the roster and settings they read). A member with neither role is a viewer of that team.
4. **Admins invite.** An invite is a link that works until it expires (7 days) for as many coaches as it reaches, or an email that works once for that address on its next Google or X sign-in. The admin sets what the invite grants: every team or a list, and which teams the coach heads or assists. A member can be re-scoped or removed by an admin in one tap, and removal takes effect on their next request.
5. **A play has one owner at a time, and the last write wins.** A write carries the rev of the play it replaces; a write over a newer play is applied anyway, since that is what two coaches editing at once means. A write that comes back from being offline over a play changed since is not applied: the device's version is saved beside it as a new play, named "<name> (your sideline version)", so nothing of either coach's is lost.
6. **Deleting is a write.** A deleted play or book is a tombstone for 30 days, so a device that still holds it drops it rather than pushing it back.
7. **Every play says who touched it**: made by, changed by, when. The playbooks screen shows "changed by Coach Heron, 2 hours ago" on the card.
8. **Coaches see each other.** A device with an organization's team open asks every few seconds for what changed since its rev and says which play it is on; the answer carries the changes and who else is on the team and where. Members show as avatars at the top of the designer and the playbooks screen, and the play someone else is drawing wears their name in the play name list and on its card. Nothing more live than that in this ADR: no cursors, no moving tokens, no new vendor.
9. **A viewer's device is read-only.** The designer opens the team's plays, Play tools and the playbooks screen read as usual, and Save, every editing control and the roster say why they are off ("You can look at this team but not change it. Ask an admin of <organization>."). Printing and every export work.
10. **Copy to another team.** A play or a whole playbook copies into any team the coach can edit, their own or the organization's, as new records that say where they came from. A copied play is independent from then on.
11. **A coach belongs to any number of organizations** (up to 10), beside their own teams. The team button lists their own teams first, then each organization's.
12. **Caps.** Up to 50 members and 24 teams per organization; a team's own caps (4 MB, 1,000 plays, 1,000 playbooks) are unchanged; invites are at most 20 open per organization.

## Data model

Organizations live in **Postgres** (`DATABASE_URL`; [the runbook](../runbook/organizations.md)), since memberships, roles, invites, per-record revs and cascading deletes are relations and transactions, which Redis would mean hand-writing as Lua. A coach's own teams and the share links stay in Redis untouched, and so does presence, which expires in seconds. Without a database the API says organizations are off and nothing else changes.

```ts
interface Organization { id: string; name: string; owner: string; created: string }
type OrgRole = "owner" | "admin" | "member";
interface Grants { teams: string[] | null; heads: string[]; assists: string[] }   // null: every team
interface Membership extends Grants { coach: string; name: string; role: OrgRole; joined: string }
interface Invite extends Grants { token: string; org: string; by: string; email: string | null; created: string; expires: string }
interface Stamp { by: string; name: string; at: string }   // `at` is the coach's own time of the change
interface OrgPlay extends SavedPlay { rev: number; made: Stamp; changed: Stamp; from?: { team: string; play: string } }
interface OrgPlaybook extends Playbook { rev: number; made: Stamp; changed: Stamp; from?: { team: string; book: string } }
interface Presence { coach: string; name: string; play: string | null; at: string }
```

- Tables (`db/migrations/001-organizations.sql`): `orgs`, `memberships` (keyed by organization and coach, with the role and grants), `invites`, `org_teams` (settings and lineups as JSON, the team's write count `rev` and the `settings_rev` they last changed at), `org_plays` and `org_books` (one row per record: the record as JSON, or null with `deleted` set for a tombstone, the `rev` it last changed at, who made and changed it and when). Deleting an organization cascades to all of it.
- Every write is one transaction that reads the caller's membership and locks the team row, so a coach removed a moment ago is refused and two writes to one team never collide on a rev. "What changed since rev N" is the rows whose rev is above N, tombstones included, plus the settings when theirs is.
- Rule 5 in the data: a change carries the coach's own time; a record changed since by **another** coach and later than that time outranks it, and the change becomes a sideline version (an edit) or is ignored (a delete). A coach's own records never outrank their own change, so their two devices and a slow clock cost nothing.
- Presence is `ffpd:presence:<team>` in Redis, a hash coach → Presence written by the poll, entries older than 30 seconds ignored. The poll is limited per coach per team (90 a minute), not against the account's reads, which two tabs would spend in forty minutes.
- The routes are `app/api/orgs/`: the coach's organizations and a new one; join by token and its preview; an organization's detail, name and deletion; invites; members' grants and roles; the owner's hand-over; leaving; teams made or moved in; a team whole; the poll; a play, a book, the settings; a copy in. Every write checks the request came from the app's own origin, as the account's do.

## In the app

- **Play tools** and the playbooks' **settings** gain an **ORGANIZATION** section under ACCOUNT: the organizations the coach is in, **New organization…**, and for an admin **Members…** (the list, each one's scope and roles, **Invite…** with the link or an email, remove) and **Move “<team>” here…**. The team button groups teams by organization.
- Coaches at work show as avatars beside the play name; a play another coach is on wears their name.
- **Copy to…** on a play card, a play's More menu and a book's menu lists the teams the coach can edit.
- The sign-in page accepts `?invite=<token>` and joins the organization once signed in; a coach already signed in who opens an invite link joins at once and lands on the team the invite grants first.

## Ways this could go wrong, written down before the code

- O1 a member's device holds a team they were removed from: the next poll is refused as not a member, the device keeps a read-only copy and says so, and the next switch drops it.
- O2 two coaches save the same play within a poll interval: the later write wins; the earlier coach's next poll brings the winner down and their designer says "Coach Heron changed this play" with the choice to keep theirs as a sideline version.
- O3 a sideline write (offline, hours old) over a changed play: rule 5; the coach is told where their version went.
- O4 a play deleted on one device and edited on another: the tombstone wins when the edit is older, the edit wins when it is newer and revives the play.
- O5 an invite link forwarded past the people it was meant for: it expires, and admins see who joined by it and can remove them; a coach who joins is listed to every admin at once.
- O6 an email invite for an address Clerk reports differently (a second email on the account): matched against every verified address of the signing-in user.
- O7 a coach in two organizations with a team of the same name: the team button shows the organization under each.
- O8 the owner leaves: refused until they hand the organization to an admin; an organization with one member who leaves is deleted with its teams, after a confirmation that counts them.
- O9 a move of a team with a push pending: the push goes first, as a switch does (A10).
- O10 polling while the tab is hidden: stops, and resumes with a full "since" read on focus, so a phone in a pocket costs nothing.
- O11 a team over its caps because two coaches added at once: the write that crosses is refused and says so, as today (A14).
- O12 the store down mid-session: every screen keeps working on the device's copy; presence disappears; writes are kept and retried (A7).
- O13 a viewer finds a way to a write (a stale page, a hand-made request): refused on the server by role, never only by the UI.
- O14 a copied play whose source is later deleted: unaffected, and its "from" reads "a play no longer in <team>".
- O15 a coach signed out on a device that mirrors an organization's team: the device is cleared as today (A11), since the team is in the organization.

## Verification

Until the screens exist, `e2e/journeys/organization.journey.ts` drives the API as the three fixture coaches (Otter, Heron and Ibis) against the disposable Redis and database: Otter makes an organization and moves a team in, invites Heron by link as head coach and Ibis by email narrowed to that team as a viewer, Ibis is in on their first visit and refused every write, Otter sees everyone; the two coaches save different plays and both land, three changes to one play leave the later coach's standing and the earlier one as a sideline version, a delete and a change resolve to the later, and a poll brings the changes with their tombstones and the other coach on their play; a viewer's every write is refused, an assistant draws and copies a play in, a removed coach gets nothing, the owner can't leave with others in, and deleting the organization spares a coach's own team. Each test leaves `test-results/organization-<test>.json` (each step: who did what, what the server answered), uploaded as `organization`.

With the screens, the journey will sign in as three fixture coaches (Otter, Heron and a new Ibis) against the disposable Redis: Otter makes an organization and moves a team in, invites Heron by link as head coach and Ibis by email with visibility narrowed to that team, as a viewer; Heron's device opens the team and its roster; both draw different plays at once and both land; both save the same play and the later wins with the other told; Heron goes offline, edits, comes back after Otter changed the same play and finds a sideline version; Ibis can print but not save; Otter copies a play to their own team; Otter removes Ibis and their device goes read-only, then deletes the organization and Heron's own teams are untouched. Each test leaves `test-results/organization-<coach>-<test>.json` and pictures of the members panel, the avatars and the read-only designer, uploaded as `organization`.
