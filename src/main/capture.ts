/**
 * VevCapture — the engine. Owns the content window and everything that happens
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
import { BrowserWindow, screen, session, type WebContents } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { mapInput } from './input-map'
import { Pacer } from './pacer'
import type { NdiSender } from './ndi-sender'
import { INTERNAL_TESTCARD, normalizeUrl } from '@shared/url'
import type { Fps, InputEventReq, NavAction, NavState, VevConfig } from '@shared/schema'

const PARTITION = 'persist:vev-content'
const PREVIEW_INTERVAL_MS = 100
const PREVIEW_WIDTH = 640
const PREVIEW_JPEG_QUALITY = 65
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

export class VevCapture extends EventEmitter<CaptureEvents> {
  private win: BrowserWindow | null = null
  private cfg: VevConfig
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
    initialCfg: VevConfig
  ) {
    super()
    this.cfg = { ...initialCfg }
  }

  private get contents(): WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null
  }

  start(): void {
    if (this.disposed) throw new Error('VevCapture is disposed')
    if (this.win) return
    this.createWindow()
    this.startLoops()
    const r = this.navigate(this.cfg.url)
    if (!r.ok) {
      // A corrupt persisted URL must never yield silent black output.
      console.warn(`[capture] lagret adresse avvist (${r.error}) — laster testkortet`)
      this.loadTarget(INTERNAL_TESTCARD)
    }
  }

  private createWindow(): void {
    const ses = session.fromPartition(PARTITION)
    if (!VevCapture.sessionWired) {
      VevCapture.sessionWired = true
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
      resizable: false,
      fullscreenable: true,
      autoHideMenuBar: true,
      title: 'VEV — presenter',
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
    contents.on('did-start-loading', push)
    contents.on('did-stop-loading', push)
    contents.on('did-navigate', push)
    contents.on('did-navigate-in-page', push)
    contents.on('page-title-updated', push)
    contents.on('did-finish-load', () => {
      this.crashCount = 0
      this.pushNav()
    })

    contents.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return
      // The errorcard ITSELF failed (e.g. resources missing/misdeployed). Never reload it —
      // that recurses, nesting the failed URL into an ever-growing query string. Stop here;
      // the control-UI banner still surfaces the failure.
      if (validatedURL.includes('errorcard.html')) {
        console.error('[capture] errorcard.html kunne ikke lastes — viser kun banner')
        this.failure = { code, description: 'Ressursfil mangler (errorcard.html)', url: this.currentTarget }
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
          description: `Nettleserprosessen krasjet gjentatte ganger (${details.reason})`,
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
    this.pacer.onFrame(Date.now())

    const now = Date.now()
    if (now - this.lastPreviewAt >= PREVIEW_INTERVAL_MS) {
      this.lastPreviewAt = now
      try {
        const small = img.resize({ width: PREVIEW_WIDTH })
        if (this.cfg.transparent && this.cfg.mode === 'studio') {
          this.emit('preview', small.toPNG(), 'image/png')
        } else {
          this.emit('preview', small.toJPEG(PREVIEW_JPEG_QUALITY), 'image/jpeg')
        }
      } catch (e) {
        console.error('[capture] preview encode:', (e as Error).message)
      }
    }
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
          this.sender.sendFrame(this.latest, this.cfg.width, this.cfg.height, FPS_N[this.cfg.fps], 1000)
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
  navigate(input: string): { ok: true } | { ok: false; error: string } {
    const res = normalizeUrl(input)
    if (!res.ok) return res
    this.failure = null
    this.loadTarget(res.url)
    return { ok: true }
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
    // Internal file:// pages keep the *intended* target in the URL bar.
    const displayUrl = rawUrl.startsWith('file:') || !rawUrl ? this.currentTarget : rawUrl
    if (!rawUrl.startsWith('file:') && rawUrl) this.currentTarget = rawUrl
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
    if (req.kind === 'down') contents.focus() // keyboard follows the click, like a real browser
    for (const ev of mapInput(req, this.cfg.width, this.cfg.height)) {
      contents.sendInputEvent(ev)
    }
  }

  // ---------- settings ----------

  /** Apply a new full config. Returns true if the change required a window rebuild. */
  applyConfig(next: VevConfig): boolean {
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
    console.log(
      `[capture] presenter → skjerm ${target.label} (${target.bounds.x},${target.bounds.y} ${target.size.width}×${target.size.height}) fullscreen=${this.cfg.presenterFullscreen}`
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
    win.destroy()
    this.tearingWindow = false
  }

  getConfig(): VevConfig {
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
