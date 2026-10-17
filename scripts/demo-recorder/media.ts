import { DEMO_VIDEO } from "../../components/demo/demos";

/**
 * The Demo asset contract, checked against ffprobe output. Pure functions so the
 * rules can be tested without an encoder: 576×720, silent, 6–12 seconds, real files.
 *
 * The frame is a phone's: the app is recorded in its own phone layout, 384 CSS pixels wide
 * (APP_VIEWPORT) at a device scale of 1.5, under a caption band the recorder draws, so the
 * field fills the width of a clip instead of a strip of a landscape one. The clip is 4:5, the
 * shape a phone-first video is shown at.
 */
export const VIDEO_SIZE = DEMO_VIDEO;
/**
 * The app's own viewport inside the harness, in its CSS pixels: a real phone width, so it lays out
 * as it does on one. The browser's viewport is the video's size; the harness zooms the app's frame
 * by ZOOM, which is what makes 384 into 576. (Chromium's screencast records CSS pixels whatever the
 * device scale, so the zoom is the only way to a crisp 1.5× picture.)
 */
export const APP_VIEWPORT = { width: 384, height: 480 } as const;
export const ZOOM = 1.5;
/** The caption band across the top of the frame, in CSS pixels; the app fills the rest. */
export const CAPTION_BAND = 52;
export const MIN_SECONDS = 6;
export const MAX_SECONDS = 12;
/** Delivery frame rates: 10 for the designer's taps and drawers, 12 where ▶ plays a ball in flight. */
export const FRAME_RATES = [10, 12] as const;
export type FrameRate = (typeof FRAME_RATES)[number];
export const DEFAULT_FPS: FrameRate = 10;
/** anything smaller is a broken encode, not a clip */
export const MIN_FILE_BYTES = 1_000;
/**
 * The complete poster-and-video set for every chapter, as enforced by
 * components/demo/demos.test.ts. The service worker precaches all of it, so this is
 * what an offline install costs. Raised from 1,250,000 when five crammed chapters were
 * split into eight focused ones (issue #36): the same material, told in smaller pieces,
 * at a higher encoding CRF to pay for the extra chapters. Raised again from 1,700,000
 * for nine chapters (issue #107: the field, end zones and slides) rather than raising the
 * CRF further. The phone-shaped frame (576×720 at 10–12 fps) carries ten chapters in less
 * than the landscape frame carried nine, so the budget stays.
 */
export const MAX_SET_BYTES = 2_000_000;

export type DeliveryKind = "webm" | "mp4" | "poster";

export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

export interface Probe {
  streams?: ProbeStream[];
  format?: { duration?: string; size?: string };
}

const EXPECTED_CODEC: Readonly<Record<DeliveryKind, string>> = { webm: "vp9", mp4: "h264", poster: "webp" };

/** Parses `ffprobe -of json` output; anything unreadable is reported, never guessed at. */
export function parseProbe(json: string): Probe {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch (error) {
    throw new Error(`ffprobe output is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("ffprobe output is not an object");
  return parsed;
}

/** Every way a file can miss the contract, in words a reader can act on. */
export function deliveryProblems(kind: DeliveryKind, probe: Probe, bytes: number): string[] {
  const problems: string[] = [];
  const streams = probe.streams ?? [];
  const video = streams.filter((stream) => stream.codec_type === "video");
  const other = streams.filter((stream) => stream.codec_type !== "video");
  if (video.length !== 1) problems.push(`expected exactly one video stream, found ${String(video.length)}`);
  if (other.length) problems.push(`must be silent and video-only, found ${other.map((s) => s.codec_type ?? "unknown").join(", ")} stream(s)`);
  const [stream] = video;
  if (stream) {
    if (stream.width !== VIDEO_SIZE.width || stream.height !== VIDEO_SIZE.height) {
      problems.push(`expected ${String(VIDEO_SIZE.width)}x${String(VIDEO_SIZE.height)}, found ${String(stream.width ?? "?")}x${String(stream.height ?? "?")}`);
    }
    if (stream.codec_name !== EXPECTED_CODEC[kind]) problems.push(`expected ${EXPECTED_CODEC[kind]} video, found ${stream.codec_name ?? "unknown"}`);
  }
  if (kind !== "poster") {
    const duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration)) problems.push("duration is unreadable");
    else if (duration < MIN_SECONDS || duration > MAX_SECONDS) {
      problems.push(`duration ${duration.toFixed(2)}s is outside the ${String(MIN_SECONDS)}–${String(MAX_SECONDS)} second contract`);
    }
  }
  if (bytes <= MIN_FILE_BYTES) problems.push(`file is only ${String(bytes)} bytes`);
  return problems;
}

/** The complete set must fit the budget with room to spare; says what to do when it does not. */
export function setProblem(totalBytes: number): string | null {
  if (totalBytes < MAX_SET_BYTES) return null;
  return `the complete Demo set is ${String(totalBytes)} bytes; shorten a chapter or raise the encoding CRF to stay below ${String(MAX_SET_BYTES)} bytes`;
}
