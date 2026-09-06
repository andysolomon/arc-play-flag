import { callOf } from "@/lib/play/call";
import { ballAt, buildMotion, HOLD, positionsAt, SPEED, type Motion } from "@/lib/play/motion";
import { kebab } from "@/lib/play/storage";
import { CARD_H, CARD_W, cardField, cardSvg, type CardOptions } from "./card";
import { download, ensureFont, rasterise } from "./raster";

export const STILL_SECONDS = 1.5;
const FPS = 24;
// Phone-sized portrait keeps software recording responsive on tablets.
const VIDEO_W = CARD_W * 2 / 3;
const VIDEO_H = CARD_H * 2 / 3;

/** 0.5 chooses play-action for an unmarked mixed call and always selects a primary pass. */
export function clipMotion(o: CardOptions): Motion {
  const call = callOf(o.players);
  const m = buildMotion(o.players, cardField(o.players).top, () => call === "run" ? 0 : 0.5);
  // Unlike live playback's five-second cap, a clip lets every route finish.
  const end = Math.max(m.dur - HOLD, ...Object.values(m.tracks).map((t) => t.wait + t.len / SPEED));
  return { ...m, dur: end + HOLD };
}

export function clipTime(m: Motion, elapsed: number): number {
  return Math.max(0, Math.min(m.dur - HOLD, elapsed - STILL_SECONDS));
}

/** Use a browser-supported container, falling back to the recorder's own default. */
export function recordingType(supports: (type: string) => boolean): string | undefined {
  return ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm", "video/mp4"].find(supports);
}

export function clipExtension(type: string): string {
  if (type.startsWith("video/mp4")) return "mp4";
  if (type.startsWith("video/webm")) return "webm";
  throw new Error("This browser did not produce a WebM or MP4 clip.");
}

async function footballData(signal?: AbortSignal): Promise<string> {
  const response = await fetch("/icons/football.png", { signal });
  if (!response.ok) throw new Error("The football sticker could not be loaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return "data:image/png;base64," + btoa(binary);
}

/** Records a self-contained 4:5 card in real time; no encoder or server dependency. */
export async function exportVideo(o: CardOptions, signal?: AbortSignal): Promise<void> {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new Error("Video export is unavailable in this browser. Try a current Chrome, Firefox, Edge or Safari.");
  }
  signal?.throwIfAborted();
  await ensureFont();
  const footballHref = await footballData(signal);
  const m = clipMotion(o);
  const runSeconds = m.dur - HOLD;
  const frame = (elapsed: number): string => {
    const t = clipTime(m, elapsed);
    const positions = positionsAt(m, o.players, t);
    return cardSvg(o, { positions, ball: ballAt(m, positions, t), footballHref }).svg;
  };
  const canvas = await rasterise(frame(0), VIDEO_W, VIDEO_H);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas.");
  signal?.throwIfAborted();
  const stream = canvas.captureStream(FPS);
  let recorder: MediaRecorder | undefined;
  const cancel = (): void => { if (recorder?.state === "recording") recorder.stop(); };
  // Background tabs throttle frames; fail explicitly instead of saving a truncated run.
  let hidden = document.hidden;
  const visibility = (): void => { if (document.hidden) { hidden = true; cancel(); } };
  signal?.addEventListener("abort", cancel, { once: true });
  document.addEventListener("visibilitychange", visibility);
  try {
    if (hidden) throw new Error("Keep this tab visible while recording a clip.");
    const mimeType = recordingType((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    // Resolve errors as values so a recorder failure cannot cause an unhandled rejection mid-frame.
    const finished = new Promise<Blob | Error>((resolve) => {
      recorder?.addEventListener("dataavailable", (event: BlobEvent) => { if (event.data.size) chunks.push(event.data); });
      recorder?.addEventListener("error", () => { resolve(new Error("The browser could not record this clip.")); });
      recorder?.addEventListener("stop", () => {
        resolve(new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type || "" }));
      });
    });
    recorder.start();
    const check = (): void => {
      signal?.throwIfAborted();
      if (hidden) throw new Error("Recording stopped because the tab was hidden. Keep it visible and try again.");
      if (recorder?.state !== "recording") throw new Error("The browser stopped recording. Please try again.");
    };
    const tick = (): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, 1000 / FPS); });
    const capture = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    const draw = (image: HTMLCanvasElement): void => {
      ctx.drawImage(image, 0, 0);
      // Explicitly request still frames where supported as well as automatic capture.
      capture?.requestFrame?.();
    };
    const hold = async (image: HTMLCanvasElement): Promise<void> => {
      const start = performance.now();
      do {
        check();
        draw(image);
        await tick();
      } while (performance.now() - start < STILL_SECONDS * 1000);
    };
    // Cache the stills, and time the final hold only AFTER its frame has been drawn.
    // A slow SVG decode or a busy device must never skip the completion of the play.
    const formation = await rasterise(frame(0), VIDEO_W, VIDEO_H);
    await hold(formation);
    const start = performance.now();
    while ((performance.now() - start) / 1000 < runSeconds) {
      check();
      const t = (performance.now() - start) / 1000;
      const image = await rasterise(frame(STILL_SECONDS + t), VIDEO_W, VIDEO_H);
      check();
      draw(image);
      await tick();
    }
    const final = await rasterise(frame(STILL_SECONDS + runSeconds), VIDEO_W, VIDEO_H);
    await hold(final);
    check();
    recorder.stop();
    const result = await finished;
    signal?.throwIfAborted();
    if (result instanceof Error) throw result;
    if (!result.size) throw new Error("The browser recorded an empty clip. Please try again.");
    download(result, kebab(o.name) + "." + clipExtension(result.type));
  } finally {
    signal?.removeEventListener("abort", cancel);
    document.removeEventListener("visibilitychange", visibility);
    cancel();
    for (const track of stream.getTracks()) track.stop();
  }
}
