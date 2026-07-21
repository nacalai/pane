/**
 * VevApp — coordinator that owns NDI status + capture + config and assembles
 * the single VevState pushed to the control UI. All mutations funnel through
 * here so state can never fork between main and renderer.
 */
import { powerSaveBlocker, type BrowserWindow } from 'electron'
import type { ConfigStore } from './config'
import { NdiSender } from './ndi-sender'
import { VevCapture, type CaptureStats } from './capture'
import {
  sanitizeNdiName,
  type IpcResult,
  type NdiStatus,
  type SettingsPatch,
  type VevConfig,
  type VevState
} from '@shared/schema'

export class VevApp {
  readonly sender = new NdiSender()
  readonly capture: VevCapture
  private ndiStatus: NdiStatus = 'off'
  private ndiError: string | null = null
  private ndiVersion: string | null = null
  private runtimeOk = false
  private lastStats: CaptureStats = { sentFps: 0, framesSent: 0, staticPage: true, receivers: 0 }
  private config: VevConfig
  private control: BrowserWindow | null = null
  private psbId: number | null = null
  private downThis = false

  constructor(
    private readonly store: ConfigStore,
    resourcesDir: string
  ) {
    this.config = store.load()
    this.capture = new VevCapture(this.sender, resourcesDir, this.config)
    this.capture.on('nav', () => this.pushState())
    this.capture.on('stats', (s) => {
      this.lastStats = s
      this.pushState()
    })
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
      if (!win.isDestroyed()) win.webContents.send('vev:preview', buf, mime)
    })
    this.capture.on('cursor', (cursor) => {
      if (!win.isDestroyed()) win.webContents.send('vev:cursor', cursor)
    })
  }

  startNdi(): IpcResult {
    if (!this.runtimeOk) {
      return { ok: false, error: this.ndiError ?? 'NDI-runtime er ikke tilgjengelig' }
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
    this.config = { ...this.config, url: this.capture.currentNav().url }
    this.store.save(this.config)
    this.pushState()
    return { ok: true, data: null }
  }

  applySettings(patch: SettingsPatch): IpcResult {
    const next: VevConfig = { ...this.config, ...patch }
    next.ndiName = sanitizeNdiName(next.ndiName)
    const prevName = this.config.ndiName
    this.config = next
    this.store.save(next)
    this.capture.applyConfig(next)
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

  state(): VevState {
    return {
      ndi: this.ndiStatus,
      ndiError: this.ndiError,
      ndiVersion: this.ndiVersion,
      receivers: this.lastStats.receivers,
      sentFps: this.lastStats.sentFps,
      framesSent: this.lastStats.framesSent,
      staticPage: this.lastStats.staticPage,
      nav: this.capture.currentNav(),
      config: { ...this.config }
    }
  }

  pushState(): void {
    if (this.control && !this.control.isDestroyed()) {
      this.control.webContents.send('vev:state', this.state())
    }
  }

  /** Idempotent full teardown — used by before-quit AND crash backstops. */
  shutdown(): void {
    if (this.downThis) return
    this.downThis = true
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
