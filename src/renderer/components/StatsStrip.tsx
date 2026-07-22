import type { PaneState } from '@shared/schema'

export function StatsStrip({ state }: { state: PaneState }): React.JSX.Element {
  const { config } = state
  const live = state.ndi === 'live'
  return (
    <footer className={`stats ${live ? '' : 'stats--dim'}`}>
      {live ? (
        <>
          <span>
            <b>{state.sentFps.toFixed(1)}</b> fps sent
          </span>
          <span>
            <b>{state.framesSent.toLocaleString('en-US')}</b> frames
          </span>
          <span>
            <b>
              {config.width}×{config.height}
            </b>{' '}
            @ {config.fps}
          </span>
          <span
            className={state.receivers > 0 ? 'stats--live' : ''}
            title={`NDI reports ${state.receivers} TCP connection${state.receivers === 1 ? '' : 's'} — one receiver (e.g. OBS) opens ~2`}
          >
            {state.receivers > 0 ? 'being received' : 'no receivers yet'}
          </span>
          <span className={state.staticPage ? 'stats--static' : 'stats--live'}>
            {state.staticPage ? 'static page' : 'live image'}
          </span>
        </>
      ) : (
        <span>
          — not sending —{'  '}
          <span className="stats__hint">
            {config.width}×{config.height} @ {config.fps} · press START NDI to go on air
          </span>
        </span>
      )}
    </footer>
  )
}
