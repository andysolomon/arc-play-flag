import { CAPTION_BAND, ZOOM } from "./media";

/**
 * The page the recorder films: a caption band it owns across the top, and the app in a
 * same-origin iframe under it. Nothing the recorder draws is ever inside the app's document,
 * so a caption can never cover a toast, a control or a dialog, and the app's own top layer
 * (a modal dialog) can never cover a caption. The page also draws the touch: a dot where a
 * beat taps or drags, with a ripple on the tap, so a viewer on a phone can see what was
 * pressed; and a cover in the app's paper colour while a chapter navigates, so a clip never
 * shows a blank or half-laid-out page.
 *
 * The band, the app's frame and the cover are zoomed by ZOOM: the page is the video's size, and
 * the app inside its frame lays out at a phone's width and renders at 1.5× (see ./media.ts).
 * The touch and the ripple are drawn in the page's own pixels.
 */
export const HARNESS_PATH = "/__demo__";

/** The harness's own ink and paper, matching the app's (app/globals.css). */
const INK = "#1b1a17";
const PAPER = "#f4efe2";
const CREAM = "#fffdf6";
const YELLOW = "#f0b429";

export const HARNESS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo recorder</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: ${INK}; }
  #band {
    zoom: ${String(ZOOM)}; position: fixed; left: 0; top: 0; width: 100%; height: ${String(CAPTION_BAND)}px; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center; padding: 0 12px;
    background: ${INK}; color: ${CREAM}; text-align: center; text-wrap: balance;
    font: 700 16px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif;
  }
  iframe {
    zoom: ${String(ZOOM)}; position: fixed; left: 0; top: ${String(CAPTION_BAND)}px; width: 100%; height: calc(100% - ${String(CAPTION_BAND)}px);
    border: 0; background: ${PAPER};
  }
  #cover { zoom: ${String(ZOOM)}; position: fixed; left: 0; right: 0; top: ${String(CAPTION_BAND)}px; bottom: 0; background: ${PAPER}; display: none; }
  #touch, .ripple {
    position: fixed; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%;
    pointer-events: none; z-index: 9;
  }
  #touch { display: none; background: rgba(240, 180, 41, 0.6); border: 2.5px solid ${INK}; box-sizing: border-box; }
  .ripple { border: 3px solid ${YELLOW}; box-sizing: border-box; animation: ripple 0.45s ease-out forwards; }
  @keyframes ripple { from { transform: scale(1); opacity: 0.95; } to { transform: scale(2.4); opacity: 0; } }
</style>
</head>
<body>
<div id="band" aria-live="polite"></div>
<iframe name="app" title="The app" src="about:blank" allow="clipboard-read; clipboard-write"></iframe>
<div id="cover"></div>
<div id="touch"></div>
<script>
  const band = document.getElementById("band");
  const cover = document.getElementById("cover");
  const touch = document.getElementById("touch");
  const place = (x, y) => { touch.style.left = x + "px"; touch.style.top = y + "px"; };
  window.__demo = {
    caption(text) { band.textContent = text; },
    cover(on) { cover.style.display = on ? "block" : "none"; },
    /** the finger comes down here and stays (a drag), or lands and lifts (a tap: the ripple) */
    touch(phase, x, y) {
      if (phase === "down") { place(x, y); touch.style.display = "block"; return; }
      if (phase === "move") { place(x, y); return; }
      if (phase === "up") { touch.style.display = "none"; return; }
      place(x, y);
      touch.style.display = "block";
      const ripple = document.createElement("div");
      ripple.className = "ripple";
      ripple.style.left = x + "px";
      ripple.style.top = y + "px";
      document.body.append(ripple);
      ripple.addEventListener("animationend", () => { ripple.remove(); });
      setTimeout(() => { touch.style.display = "none"; }, 220);
    },
  };
</script>
</body>
</html>
`;
