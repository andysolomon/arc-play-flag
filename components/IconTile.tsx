import Link from "next/link";
import type { Ref } from "react";
import { Sticker } from "./Sticker";
import { tile } from "./ui";

interface Props {
  icon: string;
  label: string;
  active?: boolean;
  /** a small yellow dot in the corner: this tile has something in it */
  dot?: boolean;
  title?: string;
  /** hatched like the field's no-run band: this choice is flagged where the ball is */
  hatched?: boolean;
  /** the id of the words that say why it is marked */
  describedBy?: string;
  /**
   * This tile drops a menu down instead of being pressed: the id of the open menu, or "closed".
   * The tile then says it has a menu and whether it is open, and wears a chevron in the corner.
   */
  menu?: string;
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
}

/** Square-ish sticker + label tile, laid out 3-up in a grid. */
export function IconTile({ icon, label, active = false, dot = false, title, hatched = false, describedBy, menu, ref, onClick }: Props) {
  const open = menu !== undefined && menu !== "closed";
  const popup = menu === undefined ? {} : { "aria-haspopup": "menu" as const, "aria-expanded": open, "aria-controls": open ? menu : undefined };
  return (
    <button
      ref={ref}
      type="button" onClick={onClick} title={title} aria-pressed={menu === undefined ? active : undefined} aria-describedby={describedBy}
      {...popup} data-active={active || open}
      data-hatched={hatched || undefined} className={`relative ${tile} ${hatched ? "hatched" : ""}`}
    >
      {dot && <span aria-hidden className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink bg-yellow" />}
      {menu !== undefined && (
        <svg
          aria-hidden viewBox="0 0 16 16" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round"
          className={`absolute right-1 top-1 h-4 w-4 fill-none stroke-current transition-transform duration-[120ms] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      )}
      <Sticker icon={icon} size={40} />
      <span className="text-center text-caption leading-tight">{label}</span>
    </button>
  );
}

interface LinkProps {
  icon: string;
  label: string;
  href: string;
  title?: string;
}

/** The same tile as a link to another screen. */
export function LinkTile({ icon, label, href, title }: LinkProps) {
  return (
    <Link href={href} title={title} className={`${tile} !text-ink no-underline`}>
      <Sticker icon={icon} size={40} />
      <span className="text-center text-caption leading-tight">{label}</span>
    </Link>
  );
}
