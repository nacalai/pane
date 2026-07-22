/**
 * Sandboxed preload — bundled to CJS. Exposes ONLY the named Pane surface;
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
  start: () => ipcRenderer.invoke('pane:start'),
  stop: () => ipcRenderer.invoke('pane:stop'),
  navigate: (url: string) => ipcRenderer.invoke('pane:navigate', { url }),
  navAction: (action: string) => ipcRenderer.invoke('pane:nav-action', { action }),
  setSettings: (patch: unknown) => ipcRenderer.invoke('pane:settings', patch),
  getState: () => ipcRenderer.invoke('pane:get-state'),
  sendInput: (ev: unknown) => {
    ipcRenderer.send('pane:input', ev)
  },
  openExternal: (url: string) => ipcRenderer.invoke('pane:open-external', url),
  updateDownload: () => ipcRenderer.invoke('pane:update-download'),
  updateLater: () => ipcRenderer.invoke('pane:update-later'),
  updateSkip: () => ipcRenderer.invoke('pane:update-skip'),
  updateRestart: () => ipcRenderer.invoke('pane:update-restart'),
  onState: (cb: (state: unknown) => void) => subscribe('pane:state', cb),
  onPreview: (cb: (data: Uint8Array, mime: string) => void) => subscribe('pane:preview', cb),
  onCursor: (cb: (cursor: string) => void) => subscribe('pane:cursor', cb)
}

contextBridge.exposeInMainWorld('pane', api)
