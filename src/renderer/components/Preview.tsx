import { useRef, useState } from 'react'
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
  const [focused, setFocused] = useState(false)

  const norm = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect || rect.width < 2 || rect.height < 2) return null
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) }
  }

  const send = (ev: InputEventReq): void => window.vev.sendInput(ev)

  const onPointerMove = (e: React.PointerEvent): void => {
    const now = performance.now()
    if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return
    lastMoveRef.current = now
    const p = norm(e)
    if (p) send({ kind: 'move', ...p, modifiers: modifiers(e) })
  }

  const button = (b: number): 0 | 1 | 2 => (b === 1 ? 1 : b === 2 ? 2 : 0)

  const onPointerDown = (e: React.PointerEvent): void => {
    boxRef.current?.focus()
    const p = norm(e)
    if (!p) return
    send({
      kind: 'down',
      ...p,
      button: button(e.button),
      clickCount: Math.min(Math.max(e.detail, 1), 3),
      modifiers: modifiers(e)
    })
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const p = norm(e)
    if (!p) return
    send({
      kind: 'up',
      ...p,
      button: button(e.button),
      clickCount: Math.min(Math.max(e.detail, 1), 3),
      modifiers: modifiers(e)
    })
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

  const { nav, config } = state
  const aspect = `${config.width} / ${config.height}`

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
        className={`preview ${config.transparent ? 'preview--checker' : ''} ${focused ? 'preview--focused' : ''}`}
        style={{ aspectRatio: aspect, cursor: CURSOR_MAP[cursor] ?? 'default' }}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
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
        {focused
          ? 'Tastatur og mus sendes til siden — Esc for å slippe'
          : 'Klikk i bildet for å styre siden'}
      </div>
    </div>
  )
}
