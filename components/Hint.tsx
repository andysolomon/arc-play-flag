/** Ink pill that floats centred under the header with a one-line instruction. */
export function Hint({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 top-[58px] z-[15] -translate-x-1/2 whitespace-nowrap rounded-pill bg-ink px-4 py-1.5 text-base text-cream shadow-toast"
    >
      {text}
    </div>
  );
}

/** Yellow sticky note used for the same hint inside the Routes panel. */
export function Note({ text }: { text: string }) {
  return (
    <span className="flex-none rounded-note border-2 border-ink bg-yellow px-[10px] py-1.5 text-base leading-note">{text}</span>
  );
}
