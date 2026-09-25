import { describe, expect, test } from "bun:test";
import { defaults } from "@/lib/play/routes";
import {
  TEAM_KEY, StorageError, readAll, readPlaybooks, readTeam, store, storePlaybook, writeDraft, writeTeam, type StorageLike,
} from "@/lib/play/storage";
import type { SavedPlay } from "@/lib/play/types";
import { applyBackupRestore, encodeBackupFile, planBackupRestore, readBackupFile, readBackupState } from "./backup";

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
  });
});
