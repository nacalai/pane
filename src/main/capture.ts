/**
 * VevCapture — the engine. Owns the offscreen content window and everything
 * that happens to its pixels:
 *
 *   paint (BGRA NativeImage) ──► latest frame buffer ──► paced send loop ──► NdiSender
 *                            └─► time-gated preview (JPEG/PNG) ──► control UI
 *
 * Also: navigation state, input injection, crash/hang/load-failure recovery.
 * The offscreen CPU path requires app.disableHardwareAcceleration() — done in index.ts.
 */
import { BrowserWindow, session, type WebContents } from 'electron'
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
}

export class VevCapture extends EventEmitter<CaptureEvents> {
  private win: BrowserWindow | null = null
  private cfg: VevConfig
  private latest: Buffer | null = null
  private readonly pacer = new Pacer()
  private sendTimer: NodeJS.Timeout | null = null
  private statsTimer: NodeJS.Timeout | null = null
  private lastPreviewAt = 0
  private warnedScale = false
  private crashCount = 0
  private crashReloadTimer: NodeJS.Timeout | null = null
  private disposed = false

  /** What the URL bar shows and what reload retries — the *intended* target, never a file:// path. */
  private currentTarget: string = INTERNAL_TESTCARD
  private failure: NavState['failure'] = null
  private unresponsive = false
  private static permissionsWired = false

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
    this.navigate(this.cfg.url)
  }

  private createWindow(): void {
    const ses = session.fromPartition(PARTITION)
    if (!VevCapture.permissionsWired) {
      VevCapture.permissionsWired = true
      // The content window renders arbitrary remote pages: deny every permission prompt.
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    }

    const win = new BrowserWindow({
      show: false,
      width: this.cfg.width,
      height: this.cfg.height,
      useContentSize: true,
      transparent: this.cfg.transparent,
      frame: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: PARTITION,
        backgroundThrottling: false
      }
    })
    this.win = win
    const contents = win.webContents
    contents.setFrameRate(this.cfg.fps)
    contents.setAudioMuted(!this.cfg.localAudio)

    contents.on('paint', (_event, _dirty, image) => {
      if (this.disposed) return
      let img = image
      const size = image.getSize()
      if (size.width !== this.cfg.width || size.height !== this.cfg.height) {
        if (!this.warnedScale) {
          this.warnedScale = true
          console.warn(
            `[capture] paint ${size.width}x${size.height} != config ${this.cfg.width}x${this.cfg.height} — resizing (check force-device-scale-factor)`
          )
        }
        img = image.resize({ width: this.cfg.width, height: this.cfg.height })
      }
      this.latest = img.toBitmap() // BGRA copy; getBitmap()'s view is only valid this tick
      this.pacer.onFrame(Date.now())

      const now = Date.now()
      if (now - this.lastPreviewAt >= PREVIEW_INTERVAL_MS) {
        this.lastPreviewAt = now
        try {
          const small = img.resize({ width: PREVIEW_WIDTH })
          if (this.cfg.transparent) this.emit('preview', small.toPNG(), 'image/png')
          else this.emit('preview', small.toJPEG(PREVIEW_JPEG_QUALITY), 'image/jpeg')
        } catch (e) {
          console.error('[capture] preview encode:', (e as Error).message)
        }
      }
    })

    contents.on('cursor-changed', (_e, type) => this.emit('cursor', type))

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
      this.failure = { code, description, url: validatedURL || this.currentTarget }
      this.loadErrorCard()
      this.pushNav()
    })

    contents.on('render-process-gone', (_e, details) => {
      if (this.disposed || details.reason === 'clean-exit') return
      this.crashCount += 1
      console.error(`[capture] renderer gone (${details.reason}), attempt ${this.crashCount}`)
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

  private startLoops(): void {
    this.stopLoops()
    const intervalMs = Math.max(4, Math.round(1000 / this.cfg.fps))
    this.sendTimer = setInterval(() => {
      if (!this.latest || !this.sender.isLive()) return
      const decision = this.pacer.onTick(Date.now())
      if (decision.send) {
        this.sender.sendFrame(
          this.latest,
          this.cfg.width,
          this.cfg.height,
          FPS_N[this.cfg.fps],
          1000
        )
      }
    }, intervalMs)
    this.statsTimer = setInterval(() => {
      const stats = this.pacer.stats(Date.now())
      this.emit('stats', { ...stats, receivers: this.sender.connections() })
    }, STATS_INTERVAL_MS)
  }

  private stopLoops(): void {
    if (this.sendTimer) clearInterval(this.sendTimer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.sendTimer = null
    this.statsTimer = null
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

    if (next.transparent !== prev.transparent) {
      // `transparent` is immutable per-window: rebuild and restore the target.
      const target = this.currentTarget
      this.rebuildWindow()
      this.loadTarget(target)
      return true
    }
    if (next.width !== prev.width || next.height !== prev.height) {
      this.warnedScale = false
      this.latest = null // old-size frames must not reach NDI with the new dimensions
      this.win.setContentSize(next.width, next.height)
      this.contents?.invalidate()
    }
    if (next.fps !== prev.fps) {
      this.contents?.setFrameRate(next.fps)
      this.startLoops()
    }
    if (next.localAudio !== prev.localAudio) {
      this.contents?.setAudioMuted(!next.localAudio)
    }
    if (next.ndiName !== prev.ndiName && this.currentTarget === INTERNAL_TESTCARD) {
      this.loadTarget(INTERNAL_TESTCARD) // testcard displays the NDI name — refresh it
    }
    return false
  }

  private rebuildWindow(): void {
    const old = this.win
    this.win = null
    this.latest = null
    this.pacer.reset()
    if (old && !old.isDestroyed()) old.destroy()
    this.createWindow()
    this.startLoops()
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
    if (this.crashReloadTimer) clearTimeout(this.crashReloadTimer)
    this.crashReloadTimer = null
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.latest = null
  }
}
