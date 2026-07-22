/**
 * NDI audio via loopback. Captures the computer's audio OUTPUT with getDisplayMedia loopback
 * (main provides the source), batches it into ~40 ms planar float32 frames in an AudioWorklet,
 * and hands them to the main process → NDI. Started/stopped by App when config.ndiAudio changes.
 *
 * Note: loopback captures ALL system audio, and the page must be audible to be captured — both
 * inherent to loopback. The (API-required) video track is stopped immediately.
 */
const AUDIO_WORKLET = `
class PaneCap extends AudioWorkletProcessor {
  constructor() { super(); this._chunks = []; this._count = 0; this._target = Math.round(sampleRate / 25); }
  process(inputs) {
    const inp = inputs[0];
    if (inp && inp.length && inp[0] && inp[0].length) {
      this._chunks.push(inp.map((c) => c.slice(0)));
      this._count += inp[0].length;
      if (this._count >= this._target) {
        const channels = this._chunks[0].length;
        const out = [];
        for (let c = 0; c < channels; c++) {
          const merged = new Float32Array(this._count);
          let o = 0;
          for (const chunk of this._chunks) { const src = chunk[c] || chunk[0]; merged.set(src, o); o += src.length; }
          out.push(merged);
        }
        this.port.postMessage(out);
        this._chunks = []; this._count = 0;
      }
    }
    return true;
  }
}
registerProcessor('pane-cap', PaneCap);
`

export class NdiAudioCapture {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private busy = false

  async start(): Promise<void> {
    if (this.stream || this.busy) return
    this.busy = true
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      stream.getVideoTracks().forEach((t) => t.stop()) // we only want audio
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      this.stream = stream
      const ctx = new AudioContext()
      this.ctx = ctx
      const url = URL.createObjectURL(new Blob([AUDIO_WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      const node = new AudioWorkletNode(ctx, 'pane-cap')
      this.node = node
      const sampleRate = ctx.sampleRate
      node.port.onmessage = (e: MessageEvent<Float32Array[]>): void => {
        const chans = e.data
        const channels = chans.length
        const samples = chans[0]?.length ?? 0
        if (!channels || !samples) return
        const planar = new Float32Array(channels * samples)
        for (let c = 0; c < channels; c++) planar.set(chans[c]!, c * samples)
        window.pane.sendAudio(planar.buffer, sampleRate, channels, samples)
      }
      // Source → worklet only. Do NOT connect to ctx.destination (would re-play / feed back).
      ctx.createMediaStreamSource(stream).connect(node)
    } catch (e) {
      console.error('[audio] loopback capture failed:', (e as Error).message)
      this.stop()
    } finally {
      this.busy = false
    }
  }

  stop(): void {
    try {
      this.node?.disconnect()
    } catch {
      /* ignore */
    }
    this.node = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}
