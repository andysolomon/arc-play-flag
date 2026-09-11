import { describe, expect, test } from "bun:test";
import { MAX_SET_BYTES, deliveryProblems, parseProbe, setProblem, type Probe } from "./media";

const video = (codec: string, duration: string, extra: Partial<Probe> = {}): Probe => ({
  streams: [{ codec_type: "video", codec_name: codec, width: 960, height: 540 }],
  format: { duration, size: "80000" },
  ...extra,
});

describe("Demo asset contract", () => {
  test("accepts silent 960x540 clips between six and twelve seconds and a webp poster", () => {
    expect(deliveryProblems("webm", video("vp9", "9.125"), 87_000)).toEqual([]);
    expect(deliveryProblems("mp4", video("h264", "6.000000"), 120_000)).toEqual([]);
    expect(deliveryProblems("mp4", video("h264", "12.000000"), 120_000)).toEqual([]);
    expect(deliveryProblems("poster", { streams: [{ codec_type: "video", codec_name: "webp", width: 960, height: 540 }] }, 26_000)).toEqual([]);
  });

  test("names every way a clip misses the contract", () => {
    const wrong: Probe = {
      streams: [
        { codec_type: "video", codec_name: "vp8", width: 1280, height: 720 },
        { codec_type: "audio", codec_name: "opus" },
      ],
      format: { duration: "13.4" },
    };
    expect(deliveryProblems("webm", wrong, 500)).toEqual([
      "must be silent and video-only, found audio stream(s)",
      "expected 960x540, found 1280x720",
      "expected vp9 video, found vp8",
      "duration 13.40s is outside the 6–12 second contract",
      "file is only 500 bytes",
    ]);
    expect(deliveryProblems("mp4", video("h264", "5.99"), 90_000)).toEqual(["duration 5.99s is outside the 6–12 second contract"]);
    expect(deliveryProblems("mp4", { streams: [], format: {} }, 90_000)).toEqual([
      "expected exactly one video stream, found 0",
      "duration is unreadable",
    ]);
    expect(deliveryProblems("poster", { streams: [{ codec_type: "video", codec_name: "png", width: 960, height: 540 }] }, 26_000)).toEqual(["expected webp video, found png"]);
  });

  test("reads ffprobe JSON and refuses anything else", () => {
    expect(parseProbe('{"streams":[],"format":{"duration":"7.0"}}')).toEqual({ streams: [], format: { duration: "7.0" } });
    expect(() => parseProbe("not json")).toThrow("ffprobe output is not JSON");
    expect(() => parseProbe("null")).toThrow("ffprobe output is not an object");
  });

  test("keeps the complete set under the tour's budget with an actionable message", () => {
    expect(setProblem(MAX_SET_BYTES - 1)).toBeNull();
    expect(setProblem(MAX_SET_BYTES)).toContain("shorten a chapter or raise the encoding CRF");
  });
});
