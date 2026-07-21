/**
 * Pure frame-pacing + stats. The send loop ticks at the target fps; a tick sends
 * the latest painted frame even if the page stopped painting (frame repetition —
 * an NDI source must never starve just because a page is static). No Electron imports.
 */

export const STATIC_AFTER_MS = 2000
const FPS_WINDOW_MS = 2000
const MAX_TRACKED_SENDS = 1000 // hard ceiling; 60 fps over the 2 s window is 120 entries

export interface TickDecision {
  send: boolean
  isRepeat: boolean
}

export interface PacerStats {
  sentFps: number
  framesSent: number
  staticPage: boolean
}

export class Pacer {
  private lastPaintAt = Number.NEGATIVE_INFINITY
  private paintedSinceLastTick = false
  private framesSent = 0
  private sendTimes: number[] = []

  onFrame(now: number): void {
    this.lastPaintAt = now
    this.paintedSinceLastTick = true
  }

  onTick(now: number): TickDecision {
    if (this.lastPaintAt === Number.NEGATIVE_INFINITY) return { send: false, isRepeat: false }
    const isRepeat = !this.paintedSinceLastTick
    this.paintedSinceLastTick = false
    this.framesSent += 1
    this.sendTimes.push(now)
    this.prune(now)
    return { send: true, isRepeat }
  }

  stats(now: number): PacerStats {
    this.prune(now)
    const sentFps = Math.round((this.sendTimes.length / (FPS_WINDOW_MS / 1000)) * 10) / 10
    return {
      sentFps,
      framesSent: this.framesSent,
      staticPage: now - this.lastPaintAt > STATIC_AFTER_MS
    }
  }

  reset(): void {
    this.lastPaintAt = Number.NEGATIVE_INFINITY
    this.paintedSinceLastTick = false
    this.framesSent = 0
    this.sendTimes = []
  }

  private prune(now: number): void {
    const cutoff = now - FPS_WINDOW_MS
    let drop = 0
    while (drop < this.sendTimes.length && (this.sendTimes[drop] ?? Infinity) < cutoff) drop += 1
    if (drop > 0) this.sendTimes.splice(0, drop)
    if (this.sendTimes.length > MAX_TRACKED_SENDS) {
      this.sendTimes.splice(0, this.sendTimes.length - MAX_TRACKED_SENDS)
    }
  }
}
