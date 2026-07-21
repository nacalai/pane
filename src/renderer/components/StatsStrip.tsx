import type { VevState } from '@shared/schema'

export function StatsStrip({ state }: { state: VevState }): React.JSX.Element {
  const { config } = state
  return (
    <footer className="stats">
      <span>
        <b>{state.sentFps.toFixed(1)}</b> fps sendt
      </span>
      <span>
        <b>{state.framesSent.toLocaleString('nb-NO')}</b> bilder
      </span>
      <span>
        <b>
          {config.width}×{config.height}
        </b>{' '}
        @ {config.fps}
      </span>
      <span>
        <b>{state.receivers}</b> mottaker{state.receivers === 1 ? '' : 'e'}
      </span>
      <span className={state.staticPage ? 'stats--static' : 'stats--live'}>
        {state.staticPage ? 'statisk side' : 'levende bilde'}
      </span>
    </footer>
  )
}
