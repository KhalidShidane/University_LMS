import test from 'node:test'
import assert from 'node:assert/strict'
import { createResendTransport, mapResendError, resendConfigured } from './resend.transport.js'

test('Resend configuration requires an API key and a sender', () => {
  assert.equal(resendConfigured({}), false)
  assert.equal(resendConfigured({ RESEND_API_KEY: 're_x' }), false)
  assert.equal(resendConfigured({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'DARSIVO LMS <noreply@example.edu>' }), true)
})

test('Resend errors map to provider-neutral codes', () => {
  const cases = [
    [{ name: 'invalid_api_key', statusCode: 401, message: 'API key is invalid' }, 'auth_failed', false, false],
    [{ name: 'missing_api_key', statusCode: 401, message: 'Missing API key' }, 'auth_failed', false, false],
    [{ name: 'rate_limit_exceeded', statusCode: 429, message: 'Too many requests' }, 'rate_limited', true, false],
    [{ name: 'daily_quota_exceeded', statusCode: 429, message: 'Daily quota exceeded' }, 'quota_exceeded', true, false],
    [{ name: 'validation_error', statusCode: 403, message: 'The example.com domain is not verified. Please, add and verify your domain on https://resend.com/domains' }, 'provider_blocked', false, false],
    [{ name: 'validation_error', statusCode: 403, message: 'You can only send testing emails to your own email address (owner@example.com).' }, 'provider_blocked', false, false],
    [{ name: 'invalid_from_address', statusCode: 422, message: 'Invalid `from` field.' }, 'provider_blocked', false, false],
    [{ name: 'validation_error', statusCode: 422, message: 'Invalid `to` field.' }, 'provider_error', false, true],
    [{ name: 'internal_server_error', statusCode: 500, message: 'Unexpected error' }, 'provider_error', true, false],
    [{ name: 'application_error', statusCode: 503, message: 'Internal server error' }, 'provider_error', true, false],
  ]
  for (const [error, code, temporary, permanent] of cases) {
    const mapped = mapResendError(error)
    assert.equal(mapped.code, code, error.name)
    assert.equal(mapped.temporary, temporary, `${error.name} temporary`)
    assert.equal(mapped.permanent, permanent, `${error.name} permanent`)
    assert.equal(mapped.providerErrorCode, error.name)
    assert.match(mapped.message, /^Resend rejected the message:/)
  }
})

test('Resend transport refuses to send when not configured (no network call)', async () => {
  const transport = createResendTransport({})
  assert.equal(transport.name, 'resend')
  await assert.rejects(() => transport.send({ to: { email: 'a@example.edu' }, subject: 's', html: '<p>h</p>', text: 't' }), (error) => error.code === 'not_configured')
  assert.deepEqual(await transport.checkConnection(), { ok: false, httpStatus: null, errorCode: 'not_configured' })
})
