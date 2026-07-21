import { describe, expect, it } from 'vitest'
import { routeCommand } from '../src/shared/control-routes'

const q = (s = ''): URLSearchParams => new URLSearchParams(s)

describe('routeCommand', () => {
  it('routes status and nav actions', () => {
    expect(routeCommand('/api/status', q())).toEqual({ ok: true, cmd: { kind: 'status' } })
    expect(routeCommand('/api/nav/back', q())).toEqual({
      ok: true,
      cmd: { kind: 'nav', action: 'back' }
    })
    expect(routeCommand('/api/nav/forward/', q())).toEqual({
      ok: true,
      cmd: { kind: 'nav', action: 'forward' }
    })
  })

  it('go requires a url', () => {
    expect(routeCommand('/api/go', q('url=vg.no'))).toEqual({
      ok: true,
      cmd: { kind: 'go', url: 'vg.no' }
    })
    expect(routeCommand('/api/go', q()).ok).toBe(false)
  })

  it('key validates key and modifiers', () => {
    expect(routeCommand('/api/key', q('key=ArrowRight'))).toEqual({
      ok: true,
      cmd: { kind: 'key', key: 'ArrowRight', modifiers: [] }
    })
    expect(routeCommand('/api/key', q('key=r&mod=control,shift'))).toEqual({
      ok: true,
      cmd: { kind: 'key', key: 'r', modifiers: ['control', 'shift'] }
    })
    expect(routeCommand('/api/key', q()).ok).toBe(false)
    expect(routeCommand('/api/key', q('key=a&mod=hyper')).ok).toBe(false)
  })

  it('scroll defaults, parses and clamps', () => {
    expect(routeCommand('/api/scroll', q())).toEqual({
      ok: true,
      cmd: { kind: 'scroll', dx: 0, dy: 600 }
    })
    expect(routeCommand('/api/scroll', q('dy=-99999'))).toEqual({
      ok: true,
      cmd: { kind: 'scroll', dx: 0, dy: -5000 }
    })
    expect(routeCommand('/api/scroll', q('dy=abc')).ok).toBe(false)
  })

  it('click defaults to center-left-click and validates', () => {
    expect(routeCommand('/api/click', q())).toEqual({
      ok: true,
      cmd: { kind: 'click', x: 0.5, y: 0.5, button: 0 }
    })
    expect(routeCommand('/api/click', q('x=2&y=-1'))).toEqual({
      ok: true,
      cmd: { kind: 'click', x: 1, y: 0, button: 0 }
    })
    expect(routeCommand('/api/click', q('button=5')).ok).toBe(false)
  })

  it('ndi, testcard, presenter and studio', () => {
    expect(routeCommand('/api/ndi/start', q())).toEqual({ ok: true, cmd: { kind: 'ndi', on: true } })
    expect(routeCommand('/api/testcard', q())).toEqual({ ok: true, cmd: { kind: 'testcard' } })
    expect(routeCommand('/api/presenter', q('fullscreen=1'))).toEqual({
      ok: true,
      cmd: { kind: 'mode', mode: 'presenter', fullscreen: true }
    })
    expect(routeCommand('/api/presenter', q())).toEqual({
      ok: true,
      cmd: { kind: 'mode', mode: 'presenter' }
    })
    expect(routeCommand('/api/studio', q())).toEqual({
      ok: true,
      cmd: { kind: 'mode', mode: 'studio' }
    })
    expect(routeCommand('/api/presenter/open', q('fullscreen=1'))).toEqual({
      ok: true,
      cmd: { kind: 'mode', mode: 'presenter', fullscreen: true }
    })
    expect(routeCommand('/api/presenter/close', q())).toEqual({
      ok: true,
      cmd: { kind: 'mode', mode: 'studio' }
    })
    expect(routeCommand('/api/presenter', q('fullscreen=x')).ok).toBe(false)
  })

  it('presenter accepts a display id and validates it', () => {
    expect(routeCommand('/api/presenter/open', q('fullscreen=1&display=667457223'))).toEqual({
      ok: true,
      cmd: { kind: 'mode', mode: 'presenter', fullscreen: true, displayId: 667457223 }
    })
    expect(routeCommand('/api/presenter', q('display=0'))).toEqual({
      ok: true,
      cmd: { kind: 'mode', mode: 'presenter', displayId: 0 }
    })
    expect(routeCommand('/api/presenter', q('display=-1')).ok).toBe(false)
    expect(routeCommand('/api/presenter', q('display=abc')).ok).toBe(false)
  })

  it('unknown endpoints 404', () => {
    const r = routeCommand('/api/nope', q())
    expect(r).toEqual({ ok: false, status: 404, error: 'unknown endpoint: /api/nope' })
  })
})
