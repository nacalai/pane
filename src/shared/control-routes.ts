/**
 * Pure HTTP-route parsing for the Stream Deck / Companion control API.
 * No node/electron imports — fully unit-testable. The server maps the
 * returned command onto VevApp; this file only validates and shapes input.
 */
import type { InputModifier, NavAction, VevMode } from './schema'

export type ControlCommand =
  | { kind: 'status' }
  | { kind: 'nav'; action: NavAction }
  | { kind: 'go'; url: string }
  | { kind: 'key'; key: string; modifiers: InputModifier[] }
  | { kind: 'scroll'; dx: number; dy: number }
  | { kind: 'click'; x: number; y: number; button: 0 | 1 | 2 }
  | { kind: 'testcard' }
  | { kind: 'ndi'; on: boolean }
  | { kind: 'mode'; mode: VevMode; fullscreen?: boolean; displayId?: number }

export type RouteResult =
  | { ok: true; cmd: ControlCommand }
  | { ok: false; status: number; error: string }

const MAX_SCROLL = 5000
const MODIFIERS = new Set<InputModifier>(['shift', 'control', 'alt', 'meta'])

function bad(error: string, status = 400): RouteResult {
  return { ok: false, status, error }
}

function clamp01(n: number): number {
  return Math.min(Math.max(n, 0), 1)
}

export function routeCommand(pathname: string, q: URLSearchParams): RouteResult {
  const path = pathname.replace(/\/+$/, '') || '/'
  switch (path) {
    case '/api/status':
      return { ok: true, cmd: { kind: 'status' } }

    case '/api/nav/back':
      return { ok: true, cmd: { kind: 'nav', action: 'back' } }
    case '/api/nav/forward':
      return { ok: true, cmd: { kind: 'nav', action: 'forward' } }
    case '/api/nav/reload':
      return { ok: true, cmd: { kind: 'nav', action: 'reload' } }

    case '/api/go': {
      const url = (q.get('url') ?? '').trim()
      if (!url) return bad('missing ?url=')
      if (url.length > 4096) return bad('url too long')
      return { ok: true, cmd: { kind: 'go', url } }
    }

    case '/api/key': {
      const key = q.get('key') ?? ''
      if (!key || key.length > 32) return bad('missing or invalid ?key=')
      const modifiers: InputModifier[] = []
      for (const m of (q.get('mod') ?? '').split(',')) {
        const mm = m.trim().toLowerCase()
        if (!mm) continue
        if (!MODIFIERS.has(mm as InputModifier)) return bad(`unknown modifier: ${mm}`)
        modifiers.push(mm as InputModifier)
      }
      return { ok: true, cmd: { kind: 'key', key, modifiers } }
    }

    case '/api/scroll': {
      const dy = q.has('dy') ? Number(q.get('dy')) : 600
      const dx = q.has('dx') ? Number(q.get('dx')) : 0
      if (!Number.isFinite(dy) || !Number.isFinite(dx)) return bad('dy/dx must be numbers')
      return {
        ok: true,
        cmd: {
          kind: 'scroll',
          dx: Math.min(Math.max(dx, -MAX_SCROLL), MAX_SCROLL),
          dy: Math.min(Math.max(dy, -MAX_SCROLL), MAX_SCROLL)
        }
      }
    }

    case '/api/click': {
      const x = q.has('x') ? Number(q.get('x')) : 0.5
      const y = q.has('y') ? Number(q.get('y')) : 0.5
      const button = q.has('button') ? Number(q.get('button')) : 0
      if (!Number.isFinite(x) || !Number.isFinite(y)) return bad('x/y must be numbers 0..1')
      if (button !== 0 && button !== 1 && button !== 2) return bad('button must be 0, 1 or 2')
      return { ok: true, cmd: { kind: 'click', x: clamp01(x), y: clamp01(y), button } }
    }

    case '/api/testcard':
      return { ok: true, cmd: { kind: 'testcard' } }

    case '/api/ndi/start':
      return { ok: true, cmd: { kind: 'ndi', on: true } }
    case '/api/ndi/stop':
      return { ok: true, cmd: { kind: 'ndi', on: false } }

    case '/api/presenter':
    case '/api/presenter/open': {
      const fs = q.get('fullscreen')
      if (fs !== null && fs !== '0' && fs !== '1') return bad('fullscreen must be 0 or 1')
      const disp = q.get('display')
      let displayId: number | undefined
      if (disp !== null) {
        const n = Number(disp)
        if (!Number.isInteger(n) || n < 0) return bad('display must be an integer ≥ 0')
        displayId = n
      }
      return {
        ok: true,
        cmd: {
          kind: 'mode',
          mode: 'presenter',
          ...(fs !== null ? { fullscreen: fs === '1' } : {}),
          ...(displayId !== undefined ? { displayId } : {})
        }
      }
    }
    // "Close" the presenter view = back to hidden studio mode; NDI keeps streaming the page.
    case '/api/studio':
    case '/api/presenter/close':
      return { ok: true, cmd: { kind: 'mode', mode: 'studio' } }

    default:
      return bad(`unknown endpoint: ${path}`, 404)
  }
}
