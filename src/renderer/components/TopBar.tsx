import type { VevState } from '@shared/schema'

function pill(state: VevState): { cls: string; text: string } {
  switch (state.ndi) {
    case 'live':
      // NDI counts TCP connections, not receivers — one receiver (e.g. OBS) opens ~2.
      return state.receivers > 0
        ? { cls: 'pill pill--coral', text: '● ON AIR · WATCHED' }
        : { cls: 'pill pill--mint', text: 'ON AIR' }
    case 'no-runtime':
      return { cls: 'pill pill--amber', text: 'NDI RUNTIME MISSING' }
    case 'error':
      return { cls: 'pill pill--coral', text: 'NDI ERROR' }
    default:
      return { cls: 'pill pill--off', text: 'NDI OFF' }
  }
}

/** "NDI SDK WIN64 16:38:09 Apr 14 2026 6.3.2.0" → "NDI 6.3.2.0". */
function cleanVersion(v: string | null): string {
  if (!v) return 'NDI'
  const m = v.match(/(\d+\.\d+\.\d+(?:\.\d+)?)/)
  return m ? `NDI ${m[1]}` : 'NDI'
}

export function TopBar({ state }: { state: VevState }): React.JSX.Element {
  const p = pill(state)
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="wordmark">
          VEV<span className="wordmark__dot">.</span>
        </span>
        <span className="topbar__tag">webpage → NDI</span>
      </div>
      <div className="topbar__status">
        <span className="ndi-chip" title={cleanVersion(state.ndiVersion)}>
          <span className="ndi-chip__label">NDI</span>
          <span className="ndi-chip__name">{state.config.ndiName}</span>
        </span>
        <span className={p.cls}>{p.text}</span>
      </div>
    </header>
  )
}
