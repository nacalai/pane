import { useEffect, useState } from 'react'
import type { VevState } from '@shared/schema'
import { TopBar } from './components/TopBar'
import { UrlBar } from './components/UrlBar'
import { Preview } from './components/Preview'
import { SettingsRail } from './components/SettingsRail'
import { StatsStrip } from './components/StatsStrip'

export default function App(): React.JSX.Element {
  const [state, setState] = useState<VevState | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cursor, setCursor] = useState('default')

  useEffect(() => {
    const off = window.vev.onState((s) => setState(s))
    // Pull once in case we mounted after the first push.
    void window.vev.getState().then((r) => {
      if (r.ok && r.data) setState(r.data)
    })
    return off
  }, [])

  useEffect(() => {
    let latest: string | null = null
    const off = window.vev.onPreview((data, mime) => {
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

  useEffect(() => window.vev.onCursor(setCursor), [])

  if (!state) {
    return <div className="boot">Laster VEV …</div>
  }

  return (
    <div className="app">
      <TopBar state={state} />
      <UrlBar state={state} />
      <div className="main">
        <Preview state={state} previewUrl={previewUrl} cursor={cursor} />
        <SettingsRail state={state} />
      </div>
      <StatsStrip state={state} />
    </div>
  )
}
