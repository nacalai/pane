/**
 * PaneCapture — the engine. Owns the content window and everything that happens
 * to its pixels, in one of two modes sharing the same downstream pipeline:
 *
 *   studio    — hidden OFFSCREEN window; 'paint' events deliver BGRA NativeImages.
 *               Pixel-perfect at the configured resolution; operated via preview.
 *   presenter — VISIBLE window (windowed/fullscreen) the presenter uses directly;
 *               beginFrameSubscription delivers the same NativeImages live.
 *
 *   frames ──► latest BGRA buffer ──► drift-corrected send loop ──► NdiSender
 *          └─► time-gated preview (JPEG/PNG) ──► control UI
 *
 * Also: navigation state, input injection, crash/hang/load-failure recovery.
 * The offscreen CPU path requires app.disableHardwareAcceleration() — done in index.ts.
 */
import { BrowserWindow, nativeImage, screen, session, type WebContents } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { mapInput } from './input-map'
import { Pacer } from './pacer'
import type { NdiSender } from './ndi-sender'
import { INTERNAL_TESTCARD, normalizeUrl } from '@shared/url'
import type { Fps, InputEventReq, NavAction, NavState, PaneConfig } from '@shared/schema'

const PARTITION = 'persist:pane-content'
const PREVIEW_INTERVAL_MS = 50 // ~20 fps preview (was 10) — smoother
const PREVIEW_WIDTH = 960 // higher-res preview (was 640) — crisper
const PREVIEW_JPEG_QUALITY = 82 // less compression noise (was 65)
const STATS_INTERVAL_MS = 500
const MAX_CRASH_RELOADS = 3
const CRASH_BACKOFF_MS = [1000, 2000, 4000] as const
/** Send loop runs on a small quantum with a float accumulator — a rounded
 *  setInterval(33) would drift ~1% off the declared NDI frame rate. */
const PACER_QUANTUM_MS = 4
const PACER_RESYNC_MS = 500
/** NDI frame_rate_N per fps (D is always 1000). */
const FPS_N: Record<Fps, number> = { 25: 25000, 30: 30000, 50: 50000, 60: 60000 }
/** did-fail-load gives ERR_ABORTED (-3) for cancelled loads — not a real failure. */
const ERR_ABORTED = -3

/**
 * Near-invisible fractal-noise overlay injected into the page to dither 8-bit gradients so
 * they don't band through NDI's 4:2:2. GPU-composited (no per-frame CPU), pointer-events:none
 * so it never blocks clicks. Tuned subtle — invisible on text, enough to break gradient bands.
 */
const DITHER_NOISE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter>" +
  "<rect width='160' height='160' filter='url(#n)'/></svg>"
// Plain alpha-over (NO mix-blend-mode) — a blend mode forces a per-pixel backdrop read that
// tanks frame rate on heavy pages. A faint translucent noise layer is cheap and still dithers.
const DITHER_CSS =
  'html::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483647;' +
  'opacity:0.05;background-size:150px 150px;background-image:url("data:image/svg+xml,' +
  encodeURIComponent(DITHER_NOISE_SVG) +
  '")}'

/**
 * The in-output cursor is COMPOSITED onto the outgoing BGRA frame in the main process — not
 * injected into the page. This is what makes it follow the mouse everywhere, including over
 * cross-origin ad iframes (which never forward mousemove to the page and used to freeze a
 * DOM cursor), and it never doubles with the OS cursor. Position comes from the real OS cursor
 * (presenter) or the last injected move (studio).
 */
function hexToBgr(hex: string): [number, number, number] {
  return [parseInt(hex.slice(5, 7), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(1, 3), 16)]
}

/** Alpha-blend one BGRA pixel; leaves the frame opaque (alpha stays 255). */
function blendPx(buf: Buffer, idx: number, b: number, g: number, r: number, a: number): void {
  if (a <= 0) return
  const ia = 255 - a
  buf[idx] = ((buf[idx]! * ia + b * a) / 255) | 0
  buf[idx + 1] = ((buf[idx + 1]! * ia + g * a) / 255) | 0
  buf[idx + 2] = ((buf[idx + 2]! * ia + r * a) / 255) | 0
  buf[idx + 3] = 255
}

/** Anti-aliased filled disc. */
function fillDisc(
  buf: Buffer, w: number, h: number, cx: number, cy: number, radius: number,
  b: number, g: number, r: number, maxA = 255
): void {
  const R = Math.ceil(radius) + 1
  for (let dy = -R; dy <= R; dy++) {
    const y = cy + dy
    if (y < 0 || y >= h) continue
    for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx
      if (x < 0 || x >= w) continue
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > radius + 0.5) continue
      const cov = d <= radius - 0.5 ? 1 : radius + 0.5 - d
      blendPx(buf, (y * w + x) * 4, b, g, r, Math.round(cov * maxA))
    }
  }
}

/** Classic arrow pointer outline; each point is [dx,dy] from the cursor hotspot (top-left). */
const ARROW_POLY: Array<[number, number]> = [
  [0, 0], [0, 17], [4.5, 12.8], [8, 20], [10.6, 18.9], [7.2, 11.7], [13.5, 11.7]
]
function fillPolygon(
  buf: Buffer, w: number, h: number, ox: number, oy: number,
  poly: Array<[number, number]>, b: number, g: number, r: number, a: number
): void {
  let minY = Infinity, maxY = -Infinity
  for (const [, py] of poly) {
    minY = Math.min(minY, py)
    maxY = Math.max(maxY, py)
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs: number[] = []
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i]!
      const [x2, y2] = poly[(i + 1) % poly.length]!
      if (y1 <= y === y2 <= y) continue
      xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.round(xs[k]!); x < Math.round(xs[k + 1]!); x++) {
        const px = ox + x, py = oy + y
        if (px >= 0 && py >= 0 && px < w && py < h) blendPx(buf, (py * w + px) * 4, b, g, r, a)
      }
    }
  }
}

/** Composite the cursor (dot or arrow) onto a BGRA frame at (cx,cy). */
function compositeCursor(
  buf: Buffer, w: number, h: number, cx: number, cy: number,
  style: 'arrow' | 'dot', color: string
): void {
  const [b, g, r] = hexToBgr(color)
  if (style === 'dot') {
    fillDisc(buf, w, h, cx, cy, 9.5, 0, 0, 0, 90) // soft shadow for contrast on any page
    fillDisc(buf, w, h, cx, cy, 8, 255, 255, 255) // white ring
    fillDisc(buf, w, h, cx, cy, 6, b, g, r) // colored core
  } else {
    // Dark outline (shifted copies) then white fill — reads as a normal pointer on any bg.
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
      fillPolygon(buf, w, h, cx + dx, cy + dy, ARROW_POLY, 0, 0, 0, 235)
    }
    fillPolygon(buf, w, h, cx, cy, ARROW_POLY, 255, 255, 255, 255)
  }
}

export interface CaptureStats {
  sentFps: number
  framesSent: number
  staticPage: boolean
  receivers: number
}

interface CaptureEvents {
  nav: [NavState]
  stats: [CaptureStats]
  preview: [Buffer, string]
  cursor: [string]
  presenterClosed: []
}

export class PaneCapture extends EventEmitter<CaptureEvents> {
  private win: BrowserWindow | null = null
  private cfg: PaneConfig
  private latest: Buffer | null = null
  private readonly pacer = new Pacer()
  private sendTimer: NodeJS.Timeout | null = null
  private statsTimer: NodeJS.Timeout | null = null
  private presenterTimer: NodeJS.Timeout | null = null
  private presenterCapturing = false
  private presenterFirstFrame = false
  private nextDueAt = 0
  private lastPreviewAt = 0
  private warnedScale = false
  private crashCount = 0
  private crashReloadTimer: NodeJS.Timeout | null = null
  private disposed = false
  private ditherKey: string | null = null
  /** Last pointer position (0..1 in page space) for the studio composited cursor. */
  private cursorNorm: { x: number; y: number } | null = null
  /** Guards the presenter window's 'closed' event during intentional rebuild/dispose. */
  private tearingWindow = false

  /** What the URL bar shows and what reload retries — the *intended* target, never a file:// path. */
  private currentTarget: string = INTERNAL_TESTCARD
  private failure: NavState['failure'] = null
  private unresponsive = false
  private static sessionWired = false

  constructor(
    private readonly sender: NdiSender,
    private readonly resourcesDir: string,
    initialCfg: PaneConfig
  ) {
    super()
    this.cfg = { ...initialCfg }
  }

  private get contents(): WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null
  }

  start(): void {
    if (this.disposed) throw new Error('PaneCapture is disposed')
    if (this.win) return
    this.createWindow()
    this.startLoops()
    const r = this.navigate(this.cfg.url)
    if (!r.ok) {
      // A corrupt persisted URL must never yield silent black output.
      console.warn(`[capture] saved address rejected (${r.error}) — loading the test card`)
      this.loadTarget(INTERNAL_TESTCARD)
    }
  }

  private createWindow(): void {
    const ses = session.fromPartition(PARTITION)
    if (!PaneCapture.sessionWired) {
      PaneCapture.sessionWired = true
      // The content window renders arbitrary remote pages: deny every permission
      // prompt AND every silent permission check, and block downloads outright.
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      ses.setPermissionCheckHandler(() => false)
      ses.on('will-download', (event) => event.preventDefault())
    }

    const presenter = this.cfg.mode === 'presenter'
    const win = new BrowserWindow({
      show: presenter,
      width: this.cfg.width,
      height: this.cfg.height,
      useContentSize: true,
      // A non-resizable window can't go fullscreen on Windows — presenter must be resizable.
      resizable: presenter,
      fullscreenable: true,
      autoHideMenuBar: true,
      title: 'Pane — presenter',
      backgroundColor: presenter ? '#0C1116' : undefined,
      // transparent only exists offscreen; a visible transparent window makes no sense here
      transparent: !presenter && this.cfg.transparent,
      frame: presenter,
      webPreferences: {
        offscreen: !presenter,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: PARTITION,
        backgroundThrottling: false
      }
    })
    this.win = win
    const contents = win.webContents
    if (!presenter) contents.setFrameRate(this.cfg.fps)
    contents.setAudioMuted(!this.cfg.localAudio)

    if (presenter) {
      win.setMenuBarVisibility(false)
      this.positionPresenter(win)
      // F11 toggles fullscreen; Esc leaves it. Everything else flows to the page.
      contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return
        if (input.key === 'F11') {
          event.preventDefault()
          win.setFullScreen(!win.isFullScreen())
          this.pushNav()
        } else if (input.key === 'Escape' && win.isFullScreen()) {
          event.preventDefault()
          win.setFullScreen(false)
          this.pushNav()
        }
      })
      win.on('closed', () => {
        if (!this.tearingWindow && !this.disposed) this.emit('presenterClosed')
      })
    } else {
      contents.on('paint', (_event, _dirty, image) => this.onFrameImage(image))
      contents.on('cursor-changed', (_e, type) => this.emit('cursor', type))
    }

    // ---- navigation state ----
    const push = (): void => this.pushNav()
    // A load that actually COMMITTED — adopt the real URL (handles redirects/in-page nav).
    // currentTarget is only advanced here, never in the synchronous pushNav (which would
    // otherwise read the pre-commit getURL() and clobber it back to the previous page).
    const commit = (): void => {
      const u = contents.getURL()
      if (u && !u.startsWith('file:')) this.currentTarget = u
      this.pushNav()
    }
    contents.on('did-start-loading', push)
    contents.on('did-stop-loading', push)
    contents.on('did-navigate', commit)
    contents.on('did-navigate-in-page', commit)
    contents.on('page-title-updated', push)
    contents.on('did-finish-load', () => {
      this.crashCount = 0
      // insertCSS is cleared on navigation; re-apply the dither overlay for the new document.
      this.ditherKey = null
      this.applyDither()
      this.pushNav()
    })

    contents.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return
      // The errorcard ITSELF failed (e.g. resources missing/misdeployed). Never reload it —
      // that recurses, nesting the failed URL into an ever-growing query string. Stop here;
      // the control-UI banner still surfaces the failure.
      if (validatedURL.includes('errorcard.html')) {
        console.error('[capture] errorcard.html failed to load — showing banner only')
        this.failure = { code, description: 'Resource file missing (errorcard.html)', url: this.currentTarget }
        this.pushNav()
        return
      }
      this.failure = { code, description, url: validatedURL || this.currentTarget }
      this.loadErrorCard()
      this.pushNav()
    })

    contents.on('render-process-gone', (_e, details) => {
      if (this.disposed || details.reason === 'clean-exit') return
      this.crashCount += 1
      console.error(`[capture] renderer gone (${details.reason}), attempt ${this.crashCount}`)
      this.clearCrashTimer()
      if (this.crashCount <= MAX_CRASH_RELOADS) {
        const delay = CRASH_BACKOFF_MS[this.crashCount - 1] ?? 4000
        this.crashReloadTimer = setTimeout(() => {
          this.crashReloadTimer = null
          this.loadTarget(this.currentTarget)
        }, delay)
      } else {
        this.failure = {
          code: 0,
          description: `The browser process crashed repeatedly (${details.reason})`,
          url: this.currentTarget
        }
        this.loadErrorCard()
      }
      this.pushNav()
    })

    contents.on('unresponsive', () => {
      this.unresponsive = true
      this.pushNav()
    })
    contents.on('responsive', () => {
      this.unresponsive = false
      this.pushNav()
    })

    // Popups never open windows; http(s) targets navigate the main frame instead.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.loadTarget(url)
      return { action: 'deny' }
    })
    // Page-initiated navigation stays on http(s) — a hostile page must not reach file: etc.
    contents.on('will-navigate', (event, url) => {
      if (!/^https?:/i.test(url)) event.preventDefault()
    })
  }

  /** Shared frame path for both modes. Must do all NativeImage work inside this tick. */
  private onFrameImage(image: Electron.NativeImage): void {
    if (this.disposed) return
    try {
      this.processFrame(image)
    } catch (e) {
      // A single malformed frame must never propagate to Electron and kill the process —
      // repetition of the last good frame keeps the NDI feed alive.
      console.error('[capture] frame drop:', (e as Error).message)
    }
  }

  private processFrame(image: Electron.NativeImage): void {
    let img = image
    const size = image.getSize()
    if (size.width !== this.cfg.width || size.height !== this.cfg.height) {
      if (!this.warnedScale) {
        this.warnedScale = true
        console.warn(
          `[capture] frame ${size.width}x${size.height} != config ${this.cfg.width}x${this.cfg.height} — resizing`
        )
      }
      img = image.resize({ width: this.cfg.width, height: this.cfg.height })
    }
    this.latest = img.toBitmap() // BGRA copy; the source buffer is only valid this tick

    // Composite the in-output cursor onto the frame (follows the mouse everywhere).
    let composited: Electron.NativeImage | null = null
    if (this.cfg.showCursor) {
      const pos = this.cursorPx()
      if (pos) {
        compositeCursor(this.latest, this.cfg.width, this.cfg.height, pos.x, pos.y, this.cfg.cursorStyle, this.cfg.cursorColor)
        composited = nativeImage.createFromBitmap(this.latest, { width: this.cfg.width, height: this.cfg.height })
      }
    }
    this.pacer.onFrame(Date.now())

    const now = Date.now()
    if (this.cfg.showPreview && now - this.lastPreviewAt >= PREVIEW_INTERVAL_MS) {
      this.lastPreviewAt = now
      try {
        // Preview from the composited frame so it shows the cursor too; else straight from img.
        const small = (composited ?? img).resize({ width: PREVIEW_WIDTH, quality: 'good' })
        if (this.cfg.transparent && this.cfg.mode === 'studio' && !composited) {
          this.emit('preview', small.toPNG(), 'image/png')
        } else {
          this.emit('preview', small.toJPEG(PREVIEW_JPEG_QUALITY), 'image/jpeg')
        }
      } catch (e) {
        console.error('[capture] preview encode:', (e as Error).message)
      }
    }
  }

  /** Cursor position in output pixels, or null if off-frame. OS cursor in presenter, last
   *  injected move in studio. */
  private cursorPx(): { x: number; y: number } | null {
    if (this.cfg.mode === 'presenter' && this.win && !this.win.isDestroyed()) {
      const p = screen.getCursorScreenPoint()
      const cb = this.win.getContentBounds()
      if (cb.width < 2 || cb.height < 2) return null
      const nx = (p.x - cb.x) / cb.width
      const ny = (p.y - cb.y) / cb.height
      if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null
      return { x: Math.round(nx * this.cfg.width), y: Math.round(ny * this.cfg.height) }
    }
    if (this.cursorNorm) {
      return {
        x: Math.round(this.cursorNorm.x * this.cfg.width),
        y: Math.round(this.cursorNorm.y * this.cfg.height)
      }
    }
    return null
  }

  /**
   * Presenter frame source: paced capturePage() polling. beginFrameSubscription
   * never fires for onscreen windows in this Electron/compositor combination
   * (verified empirically, both with and without GPU compositing) — capturePage
   * is the API that demonstrably works here. Reentrancy-guarded; empty captures
   * (minimized window) are skipped and frame repetition carries the NDI feed.
   */
  private startPresenterCapture(): void {
    const intervalMs = Math.max(16, Math.round(1000 / this.cfg.fps))
    this.presenterTimer = setInterval(() => {
      if (this.presenterCapturing || this.disposed) return
      const contents = this.contents
      if (!contents) return
      this.presenterCapturing = true
      contents
        .capturePage()
        .then((image) => {
          const size = image.getSize()
          if (size.width > 1 && size.height > 1) {
            if (!this.presenterFirstFrame) {
              this.presenterFirstFrame = true
              console.log(`[capture] presenter frames flowing (${size.width}x${size.height})`)
            }
            this.onFrameImage(image)
          }
        })
        .catch(() => {
          /* window mid-teardown — repetition keeps NDI fed */
        })
        .finally(() => {
          this.presenterCapturing = false
        })
    }, intervalMs)
  }

  private startLoops(): void {
    this.stopLoops()
    if (this.cfg.mode === 'presenter' && this.win) this.startPresenterCapture()
    const frameMs = 1000 / this.cfg.fps
    this.nextDueAt = Date.now() + frameMs
    this.sendTimer = setInterval(() => {
      try {
        const now = Date.now()
        if (now < this.nextDueAt) return
        this.nextDueAt += frameMs
        // Fell far behind (system sleep, long GC): resync instead of burst-sending.
        if (now - this.nextDueAt > PACER_RESYNC_MS) this.nextDueAt = now + frameMs
        if (!this.latest || !this.sender.isLive()) return
        const decision = this.pacer.onTick(now)
        if (decision.send) {
          // Opaque (BGRX) unless the user wants alpha out — cleaner + lighter on the wire.
          const opaque = !this.cfg.transparent
          this.sender.sendFrame(this.latest, this.cfg.width, this.cfg.height, FPS_N[this.cfg.fps], 1000, opaque)
        }
      } catch (e) {
        // One bad tick must not kill the loop or the process — the next tick recovers.
        console.error('[capture] send tick:', (e as Error).message)
      }
    }, PACER_QUANTUM_MS)
    this.statsTimer = setInterval(() => {
      try {
        const stats = this.pacer.stats(Date.now())
        this.emit('stats', { ...stats, receivers: this.sender.connections() })
      } catch (e) {
        console.error('[capture] stats tick:', (e as Error).message)
      }
    }, STATS_INTERVAL_MS)
  }

  private stopLoops(): void {
    if (this.sendTimer) clearInterval(this.sendTimer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this.presenterTimer) clearInterval(this.presenterTimer)
    this.sendTimer = null
    this.statsTimer = null
    this.presenterTimer = null
    this.presenterFirstFrame = false
  }

  private clearCrashTimer(): void {
    if (this.crashReloadTimer) clearTimeout(this.crashReloadTimer)
    this.crashReloadTimer = null
  }

  // ---------- navigation ----------

  /** input: anything the user typed, or an already-normalized URL. */
  navigate(input: string): { ok: true; url: string } | { ok: false; error: string } {
    const res = normalizeUrl(input)
    if (!res.ok) return res
    this.failure = null
    this.loadTarget(res.url)
    // Return the actual normalized target so the caller persists THIS url — not the
    // stale committed URL that getURL()/currentTarget still report until the load commits.
    return { ok: true, url: res.url }
  }

  private loadTarget(url: string): void {
    const contents = this.contents
    if (!contents) return
    // A pending crash-recovery reload must not fire on top of a fresh navigation.
    this.clearCrashTimer()
    this.currentTarget = url
    if (url === INTERNAL_TESTCARD) {
      void contents
        .loadFile(join(this.resourcesDir, 'testcard.html'), {
          query: {
            w: String(this.cfg.width),
            h: String(this.cfg.height),
            fps: String(this.cfg.fps),
            name: this.cfg.ndiName
          }
        })
        .catch((e: unknown) => console.error('[capture] testcard load:', e))
    } else {
      void contents.loadURL(url).catch(() => {
        /* did-fail-load handles real failures; loadURL rejects redundantly */
      })
    }
    this.pushNav()
  }

  private loadErrorCard(): void {
    const contents = this.contents
    if (!contents || !this.failure) return
    void contents
      .loadFile(join(this.resourcesDir, 'errorcard.html'), {
        query: { url: this.failure.url, err: this.failure.description }
      })
      .catch((e: unknown) => console.error('[capture] errorcard load:', e))
  }

  navAction(action: NavAction): void {
    const contents = this.contents
    if (!contents) return
    switch (action) {
      case 'back':
        if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
        break
      case 'forward':
        if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
        break
      case 'reload':
        if (this.failure) {
          // The visible page is the errorcard — retry the page the user wanted.
          this.failure = null
          this.loadTarget(this.currentTarget)
        } else {
          contents.reload()
        }
        break
      case 'force-reload':
        if (this.unresponsive) {
          // A hung renderer can't reload itself; crash it and let recovery reload.
          contents.forcefullyCrashRenderer()
        } else if (this.failure) {
          this.failure = null
          this.loadTarget(this.currentTarget)
        } else {
          contents.reloadIgnoringCache()
        }
        break
    }
  }

  private pushNav(): void {
    const contents = this.contents
    if (!contents) return
    const rawUrl = contents.getURL()
    // Internal file:// pages keep the *intended* target in the URL bar. currentTarget is
    // advanced only by the committed-navigation handler, never here (read-only).
    const displayUrl = rawUrl.startsWith('file:') || !rawUrl ? this.currentTarget : rawUrl
    this.emit('nav', {
      url: displayUrl === INTERNAL_TESTCARD ? INTERNAL_TESTCARD : displayUrl,
      title: contents.getTitle(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      loading: contents.isLoading(),
      failure: this.failure,
      unresponsive: this.unresponsive
    })
  }

  // ---------- input ----------

  injectInput(req: InputEventReq): void {
    const contents = this.contents
    if (!contents) return
    // Track the pointer so the studio composited cursor follows operator input.
    if (req.kind === 'move' || req.kind === 'down' || req.kind === 'up') {
      this.cursorNorm = { x: req.x, y: req.y }
    }
    if (req.kind === 'down') contents.focus() // keyboard follows the click, like a real browser
    for (const ev of mapInput(req, this.cfg.width, this.cfg.height)) {
      contents.sendInputEvent(ev)
    }
  }

  // ---------- settings ----------

  /** Apply a new full config. Returns true if the change required a window rebuild. */
  applyConfig(next: PaneConfig): boolean {
    const prev = this.cfg
    this.cfg = { ...next }
    if (!this.win) return false

    const modeChanged = next.mode !== prev.mode
    const transparentChanged = next.transparent !== prev.transparent && next.mode === 'studio'
    if (modeChanged || transparentChanged) {
      // mode and `transparent` are immutable per-window: rebuild and restore the target.
      const target = this.currentTarget
      this.rebuildWindow()
      this.loadTarget(target)
      return true
    }
    if (next.width !== prev.width || next.height !== prev.height) {
      this.warnedScale = false
      this.latest = null // old-size frames must not reach NDI with the new dimensions
      this.win.setContentSize(next.width, next.height)
      if (next.mode === 'studio') this.contents?.invalidate()
    }
    if (next.fps !== prev.fps) {
      if (next.mode === 'studio') this.contents?.setFrameRate(next.fps)
      this.startLoops()
    }
    if (next.localAudio !== prev.localAudio) {
      this.contents?.setAudioMuted(!next.localAudio)
    }
    if (next.dither !== prev.dither) {
      if (next.dither) this.applyDither()
      else this.removeDither()
    }
    // Cursor is composited each frame from cfg — no per-toggle work needed here.
    if (
      next.mode === 'presenter' &&
      (next.presenterFullscreen !== prev.presenterFullscreen ||
        next.presenterDisplayId !== prev.presenterDisplayId)
    ) {
      // Windowed↔fullscreen and/or a different monitor → re-place the window.
      this.positionPresenter(this.win)
    }
    if (next.ndiName !== prev.ndiName && this.currentTarget === INTERNAL_TESTCARD) {
      this.loadTarget(INTERNAL_TESTCARD) // testcard displays the NDI name — refresh it
    }
    return false
  }

  isPresenterFullscreen(): boolean {
    return this.cfg.mode === 'presenter' && !!this.win && !this.win.isDestroyed() && this.win.isFullScreen()
  }

  /** The monitor the presenter window should use. presenterDisplayId 0 = follow primary. */
  private resolveDisplay(): Electron.Display {
    if (this.cfg.presenterDisplayId === 0) return screen.getPrimaryDisplay()
    return (
      screen.getAllDisplays().find((d) => d.id === this.cfg.presenterDisplayId) ??
      screen.getPrimaryDisplay()
    )
  }

  /**
   * Place the presenter window on the chosen monitor, windowed (centered in the work area
   * at capture resolution) or fullscreen (covering that monitor). Always drops fullscreen
   * first so setBounds can actually move the window between displays before re-entering it.
   */
  private positionPresenter(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    const target = this.resolveDisplay()
    // Idempotent: if the window is already on the target display in the wanted mode, do
    // nothing. Without this, any display-metrics-changed (resolution/DPI/taskbar) would drop
    // and re-enter fullscreen on air — a visible glitch. Only genuine changes reposition.
    const current = screen.getDisplayMatching(win.getBounds())
    if (
      current.id === target.id &&
      win.isFullScreen() === this.cfg.presenterFullscreen
    ) {
      return
    }
    console.log(
      `[capture] presenter → display ${target.label} (${target.bounds.x},${target.bounds.y} ${target.size.width}×${target.size.height}) fullscreen=${this.cfg.presenterFullscreen}`
    )
    if (win.isFullScreen()) win.setFullScreen(false)
    win.setContentSize(this.cfg.width, this.cfg.height)
    const wb = win.getBounds()
    if (this.cfg.presenterFullscreen) {
      // Move onto the target monitor, then fullscreen there.
      win.setBounds({ x: target.bounds.x, y: target.bounds.y, width: wb.width, height: wb.height })
      win.setFullScreen(true)
    } else {
      const wa = target.workArea
      win.setBounds({
        x: wa.x + Math.max(0, Math.round((wa.width - wb.width) / 2)),
        y: wa.y + Math.max(0, Math.round((wa.height - wb.height) / 2)),
        width: wb.width,
        height: wb.height
      })
    }
  }

  /** Inject the dither overlay into the current document (idempotent). */
  private applyDither(): void {
    const contents = this.contents
    if (!contents || !this.cfg.dither || this.ditherKey) return
    contents
      .insertCSS(DITHER_CSS)
      .then((key) => {
        // If dither was toggled off (or the page navigated) while this insert was in flight,
        // remove it immediately rather than leaving a stuck overlay on the live page.
        if (!this.cfg.dither || this.contents !== contents) {
          contents.removeInsertedCSS(key).catch(() => {})
          return
        }
        this.ditherKey = key
      })
      .catch((e: unknown) => console.error('[capture] dither insertCSS:', (e as Error).message))
  }

  private removeDither(): void {
    const contents = this.contents
    const key = this.ditherKey
    this.ditherKey = null
    if (contents && key) {
      contents.removeInsertedCSS(key).catch(() => {
        /* page may have navigated away — the CSS is already gone */
      })
    }
  }

  /** Re-place the presenter window if a monitor was added/removed/reconfigured. */
  onDisplaysChanged(): void {
    if (this.cfg.mode === 'presenter' && this.win && !this.win.isDestroyed()) {
      this.positionPresenter(this.win)
    }
  }

  private rebuildWindow(): void {
    this.clearCrashTimer()
    const old = this.win
    this.win = null
    this.latest = null
    this.pacer.reset()
    this.teardownWindow(old)
    this.createWindow()
    this.startLoops()
  }

  private teardownWindow(win: BrowserWindow | null): void {
    if (!win || win.isDestroyed()) return
    this.tearingWindow = true
    // Drop our 'closed' listener before destroy so an intentional teardown can never emit a
    // spurious presenterClosed (belt-and-suspenders alongside the tearingWindow guard, in case
    // 'closed' ever fires asynchronously after tearingWindow is reset).
    win.removeAllListeners('closed')
    win.destroy()
    this.tearingWindow = false
  }

  getConfig(): PaneConfig {
    return { ...this.cfg }
  }

  currentNav(): NavState {
    return {
      url: this.currentTarget,
      title: this.contents?.getTitle() ?? '',
      canGoBack: this.contents?.navigationHistory.canGoBack() ?? false,
      canGoForward: this.contents?.navigationHistory.canGoForward() ?? false,
      loading: this.contents?.isLoading() ?? false,
      failure: this.failure,
      unresponsive: this.unresponsive
    }
  }

  /** Test/selfcheck hook: force a renderer crash to prove recovery. */
  crashForTest(): void {
    this.contents?.forcefullyCrashRenderer()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopLoops()
    this.clearCrashTimer()
    this.teardownWindow(this.win)
    this.win = null
    this.latest = null
  }
}
