----------------------------- MODULE OrgRecords -----------------------------
(***************************************************************************)
(* How one device pushes an organization team's plays and books            *)
(* (lib/org/sync.ts `noteWrite`, `push`, `land`, `poll`, `settle`) while   *)
(* the coach keeps editing a record and another coach writes it too.        *)
(*                                                                          *)
(* `P` is one play or book: plays and books run the same code, one loop     *)
(* each. The coach edits and deletes P here; another coach writes and       *)
(* deletes P and writes a second record Q this device never touches. Every  *)
(* write bumps the team's rev and stamps the row with it; the server keeps  *)
(* the newer change by the coaches' clocks and sets the older one aside as  *)
(* a sideline copy (writePlay, deletePlay in lib/org/teams.ts). Clocks may  *)
(* be skewed, so whether another coach's row outranks a write is a free     *)
(* choice. The settings are OrgPush.tla's; what is left out is listed in    *)
(* .claude/skills/verify-org-push/SKILL.md.                                 *)
(*                                                                          *)
(* `Bugs` turns on past versions of the code; each OrgRecords.<bug>.cfg     *)
(* names the bug on its \* replays: line.                                   *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Edits,    \* versions of P the coach saves on this device
  Others,   \* versions of P another coach saves
  Dels,     \* how many times the coach deletes P here
  ODels,    \* how many times another coach deletes P
  QWrites,  \* how many times another coach writes Q
  Bugs

None == "none"
Del == "del"   \* no P in storage, or a tombstone on the server
S0 == "s0"
AllBugs == {"stalePoll", "writeAdvancesRev", "landOverEdit", "deleteDropsStood"}
ASSUME Bugs \subseteq AllBugs

VARIABLES
  dev,      \* P in this device's storage (PLAYS_KEY), Del when absent
  hash,     \* d.hashes.plays[P]: the P the device believes the server has, Del when absent
  pend,     \* d.pending.plays[P] is set
  vrev,     \* d.revs.plays[P]: the row rev `hash` came from (a ghost where the code has none)
  top,      \* the newest row rev of P the device has applied, from a write or a poll
  qdev,     \* the version of Q on this device
  drev,     \* d.rev: the rev the device polls from
  marker,   \* the marker (MARKER_KEY) is dirty
  timer,    \* pushTimer is set
  again,    \* pushAgain
  req,      \* the push in flight
  orphan,   \* a push sent before a reload, still on its way to the server
  poller,   \* the poll in flight
  srv,      \* org_teams.rev, P's row (val, by, rev), Q's row (val, rev)
  held,     \* every version of P the server has held, sideline copies included
  made,     \* the versions the coach has saved here
  last,     \* the latest thing the coach did to P
  dels,     \* deletes made here
  odels     \* deletes made by another coach

vars == <<dev, hash, pend, vrev, top, qdev, drev, marker, timer, again, req, orphan, poller, srv, held, made, last, dels, odels>>

IdlePush == [phase |-> "idle", sent |-> None, rev |-> 0, stood |-> None, row |-> 0]
IdlePoll == [phase |-> "idle", since |-> 0, rev |-> 0, p |-> None, prow |-> 0, q |-> 0]
Max(a, b) == IF a > b THEN a ELSE b

Init ==
  /\ dev = S0 /\ hash = S0 /\ pend = FALSE /\ vrev = 1 /\ top = 1 /\ qdev = 0 /\ drev = 1
  /\ marker = FALSE /\ timer = FALSE /\ again = FALSE
  /\ req = IdlePush /\ orphan = None /\ poller = IdlePoll
  /\ srv = [rev |-> 1, val |-> S0, by |-> "other", prow |-> 1, q |-> 0, qrev |-> 1]
  /\ held = {S0}
  /\ made = {} /\ last = None /\ dels = 0 /\ odels = 0

(***************************************************************************)
(* The server takes this device's write of `sent` (Del is a delete).       *)
(* `out` is TRUE when the row is another coach's newer change. The result   *)
(* is what the response carries: the team rev, the P that stood, its row    *)
(* rev.                                                                     *)
(***************************************************************************)
Outcome(sent, out) ==
  LET n == srv.rev + 1 IN
  IF sent = Del
  THEN IF srv.val = Del \/ out
       THEN [srv |-> srv, held |-> held, rev |-> srv.rev, stood |-> srv.val, row |-> srv.prow]
       ELSE [srv |-> [srv EXCEPT !.rev = n, !.val = Del, !.by = "me", !.prow = n],
             held |-> held \cup {Del}, rev |-> n, stood |-> Del, row |-> n]
  ELSE IF out
       \* the device's version becomes a sideline copy; P keeps its value and takes the new rev
       THEN [srv |-> [srv EXCEPT !.rev = n, !.prow = n],
             held |-> held \cup {sent}, rev |-> n, stood |-> srv.val, row |-> n]
       ELSE [srv |-> [srv EXCEPT !.rev = n, !.val = sent, !.by = "me", !.prow = n],
             held |-> held \cup {sent}, rev |-> n, stood |-> sent, row |-> n]

Outranks == IF srv.by = "other" THEN {TRUE, FALSE} ELSE {FALSE}

(* push(): one in flight only asks for another go; else notePending, then send P as read now. *)
StartPush ==
  IF req.phase # "idle"
  THEN /\ again' = TRUE
       /\ UNCHANGED <<pend, req, timer>>
  ELSE /\ timer' = FALSE
       /\ pend' = (pend \/ dev # hash)
       /\ req' = IF pend' THEN [IdlePush EXCEPT !.phase = "out", !.sent = dev] ELSE IdlePush
       /\ UNCHANGED again

(* noteWrite() after a write in the library: notePending, the marker, pushTimer. *)
Noted ==
  IF pend'
  THEN marker' = TRUE /\ timer' = TRUE
  ELSE UNCHANGED <<marker, timer>>

Edit(e) ==
  /\ e \notin made
  /\ made' = made \cup {e}
  /\ last' = e
  /\ dev' = e
  /\ pend' = TRUE
  /\ Noted
  /\ UNCHANGED <<hash, vrev, top, qdev, drev, again, req, orphan, poller, srv, held, dels, odels>>

Delete ==
  /\ dev # Del /\ dels < Dels
  /\ dels' = dels + 1
  /\ last' = Del
  /\ dev' = Del
  /\ pend' = (pend \/ hash # Del)
  /\ Noted
  /\ UNCHANGED <<hash, vrev, top, qdev, drev, again, req, orphan, poller, srv, held, made, odels>>

TimerFires ==
  /\ timer
  /\ StartPush
  /\ UNCHANGED <<dev, hash, vrev, top, qdev, drev, marker, orphan, poller, srv, held, made, last, dels, odels>>

(* online, focus, visibilitychange in wire(): a dirty marker pushes. *)
Resume ==
  /\ marker
  /\ StartPush
  /\ UNCHANGED <<dev, hash, vrev, top, qdev, drev, marker, orphan, poller, srv, held, made, last, dels, odels>>

(* PUT or DELETE .../plays/<id>: rule 5 decides, in one transaction. *)
ServerTakesPush ==
  /\ req.phase = "out"
  /\ \E out \in Outranks :
       LET o == Outcome(req.sent, out) IN
       /\ srv' = o.srv /\ held' = o.held
       /\ req' = [req EXCEPT !.phase = "ok", !.rev = o.rev, !.stood = o.stood, !.row = o.row]
  /\ UNCHANGED <<dev, hash, pend, vrev, top, qdev, drev, marker, timer, again, orphan, poller, made, last, dels, odels>>

ServerTakesOrphan ==
  /\ orphan # None
  /\ \E out \in Outranks :
       LET o == Outcome(orphan, out) IN
       srv' = o.srv /\ held' = o.held
  /\ orphan' = None
  /\ UNCHANGED <<dev, hash, pend, vrev, top, qdev, drev, marker, timer, again, req, poller, made, last, dels, odels>>

OrphanLost ==
  /\ orphan # None
  /\ orphan' = None
  /\ UNCHANGED <<dev, hash, pend, vrev, top, qdev, drev, marker, timer, again, req, poller, srv, held, made, last, dels, odels>>

OtherWrite(o) ==
  /\ o \notin held
  /\ srv' = [srv EXCEPT !.rev = srv.rev + 1, !.val = o, !.by = "other", !.prow = srv.rev + 1]
  /\ held' = held \cup {o}
  /\ UNCHANGED <<dev, hash, pend, vrev, top, qdev, drev, marker, timer, again, req, orphan, poller, made, last, dels, odels>>

OtherDelete ==
  /\ srv.val # Del /\ odels < ODels
  /\ odels' = odels + 1
  /\ srv' = [srv EXCEPT !.rev = srv.rev + 1, !.val = Del, !.by = "other", !.prow = srv.rev + 1]
  /\ held' = held \cup {Del}
  /\ UNCHANGED <<dev, hash, pend, vrev, top, qdev, drev, marker, timer, again, req, orphan, poller, made, last, dels>>

OtherQ ==
  /\ srv.q < QWrites
  /\ srv' = [srv EXCEPT !.rev = srv.rev + 1, !.q = srv.q + 1, !.qrev = srv.rev + 1]
  /\ UNCHANGED <<dev, hash, pend, vrev, top, qdev, drev, marker, timer, again, req, orphan, poller, held, made, last, dels, odels>>

(***************************************************************************)
(* The write resolved: land() and the rest of push() run to its end and its *)
(* `finally`. The P that stood goes into storage only while storage still   *)
(* holds what was sent; an edit made during the write stays and goes up.    *)
(***************************************************************************)
PushLands ==
  /\ req.phase = "ok"
  /\ LET dropped == req.sent = Del /\ "deleteDropsStood" \in Bugs
         h == IF dropped THEN Del ELSE req.stood
         d == IF ~dropped /\ req.stood # req.sent /\ (dev = req.sent \/ "landOverEdit" \in Bugs)
              THEN req.stood ELSE dev
         dirty == d # h
     IN /\ dev' = d
        /\ hash' = h
        /\ vrev' = req.row
        /\ top' = Max(top, req.row)
        /\ drev' = IF "writeAdvancesRev" \in Bugs THEN Max(drev, req.rev) ELSE drev
        /\ pend' = dirty
        /\ marker' = dirty
  /\ req' = IdlePush
  /\ IF again THEN again' = FALSE /\ timer' = TRUE ELSE UNCHANGED <<again, timer>>
  /\ UNCHANGED <<qdev, orphan, poller, srv, held, made, last, dels, odels>>

(* poll(): with a change pending and no push out, it pushes instead; else it asks what changed since drev. *)
PollTicks ==
  /\ poller.phase = "idle"
  /\ IF pend /\ req.phase = "idle"
     THEN /\ StartPush
          /\ UNCHANGED poller
     ELSE /\ poller' = [IdlePoll EXCEPT !.phase = "out", !.since = drev]
          /\ UNCHANGED <<pend, timer, again, req>>
  /\ UNCHANGED <<dev, hash, vrev, top, qdev, drev, marker, orphan, srv, held, made, last, dels, odels>>

(* changesSince: every row whose rev is above `since`, tombstones included. *)
ServerAnswersPoll ==
  /\ poller.phase = "out"
  /\ poller' = [poller EXCEPT !.phase = "back", !.rev = srv.rev,
                  !.p = IF srv.prow > poller.since THEN srv.val ELSE None,
                  !.prow = IF srv.prow > poller.since THEN srv.prow ELSE 0,
                  !.q = IF srv.qrev > poller.since THEN srv.q ELSE 0]
  /\ UNCHANGED <<dev, hash, pend, vrev, top, qdev, drev, marker, timer, again, req, orphan, srv, held, made, last, dels, odels>>

(* The poll's answer lands: a pending change is kept and holds the rev (D2); a row no newer than the device's is dropped. *)
PollLands ==
  /\ poller.phase = "back"
  /\ LET brought == poller.p # None
         kept == brought /\ pend
         take == brought /\ ~pend /\ ("stalePoll" \in Bugs \/ poller.prow > vrev)
     IN /\ dev' = IF take THEN poller.p ELSE dev
        /\ hash' = IF take THEN poller.p ELSE hash
        /\ vrev' = IF take THEN poller.prow ELSE vrev
        /\ top' = IF take THEN Max(top, poller.prow) ELSE top
        /\ drev' = IF kept THEN drev ELSE Max(drev, poller.rev)
  /\ qdev' = IF poller.q > 0 THEN poller.q ELSE qdev
  /\ marker' = pend
  /\ poller' = IdlePoll
  /\ UNCHANGED <<pend, timer, again, req, orphan, srv, held, made, last, dels, odels>>

(* A reload: timers, the poll and the push's answer are gone; settle() reads the marker and the device's record. *)
Reload ==
  /\ orphan = None
  /\ orphan' = IF req.phase = "out" THEN req.sent ELSE None
  /\ poller' = IdlePoll
  /\ IF marker \/ pend
     THEN /\ pend' = (pend \/ dev # hash)
          /\ req' = IF pend' THEN [IdlePush EXCEPT !.phase = "out", !.sent = dev] ELSE IdlePush
     ELSE /\ req' = IdlePush
          /\ UNCHANGED pend
  /\ timer' = FALSE
  /\ again' = FALSE
  /\ UNCHANGED <<dev, hash, vrev, top, qdev, drev, marker, srv, held, made, last, dels, odels>>

Next ==
  \/ \E e \in Edits : Edit(e)
  \/ Delete
  \/ \E o \in Others : OtherWrite(o)
  \/ OtherDelete
  \/ OtherQ
  \/ TimerFires
  \/ Resume
  \/ ServerTakesPush
  \/ ServerTakesOrphan
  \/ OrphanLost
  \/ PushLands
  \/ PollTicks
  \/ ServerAnswersPoll
  \/ PollLands
  \/ Reload

Spec == Init /\ [][Next]_vars

Values == {S0, Del} \cup Edits \cup Others
TypeOK ==
  /\ dev \in Values /\ hash \in Values /\ srv.val \in Values
  /\ pend \in BOOLEAN /\ marker \in BOOLEAN /\ timer \in BOOLEAN /\ again \in BOOLEAN
  /\ req.phase \in {"idle", "out", "ok"}
  /\ poller.phase \in {"idle", "out", "back"}

(* A version the coach saved is never lost: it is on the device or the server has had it, as P or a sideline copy. *)
NoLostEdit == last \notin {None, Del} => last \in {dev} \cup held

(* The marker is never clean over a P the server never had. *)
HonestSaved == ~marker => dev \in held

(* The device never puts an older P over a newer one it already had from the server. *)
NoStaleTake == vrev = top

(* Nothing pending, in flight or scheduled, and every write read: device, server and marker agree. *)
Quiet ==
  /\ req.phase = "idle" /\ orphan = None /\ poller.phase = "idle"
  /\ ~timer /\ ~again /\ ~pend
  /\ drev = srv.rev
QuietAgrees == Quiet => dev = srv.val /\ qdev = srv.q /\ ~marker

(* Reloads resend, so writes are bounded only by this. *)
RevBound == srv.rev <= 2 * (Cardinality(Edits) + Dels) + Cardinality(Others) + ODels + QWrites + 2
=============================================================================
