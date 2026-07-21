import { describe, expect, it } from 'vitest'
import { mapInput } from '../src/main/input-map'

const W = 1920
const H = 1080

describe('mapInput — mouse', () => {
  it('scales normalized coords to content pixels, exact at the edges', () => {
    expect(mapInput({ kind: 'move', x: 0, y: 0, modifiers: [] }, W, H)).toEqual([
      { type: 'mouseMove', x: 0, y: 0, modifiers: [] }
    ])
    expect(mapInput({ kind: 'move', x: 1, y: 1, modifiers: [] }, W, H)).toEqual([
      { type: 'mouseMove', x: W - 1, y: H - 1, modifiers: [] }
    ])
    const [mid] = mapInput({ kind: 'move', x: 0.5, y: 0.5, modifiers: [] }, W, H)
    expect(mid).toMatchObject({ x: 960, y: 540 })
  })

  it('maps buttons and click counts', () => {
    expect(
      mapInput({ kind: 'down', x: 0.5, y: 0.5, button: 0, clickCount: 2, modifiers: [] }, W, H)
    ).toEqual([
      { type: 'mouseDown', x: 960, y: 540, button: 'left', clickCount: 2, modifiers: [] }
    ])
    expect(
      mapInput({ kind: 'up', x: 0.5, y: 0.5, button: 2, clickCount: 1, modifiers: ['control'] }, W, H)
    ).toEqual([
      { type: 'mouseUp', x: 960, y: 540, button: 'right', clickCount: 1, modifiers: ['control'] }
    ])
  })
})

describe('mapInput — wheel', () => {
  it('inverts DOM deltas to Chromium convention', () => {
    // DOM: deltaY > 0 = scroll down. Chromium WebMouseWheelEvent: positive = scroll up.
    const [ev] = mapInput(
      { kind: 'wheel', x: 0.5, y: 0.5, deltaX: 10, deltaY: 120, modifiers: [] },
      W,
      H
    )
    expect(ev).toMatchObject({ type: 'mouseWheel', deltaX: -10, deltaY: -120, canScroll: true })
  })
})

describe('mapInput — keyboard', () => {
  it('letters produce keyDown + char', () => {
    expect(mapInput({ kind: 'key', direction: 'down', key: 'a', modifiers: [] }, W, H)).toEqual([
      { type: 'keyDown', keyCode: 'a', modifiers: [] },
      { type: 'char', keyCode: 'a', modifiers: [] }
    ])
  })

  it('Enter maps to Return with a char event (forms must submit)', () => {
    expect(mapInput({ kind: 'key', direction: 'down', key: 'Enter', modifiers: [] }, W, H)).toEqual([
      { type: 'keyDown', keyCode: 'Return', modifiers: [] },
      { type: 'char', keyCode: 'Return', modifiers: [] }
    ])
  })

  it('space maps to Space keyCode with the literal char', () => {
    expect(mapInput({ kind: 'key', direction: 'down', key: ' ', modifiers: [] }, W, H)).toEqual([
      { type: 'keyDown', keyCode: 'Space', modifiers: [] },
      { type: 'char', keyCode: ' ', modifiers: [] }
    ])
  })

  it('arrows and navigation keys map without char events', () => {
    expect(mapInput({ kind: 'key', direction: 'down', key: 'ArrowDown', modifiers: [] }, W, H)).toEqual([
      { type: 'keyDown', keyCode: 'Down', modifiers: [] }
    ])
    expect(mapInput({ kind: 'key', direction: 'down', key: 'Backspace', modifiers: [] }, W, H)).toEqual([
      { type: 'keyDown', keyCode: 'Backspace', modifiers: [] }
    ])
  })

  it('keyUp never emits char', () => {
    expect(mapInput({ kind: 'key', direction: 'up', key: 'a', modifiers: ['shift'] }, W, H)).toEqual([
      { type: 'keyUp', keyCode: 'a', modifiers: ['shift'] }
    ])
  })

  it('modifier combos pass through', () => {
    const events = mapInput(
      { kind: 'key', direction: 'down', key: 'c', modifiers: ['control'] },
      W,
      H
    )
    expect(events[0]).toMatchObject({ type: 'keyDown', keyCode: 'c', modifiers: ['control'] })
  })
})
