import { useState } from 'react'
import type { UpdateInfo } from '@shared/schema'

export function UpdateBanner({ update }: { update: UpdateInfo }): React.JSX.Element {
  const [showNotes, setShowNotes] = useState(false)

  if (update.downloaded) {
    return (
      <div className="update update--ready">
        <span className="update__text">
          <b>Update {update.version} downloaded.</b> Restart to apply (or it installs when you quit).
        </span>
        <div className="update__actions">
          <button className="btn btn--small btn--primary" onClick={() => void window.pane.updateRestart()}>
            Restart now
          </button>
          <button className="btn btn--small" onClick={() => void window.pane.updateLater()}>
            On quit
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="update">
      <span className="update__text">
        <b>Pane {update.version} is available.</b>
        {update.notes && (
          <button className="update__link" onClick={() => setShowNotes((s) => !s)}>
            {showNotes ? 'Hide changelog' : "What's new"}
          </button>
        )}
      </span>
      <div className="update__actions">
        {update.downloading ? (
          <span className="update__downloading">Downloading…</span>
        ) : (
          <>
            <button
              className="btn btn--small btn--primary"
              onClick={() => void window.pane.updateDownload()}
            >
              Update
            </button>
            <button className="btn btn--small" onClick={() => void window.pane.updateLater()}>
              Later
            </button>
            <button className="btn btn--small btn--ghost" onClick={() => void window.pane.updateSkip()}>
              Skip this version
            </button>
          </>
        )}
      </div>
      {showNotes && update.notes && <pre className="update__notes">{update.notes}</pre>}
    </div>
  )
}
