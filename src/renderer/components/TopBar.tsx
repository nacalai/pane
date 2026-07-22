import { useEffect, useRef, useState } from 'react'
import type { PaneState } from '@shared/schema'

/** "NDI SDK WIN64 … 6.3.2.0" → "NDI 6.3.2.0" (shown on hover). */
function cleanVersion(v: string | null): string {
  if (!v) return 'NDI'
  const m = v.match(/(\d+\.\d+\.\d+(?:\.\d+)?)/)
  return m ? `NDI ${m[1]}` : 'NDI'
}

export function TopBar({ state }: { state: PaneState }): React.JSX.Element {
  const live = state.ndi === 'live'
  const noRuntime = state.ndi === 'no-runtime'
  // STOP is guarded: first click arms, a second click within 3s (or before mouse-leave) stops.
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const disarm = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setArmed(false)
  }
  const onControl = (): void => {
    if (noRuntime) return
    if (!live) {
      void window.pane.start()
      return
    }
    if (!armed) {
      setArmed(true)
      timer.current = setTimeout(() => setArmed(false), 3000)
      return
    }
    disarm()
    void window.pane.stop()
  }

  const control = noRuntime
    ? { cls: 'tally tally--off', text: 'NDI RUNTIME MISSING', title: 'Install NDI Tools to enable output' }
    : !live
      ? { cls: 'tally tally--start', text: 'START NDI', title: 'Publish this page as an NDI source' }
      : armed
        ? { cls: 'tally tally--arm', text: 'CLICK AGAIN TO STOP', title: 'Confirm — takes the source off air' }
        : {
            cls: 'tally tally--live',
            text: state.receivers > 0 ? '● ON AIR · SEEN' : '● ON AIR',
            title: 'Live — click to stop (guarded)'
          }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="wordmark">
          Pane<span className="wordmark__dot">.</span>
        </span>
        <span className="topbar__tag">webpage → NDI</span>
      </div>
      <div className="topbar__console">
        <span className="ndi-chip" title={cleanVersion(state.ndiVersion)}>
          <span className="ndi-chip__label">NDI</span>
          <span className="ndi-chip__name">{state.config.ndiName}</span>
        </span>
        <button
          className={control.cls}
          title={control.title}
          disabled={noRuntime}
          onClick={onControl}
          onMouseLeave={disarm}
        >
          {control.text}
        </button>
      </div>
    </header>
  )
}
