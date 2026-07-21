/**
 * Real NDI output via koffi FFI into Processing.NDI.Lib.x64.dll — no native compilation.
 * Adapted from creavid-gjest (proven on this machine, NDI 6.3.x runtime). Pane sends BGRA:
 * Electron's offscreen paint hands us BGRA bitmaps, and BGRA is a first-class NDI FourCC,
 * so frames pass through with zero pixel conversion. Alpha is premultiplied on both sides.
 *
 * Every entry point returns result values instead of throwing: a missing NDI runtime must
 * degrade to "no-runtime" status in the UI, never crash the app.
 */
import { existsSync } from 'node:fs'
import { join, dirname, delimiter } from 'node:path'
import koffi, { type TypeObject } from 'koffi'

/** koffi 3 dropped the KoffiFunction type; native calls take/return unknown. */
type NativeFn = (...args: unknown[]) => unknown

/** 'B','G','R','A' little-endian — used only when the page has real transparency. */
export const FOURCC_BGRA = 0x41524742
/** 'B','G','R','X' — opaque: NDI skips the alpha plane (cleaner + lighter). Default. */
export const FOURCC_BGRX = 0x58524742
const FRAME_FORMAT_PROGRESSIVE = 1
/** NDI timecodes are in 100 ns units (10,000,000 per second). */
const TIMECODE_UNITS_PER_SEC = 10_000_000

export type NdiInitResult = { ok: true; version: string } | { ok: false; error: string }
export type NdiResult = { ok: true } | { ok: false; error: string }

function dllCandidates(): string[] {
  const names = ['Processing.NDI.Lib.x64.dll']
  const dirs: string[] = []
  for (const k of ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5', 'NDI_RUNTIME_DIR_V4']) {
    const v = process.env[k]
    if (v) dirs.push(v)
  }
  dirs.push('C:\\Program Files\\NDI\\NDI 6 Runtime\\v6')
  dirs.push('C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime')
  dirs.push('C:\\Program Files\\NDI\\NDI 5 Runtime\\v5')
  return dirs.flatMap((d) => names.map((n) => join(d, n)))
}

export class NdiSender {
  private fns: Record<string, NativeFn> | null = null
  private types: Record<string, TypeObject> = {}
  private send: unknown = null
  private find: unknown = null
  private senderName = ''
  private warnedBadFrame = false
  private loggedFourcc = false
  /** Even, monotonic frame clock (100 ns units). Regular timecodes let receivers sync with a
   *  small buffer; synthesized (send-time) timecodes jitter and make OBS buffer up to ~1s. */
  private timecodeAccum = 0

  /** Load DLL + NDIlib_initialize + a find instance. Call once; safe to call again after failure. */
  init(): NdiInitResult {
    if (this.fns) return { ok: true, version: this.versionString() }
    try {
      const dllPath = dllCandidates().find((p) => existsSync(p))
      if (!dllPath) return { ok: false, error: 'NDI runtime not found — install NDI Tools (ndi.video)' }
      const dllDir = dirname(dllPath)
      if (!process.env.PATH?.split(delimiter).includes(dllDir)) {
        process.env.PATH = dllDir + delimiter + process.env.PATH
      }
      const lib = koffi.load(dllPath)

      // koffi keeps a global type registry — struct names must only ever be registered once.
      const NDIlib_source_t = koffi.struct('NDIlib_source_t', {
        p_ndi_name: 'char*',
        p_url_address: 'char*'
      })
      void koffi.struct('NDIlib_find_create_t', {
        show_local_sources: 'bool',
        p_groups: 'char*',
        p_extra_ips: 'char*'
      })
      void koffi.struct('NDIlib_send_create_t', {
        p_ndi_name: 'char*',
        p_groups: 'char*',
        clock_video: 'bool',
        clock_audio: 'bool'
      })
      const NDIlib_video_frame_v2_t = koffi.struct('NDIlib_video_frame_v2_t', {
        xres: 'int',
        yres: 'int',
        FourCC: 'int',
        frame_rate_N: 'int',
        frame_rate_D: 'int',
        picture_aspect_ratio: 'float',
        frame_format_type: 'int',
        timecode: 'int64',
        p_data: 'uint8*',
        line_stride_in_bytes: 'int',
        p_metadata: 'char*',
        timestamp: 'int64'
      })
      this.types = { NDIlib_source_t, NDIlib_video_frame_v2_t }

      this.fns = {
        initialize: lib.func('bool NDIlib_initialize()'),
        destroy: lib.func('void NDIlib_destroy()'),
        version: lib.func('const char* NDIlib_version()'),
        send_create: lib.func('void* NDIlib_send_create(NDIlib_send_create_t* p)'),
        send_destroy: lib.func('void NDIlib_send_destroy(void* p)'),
        send_video: lib.func('void NDIlib_send_send_video_v2(void* p, NDIlib_video_frame_v2_t* f)'),
        send_connections: lib.func('int NDIlib_send_get_no_connections(void* p, uint32_t timeout_ms)'),
        find_create: lib.func('void* NDIlib_find_create_v2(NDIlib_find_create_t* p)'),
        find_destroy: lib.func('void NDIlib_find_destroy(void* p)'),
        find_get: lib.func('NDIlib_source_t* NDIlib_find_get_current_sources(void* p, _Out_ uint32_t* n)')
      }

      if (!this.fns.initialize!()) {
        this.fns = null
        return { ok: false, error: 'NDIlib_initialize() failed (CPU support/license)' }
      }
      this.find = this.fns.find_create!({ show_local_sources: true, p_groups: null, p_extra_ips: null })
      return { ok: true, version: this.versionString() }
    } catch (e) {
      this.fns = null
      return { ok: false, error: `NDI load failed: ${(e as Error).message}` }
    }
  }

  private versionString(): string {
    try {
      return (this.fns?.version!() as string)?.toString().trim() || 'NDI'
    } catch {
      return 'NDI'
    }
  }

  /** Publish the named sender. clock_video=false: Pane paces frames itself. */
  createSender(name: string): NdiResult {
    if (!this.fns) return { ok: false, error: 'NDI runtime is not loaded' }
    if (this.send && this.senderName === name) return { ok: true }
    this.destroySender()
    this.timecodeAccum = 0
    try {
      this.send = this.fns.send_create!({
        p_ndi_name: name,
        p_groups: null,
        clock_video: false,
        clock_audio: false
      })
      if (!this.send) return { ok: false, error: `Could not create NDI source "${name}"` }
      this.senderName = name
      return { ok: true }
    } catch (e) {
      this.send = null
      return { ok: false, error: `NDI send_create failed: ${(e as Error).message}` }
    }
  }

  destroySender(): void {
    if (!this.send) return
    try {
      this.fns?.send_destroy!(this.send)
    } catch {
      /* teardown must never throw */
    }
    this.send = null
    this.senderName = ''
  }

  isLive(): boolean {
    return this.send !== null
  }

  /**
   * Push one 32-bit little-endian frame. `opaque` picks BGRX (no alpha plane — NDI's
   * cleaner, lighter opaque SpeedHQ path) vs BGRA when the page has real transparency.
   * Returns false (and logs once) on a size mismatch instead of corrupting.
   */
  sendFrame(bgra: Buffer, w: number, h: number, fpsN: number, fpsD: number, opaque: boolean): boolean {
    if (!this.fns || !this.send) return false
    if (bgra.byteLength !== w * h * 4) {
      if (!this.warnedBadFrame) {
        this.warnedBadFrame = true
        console.error(`[ndi] frame size mismatch: got ${bgra.byteLength}, expected ${w * h * 4}`)
      }
      return false
    }
    if (!this.loggedFourcc) {
      this.loggedFourcc = true
      console.log(`[ndi] sender FourCC = ${opaque ? 'BGRX (opaque)' : 'BGRA (alpha)'}`)
    }
    const timecode = BigInt(Math.round(this.timecodeAccum))
    this.timecodeAccum += (TIMECODE_UNITS_PER_SEC * fpsD) / fpsN // exactly one frame duration
    this.fns.send_video!(this.send, {
      xres: w,
      yres: h,
      FourCC: opaque ? FOURCC_BGRX : FOURCC_BGRA,
      frame_rate_N: fpsN,
      frame_rate_D: fpsD,
      picture_aspect_ratio: w / h,
      frame_format_type: FRAME_FORMAT_PROGRESSIVE,
      timecode,
      p_data: bgra,
      line_stride_in_bytes: w * 4,
      p_metadata: null,
      timestamp: 0n
    })
    return true
  }

  /** Receivers currently pulling this source (0 when off/unavailable). */
  connections(): number {
    if (!this.fns || !this.send) return 0
    try {
      return Number(this.fns.send_connections!(this.send, 0)) | 0
    } catch {
      return 0
    }
  }

  /** Current NDI source names on the network (self-check that "… (Pane)" is visible). */
  findSources(): string[] {
    if (!this.fns || !this.find) return []
    try {
      const count = [0]
      const ptr = this.fns.find_get!(this.find, count)
      const n = (count[0] ?? 0) | 0
      if (!n || !ptr) return []
      const decoded = koffi.decode(ptr, this.types.NDIlib_source_t!, n) as Array<{ p_ndi_name: string }>
      return decoded.map((s) => (s.p_ndi_name || '').toString()).filter(Boolean)
    } catch {
      return []
    }
  }

  shutdown(): void {
    this.destroySender()
    try {
      if (this.find) this.fns?.find_destroy!(this.find)
    } catch {
      /* ignore */
    }
    this.find = null
    try {
      this.fns?.destroy!()
    } catch {
      /* ignore */
    }
    this.fns = null
  }
}
