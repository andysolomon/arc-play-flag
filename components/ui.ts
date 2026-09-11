/** Shared Tailwind class strings for the prototype's three control shapes. */
export const pill =
  "cursor-pointer whitespace-nowrap rounded-pill border-2 border-ink bg-white leading-pill hover:bg-yellow-soft " +
  "disabled:cursor-default disabled:bg-paper-2 disabled:text-ink-faint disabled:hover:bg-paper-2";
/** min 44px tall so header/sidebar pills stay tappable with a thumb on iPhone/iPad */
export const pillSm = `${pill} min-h-11 px-[11px] py-[3px] text-small`;
export const pillMd = `${pill} min-h-11 px-[13px] py-[3px] text-base`;

export const tile =
  "flex min-h-11 cursor-pointer flex-col items-center justify-start gap-1 rounded-tile border-2 border-ink bg-white " +
  "px-1 pb-1.5 pt-2 shadow-tile transition-transform duration-[120ms] hover:-translate-y-0.5 " +
  "data-[active=true]:bg-yellow motion-reduce:transition-none";

export const tileGrid = "grid flex-none grid-cols-3 gap-2";
export const eyebrow = "flex-none text-eyebrow tracking-eyebrow text-ink-muted";
export const divider = "my-1 h-0.5 flex-none bg-divider";
export const input =
  "min-h-11 w-full rounded-pill border-2 border-ink bg-white px-3.5 py-1.5 text-input text-ink placeholder:text-ink-muted";
export const select = "min-h-11 cursor-pointer rounded-pill border-2 border-ink bg-white px-3 py-1.5 text-base";
export const card = "rounded-tile border-2 border-ink bg-white p-3 shadow-tile";
