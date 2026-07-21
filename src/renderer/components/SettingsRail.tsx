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
      setError('Egendefinert oppløsning må være 320–3840 × 240–2160')
      return
    }
    apply({ width: w, height: h })
  }

  const live = state.ndi === 'live'

  return (
    <aside className="rail">
      <section className="card">
        <h2 className="card__title">NDI-utgang</h2>
        <label className="field">
          <span className="field__label">Kildenavn</span>
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
          {live ? 'STOPP NDI' : 'START NDI'}
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={config.autoStart}
            onChange={(e) => apply({ autoStart: e.target.checked })}
          />
          <span>Start NDI ved oppstart</span>
        </label>
      </section>

      <section className="card">
        <h2 className="card__title">Bilde</h2>
        <label className="field">
          <span className="field__label">Oppløsning</span>
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
            <option value="custom">Egendefinert …</option>
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
              Bruk
            </button>
          </div>
        )}
        <label className="field">
          <span className="field__label">Bilder per sekund</span>
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
        <label className="check">
          <input
            type="checkbox"
            checked={config.transparent}
            onChange={(e) => apply({ transparent: e.target.checked })}
          />
          <span>Transparent bakgrunn (alfa i NDI)</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.localAudio}
            onChange={(e) => apply({ localAudio: e.target.checked })}
          />
          <span>Spill lyd på denne maskinen</span>
        </label>
        <p className="card__note">
          Bytte av transparent bakgrunn bygger nettleservinduet på nytt — siden lastes om.
        </p>
      </section>

      {error && <div className="rail__error">{error}</div>}
    </aside>
  )
}
