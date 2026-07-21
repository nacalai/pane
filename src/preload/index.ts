/**
 * Sandboxed preload — bundled to CJS. Exposes ONLY the named VEV surface;
 * no generic ipc bridge. Validation happens in main; this file stays dumb.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

function subscribe<T extends unknown[]>(
  channel: string,
  cb: (...args: T) => void
): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  start: () => ipcRenderer.invoke('vev:start'),
  stop: () => ipcRenderer.invoke('vev:stop'),
  navigate: (url: string) => ipcRenderer.invoke('vev:navigate', { url }),
  navAction: (action: string) => ipcRenderer.invoke('vev:nav-action', { action }),
  setSettings: (patch: unknown) => ipcRenderer.invoke('vev:settings', patch),
  getState: () => ipcRenderer.invoke('vev:get-state'),
  sendInput: (ev: unknown) => {
    ipcRenderer.send('vev:input', ev)
  },
  onState: (cb: (state: unknown) => void) => subscribe('vev:state', cb),
  onPreview: (cb: (data: Uint8Array, mime: string) => void) => subscribe('vev:preview', cb),
  onCursor: (cb: (cursor: string) => void) => subscribe('vev:cursor', cb)
}

contextBridge.exposeInMainWorld('vev', api)
