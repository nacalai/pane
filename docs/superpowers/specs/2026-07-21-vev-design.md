# CREAVID VEV — design

*2026-07-21 · status: approved-by-directive (autonomous build; Nicolai's ask: "enter a webpage and navigate it, send the whole window as NDI — a Creavid version of vingester, make it work")*

## What

**VEV** (norsk: *vev* = web/vevnad) is a local Windows Electron app: type a URL, the page renders
offscreen at broadcast resolution, and the full rendered frame is published as a **real NDI video
source** (`NACALAI (VEV)`). You navigate the page interactively through a live preview in the
control window. It is a modern replacement for rse/vingester (Electron 12-era, GPL, abandoned
`grandiose` NDI addon), built on the proven Creavid NDI stack.

**v1 scope:** ONE page → ONE NDI source. Video + alpha. No NDI audio (Phase 2 — vingester's audio
path requires Web-Audio capture plumbing; the broadcast use case here is HTML graphics/pages into
vMix, which are silent). No multi-instance UI (architecture keeps capture instance-scoped so N
instances are additive later).

## Why this approach (alternatives considered)

1. **CHOSEN — offscreen BrowserWindow (`offscreen: true`) + `paint` events → koffi NDI send, all in
   the main process.** Exact-resolution render independent of monitor; `paint` hands the main
   process a BGRA buffer; NDI accepts BGRA natively (FourCC `0x41524742`) → zero pixel conversion,
   zero renderer→main frame IPC (GJEST's IPC path capped at ~15 fps; VEV has no such hop).
   Transparent pages give real alpha in NDI. Input is injected with `webContents.sendInputEvent`.
2. Visible window + `desktopCapturer`/getDisplayMedia → renderer readback → IPC → NDI. Rejected:
   occlusion/scale coupling, the IPC hop, GPU-readback fragility (GJEST lesson: never
   `importExternalTexture` — and even CPU readback added a whole pipeline we don't need here).
3. Headless Chromium (CDP screencast) + Node NDI sidecar. Rejected: screencast is JPEG (lossy, no
   alpha), input forwarding clunkier, two processes to babysit.

## Architecture

electron-vite + TypeScript strict + React 18 (GJEST's proven skeleton), koffi ^2.9, zod, vitest.

```
src/shared/        types + zod schemas (IPC contract, config) — the only cross-import surface
src/main/
  index.ts         lifecycle, control window, single-instance lock, crash backstops → safe shutdown
  ndi-sender.ts    koffi FFI: send_create/send_video(BGRA)/get_no_connections/find self-check.
                   Adapted from creavid-gjest. DLL missing → status 'no-runtime', app keeps running.
  capture.ts       VevCapture: offscreen BrowserWindow, paint→copy BGRA, paced send loop,
                   preview JPEG (time-gated inside paint), nav events, input injection, recovery
  pacer.ts         pure frame-pacing/stats logic (unit-testable)
  input-map.ts     pure DOM-event→sendInputEvent mapping incl. coord scaling (unit-testable)
  config.ts        userData/config.json, zod-parsed, atomic write, defaults on corrupt
  ipc.ts           typed channels; every payload zod-parsed; returns {ok:true,…}|{ok:false,error}
src/preload/       narrow named bridge only (no generic ipc surface)
src/renderer/      React control UI, VAPOR tokens
resources/         testcard.html (branded internal test pattern), errorcard.html
tools/ndi-probe.js koffi NDI *receiver*: finds "… (VEV)", captures frames, reports res/fps/px —
                   the autonomous end-to-end verification instrument
```

### Video path (the core)

1. Offscreen window at exactly the configured resolution (`force-device-scale-factor=1`,
   zoomFactor 1; on any paint-size mismatch: resize + warn once — correctness over speed).
2. `paint` → `Buffer.from(image.getBitmap())` (getBitmap is zero-copy and only valid this tick →
   we copy ~8 MB; trivial at 30 fps) → `latestFrame`.
3. Send loop `setInterval(1000/fps)` sends `latestFrame` every tick (`clock_video:false`, we pace;
   timecode = INT64_MAX → NDI synthesizes). **Static page ⇒ frame repetition** — the NDI feed
   never starves just because the page stopped painting.
4. Alpha: `transparent: true` on the content window when "transparent bakgrunn" is on; Chromium
   OSR emits premultiplied BGRA, which is NDI's alpha convention — pass through untouched.

### Interaction path

Preview canvas in the control UI captures mouse/wheel/keys → normalized coords over the preload
bridge → main maps via `input-map.ts` → `contents.sendInputEvent`. `cursor-changed` events flow
back so the preview shows the real cursor. URL bar + tilbake/frem/oppdater use
`webContents.navigationHistory`.

### Content window hardening (it loads arbitrary web pages)

`sandbox:true, contextIsolation:true, nodeIntegration:false`, **no preload**, session partition
`persist:vev-content` (logins survive restarts), `setWindowOpenHandler` → deny popup but navigate
the main frame (so target=_blank works), permission requests denied (cam/mic/geo),
`setAudioMuted(true)` by default (offscreen pages still play sound to the speakers!) with a
"lyd på maskinen" toggle. http(s) + internal pages only in the URL bar.

### Unhappy paths (in scope, v1)

- `did-fail-load` → internal errorcard on air (shows URL + error, so NDI shows something sane) +
  banner with retry in UI.
- `render-process-gone` → auto-reload, max 3 attempts with backoff → errorcard + banner.
- `unresponsive`/`responsive` → banner + "tving omstart".
- NDI runtime DLL missing / init fails → banner («NDI runtime mangler — installer NDI Tools»),
  preview/navigation still fully functional.
- Corrupt config → defaults + warn. Teardown (timer, content window, NDI send) wired on
  before-quit AND uncaughtException/unhandledRejection backstops.
- Stats surface truth: real sent-fps (rolling), frames sent, NDI receiver count
  (`send_get_no_connections`), «statisk side» indicator.

## UI (VAPOR)

Single control window, light VAPOR (canvas #FAFBFC, brand blue #0284C7, slate chrome #1E2835,
Familjen Grotesk display, SQUARE buttons, 6px cards). Layout: slim top chrome (VEV wordmark, NDI
status pill — grå AV / mint PÅ LUFTA / coral + receiver count when someone is pulling the feed);
URL row (tilbake/frem/oppdater, URL felt, Gå); large 16:9 interactive preview; right rail:
NDI-navn, oppløsning (1080p/720p/egendefinert), FPS (25/30/50/60), transparent bakgrunn,
lyd på maskinen, START/STOPP NDI; stats strip underneath. Norwegian labels throughout.
Default content on first launch: the VEV testcard (branded pattern + klokke + oppløsning) so
there is instant, verifiable signal in vMix.

## Testing & verification

- vitest: config schema (valid/corrupt/missing), input-map (coords/buttons/modifiers/wheel/keys),
  pacer (repetition, fps stats), URL normalization («vg.no» → https://vg.no; reject file:/js:),
  NDI-name sanitation.
- `VEV_SELFCHECK=1`: app auto-starts NDI on the testcard, logs stats, saves a control-window
  screenshot to scratchpad, exits — CI-able smoke.
- `tools/ndi-probe.js` (separate process): NDI-receive the published source, assert resolution,
  non-black pixels, measured fps. This is the autonomous "it actually works" gate.
- **Nicolai's live gate:** vMix → Add Input → NDI → `NACALAI (VEV)` renders the testcard, then a
  real page (vg.no), then navigate via preview and see it move on program out.

## Out of scope v1 (explicit)

NDI audio, multi-instance UI, zoom factor, FFmpeg/file egress, tally, Companion module, packaging
(runs via `npm run dev`/`start`).
