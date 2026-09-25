import Image from "next/image";

interface Props {
  /** A name from public/icons: the ink sticker is `<icon>.png`, the chalk one `<icon>-dark.png`. */
  icon: string;
  size: number;
  className?: string;
  priority?: boolean;
}

/**
 * A sticker icon, ink on paper in the light theme and chalk on the dark board in the dark one.
 * Both images are in the page and app/globals.css shows the theme's, so the swap needs no script,
 * is right from the first paint, and follows a theme change live. The hidden one is lazy, so only
 * the shown sticker is fetched. Decorative: whatever it sits in carries the label.
 */
export function Sticker({ icon, size, className = "", priority = false }: Props) {
  const shared = { width: size, height: size, sizes: `${String(size)}px`, priority };
  return (
    <>
      <Image src={`/icons/${icon}.png`} alt="" {...shared} className={`sticker sticker-light ${className}`} />
      <Image src={`/icons/${icon}-dark.png`} alt="" {...shared} className={`sticker sticker-dark ${className}`} />
    </>
  );
}
