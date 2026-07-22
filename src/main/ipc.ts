/**
 * IPC boundary. Every inbound payload is zod-parsed; results are
 * { ok } | { ok:false, error } unions — nothing ever throws across IPC.
 */
import { ipcMain, shell } from 'electron'
import type { PaneApp } from './app'

/** External links the app is allowed to open in the default browser (allowlist). */
const ALLOWED_EXTERNAL = ['https://github.com/nacalai/pane', 'https://ndi.video']
import {
  InputEventSchema,
  NavActionSchema,
  NavigateReqSchema,
  SettingsPatchSchema,
  type IpcResult
} from '@shared/schema'
/** Minimal structural view of a zod schema — keeps `data` strongly typed through the generic. */
interface Parser<T> {
  safeParse: (
    raw: unknown
  ) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } }
}

function guarded<T>(
  schema: Parser<T>,
  fn: (payload: T) => IpcResult
): (event: unknown, raw: unknown) => IpcResult {
  return (_event, raw) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: `Invalid request: ${parsed.error.issues[0]?.message ?? 'unknown'}` }
    try {
      return fn(parsed.data)
    } catch (e) {
      console.error('[ipc] handler failed:', e)
      return { ok: false, error: (e as Error).message }
    }
  }
}

export function registerIpc(app: PaneApp): void {
  ipcMain.handle('pane:start', () => {
    try {
      return app.startNdi()
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('pane:stop', () => {
    try {
      return app.stopNdi()
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle(
    'pane:navigate',
    guarded(NavigateReqSchema, (p) => app.navigate(p.url))
  )
  ipcMain.handle(
    'pane:nav-action',
    guarded(NavActionSchema, (p) => {
      app.capture.navAction(p.action)
      return { ok: true, data: null }
    })
  )
  ipcMain.handle(
    'pane:settings',
    guarded(SettingsPatchSchema, (p) => app.applySettings(p))
  )
  ipcMain.handle('pane:get-state', (): IpcResult<ReturnType<PaneApp['state']>> => {
    try {
      return { ok: true, data: app.state() }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  // High-rate fire-and-forget input; invalid events are dropped silently.
  ipcMain.on('pane:input', (_event, raw: unknown) => {
    const parsed = InputEventSchema.safeParse(raw)
    if (parsed.success) app.capture.injectInput(parsed.data)
  })
  // High-rate loopback audio frames from the renderer (planar float32) → NDI.
  ipcMain.on('pane:audio', (_event, data: unknown, sampleRate: unknown, channels: unknown, samples: unknown) => {
    if (
      data instanceof ArrayBuffer &&
      typeof sampleRate === 'number' &&
      typeof channels === 'number' &&
      typeof samples === 'number' &&
      channels > 0 &&
      channels <= 8 &&
      samples > 0
    ) {
      app.pushAudio(Buffer.from(data), sampleRate, channels, samples)
    }
  })
  // Update actions (no payload).
  ipcMain.handle('pane:update-download', () => {
    app.requestUpdateDownload()
    return { ok: true, data: null }
  })
  ipcMain.handle('pane:update-later', () => {
    app.dismissUpdate()
    return { ok: true, data: null }
  })
  ipcMain.handle('pane:update-skip', () => {
    app.skipUpdate()
    return { ok: true, data: null }
  })
  ipcMain.handle('pane:update-restart', () => {
    app.restartForUpdate()
    return { ok: true, data: null }
  })
  // Open a whitelisted external link in the default browser.
  ipcMain.handle('pane:open-external', (_e, raw: unknown) => {
    const url = typeof raw === 'string' ? raw : ''
    if (ALLOWED_EXTERNAL.some((p) => url === p || url.startsWith(p + '/') || url.startsWith(p + '#'))) {
      void shell.openExternal(url)
      return { ok: true, data: null }
    }
    return { ok: false, error: 'link not allowed' }
  })
}
