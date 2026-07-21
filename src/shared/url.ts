/** Internal page ids — never raw file paths in the URL bar. */
export const INTERNAL_TESTCARD = 'vev:testcard'

export type UrlResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * User input → loadable URL. Allowlist: http(s), about:blank, vev:testcard.
 * Bare hosts get https://. file:, javascript:, data: are rejected — the content
 * window renders arbitrary remote pages and must never reach local files.
 */
export function normalizeUrl(input: string): UrlResult {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'Tom adresse' }
  const lower = raw.toLowerCase()
  if (lower === INTERNAL_TESTCARD || lower === 'testkort') return { ok: true, url: INTERNAL_TESTCARD }
  if (lower === 'about:blank') return { ok: true, url: 'about:blank' }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw)
  const candidate = hasScheme ? raw : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, error: `Ugyldig adresse: ${raw}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `Bare http(s)-adresser er tillatt (fikk ${parsed.protocol})` }
  }
  if (!parsed.hostname) return { ok: false, error: `Ugyldig adresse: ${raw}` }
  return { ok: true, url: parsed.toString() }
}
