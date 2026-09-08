import { pill } from "./ui";

interface Props {
  message: string;
  onRetry: () => void;
  onDownload: () => void;
}

/** Shown under the play tiles after a save that didn't land: the work is still here, and there are two ways out. */
export function SaveFailure({ message, onRetry, onDownload }: Props) {
  return (
    <div role="alert" className="flex flex-none flex-col gap-2 rounded-note border-2 border-ink bg-yellow px-[10px] py-2 text-base leading-note">
      <span>{message}</span>
      <span className="text-caption text-ink-muted">Your play is still here. Free up space or download it as a file you can import later.</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onRetry} className={`${pill} px-3 py-1 text-small`}>Try again</button>
        <button type="button" onClick={onDownload} className={`${pill} px-3 py-1 text-small`}>Download play</button>
      </div>
    </div>
  );
}
