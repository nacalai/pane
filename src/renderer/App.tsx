import { useEffect, useState } from 'react'
import type { PaneState } from '@shared/schema'
import { TopBar } from './components/TopBar'
import { UrlBar } from './components/UrlBar'
import { Preview } from './components/Preview'
import { SettingsRail } from './components/SettingsRail'
import { StatsStrip } from './components/StatsStrip'
import { UpdateBanner } from './components/UpdateBanner'

export default function App(): React.JSX.Element {
  const [state, setState] = useState<PaneState | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cursor, setCursor] = useState('default')

  useEffect(() => {
    const off = window.pane.onState((s) => setState(s))
    // Pull once in case we mounted after the first push.
    void window.pane.getState().then((r) => {
      if (r.ok && r.data) setState(r.data)
    })
    return off
  }, [])

  useEffect(() => {
    let latest: string | null = null
    const off = window.pane.onPreview((data, mime) => {
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
      latest = url
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    })
    return () => {
      off()
      if (latest) URL.revokeObjectURL(latest)
    }
  }, [])

  useEffect(() => window.pane.onCursor(setCursor), [])

  if (!state) {
    return <div className="boot">Loading Pane …</div>
  }

  return (
    <div className="app">
      <TopBar state={state} />
      {state.update && <UpdateBanner update={state.update} />}
      <UrlBar state={state} />
      <div className={`main ${state.config.showPreview ? '' : 'main--nopreview'}`}>
        {state.config.showPreview && (
          <Preview state={state} previewUrl={previewUrl} cursor={cursor} />
        )}
        <SettingsRail state={state} />
      </div>
      <StatsStrip state={state} />
    </div>
  )
}
