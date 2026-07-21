import { describe, expect, it } from 'vitest'
import { Pacer, STATIC_AFTER_MS } from '../src/main/pacer'

describe('Pacer', () => {
  it('does not send before the first paint', () => {
    const p = new Pacer()
    expect(p.onTick(0)).toEqual({ send: false, isRepeat: false })
    expect(p.stats(0).framesSent).toBe(0)
  })

  it('sends fresh frames after paint, repeats when the page goes static', () => {
    const p = new Pacer()
    p.onFrame(0)
    expect(p.onTick(33)).toEqual({ send: true, isRepeat: false })
    // no further paints — repetition keeps the NDI feed alive
    expect(p.onTick(66)).toEqual({ send: true, isRepeat: true })
    expect(p.onTick(99)).toEqual({ send: true, isRepeat: true })
  })

  it('flags a static page only after the threshold', () => {
    const p = new Pacer()
    p.onFrame(1000)
    expect(p.stats(1000 + STATIC_AFTER_MS).staticPage).toBe(false)
    expect(p.stats(1000 + STATIC_AFTER_MS + 1).staticPage).toBe(true)
    p.onFrame(5000)
    expect(p.stats(5001).staticPage).toBe(false)
  })

  it('measures sent fps over the rolling window', () => {
    const p = new Pacer()
    p.onFrame(0)
    for (let t = 0; t <= 2000; t += 40) p.onTick(t) // 25 fps
    const { sentFps } = p.stats(2000)
    expect(sentFps).toBeGreaterThan(23)
    expect(sentFps).toBeLessThan(27)
  })

  it('counts total frames sent and resets cleanly', () => {
    const p = new Pacer()
    p.onFrame(0)
    p.onTick(10)
    p.onTick(20)
    expect(p.stats(20).framesSent).toBe(2)
    p.reset()
    expect(p.stats(30).framesSent).toBe(0)
    expect(p.onTick(40)).toEqual({ send: false, isRepeat: false })
  })

  it('bounds its send-time buffer (no unbounded growth)', () => {
    const p = new Pacer()
    p.onFrame(0)
    for (let i = 0; i < 50000; i += 1) p.onTick(1) // same timestamp: nothing prunes by age
    expect(p.stats(1).framesSent).toBe(50000)
    // internal buffer must have been clamped — fps math still finite and sane
    expect(Number.isFinite(p.stats(1).sentFps)).toBe(true)
  })
})
