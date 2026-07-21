# CREAVID VEV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron app that renders any webpage offscreen at broadcast resolution, publishes it as a real NDI source (video+alpha), and lets the operator navigate the page through an interactive VAPOR control UI.

**Architecture:** Offscreen `BrowserWindow` → `paint` (BGRA) → paced send loop → koffi FFI `NDIlib_send_send_video_v2`, all in the Electron main process. Control window (React) talks over a narrow zod-validated IPC bridge; input is injected with `sendInputEvent`. See `docs/superpowers/specs/2026-07-21-vev-design.md`.

**Tech Stack:** electron-vite 2 + Electron ^33 + TypeScript strict + React 18 + koffi ^2.9 + zod + vitest. (GJEST's proven skeleton; NDI DLL loader pattern from creavid-gjest/ndi-matrix.)

**User decisions (already made):** "Make a creavid-version of vingester and make it work" — autonomous build; final acceptance is Nicolai's vMix gate. v1 = single instance, video+alpha, no NDI audio (design doc).

---

### Task 0: Scaffold

**Goal:** Buildable empty app: electron-vite dev/build/typecheck/test/lint run clean.

**Files:** Create `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `eslint.config.mjs`, `.gitignore`, `README.md`, stub `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html|main.tsx`.

**Key content:** scripts `dev` (electron-vite dev), `start` (electron-vite preview), `build`, `typecheck` (tsc --noEmit -p tsconfig.json), `test` (vitest run), `lint` (eslint .). Deps: koffi. DevDeps: electron ^33, electron-vite ^2.3, react 18, @vitejs/plugin-react, typescript ^5.5, vitest, zod, typescript-eslint (strict + no-floating-promises), @types/react(-dom). `"type": "module"`. tsconfig: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` off (Electron APIs), paths for `@shared/*`.

**Acceptance Criteria:**
- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` produces `out/main/index.js`

**Verify:** `npm run typecheck && npm run build`

### Task 1: Shared contracts (`src/shared/`)

**Goal:** Single source of truth for config + IPC types, URL/name hygiene. TDD.

**Files:** Create `src/shared/schema.ts`, `src/shared/url.ts`, Test `tests/schema.test.ts`, `tests/url.test.ts`.

**Content:**
- `VevConfigSchema` (zod): `{ url: string, ndiName: string (1..63, sanitized), width: int 320..3840 (default 1920), height: int 240..2160 (default 1080), fps: 25|30|50|60 (default 30), transparent: boolean (default false), localAudio: boolean (default false), autoStart: boolean (default true) }` + `.catch`-free strict parse; `parseConfig(json: unknown): VevConfig` returns defaults on ANY failure (logged).
- `sanitizeNdiName(s)`: strip control chars + `()` (NDI wraps name in parens itself), collapse whitespace, clamp 63, fallback `'VEV'`.
- `normalizeUrl(input)`: trim; allow `http(s)://`, `about:blank`, internal ids `vev:testcard`; bare host → `https://` prefix; reject `file:`, `javascript:`, `data:` → `{ ok:false, error }` union.
- IPC payload schemas: `NavigateReq`, `SettingsReq` (partial config), `InputEventReq` (discriminated union `mouse|wheel|key` with normalized 0..1 coords, buttons, modifiers, key string), `VevState` (published main→renderer: `{ ndi: 'off'|'live'|'no-runtime'|'error', ndiError?, receivers, sentFps, framesSent, static, nav: { url, title, canGoBack, canGoForward, loading, failure? }, config }`).

**Acceptance Criteria:**
- [ ] Corrupt/missing config JSON → defaults, no throw
- [ ] `normalizeUrl('vg.no')` → `https://vg.no/`… ; `file:///x` rejected
- [ ] All IPC schemas round-trip valid payloads and reject junk

**Verify:** `npx vitest run tests/schema.test.ts tests/url.test.ts`

### Task 2: Pure engine logic — pacer + input map

**Goal:** Unit-tested pacing/stats and DOM→Electron input translation.

**Files:** Create `src/main/pacer.ts`, `src/main/input-map.ts`, Test `tests/pacer.test.ts`, `tests/input-map.test.ts`.

**Content:**
- `Pacer`: injected clock. `onFrame(now)` (new paint), `onTick(now)` → `{ send: boolean, isRepeat: boolean }` (always send if a frame exists — repetition keeps NDI alive); rolling sent-fps over 2 s window; `stats(now)` → `{ sentFps, framesSent, static: now - lastPaint > 2000 }`.
- `mapMouse(ev: {kind:'move'|'down'|'up', xNorm, yNorm, button:0|1|2, clickCount, modifiers[]}, w, h)` → Electron `MouseInputEvent` (button `'left'|'middle'|'right'`, int coords clamp 0..w-1). `mapWheel(...)` → `mouseWheel` with `deltaX/deltaY` (invert per Electron convention: positive deltaY scrolls down → Electron wants negative? — test locks actual choice; see capture note). `mapKey({kind:'keydown'|'keyup', key, code, modifiers})` → `keyDown`(+`char` when `key.length===1` or Enter) / `keyUp` with `keyCode: key`.

**Acceptance Criteria:**
- [ ] Repetition: no paint for 3 ticks → still `send:true, isRepeat:true`; `static:true` after 2 s
- [ ] Coord scaling exact at edges (0,0)/(1,1) → (0,0)/(w-1,h-1)
- [ ] Enter produces `char` event with `keyCode:'Return'`… letters produce `char` with the letter

**Verify:** `npx vitest run tests/pacer.test.ts tests/input-map.test.ts`

### Task 3: NDI sender (`src/main/ndi-sender.ts`)

**Goal:** koffi binding: publish + push BGRA frames + receiver count; graceful when runtime missing.

**Files:** Create `src/main/ndi-sender.ts` (adapt `creavid-gjest/src/main/ndi-sender.ts`).

**Content deltas vs GJEST:** `FOURCC_BGRA = 0x41524742`; `sendFrame(bgra, w, h, fpsN, fpsD)` with `timecode: INT64_MAX (0x7fffffffffffffffn)` (NDI synthesizes); `clock_video: false` (we pace); add `connections(): number` via `int NDIlib_send_get_no_connections(void* p, uint32_t timeout_ms)` (timeout 0); keep `findSources()` self-check; `init(name)` returns `{ ok:true, version } | { ok:false, error }` instead of throwing (caller maps to `ndi: 'no-runtime'`); `renameTo(name)`: destroy send instance + recreate (create replacement first is impossible for same name — destroy→create, restore on failure). DLL candidates list identical (env vars → NDI 6/5 dirs).

**Acceptance Criteria:**
- [ ] With NDI Tools installed: init ok, version string non-empty (verified in Task 11 selfcheck)
- [ ] With DLL absent (simulated by env override to bogus dir + empty candidates): `{ok:false}` and no throw

**Verify:** typecheck + Task 11 selfcheck output `NDI ready`

### Task 4: Config store (`src/main/config.ts`)

**Goal:** Load/save `userData/vev-config.json` safely.

**Files:** Create `src/main/config.ts`, Test `tests/config.test.ts` (pure parts via dependency-injected read/write fns).

**Content:** `loadConfig(readFn)` → `parseConfig` (Task 1); `saveConfig(cfg, writeFn)` atomic: write `*.tmp` then rename; debounce 500 ms in caller. Never throws outward — logs and continues.

**Verify:** `npx vitest run tests/config.test.ts`

### Task 5: Capture engine (`src/main/capture.ts`)

**Goal:** The heart: offscreen window lifecycle, paint→NDI, preview, navigation, recovery, input.

**Files:** Create `src/main/capture.ts`, `resources/testcard.html`, `resources/errorcard.html`.

**Content (key points, no placeholders — full behavior list):**
- `class VevCapture extends EventEmitter` with `start(cfg)`, `stop()`, `navigate(url)`, `back/forward/reload()`, `applySettings(partial)`, `injectInput(req)`, `setLocalAudio(b)`, `dispose()`. Emits `'state'` (VevState fragments) + `'preview'` (JPEG Buffer).
- Window: `new BrowserWindow({ show:false, width, height, useContentSize:true, transparent: cfg.transparent, frame:false, webPreferences: { offscreen:true, sandbox:true, contextIsolation:true, nodeIntegration:false, partition:'persist:vev-content', backgroundThrottling:false } })`; `setAudioMuted(!cfg.localAudio)`; `contents.setFrameRate(fps)`; `app.commandLine.appendSwitch('force-device-scale-factor','1')` set in index.ts BEFORE ready.
- Resolution change / transparent toggle requires window recreate (transparent immutable) → `restartWindow()` preserving URL.
- `paint` handler: `const size = image.getSize()`; if mismatch vs config → `image.resize({width,height})` + warn once; NDI frame = `Buffer.from(image.getBitmap())` stored as `latest`; preview (≥100 ms since last): `image.resize({ width: 640 }).toJPEG(65)` → emit. All inside the handler tick (getBitmap validity).
- Send loop: `setInterval(1000/fps)`; if `latest` → `sender.sendFrame(latest, w, h, fpsN(fps), 1000)` where 25→25000/1000, 30→30000/1000, 50→50000/1000, 60→60000/1000; `pacer.onTick`; every 500 ms push stats+receivers state.
- Navigation events → state: `did-start-loading`, `did-stop-loading`, `did-navigate`(+in-page), `page-title-updated`; `did-fail-load` (ignore `-3` aborted, main frame only) → load `errorcard.html?url=&err=` + state.failure; `render-process-gone` → ≤3 reloads with 1s/2s/4s backoff then errorcard; `'unresponsive'/'responsive'` → state flag; `cursor-changed` → emit cursor type.
- `setWindowOpenHandler` → `{ action:'deny' }` + `contents.loadURL(url)` when http(s) (target=_blank navigates main frame); `will-navigate` allowed (it is a browser) but only http(s)/internal (deny file: etc.); session `setPermissionRequestHandler((_,__,cb)=>cb(false))` (once per partition).
- Internal pages: `vev:testcard` → `loadFile(resources/testcard.html)`; testcard = VAPOR-branded pattern: gradient bars, VEV wordmark, live clock (JS), resolution + fps readout, moving element (proves motion end-to-end).
- `stop()`/`dispose()`: clear interval, destroy window, null buffers — idempotent.

**Acceptance Criteria:**
- [ ] Static page keeps NDI fed (repeat frames — probe in Task 11 sees steady fps on testcard whose only motion is 1 Hz clock)
- [ ] Kill content process (`contents.forcefullyCrashRenderer()` in selfcheck path) → auto-recovers ≤3 tries
- [ ] `did-fail-load` on bogus domain → errorcard visible in NDI + failure in state

**Verify:** Task 11 selfcheck + probe (behavioral); typecheck now.

### Task 6: IPC + preload

**Goal:** Typed, validated bridge; no generic surface.

**Files:** Create `src/main/ipc.ts`, `src/preload/index.ts`.

**Content:** Channels (all `ipcMain.handle`): `vev:start`, `vev:stop`, `vev:navigate`, `vev:nav-action {action:'back'|'forward'|'reload'|'force-reload'}`, `vev:settings` (partial config → may restart capture/NDI rename), `vev:get-state`. `ipcMain.on('vev:input', …)` fire-and-forget (validated, high-rate). Main→renderer pushes: `vev:state`, `vev:preview` (JPEG ArrayBuffer), `vev:cursor`. EVERY inbound payload zod-parsed; result `{ok:true,data}|{ok:false,error}`; never throw across boundary. Preload: `contextBridge.exposeInMainWorld('vev', { start, stop, navigate, navAction, setSettings, getState, sendInput, onState(cb), onPreview(cb), onCursor(cb) })` — named channels only.

**Verify:** typecheck; renderer functions in Task 8.

### Task 7: Main entry (`src/main/index.ts`)

**Goal:** Wire everything; safe on every exit path.

**Files:** Modify `src/main/index.ts`.

**Content:** `force-device-scale-factor=1` before ready; `requestSingleInstanceLock()` else quit; create control window 1280×860 (`sandbox:true, contextIsolation:true, nodeIntegration:false`, preload, CSP via `session.defaultSession.webRequest.onHeadersReceived` or meta tag in index.html, `setWindowOpenHandler(deny)`, `will-navigate` block); instantiate NdiSender + VevCapture + config; autoStart: load config.url (default `vev:testcard`) + start NDI; `before-quit` → `capture.dispose(); sender.shutdown()`; `process.on('uncaughtException'/'unhandledRejection')` → log + attempt same teardown + `app.exit(1)`; `VEV_SELFCHECK=1` mode: start on testcard, after 20 s write `selfcheck.json` (framesSent, sentFps, sources list, ndi status) + `capturePage()` of control window → `selfcheck.png` in `VEV_SELFCHECK_DIR` or cwd, then quit. `VEV_SELFCHECK_CRASH=1` additionally `forcefullyCrashRenderer()` at t=8 s to prove recovery.

**Acceptance Criteria:**
- [ ] Selfcheck run exits 0, `selfcheck.json` shows `framesSent>300`, `sources` includes `(VEV)`, png exists

**Verify:** `VEV_SELFCHECK=1 npm start` (Task 11 does it against built output)

### Task 8: Renderer UI (VAPOR)

**Goal:** The control surface — beautiful, Norwegian, functional.

**Files:** Create `src/renderer/{index.html,main.tsx,App.tsx,app.css,components/*.tsx}` (`TopBar`, `UrlBar`, `Preview`, `SettingsRail`, `StatsStrip`, `Banner`).

**Content:** VAPOR tokens as CSS custom props copied from `creavid-design-system/vapor/tokens.json` (canvas #FAFBFC, blue #0284C7, slate #1E2835, coral #FF5A47, mint #2EE6A6, amber #FFB23E, Familjen Grotesk/Inter/JetBrains Mono via Google Fonts link with system fallback, radius 6/2/0, focus ring). Layout: slate top chrome (VEV wordmark + status pill: grå «NDI AV» / mint «PÅ LUFTA» / coral «● {n} MOTTAKER(E)» when receivers>0); URL row (◀ ▶ ⟳ buttons, URL input — Enter=Gå, «Testkort» quick button); center: 16:9 preview `<img>` (blob URL from JPEG frames, revoke previous) inside dark stage (#0C1116) with checkerboard behind when transparent; overlays: «Laster…», failure banner («Kunne ikke laste …» + Prøv igjen), unresponsive banner («Siden henger» + Tving omstart), no-runtime banner. Preview div is focusable (tabIndex): pointer events → normalized coords (`getBoundingClientRect`), wheel (passive:false, preventDefault), keydown/keyup (preventDefault except F5/F12? no — capture all while focused; Esc blurs), all → `vev.sendInput`; cursor style from `vev:cursor`. Right rail (VAPOR card): NDI-navn (text, applies on blur — triggers rename), Oppløsning select (1920×1080 / 1280×720 / Egendefinert w×h inputs), FPS select, «Transparent bakgrunn» toggle (restarts window — warn inline), «Lyd på maskinen» toggle, big square START NDI / STOPP NDI button (blue/coral). Stats strip (mono, tabular): `{sentFps} fps · {framesSent} bilder · {w}×{h}@{fps} · {receivers} mottakere · {statisk?'statisk side':'levende'}`. All state from single `vev:state` reducer; optimistic nothing — render server truth.

**Acceptance Criteria:**
- [ ] App renders with zero console errors (selfcheck png eyeballed + `--enable-logging` stderr clean of renderer errors)
- [ ] Click in preview navigates links on a real page (verified live in Task 11 via probe pixel-change + manually by Nicolai in gate)

**Verify:** build + selfcheck png inspection.

### Task 9: NDI probe (`tools/ndi-probe.js`)

**Goal:** Independent process that PROVES frames are on the wire.

**Files:** Create `tools/ndi-probe.js` (plain node, koffi; reuse DLL loader; CLI: `node tools/ndi-probe.js "VEV" 10`).

**Content:** `NDIlib_find_*` until a source whose name contains arg appears (timeout 15 s → exit 2); `NDIlib_recv_create_v3` (`color_format` 1 = BGRX_BGRA, bandwidth highest, `recv_connect`), loop `NDIlib_recv_capture_v2` (timeout 1000) for N seconds counting video frames; sample center + corner pixels of last frame (non-black check; with alpha report A). Print JSON `{ source, frames, fps, xres, yres, fourCC, centerPx, alphaAtCorner }`; `NDIlib_recv_free_video_v2` every frame; exit 0 on `frames>0 && xres===1920`. Struct `NDIlib_recv_create_v3_t { source_to_connect_to: NDIlib_source_t, color_format: int, bandwidth: int, allow_video_fields: bool, p_ndi_recv_name: char* }`; capture returns enum int (1=video) with `_Out_` frame struct pointer args.

**Verify:** Task 11.

### Task 10: Lint/typecheck/test green + commit cadence

Run after each task: `npm run typecheck && npm run lint && npm test`; commit per task (`feat: …`). No `.skip`, no weakened types.

### Task 11: Autonomous end-to-end verification

**Goal:** Real evidence before the human gate.

**Steps:**
- [ ] `npm run build` → `VEV_SELFCHECK=1 VEV_SELFCHECK_DIR=<scratchpad> npm start` (background, ≤60 s) → assert selfcheck.json: `ndi:'live'`, `framesSent>300`, sources include `(VEV)`; Read selfcheck.png — VAPOR UI renders, preview shows testcard.
- [ ] Parallel: `node tools/ndi-probe.js VEV 10` while app runs → `frames>0`, `xres 1920`, non-black center px, measured fps 25–35.
- [ ] Crash-recovery: `VEV_SELFCHECK=1 VEV_SELFCHECK_CRASH=1` run → selfcheck.json `recovered:true` (framesSent keeps growing post-crash).
- [ ] Real page: selfcheck accepts `VEV_SELFCHECK_URL=https://www.vg.no` → probe again (proves network pages, not just local file).

**Acceptance Criteria:**
- [ ] All four bullets pass with captured output in the session log

### Task 12: Multi-agent review + fixes

Workflow: parallel reviewers — (a) creavid-robustness-review checklist, (b) Electron security (electron.md rules), (c) NDI/capture correctness vs design doc, (d) VAPOR/UI fidelity + Norwegian copy — findings adversarially verified, then fixed + re-verified (Task 11 reruns as needed). Report survives into final summary.

### Task 13: USER GATE — vMix visual confirm (Nicolai)

**Goal:** Confirm on real program output.

**USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Acceptance Criteria:**
- [ ] vMix → Add Input → NDI → `NACALAI (VEV)` renders the VEV testcard (clock ticking)
- [ ] Navigate to a real page in VEV's URL bar; vMix shows it; click a link in the preview; vMix follows
- [ ] (If overlay use) transparent page keys correctly over program

**Verify:** Nicolai runs `npm run dev` in `creavid-vev`, adds the NDI input in vMix, reports back.
