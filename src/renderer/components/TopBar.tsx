import type { VevState } from '@shared/schema'

function pill(state: VevState): { cls: string; text: string } {
  switch (state.ndi) {
    case 'live':
      // NDI counts TCP connections, not receivers — one receiver (e.g. OBS) opens ~2.
      return state.receivers > 0
        ? { cls: 'pill pill--coral', text: '● PÅ LUFTA · SETT' }
        : { cls: 'pill pill--mint', text: 'PÅ LUFTA' }
    case 'no-runtime':
      return { cls: 'pill pill--amber', text: 'NDI-RUNTIME MANGLER' }
    case 'error':
      return { cls: 'pill pill--coral', text: 'NDI-FEIL' }
    default:
      return { cls: 'pill pill--off', text: 'NDI AV' }
  }
}

export function TopBar({ state }: { state: VevState }): React.JSX.Element {
  const p = pill(state)
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="wordmark">
          VEV<span className="wordmark__dot">.</span>
        </span>
        <span className="topbar__tag">CREAVID · NETTSIDE → NDI</span>
      </div>
      <div className="topbar__status">
        <span className="topbar__source">
          {state.config.ndiName}
          {state.ndiVersion ? ` · ${state.ndiVersion.replace(/^NDI SDK\s*/i, 'NDI ')}` : ''}
        </span>
        <span className={p.cls}>{p.text}</span>
      </div>
    </header>
  )
}
