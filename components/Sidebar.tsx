import type { ReactNode } from "react";

interface Props {
  id: string;
  side: "left" | "right";
  open: boolean;
  label: string;
  /**
   * Phone and tablet: the panel floats over the field instead of squeezing it.
   * Desktop keeps the in-flow width animation.
   */
  overlay?: boolean;
  children: ReactNode;
}

/**
 * 264px panel. On desktop it animates its width to 0 when closed. On phone and
 * tablet it overlays the field as a drawer so the full panel stays tappable —
 * both sidebars open at once used to clip the right edge on iPad.
 *
 * Closed overlay drawers translate fully off-canvas with no border or shadow, so
 * the default view stays a clear field.
 */
export function Sidebar({ id, side, open, label, overlay = false, children }: Props) {
  if (overlay) {
    const edge = side === "left" ? "left-0" : "right-0";
    const openChrome = side === "left" ? "translate-x-0 border-r-2 border-ink shadow-tile" : "translate-x-0 border-l-2 border-ink shadow-tile";
    const closedChrome = side === "left" ? "-translate-x-full pointer-events-none" : "translate-x-full pointer-events-none";
    return (
      <aside
        id={id}
        aria-label={label}
        aria-hidden={!open}
        data-open={open}
        className={
          `absolute top-0 bottom-0 z-30 flex w-[min(266px,85vw)] touch-manipulation flex-col bg-cream ` +
          `transition-transform duration-[180ms] ease-in-out motion-reduce:transition-none ` +
          `${edge} ${open ? openChrome : closedChrome}`
        }
      >
        <div
          className="flex h-full min-h-0 w-full flex-col gap-[10px] overflow-y-auto overscroll-contain px-3 py-3.5 [-webkit-overflow-scrolling:touch]"
          inert={!open}
        >
          {children}
        </div>
      </aside>
    );
  }

  const width = open ? (side === "left" ? "w-[266px] border-r-2" : "w-[266px] border-l-2") : "w-0";
  return (
    <aside
      id={id}
      aria-label={label}
      aria-hidden={!open}
      data-open={open}
      className={`flex-none overflow-hidden border-ink bg-cream transition-[width] duration-[180ms] ease-in-out motion-reduce:transition-none ${width}`}
    >
      <div className="flex h-full w-[264px] flex-col gap-[10px] overflow-y-auto px-3 py-3.5" inert={!open}>
        {children}
      </div>
    </aside>
  );
}
