import { describe, expect, it } from 'vitest'
import { INTERNAL_TESTCARD, normalizeUrl } from '../src/shared/url'

describe('normalizeUrl', () => {
  it('prefixes bare hosts with https', () => {
    const r = normalizeUrl('vg.no')
    expect(r).toEqual({ ok: true, url: 'https://vg.no/' })
  })

  it('keeps explicit http', () => {
    expect(normalizeUrl('http://localhost:3000/x')).toEqual({
      ok: true,
      url: 'http://localhost:3000/x'
    })
  })

  it('accepts the internal testcard id (both spellings)', () => {
    expect(normalizeUrl('vev:testcard')).toEqual({ ok: true, url: INTERNAL_TESTCARD })
    expect(normalizeUrl('Testkort')).toEqual({ ok: true, url: INTERNAL_TESTCARD })
  })

  it('accepts about:blank', () => {
    expect(normalizeUrl('about:blank')).toEqual({ ok: true, url: 'about:blank' })
  })

  it('rejects dangerous schemes', () => {
    for (const bad of ['file:///C:/x', 'javascript:alert(1)', 'data:text/html,x', 'chrome://gpu']) {
      expect(normalizeUrl(bad).ok, bad).toBe(false)
    }
  })

  it('rejects empty and unparsable input', () => {
    expect(normalizeUrl('').ok).toBe(false)
    expect(normalizeUrl('   ').ok).toBe(false)
    expect(normalizeUrl('http://').ok).toBe(false)
  })

  it('trims whitespace', () => {
    expect(normalizeUrl('  nrk.no  ')).toEqual({ ok: true, url: 'https://nrk.no/' })
  })
})
