import { describe, expect, it } from 'vitest'
import { containRect } from '../src/shared/geometry'

describe('containRect', () => {
  it('fills exactly when aspects match', () => {
    expect(containRect(960, 540, 1920, 1080)).toEqual({ x: 0, y: 0, w: 960, h: 540 })
  })

  it('letterboxes top/bottom when the box is taller than the frame aspect', () => {
    const r = containRect(1000, 1000, 1920, 1080)
    expect(r.w).toBeCloseTo(1000)
    expect(r.h).toBeCloseTo(562.5)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(218.75)
  })

  it('pillarboxes left/right for portrait frames in a landscape box', () => {
    const r = containRect(1600, 900, 1080, 1920)
    expect(r.h).toBeCloseTo(900)
    expect(r.w).toBeCloseTo(506.25)
    expect(r.x).toBeCloseTo((1600 - 506.25) / 2)
    expect(r.y).toBeCloseTo(0)
  })

  it('returns an empty rect on degenerate input instead of NaN', () => {
    expect(containRect(0, 100, 1920, 1080)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(containRect(100, 100, 0, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})
