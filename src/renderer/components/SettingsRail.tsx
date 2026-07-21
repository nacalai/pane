import { useState } from 'react'
import type { Fps, VevState } from '@shared/schema'

const PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: '1280 × 720', w: 1280, h: 720 },
  { label: '3840 × 2160', w: 3840, h: 2160 }
]
const FPS_OPTIONS: Fps[] = [25, 30, 50, 60]

export function SettingsRail({ state }: { state: VevState }): React.JSX.Element {
  const { config } = state
  const [customW, setCustomW] = useState(String(config.width))
  const [customH, setCustomH] = useState(String(config.height))
  const [showCustom, setShowCustom] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = (patch: Record<string, unknown>): void => {
    setError(null)
    void window.vev.setSettings(patch).then((r) => {
      if (!r.ok) setError(r.error)
    })
  }

  const presetValue =
    PRESETS.find((p) => p.w === config.width && p.h === config.height)?.label ?? 'custom'

  const applyCustom = (): void => {
    const w = Number(customW)
    const h = Number(customH)
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 320 || h < 240 || w > 3840 || h > 2160) {
      setError('Custom resolution must be 320–3840 × 240–2160')
      return
    }
    apply({ width: w, height: h })
  }

  const live = state.ndi === 'live'
  const presenter = config.mode === 'presenter'

  return (
    <aside className="rail">
      <section className="card">
        <h2 className="card__title">NDI output</h2>
        <label className="field">
          <span className="field__label">Source name</span>
          <input
            key={config.ndiName}
            className="field__input"
            type="text"
            defaultValue={config.ndiName}
            maxLength={63}
            onBlur={(e) => {
              if (e.target.value !== config.ndiName) apply({ ndiName: e.target.value })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </label>
        <button
          className={`btn btn--big ${live ? 'btn--stop' : 'btn--primary'}`}
          disabled={state.ndi === 'no-runtime'}
          onClick={() => void (live ? window.vev.stop() : window.vev.start())}
        >
          {live ? 'STOP NDI' : 'START NDI'}
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={config.autoStart}
            onChange={(e) => apply({ autoStart: e.target.checked })}
          />
          <span>Start NDI on launch</span>
        </label>
      </section>

      <section className="card">
        <h2 className="card__title">Startup</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={config.launchAtLogin}
            onChange={(e) => apply({ launchAtLogin: e.target.checked })}
          />
          <span>Start with Windows (hidden in tray)</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.startMinimized}
            onChange={(e) => apply({ startMinimized: e.target.checked })}
          />
          <span>Start minimized to tray</span>
        </label>
        <p className="card__note">
          The close button (X) doesn't quit — it minimizes to the system tray where NDI keeps
          running. Right-click the tray icon to quit. "Start with Windows" only works in the
          installed app.
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">Presenter view</h2>
        <p className="card__note">
          Open the page in a visible window the presenter controls directly — clicks, charts,
          forms. NDI sends exactly the same image. F11 toggles fullscreen; Esc exits fullscreen.
        </p>
        <label className="field">
          <span className="field__label">Display</span>
          <select
            className="field__input"
            value={config.presenterDisplayId}
            onChange={(e) => apply({ presenterDisplayId: Number(e.target.value) })}
          >
            <option value={0}>Primary display (auto)</option>
            {state.displays.map((d, i) => (
              <option key={d.id} value={d.id}>
                Display {i + 1}
                {d.primary ? ' (primary)' : ''} — {d.label} {d.width}×{d.height}
              </option>
            ))}
          </select>
        </label>
        <div className="btn-row">
          <button
            className={`btn ${presenter && !state.presenterFullscreen ? 'btn--active' : ''}`}
            onClick={() => apply({ mode: 'presenter', presenterFullscreen: false })}
          >
            Open windowed
          </button>
          <button
            className={`btn ${presenter && state.presenterFullscreen ? 'btn--active' : ''}`}
            onClick={() => apply({ mode: 'presenter', presenterFullscreen: true })}
          >
            Open fullscreen
          </button>
        </div>
        {presenter && (
          <button className="btn btn--stop" onClick={() => apply({ mode: 'studio' })}>
            Close presenter (back to studio)
          </button>
        )}
        <p className="card__note">
          {presenter
            ? state.presenterFullscreen
              ? 'Open fullscreen on the selected display.'
              : 'Open as a window on the selected display.'
            : 'Studio: the page renders hidden at exact resolution; you control it via the preview.'}
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">Image</h2>
        <label className="field">
          <span className="field__label">Resolution</span>
          <select
            className="field__input"
            value={showCustom ? 'custom' : presetValue}
            onChange={(e) => {
              if (e.target.value === 'custom') {
                setShowCustom(true)
                setCustomW(String(config.width))
                setCustomH(String(config.height))
                return
              }
              setShowCustom(false)
              const p = PRESETS.find((x) => x.label === e.target.value)
              if (p) apply({ width: p.w, height: p.h })
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom …</option>
          </select>
        </label>
        {(showCustom || presetValue === 'custom') && (
          <div className="field field--row">
            <input
              className="field__input field__input--num"
              type="number"
              value={customW}
              min={320}
              max={3840}
              onChange={(e) => setCustomW(e.target.value)}
            />
            <span className="field__x">×</span>
            <input
              className="field__input field__input--num"
              type="number"
              value={customH}
              min={240}
              max={2160}
              onChange={(e) => setCustomH(e.target.value)}
            />
            <button className="btn btn--small" onClick={applyCustom}>
              Apply
            </button>
          </div>
        )}
        <label className="field">
          <span className="field__label">Frames per second</span>
          <select
            className="field__input"
            value={config.fps}
            onChange={(e) => apply({ fps: Number(e.target.value) })}
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
        <label className="check" title={presenter ? 'Only available in studio mode' : undefined}>
          <input
            type="checkbox"
            checked={config.transparent}
            disabled={presenter}
            onChange={(e) => apply({ transparent: e.target.checked })}
          />
          <span>Transparent background (alpha in NDI)</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.localAudio}
            onChange={(e) => apply({ localAudio: e.target.checked })}
          />
          <span>Play audio on this machine</span>
        </label>
        <label className="check" title="Adds a nearly invisible noise layer to the page to break up banding in gradients">
          <input
            type="checkbox"
            checked={config.dither}
            onChange={(e) => apply({ dither: e.target.checked })}
          />
          <span>Reduce banding in gradients (dither)</span>
        </label>
        <label className="check" title="Turn off the in-app preview to save some CPU (does not affect the NDI output)">
          <input
            type="checkbox"
            checked={config.showPreview}
            onChange={(e) => apply({ showPreview: e.target.checked })}
          />
          <span>Show preview in the app</span>
        </label>
        <p className="card__note">
          {presenter
            ? 'Transparent background applies to studio mode only (hidden window).'
            : 'Toggling transparent background rebuilds the browser window — the page reloads.'}
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">Remote control · Stream Deck</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={config.httpEnabled}
            onChange={(e) => apply({ httpEnabled: e.target.checked })}
          />
          <span>HTTP API on</span>
        </label>
        {config.httpEnabled && (
          <>
            <div className="field field--row">
              <span className="field__label" style={{ minWidth: 34 }}>
                Port
              </span>
              <input
                key={config.httpPort}
                className="field__input field__input--num"
                type="number"
                min={1024}
                max={65535}
                defaultValue={config.httpPort}
                onBlur={(e) => {
                  const p = Number(e.target.value)
                  if (Number.isInteger(p) && p >= 1024 && p <= 65535 && p !== config.httpPort) {
                    apply({ httpPort: p })
                  }
                }}
              />
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={config.httpLan}
                onChange={(e) => apply({ httpLan: e.target.checked })}
              />
              <span>Allow LAN (requires token)</span>
            </label>
            {config.httpLan && (
              <label className="field">
                <span className="field__label">Token</span>
                <input
                  key={config.httpToken}
                  className="field__input"
                  type="text"
                  placeholder="secret-token"
                  defaultValue={config.httpToken}
                  onBlur={(e) => {
                    if (e.target.value !== config.httpToken) apply({ httpToken: e.target.value })
                  }}
                />
              </label>
            )}
            {state.httpError && <div className="rail__error">{state.httpError}</div>}
            <p className="card__note code-note">
              GET /api/key?key=ArrowRight · /api/scroll?dy=600 · /api/go?url=… ·
              /api/nav/back · /api/testcard · /api/presenter?fullscreen=1 · /api/status
              <br />
              http://127.0.0.1:{config.httpPort}/api/…
            </p>
          </>
        )}
      </section>

      {error && <div className="rail__error">{error}</div>}
    </aside>
  )
}
