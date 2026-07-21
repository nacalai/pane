import { describe, expect, it } from 'vitest'
import { authorizeRequest, type AuthInput } from '../src/main/control-auth'

const base: AuthInput = {
  remoteAddress: '127.0.0.1',
  hostHeader: '127.0.0.1:9350',
  originHeader: undefined,
  secFetchSite: undefined,
  authorizationHeader: undefined,
  port: 9350,
  lan: false,
  token: ''
}

describe('authorizeRequest — loopback', () => {
  it('allows plain loopback callers (Stream Deck, Companion, curl)', () => {
    expect(authorizeRequest(base)).toEqual({ ok: true })
    expect(authorizeRequest({ ...base, hostHeader: 'localhost:9350' })).toEqual({ ok: true })
    expect(authorizeRequest({ ...base, remoteAddress: '::1', hostHeader: '[::1]:9350' })).toEqual({
      ok: true
    })
  })

  it('allows a manually typed browser address-bar request (Sec-Fetch-Site: none)', () => {
    expect(authorizeRequest({ ...base, secFetchSite: 'none' }).ok).toBe(true)
  })

  it('rejects browser-scripted requests — the on-air CSRF vector', () => {
    // fetch()/img/script from any web page, including VEV's own content window
    expect(authorizeRequest({ ...base, secFetchSite: 'cross-site' }).ok).toBe(false)
    expect(authorizeRequest({ ...base, secFetchSite: 'same-site' }).ok).toBe(false)
    expect(authorizeRequest({ ...base, secFetchSite: 'same-origin' }).ok).toBe(false)
    expect(authorizeRequest({ ...base, originHeader: 'https://evil.example' }).ok).toBe(false)
  })

  it('rejects DNS-rebinding (loopback socket, foreign Host header)', () => {
    expect(authorizeRequest({ ...base, hostHeader: 'attacker.example:9350' }).ok).toBe(false)
    expect(authorizeRequest({ ...base, hostHeader: '' }).ok).toBe(false)
  })
})

describe('authorizeRequest — remote', () => {
  const remote: AuthInput = {
    ...base,
    remoteAddress: '192.168.1.50',
    hostHeader: '192.168.1.10:9350'
  }

  it('rejects remote callers without LAN mode or token', () => {
    expect(authorizeRequest(remote).ok).toBe(false)
    expect(authorizeRequest({ ...remote, lan: true }).ok).toBe(false)
    expect(authorizeRequest({ ...remote, token: 'hemmelig' }).ok).toBe(false)
  })

  it('accepts a correct bearer token, rejects a wrong one', () => {
    const cfg = { ...remote, lan: true, token: 'hemmelig' }
    expect(
      authorizeRequest({ ...cfg, authorizationHeader: 'Bearer hemmelig' })
    ).toEqual({ ok: true })
    expect(authorizeRequest({ ...cfg, authorizationHeader: 'hemmelig' })).toEqual({ ok: true })
    expect(authorizeRequest({ ...cfg, authorizationHeader: 'Bearer feil' }).ok).toBe(false)
    expect(authorizeRequest({ ...cfg, authorizationHeader: undefined }).ok).toBe(false)
  })

  it('still rejects browser provenance markers even with a valid token', () => {
    const cfg = { ...remote, lan: true, token: 'hemmelig', authorizationHeader: 'Bearer hemmelig' }
    expect(authorizeRequest({ ...cfg, secFetchSite: 'cross-site' }).ok).toBe(false)
  })
})
