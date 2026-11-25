------------------------------ MODULE OrgPush ------------------------------
(***************************************************************************)
(* How one device pushes an organization team's settings and lineups       *)
(* (lib/org/sync.ts `noteWrite`, `push`, `poll`, `settle`) while the coach   *)
(* keeps editing them and another head coach writes them too.               *)
(*                                                                          *)
(* The settings are one value: the server keeps the last write whole        *)
(* (writeSettings in lib/org/teams.ts), and every write to the team bumps   *)
(* its rev. What is left out is listed in                                  *)
(* .claude/skills/verify-org-push/SKILL.md.                                 *)
(*                                                                          *)
(* `Variant` replays a past version of the code; each OrgPush.<variant>.cfg *)
(* names the bug on its \* replays: line.                                   *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Edits,    \* settings the coach makes on this device, each a new value
  Others,   \* settings another head coach writes
  Bumps,    \* how many writes other coaches make to the team's plays: they move the rev, not the settings
  Variant

None == "none"
S0 == "s0"
ASSUME Variant \in {"fixed", "hashAfterAwait", "cleanAfterPush", "staleSettingsPoll", "skipAdvancesRev", "settleSaysSaved"}

VARIABLES
  dev,      \* the settings in this device's storage (TEAM_KEY, LINEUPS_KEY)
  hash,     \* d.hashes.settings: the settings the device believes the organization has
  pend,     \* d.pending.settings is set
  seen,     \* d.settingsRev: the settings rev `hash` came from
  drev,     \* d.rev: the rev the device polls from
  marker,   \* the marker (MARKER_KEY) is dirty
  status,   \* what the panel says
  timer,    \* pushTimer is set
  again,    \* pushAgain
  req,      \* the push in flight
  orphan,   \* a push sent before a reload, still on its way to the server
  poller,   \* the poll in flight
  server,   \* org_teams: [rev, val, srev], srev being settings_rev
  held,     \* every value the server has held
  made,     \* the settings the coach has made here
  last,     \* the latest of them
  plays     \* the play writes other coaches have made

vars == <<dev, hash, pend, seen, drev, marker, status, timer, again, req, orphan, poller, server, held, made, last, plays>>

IdlePush == [phase |-> "idle", sent |-> None, rev |-> 0, settle |-> FALSE]
IdlePoll == [phase |-> "idle", since |-> 0, rev |-> 0, val |-> None, srev |-> 0]
Max(a, b) == IF a > b THEN a ELSE b

Init ==
  /\ dev = S0 /\ hash = S0 /\ pend = FALSE /\ seen = 1 /\ drev = 1
  /\ marker = FALSE /\ status = "saved"
  /\ timer = FALSE /\ again = FALSE
  /\ req = IdlePush /\ orphan = None /\ poller = IdlePoll
  /\ server = [rev |-> 1, val |-> S0, srev |-> 1]
  /\ held = {S0}
  /\ made = {} /\ last = None /\ plays = 0

(* push(): one in flight only asks for another go; else notePending, then send the settings as read now. *)
StartPush(bySettle) ==
  IF req.phase # "idle"
  THEN /\ again' = TRUE
       /\ UNCHANGED <<pend, status, req, timer>>
  ELSE /\ timer' = FALSE
       /\ pend' = (pend \/ dev # hash)
       /\ IF pend'
          THEN /\ status' = "saving"
               /\ req' = [IdlePush EXCEPT !.phase = "out", !.sent = dev, !.settle = bySettle]
          ELSE /\ status' = "saved"
               /\ req' = IdlePush
       /\ UNCHANGED again

(* The coach changes the settings; the library's subscriber calls noteWrite() at once. *)
Edit(e) ==
  /\ e \notin made
  /\ made' = made \cup {e}
  /\ last' = e
  /\ dev' = e
  /\ pend' = TRUE
  /\ marker' = TRUE
  /\ status' = "pending"
  /\ timer' = TRUE
  /\ UNCHANGED <<hash, seen, drev, again, req, orphan, poller, server, held, plays>>

TimerFires ==
  /\ timer
  /\ timer' = FALSE
  /\ StartPush(FALSE)
  /\ UNCHANGED <<dev, hash, seen, drev, marker, orphan, poller, server, held, made, last, plays>>

(* online, focus, visibilitychange in wire(): a dirty marker pushes. *)
Resume ==
  /\ marker
  /\ StartPush(FALSE)
  /\ UNCHANGED <<dev, hash, seen, drev, marker, orphan, poller, server, held, made, last, plays>>

Write(v) ==
  /\ server' = [rev |-> server.rev + 1, val |-> v, srev |-> server.rev + 1]
  /\ held' = held \cup {v}

(* PUT .../settings: the last write wins outright. *)
ServerTakesPush ==
  /\ req.phase = "out"
  /\ Write(req.sent)
  /\ req' = [req EXCEPT !.phase = "ok", !.rev = server.rev + 1]
  /\ UNCHANGED <<dev, hash, pend, seen, drev, marker, status, timer, again, orphan, poller, made, last, plays>>

ServerTakesOrphan ==
  /\ orphan # None
  /\ Write(orphan)
  /\ orphan' = None
  /\ UNCHANGED <<dev, hash, pend, seen, drev, marker, status, timer, again, req, poller, made, last, plays>>

OrphanLost ==
  /\ orphan # None
  /\ orphan' = None
  /\ UNCHANGED <<dev, hash, pend, seen, drev, marker, status, timer, again, req, poller, server, held, made, last, plays>>

OtherCoach(o) ==
  /\ o \notin held
  /\ Write(o)
  /\ UNCHANGED <<dev, hash, pend, seen, drev, marker, status, timer, again, req, orphan, poller, made, last, plays>>

OtherPlay ==
  /\ plays < Bumps
  /\ plays' = plays + 1
  /\ server' = [server EXCEPT !.rev = server.rev + 1]
  /\ UNCHANGED <<dev, hash, pend, seen, drev, marker, status, timer, again, req, orphan, poller, held, made, last>>

(* writeSettings resolved: the rest of push() runs to its end and its `finally`. *)
PushLands ==
  /\ req.phase = "ok"
  /\ LET h == IF Variant = "hashAfterAwait" THEN dev ELSE req.sent
         dirty == IF Variant = "cleanAfterPush" THEN FALSE ELSE dev # h
     IN /\ hash' = h
        /\ seen' = req.rev
        /\ drev' = Max(drev, req.rev)
        /\ pend' = dirty
        /\ marker' = dirty
        /\ status' = IF req.settle /\ Variant = "settleSaysSaved" THEN "saved"
                     ELSE IF dirty THEN "pending" ELSE "saved"
  /\ req' = IdlePush
  \* finally: `void push()` again when asked; nothing the coach does fits between, so the timer stands in
  /\ IF again THEN again' = FALSE /\ timer' = TRUE ELSE UNCHANGED <<again, timer>>
  /\ UNCHANGED <<dev, orphan, poller, server, held, made, last, plays>>

(* poll(): with a change pending and no push out, it pushes instead; else it asks what changed since drev. *)
PollTicks ==
  /\ poller.phase = "idle"
  /\ IF pend /\ req.phase = "idle"
     THEN /\ StartPush(FALSE)
          /\ UNCHANGED poller
     ELSE /\ poller' = [IdlePoll EXCEPT !.phase = "out", !.since = drev]
          /\ UNCHANGED <<pend, status, timer, again, req>>
  /\ UNCHANGED <<dev, hash, seen, drev, marker, orphan, server, held, made, last, plays>>

(* changesSince: the settings come back when settings_rev > since. *)
ServerAnswersPoll ==
  /\ poller.phase = "out"
  /\ poller' = [poller EXCEPT !.phase = "back", !.rev = server.rev,
                  !.val = IF server.srev > poller.since THEN server.val ELSE None,
                  !.srev = IF server.srev > poller.since THEN server.srev ELSE 0]
  /\ UNCHANGED <<dev, hash, pend, seen, drev, marker, status, timer, again, req, orphan, server, held, made, last, plays>>

(* The poll's answer lands: a pending change is kept over what it brought (D2). *)
PollLands ==
  /\ poller.phase = "back"
  /\ LET brought == poller.val # None
         take == brought /\ ~pend /\ (Variant = "staleSettingsPoll" \/ poller.srev > seen)
         kept == brought /\ pend
     IN /\ dev' = IF take THEN poller.val ELSE dev
        /\ hash' = IF take THEN poller.val ELSE hash
        /\ seen' = IF take THEN poller.srev ELSE seen
        /\ drev' = IF kept /\ Variant # "skipAdvancesRev" THEN drev ELSE Max(drev, poller.rev)
  /\ marker' = pend
  /\ poller' = IdlePoll
  /\ UNCHANGED <<pend, status, timer, again, req, orphan, server, held, made, last, plays>>

(* A reload: timers, the poll and the push's answer are gone; settle() reads the marker and the device's record. *)
Reload ==
  /\ orphan = None
  /\ orphan' = IF req.phase = "out" THEN req.sent ELSE None
  /\ poller' = IdlePoll
  /\ IF marker \/ pend
     THEN LET p == pend \/ dev # hash
          IN /\ pend' = p
             /\ IF p
                THEN /\ status' = "saving"
                     /\ req' = [IdlePush EXCEPT !.phase = "out", !.sent = dev, !.settle = TRUE]
                ELSE /\ status' = "saved"
                     /\ req' = IdlePush
     ELSE /\ status' = "saved"
          /\ req' = IdlePush
          /\ UNCHANGED pend
  /\ timer' = FALSE
  /\ again' = FALSE
  /\ UNCHANGED <<dev, hash, seen, drev, marker, server, held, made, last, plays>>

Next ==
  \/ \E e \in Edits : Edit(e)
  \/ \E o \in Others : OtherCoach(o)
  \/ OtherPlay
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

TypeOK ==
  /\ dev \in {S0} \cup Edits \cup Others /\ hash \in {S0} \cup Edits \cup Others
  /\ pend \in BOOLEAN /\ marker \in BOOLEAN /\ timer \in BOOLEAN /\ again \in BOOLEAN
  /\ status \in {"saved", "pending", "saving"}
  /\ req.phase \in {"idle", "out", "ok"}
  /\ poller.phase \in {"idle", "out", "back"}

(* An edit the coach made is never lost: it is on the device or the server has had it. *)
NoLostEdit == last # None => last \in {dev} \cup held

(* Neither the panel nor the marker says saved over settings the server never had. *)
HonestSaved == (status = "saved" \/ ~marker) => dev \in held

(* Nothing pending, in flight or scheduled, and every write read: device, server and marker agree. *)
Quiet ==
  /\ req.phase = "idle" /\ orphan = None /\ poller.phase = "idle"
  /\ ~timer /\ ~again /\ ~pend
  /\ drev = server.rev
QuietAgrees == Quiet => dev = server.val /\ ~marker

(* Reloads resend, so writes are bounded only by this. *)
RevBound == server.rev <= 2 * Cardinality(Edits) + Cardinality(Others) + Bumps + 2
=============================================================================
