/**
 * IPC boundary. Every inbound payload is zod-parsed; results are
 * { ok } | { ok:false, error } unions — nothing ever throws across IPC.
 */
import { ipcMain } from 'electron'
import type { PaneApp } from './app'
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
}
