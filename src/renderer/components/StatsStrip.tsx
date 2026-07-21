import type { VevState } from '@shared/schema'

export function StatsStrip({ state }: { state: VevState }): React.JSX.Element {
  const { config } = state
  return (
    <footer className="stats">
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
      <span title="NDI counts TCP connections, not receivers — one receiver (e.g. OBS) opens ~2">
        <b>{state.receivers}</b> connection{state.receivers === 1 ? '' : 's'}
      </span>
      <span className={state.staticPage ? 'stats--static' : 'stats--live'}>
        {state.staticPage ? 'static page' : 'live image'}
      </span>
    </footer>
  )
}
