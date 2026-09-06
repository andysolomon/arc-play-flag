import Image from "next/image";
import { tile } from "./ui";

interface Props {
  icon: string;
  label: string;
  active?: boolean;
  title?: string;
  onClick: () => void;
}

/** Square-ish sticker + label tile, laid out 3-up in a grid. */
export function IconTile({ icon, label, active = false, title, onClick }: Props) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active} data-active={active} className={tile}>
      <Image src={`/icons/${icon}.png`} alt="" width={40} height={40} sizes="40px" className="block" />
      <span className="text-center text-caption leading-tight">{label}</span>
    </button>
  );
}
