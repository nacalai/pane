import { z } from 'zod'

/** NDI publishes as "<machine> (<name>)" — parens are stripped so the wrapping stays unambiguous. */
export const NDI_NAME_MAX = 63
export const DEFAULT_NDI_NAME = 'Pane'

export function sanitizeNdiName(s: string): string {
  const cleaned = s
    .replace(/[\u0000-\u001f()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NDI_NAME_MAX)
  return cleaned || DEFAULT_NDI_NAME
}

export const FPS_VALUES = [25, 30, 50, 60] as const
export type Fps = (typeof FPS_VALUES)[number]

/**
 * studio    — hidden offscreen render; operate via the control-UI preview. Pixel-perfect.
 * presenter — visible window (windowed/fullscreen) the presenter uses DIRECTLY;
 *             frames captured from the live window. Same NDI pipeline.
 */
export type PaneMode = 'studio' | 'presenter'

export interface PaneConfig {
  url: string
  ndiName: string
  width: number
  height: number
  fps: Fps
  transparent: boolean
  localAudio: boolean
  autoStart: boolean
  dither: boolean
  showPreview: boolean
  showCursor: boolean
  mode: PaneMode
  presenterFullscreen: boolean
  presenterDisplayId: number
  httpEnabled: boolean
  httpPort: number
  httpLan: boolean
  httpToken: string
  launchAtLogin: boolean
  startMinimized: boolean
}

export const DEFAULT_HTTP_PORT = 9350

export const DEFAULT_CONFIG: PaneConfig = {
  url: 'pane:testcard',
  ndiName: DEFAULT_NDI_NAME,
  width: 1920,
  height: 1080,
  fps: 30,
  transparent: false,
  localAudio: false,
  autoStart: true,
  dither: false,
  showPreview: true,
  showCursor: false,
  mode: 'studio',
  presenterFullscreen: false,
  presenterDisplayId: 0,
  httpEnabled: true,
  httpPort: DEFAULT_HTTP_PORT,
  httpLan: false,
  httpToken: '',
  launchAtLogin: false,
  startMinimized: false
}

const fpsSchema = z.union([z.literal(25), z.literal(30), z.literal(50), z.literal(60)])

/** Partial config — used both as settings patch over IPC and to parse stored config. No defaults here. */
export const SettingsPatchSchema = z
  .object({
    url: z.string().min(1).max(4096),
    ndiName: z.string().min(1).max(NDI_NAME_MAX),
    width: z.number().int().min(320).max(3840),
    height: z.number().int().min(240).max(2160),
    fps: fpsSchema,
    transparent: z.boolean(),
    localAudio: z.boolean(),
    autoStart: z.boolean(),
    dither: z.boolean(),
    showPreview: z.boolean(),
    showCursor: z.boolean(),
    mode: z.enum(['studio', 'presenter']),
    presenterFullscreen: z.boolean(),
    // 0 = follow primary display; otherwise an Electron display id.
    presenterDisplayId: z.number().int().min(0),
    httpEnabled: z.boolean(),
    httpPort: z.number().int().min(1024).max(65535),
    httpLan: z.boolean(),
    httpToken: z.string().max(128),
    launchAtLogin: z.boolean(),
    startMinimized: z.boolean()
  })
  .partial()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

/** Stored/foreign config → PaneConfig. Any failure yields defaults — a broken file must never brick the app. */
export function parseConfig(raw: unknown): PaneConfig {
  const res = SettingsPatchSchema.safeParse(raw)
  if (!res.success) return { ...DEFAULT_CONFIG }
  const merged = { ...DEFAULT_CONFIG, ...res.data }
  merged.ndiName = sanitizeNdiName(merged.ndiName)
  return merged
}

// ---------- IPC payloads (renderer → main). Everything is parsed at the boundary. ----------

export const NavigateReqSchema = z.object({ url: z.string().min(1).max(4096) })

export const NavActionSchema = z.object({
  action: z.enum(['back', 'forward', 'reload', 'force-reload'])
})
export type NavAction = z.infer<typeof NavActionSchema>['action']

const norm = z.number().min(0).max(1)
const modifiersSchema = z.array(z.enum(['shift', 'control', 'alt', 'meta'])).max(4).default([])
export type InputModifier = 'shift' | 'control' | 'alt' | 'meta'

export const InputEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), x: norm, y: norm, modifiers: modifiersSchema }),
  z.object({
    kind: z.literal('down'),
    x: norm,
    y: norm,
    button: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    clickCount: z.number().int().min(1).max(3),
    modifiers: modifiersSchema
  }),
  z.object({
    kind: z.literal('up'),
    x: norm,
    y: norm,
    button: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    clickCount: z.number().int().min(1).max(3),
    modifiers: modifiersSchema
  }),
  z.object({
    kind: z.literal('wheel'),
    x: norm,
    y: norm,
    deltaX: z.number().finite(),
    deltaY: z.number().finite(),
    modifiers: modifiersSchema
  }),
  z.object({
    kind: z.literal('key'),
    direction: z.enum(['down', 'up']),
    key: z.string().min(1).max(32),
    modifiers: modifiersSchema
  })
])
export type InputEventReq = z.infer<typeof InputEventSchema>

// ---------- State pushed main → renderer (internal, TS types suffice). ----------

export type NdiStatus = 'off' | 'live' | 'no-runtime' | 'error'

/** A connected monitor, for the presenter-window display picker. */
export interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

export interface NavFailure {
  code: number
  description: string
  url: string
}

export interface NavState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  failure: NavFailure | null
  unresponsive: boolean
}

export interface PaneState {
  ndi: NdiStatus
  ndiError: string | null
  ndiVersion: string | null
  receivers: number
  sentFps: number
  framesSent: number
  staticPage: boolean
  presenterFullscreen: boolean
  httpError: string | null
  displays: DisplayInfo[]
  nav: NavState
  config: PaneConfig
}

export type IpcResult<T = null> = { ok: true; data: T } | { ok: false; error: string }
