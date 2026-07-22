/** Internal page ids — never raw file paths in the URL bar. */
export const INTERNAL_TESTCARD = 'pane:testcard'

export type UrlResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * User input → loadable URL. Allowlist: http(s), about:blank, pane:testcard.
 * Bare hosts get https://. file:, javascript:, data: are rejected — the content
 * window renders arbitrary remote pages and must never reach local files.
 */
export function normalizeUrl(input: string): UrlResult {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'Empty address' }
  const lower = raw.toLowerCase()
  if (lower === INTERNAL_TESTCARD || lower === 'testcard' || lower === 'testkort')
    return { ok: true, url: INTERNAL_TESTCARD }
  if (lower === 'about:blank') return { ok: true, url: 'about:blank' }

  // "host:port" (e.g. graphics:8080, localhost:3000) looks like a scheme but is really a bare
  // host — the part after ':' is all digits. Treat those as needing https, not as a scheme.
  const looksLikeHostPort = /^[a-z0-9.-]+:\d+(\/|$)/i.test(raw)
  const hasScheme = !looksLikeHostPort && /^[a-z][a-z0-9+.-]*:/i.test(raw)
  const candidate = hasScheme ? raw : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, error: `Invalid address: ${raw}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `Only http(s) addresses are allowed (got ${parsed.protocol})` }
  }
  if (!parsed.hostname) return { ok: false, error: `Invalid address: ${raw}` }
  return { ok: true, url: parsed.toString() }
}
