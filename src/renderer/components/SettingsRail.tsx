import { useState } from 'react'
import type { Fps, PaneState } from '@shared/schema'

const PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: '1920 × 1080 · 16:9', w: 1920, h: 1080 },
  { label: '1280 × 720 · 16:9', w: 1280, h: 720 },
  { label: '3840 × 2160 · 4K', w: 3840, h: 2160 },
  { label: '1440 × 1080 · 4:3', w: 1440, h: 1080 },
  { label: '1080 × 1080 · 1:1', w: 1080, h: 1080 },
  { label: '1080 × 1920 · 9:16', w: 1080, h: 1920 }
]
const FPS_OPTIONS: Fps[] = [25, 30, 50, 60]
type Tab = 'output' | 'presenter' | 'remote' | 'app'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'output', label: 'Output' },
  { id: 'presenter', label: 'Presenter' },
  { id: 'remote', label: 'Remote' },
  { id: 'app', label: 'App' }
]

export function SettingsRail({ state }: { state: PaneState }): React.JSX.Element {
  const { config } = state
  const [tab, setTab] = useState<Tab>('output')
  const [customW, setCustomW] = useState(String(config.width))
  const [customH, setCustomH] = useState(String(config.height))
  const [showCustom, setShowCustom] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = (patch: Record<string, unknown>): void => {
    setError(null)
    void window.pane.setSettings(patch).then((r) => {
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

  const presenter = config.mode === 'presenter'

  return (
    <aside className="rail">
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'output' && (
        <div className="tabpanel">
          <section className="card">
            <label className="field">
              <span className="field__label">NDI source name</span>
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
            <h2 className="card__title">Format</h2>
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
            <label
              className="check"
              title={presenter ? 'Only available in studio mode' : undefined}
            >
              <input
                type="checkbox"
                checked={config.transparent}
                disabled={presenter}
                onChange={(e) => apply({ transparent: e.target.checked })}
              />
              <span>Transparent background (alpha in NDI)</span>
            </label>
            <label
              className="check"
              title="Adds a nearly invisible noise layer to break up banding in gradients"
            >
              <input
                type="checkbox"
                checked={config.dither}
                onChange={(e) => apply({ dither: e.target.checked })}
              />
              <span>Reduce banding in gradients (dither)</span>
            </label>
            <label
              className="check"
              title="Send audio over NDI by capturing this computer's audio output (loopback)"
            >
              <input
                type="checkbox"
                checked={config.ndiAudio}
                onChange={(e) => apply({ ndiAudio: e.target.checked })}
              />
              <span>Send page audio over NDI (loopback)</span>
            </label>
            {config.ndiAudio && (
              <p className="card__note">
                Loopback captures this computer's <b>whole audio output</b> — the page must be
                audible (it also plays on your speakers), and other system sounds are included too.
              </p>
            )}
          </section>

          <section className="card">
            <h2 className="card__title">Cursor in output</h2>
            <label className="check">
              <input
                type="checkbox"
                checked={config.showCursor}
                onChange={(e) => apply({ showCursor: e.target.checked })}
              />
              <span>Show a cursor in the output</span>
            </label>
            {config.showCursor && (
              <div className="field field--row">
                <select
                  className="field__input"
                  value={config.cursorStyle}
                  onChange={(e) => apply({ cursorStyle: e.target.value })}
                >
                  <option value="dot">Colored dot</option>
                  <option value="arrow">Arrow pointer</option>
                </select>
                {config.cursorStyle === 'dot' && (
                  <input
                    className="field__color"
                    type="color"
                    value={config.cursorColor}
                    title="Dot color"
                    onChange={(e) => apply({ cursorColor: e.target.value })}
                  />
                )}
              </div>
            )}
            <p className="card__note">
              {config.showCursor
                ? 'Drawn onto the output frame, so it follows the mouse everywhere. The presenter still uses the real OS cursor in their own window.'
                : 'Off: the presenter uses the real mouse (zero latency); the output has no pointer.'}
            </p>
          </section>
        </div>
      )}

      {tab === 'presenter' && (
        <div className="tabpanel">
          <section className="card">
            <h2 className="card__title">Presenter view</h2>
            <p className="card__note">
              Open the page in a visible window the presenter controls directly — clicks, charts,
              forms. NDI sends exactly the same image. F11 toggles fullscreen; Esc exits.
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
              Switching between studio and presenter rebuilds the window — the page reloads.
            </p>
          </section>
        </div>
      )}

      {tab === 'remote' && (
        <div className="tabpanel">
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
                  Base: http://127.0.0.1:{config.httpPort}/api/… — e.g. /api/go?url=… ·
                  /api/key?key=ArrowRight · /api/presenter/open?fullscreen=1 · /api/status
                </p>
                <button
                  className="linkbtn"
                  onClick={() =>
                    void window.pane.openExternal(
                      'https://github.com/nacalai/pane#remote-control-stream-deck--companion'
                    )
                  }
                >
                  See all API commands &amp; usage ↗
                </button>
              </>
            )}
          </section>
        </div>
      )}

      {tab === 'app' && (
        <div className="tabpanel">
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
            <h2 className="card__title">This window</h2>
            <label
              className="check"
              title="Play the page's sound on this computer's speakers. This does NOT go over NDI — NDI audio isn't supported yet."
            >
              <input
                type="checkbox"
                checked={config.localAudio}
                onChange={(e) => apply({ localAudio: e.target.checked })}
              />
              <span>Play page audio on this computer</span>
            </label>
            <label
              className="check"
              title="Hide the preview to give the settings more room — does not affect the NDI output"
            >
              <input
                type="checkbox"
                checked={config.showPreview}
                onChange={(e) => apply({ showPreview: e.target.checked })}
              />
              <span>Show preview in the app</span>
            </label>
            <p className="card__note">
              Audio plays locally only (not over NDI). Hiding the preview gives the settings more
              space and saves a little CPU — the NDI output is unaffected.
            </p>
          </section>

          <section className="card">
            <h2 className="card__title">NDI details</h2>
            <dl className="ndistats">
              <dt>Codec</dt>
              <dd>SpeedHQ (full‑bandwidth NDI)</dd>
              <dt>Pixel format</dt>
              <dd>{config.transparent ? 'BGRA · with alpha' : 'BGRX · opaque'} · 8‑bit 4:2:2</dd>
              <dt>Resolution</dt>
              <dd>
                {config.width}×{config.height} @ {config.fps} fps
              </dd>
              <dt>Sending</dt>
              <dd>{state.ndi === 'live' ? `${state.sentFps.toFixed(1)} fps` : 'off'}</dd>
              <dt>Bandwidth</dt>
              <dd>~{Math.round((config.width * config.height * config.fps * 2) / 1e6)} Mbps (est.)</dd>
              <dt>Connections</dt>
              <dd>{state.receivers} (~2 per receiver)</dd>
              {state.ndiVersion && (
                <>
                  <dt>Runtime</dt>
                  <dd>{state.ndiVersion.replace(/^NDI SDK\s*/i, '').replace(/WIN64.*?(\d)/i, '$1')}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="card card--about">
            <span className="about__beta">BETA</span>
            <button
              className="linkbtn"
              onClick={() => void window.pane.openExternal('https://github.com/nacalai/pane')}
            >
              Pane on GitHub ↗
            </button>
          </section>
        </div>
      )}

      {error && <div className="rail__error">{error}</div>}
    </aside>
  )
}
