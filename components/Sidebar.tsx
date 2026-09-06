import type { ReactNode } from "react";

interface Props {
  id: string;
  side: "left" | "right";
  open: boolean;
  label: string;
  children: ReactNode;
}

/**
 * 264px panel that animates its width to 0 when closed. Both sidebars start
 * closed — on every screen size — so the app opens on an uncluttered field and
 * the first paint never slides.
 */
export function Sidebar({ id, side, open, label, children }: Props) {
  const width = open ? (side === "left" ? "w-[266px] border-r-2" : "w-[266px] border-l-2") : "w-0";
  return (
    <aside
      id={id}
      aria-label={label}
      aria-hidden={!open}
      className={`flex-none overflow-hidden border-ink bg-cream transition-[width] duration-[180ms] ease-in-out motion-reduce:transition-none ${width}`}
    >
      <div className="flex h-full w-[264px] flex-col gap-[10px] overflow-y-auto px-3 py-3.5" inert={!open}>
        {children}
      </div>
    </aside>
  );
}
