import { useEffect, useRef, useState } from 'react'
import type { VevState } from '@shared/schema'

export function UrlBar({ state }: { state: VevState }): React.JSX.Element {
  const [value, setValue] = useState(state.nav.url)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editingRef = useRef(false)

  // Follow navigation unless the user is mid-edit.
  useEffect(() => {
    if (!editingRef.current) setValue(state.nav.url)
  }, [state.nav.url])

  const go = (target?: string): void => {
    const url = target ?? value
    if (!url.trim()) return
    setError(null)
    void window.vev.navigate(url).then((r) => {
      if (!r.ok) setError(r.error)
      else {
        editingRef.current = false
        inputRef.current?.blur()
      }
    })
  }

  const act = (action: 'back' | 'forward' | 'reload'): void => {
    setError(null)
    void window.vev.navAction(action)
  }

  return (
    <div className="urlrow">
      <div className="urlrow__inner">
        <button
          className="btn btn--icon"
          title="Tilbake"
          disabled={!state.nav.canGoBack}
          onClick={() => act('back')}
        >
          ←
        </button>
        <button
          className="btn btn--icon"
          title="Frem"
          disabled={!state.nav.canGoForward}
          onClick={() => act('forward')}
        >
          →
        </button>
        <button className="btn btn--icon" title="Oppdater" onClick={() => act('reload')}>
          ⟳
        </button>
        <input
          ref={inputRef}
          className="urlrow__input"
          type="text"
          spellCheck={false}
          value={value}
          placeholder="Skriv inn adresse — f.eks. vg.no"
          onChange={(e) => {
            editingRef.current = true
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') {
              editingRef.current = false
              setValue(state.nav.url)
            }
          }}
          onBlur={() => {
            editingRef.current = false
          }}
        />
        <button className="btn btn--primary" onClick={() => go()}>
          Gå
        </button>
        <button className="btn btn--ghost" title="VEV-testkortet" onClick={() => go('vev:testcard')}>
          Testkort
        </button>
      </div>
      {error && <div className="urlrow__error">{error}</div>}
    </div>
  )
}
