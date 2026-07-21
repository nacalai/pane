/**
 * Pure authorization decision for the control API — separated for unit tests.
 *
 * Threat model: Pane's own content window renders ARBITRARY web pages on this
 * machine. A hostile page can fire fetch()/img/navigation requests at
 * http://127.0.0.1:<port>/api/* — loopback origin, real side effects (hijack
 * what's on air). Defenses:
 *
 *  1. Any request carrying a browser provenance marker (Sec-Fetch-Site other
 *     than 'none', or an Origin header) is rejected. Legit clients — Stream
 *     Deck plugins, Companion, curl — never send these; browsers always do on
 *     scripted cross-origin requests.
 *  2. Loopback fast-path additionally pins the Host header to loopback names,
 *     which defeats DNS rebinding (rebound requests carry the attacker's host).
 *  3. Everything else needs LAN mode + a bearer token, compared timing-safe.
 *     Tokens are NOT accepted via query string (they leak into logs/history).
 */
import { createHash, timingSafeEqual } from 'node:crypto'

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export interface AuthInput {
  remoteAddress: string
  hostHeader: string
  originHeader: string | undefined
  secFetchSite: string | undefined
  authorizationHeader: string | undefined
  port: number
  lan: boolean
  token: string
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!token || !header) return false
  const bearer = header.replace(/^Bearer\s+/i, '')
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = createHash('sha256').update(bearer).digest()
  const b = createHash('sha256').update(token).digest()
  return timingSafeEqual(a, b)
}

export function authorizeRequest(input: AuthInput): { ok: true } | { ok: false; reason: string } {
  // Browser-originated requests are never legitimate control-API callers.
  if (input.originHeader !== undefined) {
    return { ok: false, reason: 'browser-originated requests are rejected (Origin)' }
  }
  if (input.secFetchSite !== undefined && input.secFetchSite !== 'none') {
    return { ok: false, reason: 'browser-originated requests are rejected (Sec-Fetch-Site)' }
  }

  if (LOOPBACK_ADDRS.has(input.remoteAddress)) {
    const hostname = input.hostHeader.replace(/:\d+$/, '').toLowerCase()
    if (!LOOPBACK_HOSTS.has(hostname)) {
      return { ok: false, reason: 'invalid Host header (DNS rebinding?)' }
    }
    return { ok: true }
  }

  if (!input.lan || !input.token) {
    return { ok: false, reason: 'external calls require LAN mode + token' }
  }
  if (!tokenMatches(input.authorizationHeader, input.token)) {
    return { ok: false, reason: 'invalid token (Authorization: Bearer …)' }
  }
  return { ok: true }
}
