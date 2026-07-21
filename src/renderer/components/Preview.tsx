import { useRef, useState } from 'react'
import { containRect } from '@shared/geometry'
import type { InputEventReq, InputModifier, VevState } from '@shared/schema'

const MOVE_THROTTLE_MS = 16

/** Electron cursor types → CSS. Unknown types fall back to default. */
const CURSOR_MAP: Record<string, string> = {
  default: 'default',
  pointer: 'pointer',
  hand: 'pointer',
  text: 'text',
  crosshair: 'crosshair',
  wait: 'wait',
  progress: 'progress',
  help: 'help',
  move: 'move',
  grab: 'grab',
  grabbing: 'grabbing',
  'not-allowed': 'not-allowed',
  'col-resize': 'col-resize',
  'row-resize': 'row-resize',
  'ns-resize': 'ns-resize',
  'ew-resize': 'ew-resize',
  'nesw-resize': 'nesw-resize',
  'nwse-resize': 'nwse-resize'
}

function modifiers(e: {
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}): InputModifier[] {
  const m: InputModifier[] = []
  if (e.shiftKey) m.push('shift')
  if (e.ctrlKey) m.push('control')
  if (e.altKey) m.push('alt')
  if (e.metaKey) m.push('meta')
  return m
}

const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1)

export function Preview({
  state,
  previewUrl,
  cursor
}: {
  state: VevState
  previewUrl: string | null
  cursor: string
}): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const lastMoveRef = useRef(0)
  const draggingRef = useRef(false)
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 })
  const [focused, setFocused] = useState(false)

  const { nav, config } = state

  /**
   * Pointer → normalized frame coords via the image's contain-rect, NOT the box —
   * letterbox bars would otherwise skew every click. Outside the image: null,
   * unless we're mid-drag (then clamp so drags keep tracking).
   */
  const norm = (
    e: { clientX: number; clientY: number },
    clampOutside = false
  ): { x: number; y: number } | null => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect || rect.width < 2 || rect.height < 2) return null
    const cr = containRect(rect.width, rect.height, config.width, config.height)
    if (cr.w < 2 || cr.h < 2) return null
    const px = e.clientX - rect.left - cr.x
    const py = e.clientY - rect.top - cr.y
    if (!clampOutside && (px < 0 || py < 0 || px > cr.w || py > cr.h)) return null
    return { x: clamp01(px / cr.w), y: clamp01(py / cr.h) }
  }

  const send = (ev: InputEventReq): void => window.vev.sendInput(ev)

  const button = (b: number): 0 | 1 | 2 => (b === 1 ? 1 : b === 2 ? 2 : 0)

  const onPointerMove = (e: React.PointerEvent): void => {
    const now = performance.now()
    if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return
    lastMoveRef.current = now
    const p = norm(e, draggingRef.current)
    if (!p) return
    lastPosRef.current = p
    send({ kind: 'move', ...p, modifiers: modifiers(e) })
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    boxRef.current?.focus()
    // Mouse side buttons (back/forward) must never become left clicks in the page.
    if (e.button === 3 || e.button === 4) {
      void window.vev.navAction(e.button === 3 ? 'back' : 'forward')
      return
    }
    if (e.button > 2) return
    const p = norm(e)
    if (!p) return
    // Capture so the matching 'up' arrives even when released outside the window —
    // otherwise the page is left with a stuck mouse-down mid-drag.
    boxRef.current?.setPointerCapture(e.pointerId)
    draggingRef.current = true
    lastPosRef.current = p
    send({
      kind: 'down',
      ...p,
      button: button(e.button),
      clickCount: Math.min(Math.max(e.detail, 1), 3),
      modifiers: modifiers(e)
    })
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (e.button > 2) return
    const p = norm(e, true) ?? lastPosRef.current
    draggingRef.current = false
    send({
      kind: 'up',
      ...p,
      button: button(e.button),
      clickCount: Math.min(Math.max(e.detail, 1), 3),
      modifiers: modifiers(e)
    })
  }

  /** Backstop: capture lost without an 'up' (window switch etc.) → synthetic release. */
  const onPointerAborted = (): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    send({ kind: 'up', ...lastPosRef.current, button: 0, clickCount: 1, modifiers: [] })
  }

  const onWheel = (e: React.WheelEvent): void => {
    const p = norm(e)
    if (!p) return
    send({ kind: 'wheel', ...p, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modifiers(e) })
  }

  const onKey = (direction: 'down' | 'up') => (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      boxRef.current?.blur()
      return
    }
    e.preventDefault()
    send({ kind: 'key', direction, key: e.key, modifiers: modifiers(e) })
  }

  const aspect = `${config.width} / ${config.height}`
  const widthCalc = `min(100%, calc((100vh - 320px) * ${(config.width / config.height).toFixed(4)}))`

  return (
    <div className="stage">
      {state.ndi === 'no-runtime' && (
        <div className="banner banner--amber">
          <b>NDI-runtime mangler.</b> {state.ndiError} — forhåndsvisning og navigasjon virker,
          men ingenting sendes.
        </div>
      )}
      {state.ndi === 'error' && state.ndiError && (
        <div className="banner banner--coral">
          <b>NDI-feil:</b> {state.ndiError}
        </div>
      )}
      {nav.failure && (
        <div className="banner banner--coral">
          <b>Kunne ikke laste</b> {nav.failure.url} — {nav.failure.description}
          <button className="btn btn--small" onClick={() => void window.vev.navAction('reload')}>
            Prøv igjen
          </button>
        </div>
      )}
      {nav.unresponsive && (
        <div className="banner banner--amber">
          <b>Siden henger.</b>
          <button
            className="btn btn--small"
            onClick={() => void window.vev.navAction('force-reload')}
          >
            Tving omstart
          </button>
        </div>
      )}

      <div
        ref={boxRef}
        className={`preview ${config.transparent && config.mode === 'studio' ? 'preview--checker' : ''} ${focused ? 'preview--focused' : ''}`}
        style={{ aspectRatio: aspect, width: widthCalc, cursor: CURSOR_MAP[cursor] ?? 'default' }}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerAborted}
        onLostPointerCapture={onPointerAborted}
        onWheel={onWheel}
        onKeyDown={onKey('down')}
        onKeyUp={onKey('up')}
        onContextMenu={(e) => e.preventDefault()}
      >
        {previewUrl ? (
          <img className="preview__img" src={previewUrl} alt="" draggable={false} />
        ) : (
          <div className="preview__empty">Venter på bilde …</div>
        )}
        {nav.loading && <div className="preview__loading" />}
      </div>
      <div className="stage__hint">
        {config.mode === 'presenter'
          ? 'Presenter-modus: styr direkte i det synlige vinduet (F11 = fullskjerm)'
          : focused
            ? 'Tastatur og mus sendes til siden — Esc for å slippe'
            : 'Klikk i bildet for å styre siden'}
      </div>
    </div>
  )
}
