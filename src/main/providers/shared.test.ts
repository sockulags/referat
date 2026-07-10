import { describe, it, expect } from 'vitest'
import {
  classifyError,
  errorDetail,
  HttpError,
  isConnectionError,
  isTimeoutError,
  trimBaseUrl,
  authHeaders,
  UserFacingError
} from './shared'

describe('trimBaseUrl', () => {
  it('strips trailing slashes', () => {
    expect(trimBaseUrl('http://localhost:8000/v1/')).toBe('http://localhost:8000/v1')
    expect(trimBaseUrl('http://localhost:8000/v1///')).toBe('http://localhost:8000/v1')
  })

  it('leaves a clean url untouched', () => {
    expect(trimBaseUrl('http://localhost:8000/v1')).toBe('http://localhost:8000/v1')
  })
})

describe('authHeaders', () => {
  it('emits both Bearer and api-key when a key is present', () => {
    expect(authHeaders('secret')).toEqual({
      Authorization: 'Bearer secret',
      'api-key': 'secret'
    })
  })

  it('emits nothing when no key is set', () => {
    expect(authHeaders('')).toEqual({})
  })
})

describe('isTimeoutError / isConnectionError', () => {
  it('recognizes TimeoutError and AbortError as timeouts', () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(isTimeoutError(timeout)).toBe(true)
    expect(isTimeoutError(abort)).toBe(true)
    expect(isTimeoutError(new Error('nope'))).toBe(false)
  })

  it('recognizes fetch/network failures as connection errors', () => {
    const typeErr = new TypeError('fetch failed')
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:8000')
    const dns = new Error('getaddrinfo ENOTFOUND api.example.com')
    expect(isConnectionError(typeErr)).toBe(true)
    expect(isConnectionError(refused)).toBe(true)
    expect(isConnectionError(dns)).toBe(true)
    expect(isConnectionError(new HttpError(500, 'boom'))).toBe(false)
    expect(isConnectionError('a string')).toBe(false)
  })
})

describe('errorDetail', () => {
  it('formats Error as "name: message"', () => {
    expect(errorDetail(new HttpError(404, 'missing'))).toBe('HttpError: HTTP 404: missing')
  })

  it('stringifies non-errors', () => {
    expect(errorDetail('plain')).toBe('plain')
    expect(errorDetail(42)).toBe('42')
  })
})

describe('classifyError', () => {
  it('passes a UserFacingError through with its own message and raw detail', () => {
    const err = new UserFacingError('Nyckeln kan inte sparas', 'DPAPI unavailable')
    const out = classifyError(err)
    expect(out.message).toBe('Nyckeln kan inte sparas')
    expect(out.detail).toBe('DPAPI unavailable')
  })

  it('falls back to errorDetail when a UserFacingError has no rawDetail', () => {
    const err = new UserFacingError('Något specifikt')
    const out = classifyError(err)
    expect(out.message).toBe('Något specifikt')
    expect(out.detail).toBe('UserFacingError: Något specifikt')
  })

  it('maps timeouts to the timeout message', () => {
    const err = new Error('timed out')
    err.name = 'TimeoutError'
    expect(classifyError(err).message).toBe('Servern svarar inte (timeout)')
  })

  it('maps connection failures to the address-check message', () => {
    expect(classifyError(new TypeError('fetch failed')).message).toBe(
      'Servern svarar inte — kontrollera adressen'
    )
  })

  it('maps 401 and 403 to the API-key message', () => {
    expect(classifyError(new HttpError(401, 'unauthorized')).message).toBe(
      'Fel eller saknad API-nyckel'
    )
    expect(classifyError(new HttpError(403, 'forbidden')).message).toBe(
      'Fel eller saknad API-nyckel'
    )
  })

  it('maps 404 to the model/endpoint message', () => {
    expect(classifyError(new HttpError(404, 'not found')).message).toBe(
      'Modellen eller endpointen hittades inte — kontrollera inställningarna'
    )
  })

  it('maps other HTTP errors to a generic status message including the code', () => {
    expect(classifyError(new HttpError(503, 'unavailable')).message).toBe(
      'Servern svarade med ett fel (503)'
    )
  })

  it('maps unknown errors to the catch-all message', () => {
    expect(classifyError(new Error('weird')).message).toBe('Något gick fel vid bearbetningen')
    expect(classifyError('boom').message).toBe('Något gick fel vid bearbetningen')
  })
})
