import type { PaneState } from '@shared/schema'

export function StatsStrip({ state }: { state: PaneState }): React.JSX.Element {
  const { config } = state
  const live = state.ndi === 'live'
  return (
    <footer className={`stats ${live ? '' : 'stats--dim'}`}>
      {live ? (
        <>
          <span>
            <b>{state.sentFps.toFixed(0)}</b> fps
          </span>
          <span>
            <b>
              {config.width}×{config.height}
            </b>
          </span>
          {state.staticPage && <span className="stats--static">static page</span>}
        </>
      ) : (
        <span>— not sending —</span>
      )}
    </footer>
  )
}
