import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  InputEventSchema,
  NavActionSchema,
  NavigateReqSchema,
  parseConfig,
  sanitizeNdiName,
  SettingsPatchSchema
} from '../src/shared/schema'

describe('parseConfig', () => {
  it('returns defaults for garbage', () => {
    expect(parseConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(parseConfig('not an object')).toEqual(DEFAULT_CONFIG)
    expect(parseConfig(42)).toEqual(DEFAULT_CONFIG)
  })

  it('returns defaults when a field is invalid', () => {
    expect(parseConfig({ fps: 24 })).toEqual(DEFAULT_CONFIG)
    expect(parseConfig({ width: 10 })).toEqual(DEFAULT_CONFIG)
  })

  it('merges valid partials over defaults', () => {
    const cfg = parseConfig({ url: 'https://vg.no/', fps: 50 })
    expect(cfg.url).toBe('https://vg.no/')
    expect(cfg.fps).toBe(50)
    expect(cfg.width).toBe(1920)
    expect(cfg.ndiName).toBe('Pane')
  })

  it('strips unknown keys instead of failing (old config files must load)', () => {
    const cfg = parseConfig({ url: 'https://nrk.no/', someOldKey: true })
    expect(cfg.url).toBe('https://nrk.no/')
    expect('someOldKey' in cfg).toBe(false)
  })

  it('sanitizes the NDI name', () => {
    expect(parseConfig({ ndiName: 'My (Cool) Source' }).ndiName).toBe('My Cool Source')
  })

  it('does not mutate DEFAULT_CONFIG', () => {
    const a = parseConfig(undefined)
    a.url = 'mutated'
    expect(DEFAULT_CONFIG.url).toBe('pane:testcard')
  })
})

describe('sanitizeNdiName', () => {
  it('strips parens and control chars, collapses whitespace', () => {
    expect(sanitizeNdiName('  Pane\u0000\u001f  (2)  ')).toBe('Pane 2')
  })
  it('preserves spaces and ordinary punctuation (regression: accidental char range)', () => {
    expect(sanitizeNdiName('My Pane 2')).toBe('My Pane 2')
    expect(sanitizeNdiName('Pane Program')).toBe('Pane Program')
    expect(sanitizeNdiName("Nyheter #1 & 'mer'")).toBe("Nyheter #1 & 'mer'")
  })
  it('falls back to Pane when empty after cleaning', () => {
    expect(sanitizeNdiName('((()))')).toBe('Pane')
    expect(sanitizeNdiName('   ')).toBe('Pane')
  })
  it('clamps to 63 chars', () => {
    expect(sanitizeNdiName('x'.repeat(100)).length).toBe(63)
  })
})

describe('IPC schemas', () => {
  it('NavigateReq accepts a url and rejects junk', () => {
    expect(NavigateReqSchema.safeParse({ url: 'vg.no' }).success).toBe(true)
    expect(NavigateReqSchema.safeParse({ url: '' }).success).toBe(false)
    expect(NavigateReqSchema.safeParse({}).success).toBe(false)
    expect(NavigateReqSchema.safeParse('vg.no').success).toBe(false)
  })

  it('NavAction allows only the four actions', () => {
    expect(NavActionSchema.safeParse({ action: 'back' }).success).toBe(true)
    expect(NavActionSchema.safeParse({ action: 'close' }).success).toBe(false)
  })

  it('SettingsPatch rejects invalid values but allows any subset', () => {
    expect(SettingsPatchSchema.safeParse({}).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ fps: 60 }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ fps: 61 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ width: 99999 }).success).toBe(false)
  })

  it('validates mode and http settings', () => {
    expect(SettingsPatchSchema.safeParse({ mode: 'presenter' }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ mode: 'kiosk' }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ httpPort: 9350 }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ httpPort: 80 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ httpToken: 'x'.repeat(200) }).success).toBe(false)
    expect(parseConfig({ mode: 'presenter', httpLan: true }).mode).toBe('presenter')
    expect(parseConfig(undefined).httpPort).toBe(9350)
  })

  it('validates and defaults the dither + preview flags', () => {
    expect(SettingsPatchSchema.safeParse({ dither: true }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ dither: 1 }).success).toBe(false)
    expect(parseConfig(undefined).dither).toBe(false)
    expect(parseConfig({ dither: true }).dither).toBe(true)
    expect(parseConfig(undefined).showPreview).toBe(true)
    expect(parseConfig({ showPreview: false }).showPreview).toBe(false)
    expect(SettingsPatchSchema.safeParse({ showPreview: 'no' }).success).toBe(false)
  })

  it('validates the presenter display id', () => {
    expect(SettingsPatchSchema.safeParse({ presenterDisplayId: 0 }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ presenterDisplayId: 667457223 }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ presenterDisplayId: -1 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ presenterDisplayId: 1.5 }).success).toBe(false)
    expect(parseConfig(undefined).presenterDisplayId).toBe(0)
  })

  it('validates and defaults the startup flags', () => {
    expect(SettingsPatchSchema.safeParse({ launchAtLogin: true, startMinimized: true }).success).toBe(
      true
    )
    expect(SettingsPatchSchema.safeParse({ launchAtLogin: 'yes' }).success).toBe(false)
    expect(parseConfig(undefined).launchAtLogin).toBe(false)
    expect(parseConfig(undefined).startMinimized).toBe(false)
    expect(parseConfig({ launchAtLogin: true }).launchAtLogin).toBe(true)
  })

  it('InputEvent validates each kind and rejects malformed events', () => {
    expect(
      InputEventSchema.safeParse({ kind: 'move', x: 0.5, y: 0.5, modifiers: [] }).success
    ).toBe(true)
    expect(
      InputEventSchema.safeParse({
        kind: 'down',
        x: 0,
        y: 1,
        button: 0,
        clickCount: 2,
        modifiers: ['shift']
      }).success
    ).toBe(true)
    expect(
      InputEventSchema.safeParse({ kind: 'wheel', x: 0.5, y: 0.5, deltaX: 0, deltaY: 120, modifiers: [] })
        .success
    ).toBe(true)
    expect(
      InputEventSchema.safeParse({ kind: 'key', direction: 'down', key: 'a', modifiers: [] }).success
    ).toBe(true)
    // out-of-range coords, unknown kind, oversized key
    expect(InputEventSchema.safeParse({ kind: 'move', x: 1.5, y: 0, modifiers: [] }).success).toBe(false)
    expect(InputEventSchema.safeParse({ kind: 'hover', x: 0, y: 0 }).success).toBe(false)
    expect(
      InputEventSchema.safeParse({ kind: 'key', direction: 'down', key: 'x'.repeat(40), modifiers: [] })
        .success
    ).toBe(false)
  })
})
