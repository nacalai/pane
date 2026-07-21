import type {
  InputEventReq,
  IpcResult,
  NavAction,
  SettingsPatch,
  VevState
} from './schema'

/** The full preload surface. Named channels only — no generic IPC. */
export interface VevApi {
  start: () => Promise<IpcResult>
  stop: () => Promise<IpcResult>
  navigate: (url: string) => Promise<IpcResult>
  navAction: (action: NavAction) => Promise<IpcResult>
  setSettings: (patch: SettingsPatch) => Promise<IpcResult>
  getState: () => Promise<IpcResult<VevState>>
  sendInput: (ev: InputEventReq) => void
  onState: (cb: (state: VevState) => void) => () => void
  onPreview: (cb: (data: Uint8Array, mime: string) => void) => () => void
  onCursor: (cb: (cursor: string) => void) => () => void
}

declare global {
  interface Window {
    vev: VevApi
  }
}
