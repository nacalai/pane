import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../src/main/config'
import { DEFAULT_CONFIG } from '../src/shared/schema'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vev-config-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ConfigStore', () => {
  it('returns defaults when the file is missing', () => {
    expect(new ConfigStore(dir).load()).toEqual(DEFAULT_CONFIG)
  })

  it('returns defaults when the file is corrupt JSON', () => {
    const store = new ConfigStore(dir)
    writeFileSync(store.filePath, '{ this is not json')
    expect(store.load()).toEqual(DEFAULT_CONFIG)
  })

  it('returns defaults when the file has invalid values', () => {
    const store = new ConfigStore(dir)
    writeFileSync(store.filePath, JSON.stringify({ fps: 24 }))
    expect(store.load()).toEqual(DEFAULT_CONFIG)
  })

  it('round-trips a saved config', () => {
    const store = new ConfigStore(dir)
    const cfg = { ...DEFAULT_CONFIG, url: 'https://vg.no/', fps: 50 as const }
    store.save(cfg)
    expect(store.load()).toEqual(cfg)
  })

  it('persists the NDI source name and all settings across a reload', () => {
    const store = new ConfigStore(dir)
    const cfg = {
      ...DEFAULT_CONFIG,
      ndiName: 'Studio 1 Nyheter',
      mode: 'presenter' as const,
      presenterFullscreen: true,
      httpPort: 9400,
      httpLan: true,
      httpToken: 'hemmelig',
      launchAtLogin: true,
      startMinimized: true
    }
    store.save(cfg)
    // A fresh store instance (simulating an app restart) must see every value.
    const reloaded = new ConfigStore(dir).load()
    expect(reloaded.ndiName).toBe('Studio 1 Nyheter')
    expect(reloaded).toEqual(cfg)
  })

  it('leaves no tmp file behind after save', () => {
    const store = new ConfigStore(dir)
    store.save(DEFAULT_CONFIG)
    expect(readdirSync(dir)).toEqual(['vev-config.json'])
    expect(JSON.parse(readFileSync(store.filePath, 'utf8')).url).toBe('vev:testcard')
  })

  it('creates the directory if missing and never throws on save failure', () => {
    const store = new ConfigStore(join(dir, 'nested', 'deeper'))
    expect(() => store.save(DEFAULT_CONFIG)).not.toThrow()
    expect(store.load()).toEqual(DEFAULT_CONFIG)
  })
})
