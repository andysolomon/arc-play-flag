import type { ReactNode } from "react";

export type Open = boolean | "auto";

interface Props {
  id: string;
  side: "left" | "right";
  open: Open;
  label: string;
  children: ReactNode;
}

/**
 * 264px panel that animates its width to 0 when closed. "auto" is the
 * pre-hydration state: open on wide screens, closed on narrow ones, decided in CSS
 * so the first paint never slides.
 */
export function Sidebar({ id, side, open, label, children }: Props) {
  const border = side === "left" ? "border-r-2" : "border-l-2";
  const width =
    open === "auto"
      ? side === "left" ? `w-0 min-[900px]:w-[266px] min-[900px]:${border}` : "w-0"
      : open ? `w-[266px] ${border}` : "w-0";
  return (
    <aside
      id={id}
      aria-label={label}
      aria-hidden={open === false}
      className={`flex-none overflow-hidden border-ink bg-cream transition-[width] duration-[180ms] ease-in-out motion-reduce:transition-none ${width}`}
    >
      <div className="flex h-full w-[264px] flex-col gap-[10px] overflow-y-auto px-3 py-3.5" inert={open === false}>
        {children}
      </div>
    </aside>
  );
}
