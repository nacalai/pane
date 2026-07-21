/**
 * Pure mapping: normalized renderer input → Electron sendInputEvent payloads.
 * Coordinates arrive normalized 0..1 over the preview and scale to content pixels.
 * No Electron runtime imports — type-only, so this stays unit-testable in node.
 */
import type { InputEventReq, InputModifier } from '@shared/schema'

interface BaseEvent {
  type: string
  modifiers?: InputModifier[]
}
export interface MappedMouseEvent extends BaseEvent {
  type: 'mouseDown' | 'mouseUp' | 'mouseMove'
  x: number
  y: number
  button?: 'left' | 'middle' | 'right'
  clickCount?: number
}
export interface MappedWheelEvent extends BaseEvent {
  type: 'mouseWheel'
  x: number
  y: number
  deltaX: number
  deltaY: number
  canScroll: boolean
}
export interface MappedKeyEvent extends BaseEvent {
  type: 'keyDown' | 'keyUp' | 'char'
  keyCode: string
}
export type MappedEvent = MappedMouseEvent | MappedWheelEvent | MappedKeyEvent

const MOUSE_BUTTONS = ['left', 'middle', 'right'] as const

/** DOM KeyboardEvent.key → Electron keyCode (accelerator-style). */
const KEY_MAP: Record<string, string> = {
  Enter: 'Return',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

function scale(norm: number, extent: number): number {
  const px = Math.round(norm * (extent - 1))
  return Math.min(Math.max(px, 0), extent - 1)
}

export function mapInput(req: InputEventReq, width: number, height: number): MappedEvent[] {
  switch (req.kind) {
    case 'move':
      return [
        { type: 'mouseMove', x: scale(req.x, width), y: scale(req.y, height), modifiers: req.modifiers }
      ]
    case 'down':
    case 'up':
      return [
        {
          type: req.kind === 'down' ? 'mouseDown' : 'mouseUp',
          x: scale(req.x, width),
          y: scale(req.y, height),
          button: MOUSE_BUTTONS[req.button],
          clickCount: req.clickCount,
          modifiers: req.modifiers
        }
      ]
    case 'wheel':
      // DOM: positive deltaY = scroll down. Chromium WebMouseWheelEvent: positive = scroll up. Invert.
      return [
        {
          type: 'mouseWheel',
          x: scale(req.x, width),
          y: scale(req.y, height),
          deltaX: -req.deltaX,
          deltaY: -req.deltaY,
          canScroll: true,
          modifiers: req.modifiers
        }
      ]
    case 'key': {
      const keyCode = KEY_MAP[req.key] ?? req.key
      if (req.direction === 'up') return [{ type: 'keyUp', keyCode, modifiers: req.modifiers }]
      const events: MappedEvent[] = [{ type: 'keyDown', keyCode, modifiers: req.modifiers }]
      // Printable keys and Return need a follow-up char event or pages never see text input.
      if (req.key.length === 1) {
        events.push({ type: 'char', keyCode: req.key, modifiers: req.modifiers })
      } else if (req.key === 'Enter') {
        events.push({ type: 'char', keyCode: 'Return', modifiers: req.modifiers })
      }
      return events
    }
  }
}
