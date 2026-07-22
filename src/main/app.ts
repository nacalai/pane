/**
 * PaneApp — coordinator that owns NDI status + capture + config and assembles
 * the single PaneState pushed to the control UI. All mutations funnel through
 * here so state can never fork between main and renderer.
 */
import { powerSaveBlocker, type BrowserWindow } from 'electron'
import type { ConfigStore } from './config'
import { NdiSender } from './ndi-sender'
import { PaneCapture, type CaptureStats } from './capture'
import { ControlServer } from './control-server'
import type { ControlCommand } from '@shared/control-routes'
import {
  sanitizeNdiName,
  type DisplayInfo,
  type IpcResult,
  type NdiStatus,
  type SettingsPatch,
  type PaneConfig,
  type PaneState,
  type UpdateInfo
} from '@shared/schema'

export class PaneApp {
  readonly sender = new NdiSender()
  readonly capture: PaneCapture
  private ndiStatus: NdiStatus = 'off'
  private ndiError: string | null = null
  private ndiVersion: string | null = null
  private runtimeOk = false
  private lastStats: CaptureStats = { sentFps: 0, framesSent: 0, staticPage: true, receivers: 0 }
  private config: PaneConfig
  private control: BrowserWindow | null = null
  private psbId: number | null = null
  private downThis = false
  private displays: DisplayInfo[] = []
  private update: UpdateInfo | null = null
  private updateActions: { download: () => void; restart: () => void } | null = null

  readonly http = new ControlServer((cmd) => this.execCommand(cmd))

  /** index.ts wires the actual electron-updater download/quitAndInstall calls here. */
  onUpdateActions(actions: { download: () => void; restart: () => void }): void {
    this.updateActions = actions
  }

  /** An update is available (never auto-downloaded). Skip if the user chose to skip this version. */
  presentUpdate(version: string, notes: string): void {
    if (version === this.config.skipUpdateVersion) return
    this.update = { version, notes, downloaded: false, downloading: false }
    this.pushState()
  }

  markUpdateDownloaded(): void {
    if (this.update) this.update = { ...this.update, downloaded: true, downloading: false }
    this.pushState()
  }

  /** User chose to update → start the download. */
  requestUpdateDownload(): void {
    if (!this.update) return
    this.update = { ...this.update, downloading: true }
    this.pushState()
    this.updateActions?.download()
  }

  /** "Remind me later" — dismiss for now; it re-appears on the next check. */
  dismissUpdate(): void {
    this.update = null
    this.pushState()
  }

  /** "Don't remind me for this version". */
  skipUpdate(): void {
    if (this.update) this.applySettings({ skipUpdateVersion: this.update.version })
    this.update = null
    this.pushState()
  }

  restartForUpdate(): void {
    this.updateActions?.restart()
  }

  /** Planar float32 loopback audio from the renderer → NDI (only while enabled + live). */
  pushAudio(planar: Buffer, sampleRate: number, channels: number, samples: number): void {
    if (this.config.ndiAudio && this.sender.isLive()) {
      this.sender.sendAudio(planar, sampleRate, channels, samples)
    }
  }

  /** index.ts feeds the connected-monitor list here (and on hotplug). */
  setDisplays(displays: DisplayInfo[]): void {
    this.displays = displays
    this.capture.onDisplaysChanged()
    this.pushState()
  }

  constructor(
    private readonly store: ConfigStore,
    resourcesDir: string
  ) {
    this.config = store.load()
    this.capture = new PaneCapture(this.sender, resourcesDir, this.config)
    this.capture.on('nav', () => this.pushState())
    this.capture.on('stats', (s) => {
      this.lastStats = s
      this.pushState()
    })
    // Presenter closed their window → drop back to hidden studio mode.
    this.capture.on('presenterClosed', () => {
      const r = this.applySettings({ mode: 'studio' })
      if (!r.ok) console.error('[app] returning to studio mode failed:', r.error)
    })
  }

  startHttp(): void {
    this.http.apply({
      enabled: this.config.httpEnabled,
      port: this.config.httpPort,
      lan: this.config.httpLan,
      token: this.config.httpToken
    })
  }

  /** Stream Deck / Companion command → the same paths the UI uses. */
  execCommand(cmd: ControlCommand): { ok: true; data: unknown } | { ok: false; error: string } {
    switch (cmd.kind) {
      case 'status':
        return { ok: true, data: this.state() }
      case 'nav':
        this.capture.navAction(cmd.action)
        return { ok: true, data: null }
      case 'go': {
        const r = this.navigate(cmd.url)
        return r.ok ? { ok: true, data: null } : r
      }
      case 'testcard': {
        const r = this.navigate('pane:testcard')
        return r.ok ? { ok: true, data: null } : r
      }
      case 'key':
        this.capture.injectInput({ kind: 'key', direction: 'down', key: cmd.key, modifiers: cmd.modifiers })
        this.capture.injectInput({ kind: 'key', direction: 'up', key: cmd.key, modifiers: cmd.modifiers })
        return { ok: true, data: null }
      case 'scroll':
        // DOM convention in, input-map inverts to Chromium's.
        this.capture.injectInput({
          kind: 'wheel',
          x: 0.5,
          y: 0.5,
          deltaX: cmd.dx,
          deltaY: cmd.dy,
          modifiers: []
        })
        return { ok: true, data: null }
      case 'click':
        this.capture.injectInput({
          kind: 'down',
          x: cmd.x,
          y: cmd.y,
          button: cmd.button,
          clickCount: 1,
          modifiers: []
        })
        this.capture.injectInput({
          kind: 'up',
          x: cmd.x,
          y: cmd.y,
          button: cmd.button,
          clickCount: 1,
          modifiers: []
        })
        return { ok: true, data: null }
      case 'ndi': {
        const r = cmd.on ? this.startNdi() : this.stopNdi()
        return r.ok ? { ok: true, data: null } : r
      }
      case 'mode': {
        const patch: SettingsPatch = { mode: cmd.mode }
        if (cmd.mode === 'presenter') {
          if (cmd.fullscreen !== undefined) patch.presenterFullscreen = cmd.fullscreen
          if (cmd.displayId !== undefined) patch.presenterDisplayId = cmd.displayId
        }
        const r = this.applySettings(patch)
        return r.ok ? { ok: true, data: null } : r
      }
    }
  }

  /** Load the NDI runtime (not the sender). Called once at startup. */
  initNdiRuntime(): void {
    const r = this.sender.init()
    if (r.ok) {
      this.runtimeOk = true
      this.ndiVersion = r.version
    } else {
      this.ndiStatus = 'no-runtime'
      this.ndiError = r.error
    }
  }

  attachControl(win: BrowserWindow): void {
    this.control = win
    this.capture.on('preview', (buf, mime) => {
      if (!win.isDestroyed()) win.webContents.send('pane:preview', buf, mime)
    })
    this.capture.on('cursor', (cursor) => {
      if (!win.isDestroyed()) win.webContents.send('pane:cursor', cursor)
    })
  }

  startNdi(): IpcResult {
    if (!this.runtimeOk) {
      return { ok: false, error: this.ndiError ?? 'NDI runtime is not available' }
    }
    const r = this.sender.createSender(this.config.ndiName)
    if (!r.ok) {
      this.ndiStatus = 'error'
      this.ndiError = r.error
      this.pushState()
      return r
    }
    this.ndiStatus = 'live'
    this.ndiError = null
    if (this.psbId === null) this.psbId = powerSaveBlocker.start('prevent-app-suspension')
    this.pushState()
    return { ok: true, data: null }
  }

  stopNdi(): IpcResult {
    this.sender.destroySender()
    if (this.ndiStatus === 'live' || this.ndiStatus === 'error') this.ndiStatus = 'off'
    if (this.psbId !== null && powerSaveBlocker.isStarted(this.psbId)) {
      powerSaveBlocker.stop(this.psbId)
    }
    this.psbId = null
    this.pushState()
    return { ok: true, data: null }
  }

  navigate(url: string): IpcResult {
    const r = this.capture.navigate(url)
    if (!r.ok) return r
    // Persist the normalized target we actually navigated to (r.url) — NOT currentNav(),
    // which still reports the pre-commit page and would save the previous URL.
    this.config = { ...this.config, url: r.url }
    this.store.save(this.config)
    this.pushState()
    return { ok: true, data: null }
  }

  private loginItemHandler: ((cfg: PaneConfig) => void) | null = null

  /** index.ts registers this to sync the OS login item (packaged-only). */
  onLoginItemChange(cb: (cfg: PaneConfig) => void): void {
    this.loginItemHandler = cb
  }

  applySettings(patch: SettingsPatch): IpcResult {
    const next: PaneConfig = { ...this.config, ...patch }
    next.ndiName = sanitizeNdiName(next.ndiName)
    const prevName = this.config.ndiName
    const httpChanged =
      next.httpEnabled !== this.config.httpEnabled ||
      next.httpPort !== this.config.httpPort ||
      next.httpLan !== this.config.httpLan ||
      next.httpToken !== this.config.httpToken
    const loginChanged = next.launchAtLogin !== this.config.launchAtLogin
    this.config = next
    this.store.save(next)
    this.capture.applyConfig(next)
    if (loginChanged && this.loginItemHandler) this.loginItemHandler(next)
    if (httpChanged) {
      this.http.apply({
        enabled: next.httpEnabled,
        port: next.httpPort,
        lan: next.httpLan,
        token: next.httpToken
      })
    }
    if (next.ndiName !== prevName && this.sender.isLive()) {
      // NDI has no rename — recreate the sender under the new name.
      this.sender.destroySender()
      const r = this.sender.createSender(next.ndiName)
      if (!r.ok) {
        this.ndiStatus = 'error'
        this.ndiError = r.error
        this.pushState()
        return r
      }
    }
    this.pushState()
    return { ok: true, data: null }
  }

  state(): PaneState {
    return {
      ndi: this.ndiStatus,
      ndiError: this.ndiError,
      ndiVersion: this.ndiVersion,
      receivers: this.lastStats.receivers,
      sentFps: this.lastStats.sentFps,
      framesSent: this.lastStats.framesSent,
      staticPage: this.lastStats.staticPage,
      presenterFullscreen: this.capture.isPresenterFullscreen(),
      httpError: this.http.error,
      displays: this.displays,
      update: this.update,
      nav: this.capture.currentNav(),
      config: { ...this.config }
    }
  }

  pushState(): void {
    if (this.control && !this.control.isDestroyed()) {
      this.control.webContents.send('pane:state', this.state())
    }
  }

  /** Idempotent full teardown — used by before-quit AND crash backstops. */
  shutdown(): void {
    if (this.downThis) return
    this.downThis = true
    try {
      this.http.stop()
    } catch {
      /* ignore */
    }
    try {
      this.capture.dispose()
    } catch {
      /* teardown must never throw */
    }
    try {
      this.sender.shutdown()
    } catch {
      /* ignore */
    }
    if (this.psbId !== null && powerSaveBlocker.isStarted(this.psbId)) {
      try {
        powerSaveBlocker.stop(this.psbId)
      } catch {
        /* ignore */
      }
    }
  }
}
