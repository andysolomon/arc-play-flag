import Link from "next/link";
import { Sticker } from "./Sticker";
import { tile } from "./ui";

interface Props {
  icon: string;
  label: string;
  active?: boolean;
  /** a small yellow dot in the corner: this tile has something in it */
  dot?: boolean;
  title?: string;
  onClick: () => void;
}

/** Square-ish sticker + label tile, laid out 3-up in a grid. */
export function IconTile({ icon, label, active = false, dot = false, title, onClick }: Props) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active} data-active={active} className={`relative ${tile}`}>
      {dot && <span aria-hidden className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink bg-yellow" />}
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
