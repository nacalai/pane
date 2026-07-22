# Pane — a webpage you can *drive*, live as an NDI source

Pane turns any web page into a live **[NDI](https://ndi.video/)** video source for your switcher
(vMix, OBS/DistroAV, TriCaster…). Type a URL, and the whole rendered page is published on the
network as `MACHINE (Pane)`.

**The key difference from HTML‑to‑NDI tools:** Pane is a *browser you interact with*, not a
one‑shot converter. Tools like `htmltondi` just render a static HTML file to NDI — you can't
navigate, click, or change anything. Pane lets you (or a presenter) **navigate pages, click
buttons, switch tabs in a chart, fill forms, and scroll** — all live on air. Bring up a stock
graph, click through the days, jump to another page, and the NDI feed follows every interaction.

A modern replacement for the abandoned [rse/vingester](https://github.com/rse/vingester), built on
Electron 43 (H.264/AAC included, so more of the web actually plays) and **NDI 6** via a
zero‑compile [koffi](https://koffi.dev/) FFI binding.

## Download

Grab the latest Windows installer from the **[Releases](https://github.com/nacalai/pane/releases/latest)**
page. Pane auto‑updates itself from there (downloads in the background, installs when you quit).

## Two ways to run

| | **Studio** | **Presenter** |
|---|---|---|
| Window | Hidden, rendered offscreen at exact resolution | A visible window on any monitor (windowed or fullscreen) |
| Who drives it | You, from the preview in the control app | The presenter, **directly** — real clicks, charts, forms |
| Use for | Graphics/lower‑thirds you operate | A host walking through a live web page on air |

Both publish the identical image over the same NDI pipeline.

## Highlights

- **Interactive** — navigate, click, type, scroll; the page is live, not a snapshot.
- **Full‑bandwidth NDI (SpeedHQ)** — near‑lossless, low latency, video + alpha (transparent pages
  key straight over program).
- **Per‑monitor presenter view** — open the page fullscreen on the confidence monitor.
- **Stream Deck / Companion control** — a built‑in HTTP API (`/api/go`, `/api/key`, `/api/scroll`,
  `/api/presenter/open`, `/api/nav/*`, `/api/status`, …).
- **In‑output cursor** — optionally draw a colored dot or an arrow that follows the mouse (great for
  pointing at charts); off means the presenter uses the real mouse with zero latency.
- **Runs from the tray** — single instance, the X button minimizes to the tray so the feed stays
  live; optional launch‑with‑Windows; guarded STOP so a stray click can't drop the source.
- **Quality tools** — resolution/FPS presets, a broadcast test card, and an optional dither to tame
  gradient banding.

## Requirements

- Windows 10/11 (x64)
- [NDI Tools / Runtime](https://ndi.video/tools/) installed (Pane finds it automatically; without
  it the app still runs, with a clear notice and full preview/navigation).

## Develop

```bash
npm install
npm run dev        # run in development
npm start          # run the built app (build first: npm run build)
npm run dist       # build the Windows installer (NSIS) → release/
npm run typecheck && npm run lint && npm test
```

Autonomous smoke test + an independent NDI receiver probe:

```bash
PANE_SELFCHECK=1 npm start          # 20 s smoke → selfcheck.json + screenshot
node tools/ndi-probe.cjs Pane 10    # receive the source, report resolution/fps/pixels
```

Design and implementation notes live in `docs/`.
