import { spawn } from "node:child_process";
import { CAPTION_BAND, VIDEO_SIZE, ZOOM } from "./media";

/**
 * Whether a fresh take of a chapter shows what its published clip shows. Two takes of the same UI
 * never match frame for frame: a beat lands a little earlier or later, a drag's touch dot is a few
 * pixels along, a scroll is caught mid-way, an image paints a frame late, and the published clip
 * went through a lossy encoder on another machine. A UI change is different: it stays put on screen
 * for as long as the screen it is on. So the takes are paired frame by frame in order, and a clip
 * differs only where one region of the app stays different for TOLERANCE.seconds of both clips.
 *
 * The caption band is left out: the recorder draws it with the machine's own sans-serif, and the
 * captions themselves are checked against the manifest by every recording.
 */
export const TOLERANCE = {
  /** a pixel differs when its grey level moves by more than this, out of 255 */
  pixelDelta: 24,
  /** for this long in both clips */
  seconds: 0.7,
  /** in more than this share of one block of the app */
  blockShare: 0.15,
} as const;

const SCALE = 4;
const BLOCK = 16;
const BAND = CAPTION_BAND * ZOOM;
/** whole sample rows only: the app area is cropped to a multiple of SCALE, so every decoded frame is the same size */
const SAMPLE = { width: VIDEO_SIZE.width / SCALE, height: Math.floor((VIDEO_SIZE.height - BAND) / SCALE) };

/** A clip's app area, a quarter size and grey: a control, a label or a line still shows; codec noise mostly does not. */
export type Frames = readonly Uint8Array[];

export async function decodeFrames(path: string, filter?: string): Promise<Frames> {
  const sample = `crop=${String(VIDEO_SIZE.width)}:${String(SAMPLE.height * SCALE)}:0:${String(BAND)},scale=${String(SAMPLE.width)}:${String(SAMPLE.height)}:flags=area,format=gray`;
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", path, "-an", "-vf", filter ? `${filter},${sample}` : sample, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { reject(new Error(`decoding ${path}: could not start ffmpeg: ${error.message}`)); });
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`decoding ${path}: ffmpeg exited ${String(code)}: ${stderr.trim().slice(-600)}`));
    });
  });
  const size = SAMPLE.width * SAMPLE.height;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + size <= bytes.length; at += size) frames.push(bytes.subarray(at, at + size));
  if (!frames.length) throw new Error(`decoding ${path}: no frames`);
  return frames;
}

function differing(a: Uint8Array, b: Uint8Array): Uint8Array {
  const mask = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) mask[i] = Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > TOLERANCE.pixelDelta ? 1 : 0;
  return mask;
}

function share(mask: Uint8Array): number {
  let count = 0;
  for (const bit of mask) count += bit;
  return count / mask.length;
}

/**
 * Pairs every frame of the take with a frame of the published clip, in order, at the least total
 * difference (dynamic time warping), so a beat that lands later in one is compared with the same
 * beat in the other. Pairs stay within `band` frames of the proportional diagonal.
 */
function align(take: Frames, published: Frames, band: number): Array<readonly [number, number]> {
  const n = take.length;
  const m = published.length;
  const cost = new Float64Array(n * m).fill(Number.POSITIVE_INFINITY);
  const cell = (i: number, j: number) => (i < 0 || j < 0 ? Number.POSITIVE_INFINITY : cost[i * m + j] ?? Number.POSITIVE_INFINITY);
  for (let i = 0; i < n; i += 1) {
    const centre = Math.round((i * (m - 1)) / Math.max(1, n - 1));
    for (let j = Math.max(0, centre - band); j <= Math.min(m - 1, centre + band); j += 1) {
      const before = i === 0 && j === 0 ? 0 : Math.min(cell(i - 1, j), cell(i, j - 1), cell(i - 1, j - 1));
      cost[i * m + j] = before + share(differing(take[i] as Uint8Array, published[j] as Uint8Array));
    }
  }
  const path: Array<readonly [number, number]> = [];
  let i = n - 1;
  let j = m - 1;
  for (;;) {
    path.push([i, j]);
    if (i === 0 && j === 0) break;
    const steps: Array<readonly [number, number]> = [[i - 1, j - 1], [i - 1, j], [i, j - 1]];
    [i, j] = steps.reduce((best, step) => (cell(step[0], step[1]) < cell(best[0], best[1]) ? step : best));
  }
  return path.reverse();
}

export interface ClipComparison {
  /** the largest share of one block that stayed different for TOLERANCE.seconds */
  worst: number;
  /** where that was: the frame of each take, and the block's corner in the clip's pixels */
  takeFrame: number;
  publishedFrame: number;
  block: { x: number; y: number };
}

export const differs = (comparison: ClipComparison): boolean => comparison.worst > TOLERANCE.blockShare;

/**
 * A pixel counts once it has differed for TOLERANCE.seconds of both clips. One take can hold a
 * passing state (a drawer just after a tap) longer than the other, and the pairing then repeats a
 * frame of the shorter one; counted in one clip only, that would pass for a change that stays put.
 */
export function compareClips(take: Frames, published: Frames, fps: number): ClipComparison {
  const run = Math.max(1, Math.round(TOLERANCE.seconds * fps));
  const pixels = SAMPLE.width * SAMPLE.height;
  const since = { take: new Int32Array(pixels).fill(-1), published: new Int32Array(pixels).fill(-1) };
  let found: ClipComparison = { worst: 0, takeFrame: 0, publishedFrame: 0, block: { x: 0, y: 0 } };
  for (const [i, j] of align(take, published, Math.round(3 * fps))) {
    const mask = differing(take[i] as Uint8Array, published[j] as Uint8Array);
    for (let p = 0; p < pixels; p += 1) {
      if (!mask[p]) { since.take[p] = -1; since.published[p] = -1; } else if (since.take[p] === -1) { since.take[p] = i; since.published[p] = j; }
    }
    const held = (p: number) => (since.take[p] ?? -1) >= 0 && i - (since.take[p] ?? 0) + 1 >= run && j - (since.published[p] ?? 0) + 1 >= run;
    for (let by = 0; by < SAMPLE.height; by += BLOCK) {
      for (let bx = 0; bx < SAMPLE.width; bx += BLOCK) {
        let count = 0;
        let size = 0;
        for (let y = by; y < Math.min(SAMPLE.height, by + BLOCK); y += 1) {
          for (let x = bx; x < Math.min(SAMPLE.width, bx + BLOCK); x += 1) {
            size += 1;
            if (held(y * SAMPLE.width + x)) count += 1;
          }
        }
        if (count / size > found.worst) found = { worst: count / size, takeFrame: i, publishedFrame: j, block: { x: bx * SCALE, y: BAND + by * SCALE } };
      }
    }
  }
  return found;
}

/** The take's frame, the published frame and their difference side by side, the block that differs boxed in red. */
export async function sideBySide(take: { path: string; filter: string; frame: number }, published: { path: string; frame: number }, comparison: ClipComparison, out: string): Promise<void> {
  const size = BLOCK * SCALE;
  const box = `drawbox=x=${String(comparison.block.x)}:y=${String(comparison.block.y)}:w=${String(size)}:h=${String(size)}:color=red:t=3`;
  const graph = [
    `[0:v]${take.filter},select=eq(n\\,${String(take.frame)}),format=rgb24,split[t][td]`,
    `[1:v]select=eq(n\\,${String(published.frame)}),format=rgb24,split[p][pd]`,
    "[td][pd]blend=all_mode=difference,eq=contrast=3[d]",
    `[t]${box}[tb]`, `[p]${box}[pb]`, `[d]${box}[db]`,
    "[tb][pb][db]hstack=inputs=3",
  ].join(";");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-y", "-i", take.path, "-i", published.path, "-filter_complex", graph, "-frames:v", "1", out], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => { if (code === 0) resolve(); else reject(new Error(`writing ${out}: ffmpeg exited ${String(code)}: ${stderr.trim().slice(-600)}`)); });
  });
}
