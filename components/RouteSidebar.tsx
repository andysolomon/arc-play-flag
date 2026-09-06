"use client";

import Image from "next/image";
import { memo, useRef, type ChangeEvent } from "react";
import { DEFENSE_KEYS, PASS_KEYS, RUN_KEYS, mirrorable, tableFor } from "@/lib/play/routes";
import { teamFill } from "@/lib/play/geometry";
import type { Player, RouteType } from "@/lib/play/types";
import { Note } from "./Hint";
import { IconTile } from "./IconTile";
import { eyebrow, pill, tileGrid } from "./ui";

interface Props {
  selected: Player | null;
  hint: string | null;
  onPick: (key: RouteType) => void;
  onDone: () => void;
  onPrimary: () => void;
  onMirror: () => void;
  onRename: (id: string, label: string, commit: boolean) => void;
}

function RouteSidebarImpl({ selected: sel, hint, onPick, onDone, onPrimary, onMirror, onRename }: Props) {
  // one history entry per rename session, not per keystroke
  const renaming = useRef<string | null>(null);
  // offense splits into the passing tree and the run game; defense is one list
  const keys: readonly RouteType[] = sel?.team === "offense" ? PASS_KEYS : DEFENSE_KEYS;
  const runKeys: readonly RouteType[] = sel?.team === "offense" ? RUN_KEYS : [];
  const suffix = sel?.team === "offense" ? "Off" : "Def";
  const canPrimary = !!(sel && sel.team === "offense" && sel.route);
  const canMirror = mirrorable(sel);
  const primaryOn = !!sel?.route?.primary;

  return (
    <>
      <span className={eyebrow}>ROUTES</span>
      {!sel && (
        <div className="flex flex-none flex-col items-center gap-[10px] rounded-tile border-2 border-dashed border-ink px-[10px] py-[18px]">
          <Image src="/icons/football.png" alt="" width={56} height={56} sizes="56px" className="block opacity-75" />
          <span className="text-center text-base leading-body text-ink-muted">
            Tap a player to give them a route.
            <br />
            Drag to move them.
          </span>
        </div>
      )}
      {sel && (
        <>
          <div className="flex flex-none items-center gap-[10px]">
            <span
              aria-hidden
              className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border-[2.5px] border-ink text-small"
              style={{ background: teamFill(sel.team) }}
            >
              {sel.label}
            </span>
            <h2 className="flex-1 text-title font-normal leading-tight">
              {sel.team === "offense" ? "Pick a route" : "Pick a coverage"}
            </h2>
            <input
              value={sel.label}
              maxLength={3}
              placeholder="Tag"
              aria-label="Player tag"
              title="Player tag (up to 3 letters)"
              onFocus={() => { renaming.current = null; }}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const commit = renaming.current !== sel.id;
                renaming.current = sel.id;
                onRename(sel.id, e.target.value, commit);
              }}
              className="w-[58px] flex-none rounded-pill border-2 border-ink bg-white px-2 py-1 text-center text-small text-ink"
            />
          </div>
          <div className={tileGrid} role="group" aria-label={sel.team === "offense" ? "Routes" : "Coverages"}>
            {keys.map((k) => (
              <IconTile
                key={k}
                icon={k === "custom" ? `custom${suffix}` : k}
                label={tableFor(sel.team)[k]?.label ?? k}
                active={sel.route?.type === k}
                onClick={() => { onPick(k); }}
              />
            ))}
            {runKeys.length === 0 && <IconTile icon={`deselect${suffix}`} label="Done" onClick={onDone} />}
          </div>
          {runKeys.length > 0 && (
            <>
              <span className={eyebrow}>RUN</span>
              <div className={tileGrid} role="group" aria-label="Runs">
                {runKeys.map((k) => (
                  <IconTile
                    key={k}
                    icon={k}
                    label={tableFor(sel.team)[k]?.label ?? k}
                    active={sel.route?.type === k}
                    onClick={() => { onPick(k); }}
                  />
                ))}
                <IconTile icon={`deselect${suffix}`} label="Done" onClick={onDone} />
              </div>
            </>
          )}
          {(canPrimary || canMirror) && (
            <div className="flex flex-none flex-wrap gap-1.5">
              {canPrimary && (
                <button
                  type="button"
                  onClick={onPrimary}
                  title="Colour this as the primary read"
                  aria-pressed={primaryOn}
                  data-active={primaryOn}
                  className={`${pill} px-3 py-1 text-small data-[active=true]:bg-rose-soft`}
                >
                  {primaryOn ? "★ Primary read" : "☆ Mark primary"}
                </button>
              )}
              {canMirror && (
                <button type="button" onClick={onMirror} title="Mirror this route left/right" className={`${pill} px-3 py-1 text-small`}>
                  ⇄ Mirror route
                </button>
              )}
            </div>
          )}
        </>
      )}
      {hint && <Note text={hint} />}
    </>
  );
}

export const RouteSidebar = memo(RouteSidebarImpl);
