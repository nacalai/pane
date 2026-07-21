/**
 * Stream Deck / Companion HTTP control API. Plain node:http, GET or POST.
 *
 * Security model: loopback callers are always allowed (the presenter's own
 * Stream Deck). Remote callers require BOTH the LAN toggle AND a matching
 * bearer/query token — no token configured means loopback-only, period.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { routeCommand, type ControlCommand } from '@shared/control-routes'

const REQUEST_TIMEOUT_MS = 10_000
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export interface HttpSettings {
  enabled: boolean
  port: number
  lan: boolean
  token: string
}

export type CommandExecutor = (cmd: ControlCommand) => { ok: true; data: unknown } | { ok: false; error: string }

export class ControlServer {
  private server: Server | null = null
  private current: HttpSettings | null = null
  private lastError: string | null = null

  constructor(private readonly exec: CommandExecutor) {}

  get error(): string | null {
    return this.lastError
  }

  /** Idempotent: (re)starts only when settings actually changed. */
  apply(next: HttpSettings): void {
    if (
      this.current &&
      this.current.enabled === next.enabled &&
      this.current.port === next.port &&
      this.current.lan === next.lan &&
      this.current.token === next.token &&
      this.server
    ) {
      return
    }
    this.stop()
    this.current = { ...next }
    if (!next.enabled) return

    const host = next.lan && next.token ? '0.0.0.0' : '127.0.0.1'
    const server = createServer((req, res) => this.handle(req, res))
    server.requestTimeout = REQUEST_TIMEOUT_MS
    server.on('error', (e: NodeJS.ErrnoException) => {
      this.lastError =
        e.code === 'EADDRINUSE'
          ? `port ${next.port} er opptatt — endre port under Fjernstyring`
          : `HTTP-feil: ${e.message}`
      console.error('[http]', this.lastError)
      this.server = null
    })
    server.listen(next.port, host, () => {
      this.lastError = null
      console.log(`[http] fjernstyring på http://${host === '0.0.0.0' ? '<LAN-IP>' : host}:${next.port}/api/…`)
    })
    this.server = server
  }

  private authorized(req: IncomingMessage, url: URL): boolean {
    const remote = req.socket.remoteAddress ?? ''
    if (LOOPBACK.has(remote)) return true
    const cfg = this.current
    if (!cfg || !cfg.lan || !cfg.token) return false
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    return bearer === cfg.token || url.searchParams.get('token') === cfg.token
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const send = (status: number, body: unknown): void => {
      const json = JSON.stringify(body)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(json)
    }
    try {
      if (req.method !== 'GET' && req.method !== 'POST') {
        send(405, { ok: false, error: 'bare GET/POST' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://vev.local')
      if (!this.authorized(req, url)) {
        send(403, { ok: false, error: 'ikke autorisert (LAN + token kreves for eksterne kall)' })
        return
      }
      const routed = routeCommand(url.pathname, url.searchParams)
      if (!routed.ok) {
        send(routed.status, { ok: false, error: routed.error })
        return
      }
      const result = this.exec(routed.cmd)
      if (result.ok) send(200, { ok: true, ...(result.data !== null ? { data: result.data } : {}) })
      else send(422, result)
    } catch (e) {
      send(500, { ok: false, error: (e as Error).message })
    }
  }

  stop(): void {
    if (this.server) {
      try {
        this.server.close()
      } catch {
        /* ignore */
      }
      this.server = null
    }
  }
}
