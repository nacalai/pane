# Pane — Webpage to NDI

**Pane turns any web page into a live [NDI®](https://ndi.video/) video source you can navigate and
interact with — a browser source for vMix, OBS Studio, TriCaster and any NDI receiver.**

Type a URL and the whole rendered page is published on your network as an NDI source
(`MACHINE (Pane)`). Because Pane is a real, interactive browser — not a one‑shot converter — you can
click, scroll, fill in forms, switch tabs in a chart and navigate to other pages, all live on air.
Bring up a stock graph, click through the days, jump to another page, and the NDI feed follows every
interaction.

Great for **live broadcast graphics, web dashboards, data visualizations, lower thirds, scoreboards,
and financial or sports tickers** fed straight into your video switcher over NDI.

Pane is inspired by earlier web‑to‑NDI tools such as
[vingester](https://github.com/rse/vingester) and HTML‑to‑NDI, and adds live, interactive
navigation on top — built on Electron and **NDI 6**.

## Download

**➡️ [Download the latest Windows installer](https://github.com/nacalai/pane/releases/latest)**

Run the installer and you're done — Pane keeps itself up to date (it asks before installing an
update, and never mid‑broadcast). You'll also need the free
[NDI Tools / Runtime](https://ndi.video/tools/) installed; Pane finds it automatically.

> Windows 10/11 (x64). The installer isn't code‑signed yet, so Windows SmartScreen may warn on first
> run — click **More info → Run anyway**.

## Features

- **Interactive** — navigate, click, type and scroll a live page; it's a browser, not a snapshot.
- **Studio or presenter** — operate the page yourself from a hidden render, or hand a visible window
  to a presenter to drive directly (see below).
- **Full‑bandwidth NDI (SpeedHQ)** — near‑lossless, low latency, with alpha so transparent pages key
  cleanly over your program.
- **Stream Deck / Companion control** — a built‑in HTTP API to change page, click, scroll, open the
  presenter view and more.
- **In‑output pointer** — optionally show a colored dot or an arrow that follows the mouse (handy for
  pointing at charts); turn it off and the presenter uses the real mouse with zero latency.
- **Tray app** — runs in the system tray so the feed stays live; single instance; optional
  start‑with‑Windows; a guarded STOP so a stray click can't drop the source.
- **Broadcast helpers** — resolution and frame‑rate presets, a built‑in test card, and an optional
  dither to reduce gradient banding.

## Studio vs. presenter

Pane can render the page two ways — pick per use:

- **Studio** *(default)* — the page renders hidden at your exact output resolution and you drive it
  from the preview in the Pane window. Best for graphics you operate yourself.
- **Presenter** — the page opens in a real, visible window (windowed or fullscreen, on any monitor)
  that a host controls directly with their mouse and keyboard. Best for a presenter walking through
  a live page on air.

Either way, the NDI output is exactly the page you see.

## Remote control (Stream Deck / Companion)

Pane exposes a small local HTTP API, e.g.:

```
GET /api/go?url=example.com          load a page
GET /api/nav/back | forward | reload navigation
GET /api/key?key=ArrowRight          send a keypress (next slide, etc.)
GET /api/scroll?dy=600               scroll
GET /api/presenter/open?fullscreen=1 open the presenter window
GET /api/status                      current state (JSON)
```

Loopback works with no setup; LAN access is opt‑in and token‑protected.

---

## Building from source (for developers)

Most people should just use the **[Releases](https://github.com/nacalai/pane/releases/latest)** above.
To build or contribute:

```bash
npm install
npm run dev        # run in development
npm run dist       # build the Windows installer (NSIS) → release/
npm run typecheck && npm run lint && npm test
```

Tech: Electron + TypeScript + React, with a zero‑compile [koffi](https://koffi.dev/) FFI binding to
the NDI 6 runtime. An autonomous smoke test and an independent NDI‑receiver probe are included:

```bash
PANE_SELFCHECK=1 npm start          # 20 s smoke test → selfcheck.json + screenshot
node tools/ndi-probe.cjs Pane 10    # receive the source; report resolution/fps/pixels
```

---

*NDI® is a registered trademark of Vizrt NDI AB. Pane is an independent project and is not affiliated
with or endorsed by Vizrt, vMix, OBS, or the other tools mentioned.*
