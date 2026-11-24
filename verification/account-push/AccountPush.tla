---------------------------- MODULE AccountPush ----------------------------
(***************************************************************************)
(* How one device pushes a coach's team to the account (lib/account/sync.ts *)
(* `push`, `noteWrite`, `synced`) while the coach keeps saving and another  *)
(* device writes the same team.                                             *)
(*                                                                          *)
(* A team is modelled as its set of plays; the account's PUT replaces it    *)
(* whole, and `mergeTeamData` keeps both sides' plays, so a merge is a      *)
(* union. Pulls on focus (`check`), sign-in, deletes, the 404 and 401 paths *)
(* and the look (prefs) are outside the model.                              *)
(*                                                                          *)
(* `Variant` replays a past version of `push` so CI shows the model still   *)
(* catches it:                                                              *)
(*   "fixed"            the code as it is                                   *)
(*   "syncedAfterAwait" `synced` read the device after the request came back*)
(*                      and recorded it as what the account holds           *)
(*   "mergeFromSnapshot" a 409 merged the account's copy into the desk read *)
(*                      before the request and wrote that over the device   *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Edits,    \* plays the coach saves on this device
  Others,   \* plays another device of the account writes
  Variant

ASSUME Variant \in {"fixed", "syncedAfterAwait", "mergeFromSnapshot"}

VARIABLES
  device,   \* the plays in this device's storage
  made,     \* the plays the coach saved here: none may ever be lost
  server,   \* the account's copy: [rev, plays]
  marker,   \* the device's marker (MARKER_KEY): [rev, dirty]
  last,     \* getLastSynced(): what the device believes the account holds
  timer,    \* pushTimer is set
  again,    \* pushAgain
  req       \* the push in flight, if any

vars == <<device, made, server, marker, last, timer, again, req>>

Idle == [phase |-> "idle", sent |-> {}, rev |-> 0, attempt |-> 0, newRev |-> 0, record |-> {}]

Init ==
  /\ device = {}
  /\ made = {}
  /\ server = [rev |-> 1, plays |-> {}]
  /\ marker = [rev |-> 1, dirty |-> FALSE]
  /\ last = {}
  /\ timer = FALSE
  /\ again = FALSE
  /\ req = Idle

(* push() when nothing is in flight: skips when nothing changed (A18), else sends the desk as read now. *)
StartPush ==
  IF ~marker.dirty /\ last = device
  THEN req' = Idle
  ELSE req' = [Idle EXCEPT !.phase = "out", !.sent = device, !.rev = marker.rev]

(* push(): a second call while one is in flight only asks for another go. *)
Push ==
  IF req.phase # "idle"
  THEN /\ again' = TRUE
       /\ UNCHANGED req
  ELSE /\ StartPush
       /\ UNCHANGED again

(* The coach saves a play; the library's subscriber calls noteWrite(PUSH_DELAY). *)
Save(e) ==
  /\ e \notin made
  /\ device' = device \cup {e}
  /\ made' = made \cup {e}
  /\ IF device' = last
     THEN UNCHANGED <<marker, timer>>
     ELSE /\ marker' = [marker EXCEPT !.dirty = TRUE]
          /\ timer' = TRUE
  /\ UNCHANGED <<server, last, again, req>>

TimerFires ==
  /\ timer
  /\ timer' = FALSE
  /\ Push
  /\ UNCHANGED <<device, made, server, marker, last>>

(* online, focus, visibilitychange, pagehide: a dirty marker pushes. *)
Resume ==
  /\ marker.dirty
  /\ Push
  /\ UNCHANGED <<device, made, server, marker, last, timer>>

(* Another device of the account writes the team, having merged it properly. *)
OtherDevice(o) ==
  /\ o \notin server.plays
  /\ server' = [rev |-> server.rev + 1, plays |-> server.plays \cup {o}]
  /\ UNCHANGED <<device, made, marker, last, timer, again, req>>

(* PUT /api/account/teams/:id: written when the rev matches, else 409 with the account's copy. *)
ServerHandles ==
  /\ req.phase = "out"
  /\ IF req.rev = server.rev
     THEN /\ server' = [rev |-> server.rev + 1, plays |-> req.sent]
          /\ req' = [req EXCEPT !.phase = "ok", !.newRev = server.rev + 1]
     ELSE /\ req' = [req EXCEPT !.phase = "conflict", !.record = server.plays, !.newRev = server.rev]
          /\ UNCHANGED server
  /\ UNCHANGED <<device, made, marker, last, timer, again>>

(* The push's `finally`: another go was asked for, so it pushes again. *)
Finally ==
  IF again THEN /\ again' = FALSE /\ timer' = TRUE ELSE UNCHANGED <<again, timer>>

(* writeTeam resolved: synced() records what the account holds. *)
Written ==
  /\ req.phase = "ok"
  /\ IF Variant = "syncedAfterAwait"
     THEN /\ last' = device
          /\ marker' = [rev |-> req.newRev, dirty |-> FALSE]
     ELSE /\ last' = req.sent
          /\ marker' = [rev |-> req.newRev, dirty |-> req.sent # device]
  /\ req' = Idle
  /\ Finally
  /\ UNCHANGED <<device, made, server>>

(* writeTeam refused with 409 (A8, A22): merge the account's copy in and go again, once. *)
Refused ==
  /\ req.phase = "conflict"
  /\ IF req.attempt = 0
     THEN LET base == IF Variant = "mergeFromSnapshot" THEN req.sent ELSE device
              merged == base \cup req.record
          IN /\ device' = merged
             /\ marker' = [rev |-> req.newRev, dirty |-> TRUE]
             /\ req' = [Idle EXCEPT !.phase = "out", !.sent = merged, !.rev = req.newRev, !.attempt = 1]
             /\ UNCHANGED <<again, timer>>
     ELSE /\ req' = Idle  \* set(problem(e)): the marker stays dirty for the next resume
          /\ Finally
          /\ UNCHANGED <<device, marker>>
  /\ UNCHANGED <<made, server, last>>

Next ==
  \/ \E e \in Edits : Save(e)
  \/ \E o \in Others : OtherDevice(o)
  \/ TimerFires
  \/ Resume
  \/ ServerHandles
  \/ Written
  \/ Refused

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ device \subseteq Edits \cup Others
  /\ made \subseteq Edits
  /\ req.phase \in {"idle", "out", "ok", "conflict"}
  /\ timer \in BOOLEAN /\ again \in BOOLEAN

(* A play saved on this device is never taken off it. *)
NoLostSave == made \subseteq device

(* When the device has nothing pending and nothing in flight, the account holds every play saved here. *)
Quiet == req.phase = "idle" /\ ~timer /\ ~again /\ ~marker.dirty
HonestSaved == Quiet => made \subseteq server.plays

(* Writes are bounded by the plays, so the state space is finite. *)
RevBound == server.rev <= 2 * (Cardinality(Edits) + Cardinality(Others)) + 3
=============================================================================
