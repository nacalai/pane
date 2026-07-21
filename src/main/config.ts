/**
 * Persisted settings in <dir>/pane-config.json. The directory is injected
 * (app.getPath('userData') in production, a tmpdir in tests) so this module
 * never imports Electron. Corrupt or missing files yield defaults — a broken
 * config must never brick a broadcast tool.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseConfig, type PaneConfig } from '@shared/schema'

const FILE_NAME = 'pane-config.json'

export class ConfigStore {
  constructor(private readonly dir: string) {}

  get filePath(): string {
    return join(this.dir, FILE_NAME)
  }

  load(): PaneConfig {
    try {
      return parseConfig(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      return parseConfig(undefined)
    }
  }

  /** Atomic: write tmp then rename, so a crash mid-write never leaves a torn file. */
  save(cfg: PaneConfig): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      const tmp = this.filePath + '.tmp'
      writeFileSync(tmp, JSON.stringify(cfg, null, 2))
      renameSync(tmp, this.filePath)
    } catch (e) {
      console.error('[config] save failed:', (e as Error).message)
    }
  }
}
