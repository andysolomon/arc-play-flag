import { describe, expect, test } from "bun:test";
import { defaults } from "@/lib/play/routes";
import {
  DRAFT_KEY, PLAYBOOKS_KEY, PLAYS_KEY, TEAM_KEY, StorageError, readAll, readDraft, readPlaybooks, readTeam, store,
  storePlaybook, writeDraft, writeTeam, type StorageLike,
} from "@/lib/play/storage";
import type { SavedPlay } from "@/lib/play/types";
import {
  BACKUP_KIND, applyBackupRestore, backupMessage, encodeBackupFile, planBackupRestore, readBackupFile, readBackupState,
} from "./backup";

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

const play = (id: string, name: string): SavedPlay => ({
  id,
  name,
  notes: `Read for ${name}`,
  side: "offense",
  players: defaults().map((p) => p.id === "o3"
    ? { ...p, route: { type: "custom", pts: [[8, -2], [19, -10]], primary: true } }
    : p),
});

describe("on-device backup", () => {
  test("round-trips every play, ordered references, team, draft, notes, primary flags and custom geometry", () => {
    const source = memory();
    const inBook = play("booked", "Booked");
    const unbooked = play("loose", "Unbooked");
    store(inBook, source);
    store(unbooked, source);
    storePlaybook({ id: "week", name: "Week", plays: ["loose", "booked"] }, source);
    writeTeam({ name: "Otters", color: "#123abc" }, source);
    writeDraft({ id: "booked", name: "Changed draft", notes: "Not saved yet", players: unbooked.players }, source);

    const encoded = encodeBackupFile(source);
    expect(encoded.filename).toMatch(/^otters-device-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const read = readBackupFile(encoded.json);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.error);
    expect(read.file.kind).toBe(BACKUP_KIND);
    expect(read.file.plays.map((p) => p.id)).toEqual(["booked", "loose"]);
    expect(read.file.playbooks[0]?.plays).toEqual(["loose", "booked"]);
    expect(read.file.plays[0]?.notes).toBe("Read for Booked");
    expect(read.file.plays[0]?.players.find((p) => p.id === "o3")?.route).toEqual({
      type: "custom", pts: [[8, -2], [19, -10]], primary: true,
    });

    const target = memory();
    applyBackupRestore(planBackupRestore(read.file, readBackupState(target), "replace"), target);
    expect(readAll(target)).toEqual(readAll(source));
    expect(readPlaybooks(target)).toEqual(readPlaybooks(source));
    expect(readTeam(target)).toEqual(readTeam(source));
    expect(readDraft(target)).toEqual(readDraft(source));
  });

  test("refuses an invalid or incomplete backup before any write", () => {
    const target = memory();
    store(play("keep", "Keep"), target);
    const before = new Map(target.data);
    const good = JSON.parse(encodeBackupFile(target).json) as Record<string, unknown>;
    const read = (patch: Record<string, unknown>) => readBackupFile(JSON.stringify({ ...good, ...patch }));
    expect(readBackupFile("{nope")).toEqual({ ok: false, error: "notJson" });
    expect(readBackupFile("{}")).toEqual({ ok: false, error: "notBackup" });
    expect(read({ version: 99 })).toEqual({ ok: false, error: "newerVersion" });
    expect(read({ draft: { name: "Missing players" } })).toEqual({ ok: false, error: "invalidData" });
    const plays = good.plays as Record<string, unknown>[];
    expect(read({ plays: [{ ...plays[0], notes: 42 }] })).toEqual({ ok: false, error: "invalidData" });
    const playbooks = [{ id: "bad", name: "Bad", plays: ["missing"] }];
    expect(read({ playbooks })).toEqual({ ok: false, error: "invalidData" });
    expect(target.data).toEqual(before);
    expect(backupMessage("invalidData")).toContain("Nothing was changed");
  });

  test("refuses prototype-pollution IDs before any restore write", () => {
    const source = memory();
    store(play("safe", "Safe"), source);
    storePlaybook({ id: "safe-book", name: "Safe book", plays: ["safe"] }, source);
    const good = JSON.parse(encodeBackupFile(source).json) as {
      plays: Array<Record<string, unknown>>;
      playbooks: Array<Record<string, unknown>>;
    };
    const target = memory();
    let writes = 0;
    const watched: StorageLike = {
      getItem: (key) => target.getItem(key),
      setItem: (key, value) => { writes++; target.setItem(key, value); },
      removeItem: (key) => { target.removeItem?.(key); },
    };
    const restoreIfValid = (candidate: typeof good) => {
      const read = readBackupFile(JSON.stringify(candidate));
      if (read.ok) applyBackupRestore(planBackupRestore(read.file, readBackupState(watched), "replace"), watched);
      return read;
    };

    for (const id of ["__proto__", "constructor", "prototype"]) {
      const hostilePlay = structuredClone(good);
      if (!hostilePlay.plays[0]) throw new Error("missing play fixture");
      hostilePlay.plays[0].id = id;
      expect(restoreIfValid(hostilePlay)).toEqual({ ok: false, error: "invalidData" });

      const hostileBook = structuredClone(good);
      if (!hostileBook.playbooks[0]) throw new Error("missing playbook fixture");
      hostileBook.playbooks[0].id = id;
      expect(restoreIfValid(hostileBook)).toEqual({ ok: false, error: "invalidData" });
    }

    expect(writes).toBe(0);
    expect(target.data.size).toBe(0);
  });

  test("refuses hostile or empty nested identifiers before any restore write", () => {
    const source = memory();
    const nested = play("safe", "Safe");
    nested.players = nested.players.map((p) => p.id === "d1"
      ? { ...p, route: { type: "man" as const, target: "o3" } }
      : p);
    store(nested, source);
    storePlaybook({ id: "safe-book", name: "Safe book", plays: ["safe"] }, source);
    writeDraft({ id: "safe", name: "Safe draft", players: nested.players }, source);

    type RawPlayer = { id: string; route: Record<string, unknown> | null };
    type Candidate = {
      plays: Array<{ players: RawPlayer[] }>;
      playbooks: Array<{ plays: string[] }>;
      draft: { id: string | null; players: RawPlayer[] } | null;
    };
    const good = JSON.parse(encodeBackupFile(source).json) as Candidate;
    const target = memory();
    let writes = 0;
    const watched: StorageLike = {
      getItem: (key) => target.getItem(key),
      setItem: (key, value) => { writes++; target.setItem(key, value); },
      removeItem: (key) => { target.removeItem?.(key); },
    };
    const restoreIfValid = (candidate: Candidate) => {
      const read = readBackupFile(JSON.stringify(candidate));
      if (read.ok) applyBackupRestore(planBackupRestore(read.file, readBackupState(watched), "replace"), watched);
      return read;
    };
    const mutate = (label: string, values: readonly string[], change: (candidate: Candidate, value: string) => void) => {
      for (const value of values) {
        const candidate = structuredClone(good);
        change(candidate, value);
        expect(restoreIfValid(candidate), `${label}: ${value}`).toEqual({ ok: false, error: "invalidData" });
      }
    };
    const hostileOrEmpty = ["", "__proto__", "constructor", "prototype"] as const;

    mutate("saved player id", hostileOrEmpty, (candidate, value) => {
      const player = candidate.plays[0]?.players[0];
      if (!player) throw new Error("missing saved player fixture");
      player.id = value;
    });
    mutate("draft player id", hostileOrEmpty, (candidate, value) => {
      const player = candidate.draft?.players[0];
      if (!player) throw new Error("missing draft player fixture");
      player.id = value;
    });
    mutate("man target", hostileOrEmpty, (candidate, value) => {
      const player = candidate.plays[0]?.players.find((p) => p.id === "d1");
      if (!player?.route) throw new Error("missing man target fixture");
      player.route.target = value;
    });
    mutate("playbook reference", hostileOrEmpty, (candidate, value) => {
      const book = candidate.playbooks[0];
      if (!book) throw new Error("missing playbook fixture");
      book.plays[0] = value;
    });
    mutate("draft id", hostileOrEmpty, (candidate, value) => {
      if (!candidate.draft) throw new Error("missing draft fixture");
      candidate.draft.id = value;
    });

    expect(writes).toBe(0);
    expect(target.data.size).toBe(0);
  });

  describe("a backup made before lateral chains (B1–B7)", () => {
    type RawRoute = Record<string, unknown> | null;
    type RawPlayer = Record<string, unknown> & { id: string; route: RawRoute };
    type RawPlay = Record<string, unknown> & { players: RawPlayer[] };
    // a play exactly as a version before laterals stored it: a Pitch was a route like any other
    const old = (id: string, routes: Record<string, RawRoute>): RawPlay => ({
      id, name: `Old ${id}`, notes: "From before laterals", side: "offense",
      players: defaults().map((p) => ({ ...p, route: routes[p.id] ?? null })),
    });
    const OPTION = old("old-option", { o5: { type: "pitch" }, o4: { type: "corner" } });
    const SWEEP = old("old-sweep", { o5: { type: "pitch", mirror: true, primary: true } });
    const DECOY = old("old-decoy", { o3: { type: "dive", primary: true }, o5: { type: "pitch" }, o4: { type: "corner" } });
    const backup = (patch: { plays?: RawPlay[]; playbooks?: unknown[]; draft?: Record<string, unknown> | null }): string => JSON.stringify({
      ...(JSON.parse(encodeBackupFile(memory()).json) as Record<string, unknown>),
      plays: [OPTION, SWEEP, DECOY],
      playbooks: [{ id: "old-book", name: "Old book", plays: ["old-sweep", "old-option"] }],
      draft: { id: "old-option", name: "Old draft", notes: "", side: "offense", players: OPTION.players },
      ...patch,
    });
    // each player's job: the quarterback's laterals when there are some, else their route
    const routes = (players: readonly { label: string; route: unknown; laterals?: unknown }[]): Record<string, unknown> =>
      Object.fromEntries(players.filter((p) => p.route || p.laterals).map((p) => [p.label, p.laterals ?? p.route]));

    test("restores every Pitch play and the draft as the lateral it reads as today (B1, B7)", () => {
      const read = readBackupFile(backup({}));
      if (!read.ok) throw new Error(read.error);
      const [option, sweep, decoy] = read.file.plays;
      expect(routes(option?.players ?? [])).toEqual({ QB: [{ to: "o5" }], Z: { type: "throw" }, Y: { type: "corner" } });
      expect(routes(sweep?.players ?? [])).toEqual({ QB: [{ to: "o5" }], Z: { type: "stretch", mirror: true } });
      expect(routes(decoy?.players ?? [])).toEqual({ X: { type: "dive", primary: true }, Z: { type: "stretch" }, Y: { type: "corner" } });
      expect(routes(read.file.draft?.players ?? [])).toEqual(routes(option?.players ?? []));
      expect(read.file.playbooks[0]?.plays).toEqual(["old-sweep", "old-option"]);

      const target = memory();
      applyBackupRestore(planBackupRestore(read.file, readBackupState(target), "replace"), target);
      expect(target.data.get(PLAYS_KEY)).not.toContain("pitch");
      expect(target.data.get(DRAFT_KEY)).not.toContain("pitch");
      expect(readAll(target)["old-option"]).toEqual(option);
      // restored once, it is in today's shape: a backup of it reads back exactly
      expect(readBackupFile(encodeBackupFile(target).json).ok).toBe(true);
    });

    test("still refuses one that was damaged, or that no version ever stored (B2–B5)", () => {
      const damaged = (label: string, change: (p: RawPlay) => void) => {
        const play = structuredClone(OPTION);
        change(play);
        expect(readBackupFile(backup({ plays: [play, SWEEP, DECOY] })), `play: ${label}`).toEqual({ ok: false, error: "invalidData" });
        expect(readBackupFile(backup({ draft: { id: null, name: "Draft", notes: "", side: "offense", players: play.players } })), `draft: ${label}`)
          .toEqual({ ok: false, error: "invalidData" });
      };
      const player = (p: RawPlay, id: string): RawPlayer => {
        const q = p.players.find((v) => v.id === id);
        if (!q) throw new Error(`missing ${id}`);
        return q;
      };
      damaged("a spot off the field", (p) => { player(p, "o3").x = 99; });
      damaged("a hostile player id", (p) => { player(p, "o3").id = "__proto__"; });
      damaged("a label too long", (p) => { player(p, "o3").label = "WIDE"; });
      damaged("a Pitch read flag that isn't true", (p) => { player(p, "o5").route = { type: "pitch", primary: "yes" }; });
      damaged("a Pitch with a key it never had", (p) => { player(p, "o5").route = { type: "pitch", speed: 3 }; });
      damaged("a Pitch on a defender", (p) => { player(p, "d1").route = { type: "pitch" }; });
      damaged("a Pitch beside a throw", (p) => { player(p, "o3").route = { type: "throw" }; });
      damaged("a Pitch beside a lateral", (p) => { player(p, "o2").route = { type: "lateral", target: "o3" }; });
      damaged("a Pitch beside a list of laterals", (p) => { player(p, "o2").laterals = [{ to: "o3" }]; });
      damaged("a hostile id on a Pitch", (p) => { player(p, "o5").route = { type: "pitch", target: "__proto__" }; });
      const notes = { ...OPTION, notes: 42 };
      expect(readBackupFile(backup({ plays: [notes, SWEEP, DECOY] }))).toEqual({ ok: false, error: "invalidData" });
    });

    describe("from ADR 004's version, one lateral per carrier (B8–B10)", () => {
      // QB → Z → X, X throws to Y, as that version stored it: each carrier's lateral is their route
      const CHAIN = old("old-chain", {
        o2: { type: "lateral", target: "o5", catch: [22, 6] },
        o5: { type: "lateral", target: "o3", catch: [9, 6.5] },
        o3: { type: "throw" },
        o4: { type: "go", primary: true },
      });
      const KEEP = old("old-keep", { o2: { type: "lateral", target: "o5" }, o5: { type: "reverse" } });
      const draft = (p: RawPlay) => ({ id: null, name: "Draft", notes: "", side: "offense", players: p.players });
      const chainBackup = (plays: RawPlay[], d: RawPlay | null = null) => backup({ plays, playbooks: [], draft: d && draft(d) });

      test("restores it as the quarterback's laterals, in order, with the same catches (B8)", () => {
        const read = readBackupFile(chainBackup([CHAIN, KEEP], CHAIN));
        if (!read.ok) throw new Error(read.error);
        const [chain, keep] = read.file.plays;
        expect(routes(chain?.players ?? [])).toEqual({
          QB: [{ to: "o5", catch: [22, 6] }, { to: "o3", catch: [9, 6.5] }], X: { type: "throw" }, Y: { type: "go", primary: true },
        });
        expect(routes(keep?.players ?? [])).toEqual({ QB: [{ to: "o5" }], Z: { type: "reverse" } });
        expect(routes(read.file.draft?.players ?? [])).toEqual(routes(chain?.players ?? []));

        const target = memory();
        applyBackupRestore(planBackupRestore(read.file, readBackupState(target), "replace"), target);
        expect(target.data.get(PLAYS_KEY)).not.toContain("\"lateral\"");
        expect(readBackupFile(encodeBackupFile(target).json).ok).toBe(true);
      });

      test("still refuses one that version would never have stored, or one mixed with another version's (B9, B10)", () => {
        const damaged = (label: string, change: (p: RawPlay) => void) => {
          const play = structuredClone(CHAIN);
          change(play);
          expect(readBackupFile(chainBackup([play])), `play: ${label}`).toEqual({ ok: false, error: "invalidData" });
          expect(readBackupFile(chainBackup([], play)), `draft: ${label}`).toEqual({ ok: false, error: "invalidData" });
        };
        const player = (p: RawPlay, id: string): RawPlayer => {
          const q = p.players.find((v) => v.id === id);
          if (!q) throw new Error(`missing ${id}`);
          return q;
        };
        damaged("a catch in front of its release", (p) => { player(p, "o5").route = { type: "lateral", target: "o3", catch: [9, 3] }; });
        damaged("a catch past the line", (p) => { player(p, "o2").route = { type: "lateral", target: "o5", catch: [22, 0.5] }; });
        damaged("a lateral to a defender", (p) => { player(p, "o5").route = { type: "lateral", target: "d1" }; });
        damaged("a lateral to nobody", (p) => { player(p, "o5").route = { type: "lateral", target: "zz" }; });
        damaged("a hostile id on a lateral", (p) => { player(p, "o5").route = { type: "lateral", target: "__proto__" }; });
        damaged("a lateral back into the chain", (p) => { player(p, "o3").route = { type: "lateral", target: "o2" }; });
        damaged("a lateral on a player off the chain", (p) => { player(p, "o4").route = { type: "lateral", target: "o1" }; });
        damaged("a read on a carrier's lateral", (p) => { player(p, "o5").route = { type: "lateral", target: "o3", catch: [9, 6.5], primary: true }; });
        damaged("a read on the last carrier", (p) => { player(p, "o3").route = { type: "throw", primary: true }; });
        damaged("a pass route on the last carrier", (p) => { player(p, "o3").route = { type: "go" }; });
        damaged("a catch that isn't a point", (p) => { player(p, "o2").route = { type: "lateral", target: "o5", catch: "deep" }; });
        damaged("beside a list of laterals", (p) => { player(p, "o2").laterals = [{ to: "o5" }]; });
        damaged("beside a Pitch", (p) => { player(p, "o1").route = { type: "pitch" }; });
      });
    });

    test("checks a play in today's shape as strictly as before (B6)", () => {
      const thrown = (id: string, c: [number, number]): RawPlay => {
        const p = old(id, { o5: { type: "throw" } });
        return { ...p, players: p.players.map((q) => (q.id === "o2" ? { ...q, laterals: [{ to: "o5", catch: c }] } : q)) };
      };
      // a lateral caught in front of the QB's spot reads back snapped, so it isn't what was stored
      expect(readBackupFile(backup({ plays: [thrown("forward", [20, 2])], playbooks: [], draft: null }))).toEqual({ ok: false, error: "invalidData" });
      expect(readBackupFile(backup({ plays: [thrown("legal", [20, 6])], playbooks: [], draft: null })).ok).toBe(true);
    });
  });

  test("previews and applies merge or replace without changing playbook order", () => {
    const currentStore = memory();
    store(play("same", "Local version"), currentStore);
    store(play("local", "Local only"), currentStore);
    storePlaybook({ id: "local-book", name: "Local", plays: ["local"] }, currentStore);

    const backupStore = memory();
    store(play("same", "Backup version"), backupStore);
    store(play("incoming", "Incoming"), backupStore);
    storePlaybook({ id: "backup-book", name: "Backup", plays: ["incoming", "same"] }, backupStore);
    writeTeam({ name: "Backup team", color: "#445566" }, backupStore);
    const read = readBackupFile(encodeBackupFile(backupStore).json);
    if (!read.ok) throw new Error(read.error);

    const merge = planBackupRestore(read.file, readBackupState(currentStore), "merge");
    expect(merge).toMatchObject({ matchingPlays: 1, currentOnlyPlays: 1, currentOnlyPlaybooks: 1 });
    applyBackupRestore(merge, currentStore);
    expect(Object.keys(readAll(currentStore))).toEqual(["same", "local", "incoming"]);
    expect(readAll(currentStore).same?.name).toBe("Backup version");
    expect(readPlaybooks(currentStore)["backup-book"]?.plays).toEqual(["incoming", "same"]);
    expect(readPlaybooks(currentStore)["local-book"]).toBeDefined();

    const replace = planBackupRestore(read.file, readBackupState(currentStore), "replace");
    applyBackupRestore(replace, currentStore);
    expect(Object.keys(readAll(currentStore))).toEqual(["same", "incoming"]);
    expect(Object.keys(readPlaybooks(currentStore))).toEqual(["backup-book"]);
    expect(readTeam(currentStore).name).toBe("Backup team");
  });

  test("rolls every key back when a restore write fails", () => {
    const target = memory();
    store(play("keep", "Keep"), target);
    storePlaybook({ id: "keep-book", name: "Keep", plays: ["keep"] }, target);
    writeTeam({ name: "Keep team", color: "#112233" }, target);
    writeDraft({ id: "keep", name: "Keep draft", notes: "", players: defaults() }, target);
    const before = new Map(target.data);

    const source = memory();
    store(play("new", "New"), source);
    const read = readBackupFile(encodeBackupFile(source).json);
    if (!read.ok) throw new Error(read.error);
    const plan = planBackupRestore(read.file, readBackupState(target), "replace");
    const flaky: StorageLike = {
      getItem: (key) => target.getItem(key),
      setItem: (key, value) => {
        if (key === TEAM_KEY) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
        target.setItem(key, value);
      },
      removeItem: (key) => { target.removeItem?.(key); },
    };
    expect(() => { applyBackupRestore(plan, flaky); }).toThrow(StorageError);
    expect(target.data).toEqual(before);
    expect(target.data.get(PLAYS_KEY)).toBe(before.get(PLAYS_KEY));
    expect(target.data.get(PLAYBOOKS_KEY)).toBe(before.get(PLAYBOOKS_KEY));
    expect(target.data.get(TEAM_KEY)).toBe(before.get(TEAM_KEY));
    expect(target.data.get(DRAFT_KEY)).toBe(before.get(DRAFT_KEY));
  });
});
