# TIER: PRODUCT

Pane — **on-air NDI source**. A news presenter drives a live webpage that is broadcast into
vMix. Treat every change as production, on-air software: **it must never crash itself off the
air or take down the machine.** Extends the Creavid baseline (`~/.claude/CLAUDE.md`); on
conflict this file wins.

`npm run typecheck` exists so the PRODUCT-tier Stop-gate is deterministic.

## Non-negotiables for this repo

- **Stay live through errors.** The main-process backstops (`uncaughtException` /
  `unhandledRejection`) LOG and keep running — they do NOT exit. The frame loop, NDI send, and
  every IPC handler fail closed on their own. Never reintroduce `app.exit()` in a backstop.
- **Frame path is wrapped.** `onFrameImage`, the send loop, and the stats loop are each
  try/caught so one malformed frame or native hiccup can't propagate to Electron. Keep it that way.
- **NDI feed never starves.** Frame repetition carries static pages; a paced, drift-corrected
  send loop clocks output. Don't add a naïve `performance.now()` rate cap (killed frame flow in GJEST).
- **koffi/NDI is isolated** behind `ndi-sender.ts`; every native call is wrapped and returns a
  result union. Missing NDI runtime → `no-runtime` status, app keeps working. Validate the BGRA
  buffer size before `send_video` (a size mismatch would corrupt or crash native).
- **Content window renders arbitrary pages** with `sandbox:true, contextIsolation:true,
  nodeIntegration:false`, no preload, permissions/downloads denied, popups/file: blocked,
  render-process-gone auto-recovery (≤3, backoff). Never loosen these.
- **Control API (HTTP) rejects browser-originated requests** (Sec-Fetch-Site/Origin) + pins Host
  (DNS rebinding); token is Bearer-only, timing-safe. Loopback-free only for non-browser callers.
- **Settings + NDI name persist** via `ConfigStore` (atomic tmp+rename, defaults-on-corrupt) to
  `userData`. `app.setName('Pane')` fixes the userData folder across dev/packaged — don't change it
  (would orphan users' saved config).
- **Lifecycle:** single-instance lock; X hides to tray (never quits); quit only from tray menu.
  Every timer/listener/window/NDI handle torn down on dispose + before-quit.

## Verify before "done"

`npm run typecheck && npm run lint && npm test`, then the runtime selfchecks:
`PANE_SELFCHECK=1 [PANE_SELFCHECK_MODE=presenter | _TRAY=1 | _CRASH=1] npm start` and the
independent `node tools/ndi-probe.cjs Pane 8`. A capture/NDI change is not done until the probe
confirms frames on the wire — typecheck/build alone don't prove pixels reach NDI.
