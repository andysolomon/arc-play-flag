# Validation summary

Production build, full ESLint, TypeScript and the Bun suite passed: **339 passed, 7 skipped, 0 failed**. The skipped tests require real Redis.

Browser checks: **76 passed** across the new header, header Save, history and playbook switching journeys. After final header refinements, **32 passed** across header editing and header Save on desktop, Pixel 7, iPhone 15 and iPad Chromium projects. Screenshots and JSON evidence are produced by the journeys and retained as CI artifacts.

Demo validation used FFmpeg/ffprobe 6.1.1 and Playwright 1.63.0. An isolated first-play capture passed at 12 seconds. Both full sets passed feature/caption coverage, 6–12 second duration, 576×720 resolution, silent VP9/H.264 formats and the 2 MB aggregate limit. Set A was 1,880,468 bytes; set B was 1,900,655 bytes. The published media is the complete set A.

| Set | Chapter | Duration | Checks |
| --- | --- | --- | --- |
| A | first-play | 12.0s | Passed |
| A | roster | 11.0s | Passed |
| A | league-rules | 10.0s | Passed |
| A | run-game | 12.0s | Passed |
| A | defense | 11.0s | Passed |
| A | game-day | 11.0s | Passed |
| A | wristbands | 11.0s | Passed |
| A | share | 9.0s | Passed |
| A | touchdown | 11.0s | Passed |
| A | trick-plays | 10.0s | Passed |
| B | first-play | 12.0s | Passed |
| B | roster | 11.0s | Passed |
| B | league-rules | 10.0s | Passed |
| B | run-game | 12.0s | Passed |
| B | defense | 11.0s | Passed |
| B | game-day | 11.0s | Passed |
| B | wristbands | 11.0s | Passed |
| B | share | 9.0s | Passed |
| B | touchdown | 11.0s | Passed |
| B | trick-plays | 10.0s | Passed |
