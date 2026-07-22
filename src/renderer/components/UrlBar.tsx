import { useEffect, useRef, useState } from 'react'
import { INTERNAL_TESTCARD } from '@shared/url'
import type { PaneState } from '@shared/schema'

/** The test card is an internal id — show the field empty (ready for input), not "pane:testcard". */
function displayUrl(url: string): string {
  return url === INTERNAL_TESTCARD ? '' : url
}

export function UrlBar({ state }: { state: PaneState }): React.JSX.Element {
  const [value, setValue] = useState(displayUrl(state.nav.url))
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editingRef = useRef(false)

  // Follow navigation unless the user is mid-edit.
  useEffect(() => {
    if (!editingRef.current) setValue(displayUrl(state.nav.url))
  }, [state.nav.url])

  const go = (target?: string): void => {
    const url = target ?? value
    if (!url.trim()) return
    setError(null)
    void window.pane.navigate(url).then((r) => {
      if (!r.ok) setError(r.error)
      else {
        editingRef.current = false
        inputRef.current?.blur()
      }
    })
  }

  const act = (action: 'back' | 'forward' | 'reload'): void => {
    setError(null)
    void window.pane.navAction(action)
  }

  // App-level shortcuts (capture phase so they win over the preview's key-forwarding).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ae = document.activeElement
      const inField = !!ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)
      // Focus + select the address bar — works from anywhere (browser muscle memory).
      if (e.key === 'F6' || (e.ctrlKey && e.key.toLowerCase() === 'l')) {
        e.preventDefault()
        e.stopPropagation()
        inputRef.current?.focus()
        inputRef.current?.select()
        return
      }
      // Reload the page.
      if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
        e.preventDefault()
        e.stopPropagation()
        void window.pane.navAction('reload')
        return
      }
      // Put up the test card (known-good fallback) — not while typing.
      if (e.altKey && e.key.toLowerCase() === 't' && !inField) {
        e.preventDefault()
        e.stopPropagation()
        void window.pane.navigate('testcard')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="urlrow">
      <div className="urlrow__inner">
        <button
          className="btn btn--icon"
          title="Back"
          aria-label="Back"
          disabled={!state.nav.canGoBack}
          onClick={() => act('back')}
        >
          ←
        </button>
        <button
          className="btn btn--icon"
          title="Forward"
          aria-label="Forward"
          disabled={!state.nav.canGoForward}
          onClick={() => act('forward')}
        >
          →
        </button>
        <button
          className={`btn btn--icon ${state.nav.loading ? 'btn--spin' : ''}`}
          title="Reload (F5)"
          aria-label="Reload"
          onClick={() => act('reload')}
        >
          ⟳
        </button>
        <input
          ref={inputRef}
          className="urlrow__input"
          type="text"
          spellCheck={false}
          value={value}
          placeholder="Enter address — e.g. vg.no  (Ctrl+L)"
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            editingRef.current = true
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') {
              editingRef.current = false
              setValue(displayUrl(state.nav.url))
              inputRef.current?.blur()
            }
          }}
          onBlur={() => {
            editingRef.current = false
          }}
        />
        <button className="btn btn--primary" onClick={() => go()}>
          Go
        </button>
        <button
          className="btn btn--ghost"
          title="Put up the test card (Alt+T)"
          onClick={() => go('testcard')}
        >
          Test card
        </button>
      </div>
      {error && <div className="urlrow__error">{error}</div>}
    </div>
  )
}
