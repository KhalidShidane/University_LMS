// Resend transport using the official Node.js SDK (https://resend.com/docs/send-with-nodejs).
// Credentials are read from the environment at send time and are never logged or returned.
import { Resend } from 'resend'
import { EmailTransportError } from './transportError.js'

const DEFAULT_TIMEOUT_MS = 10000

export function resendConfigured(env = process.env) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM)
}

function client(env) {
  // baseUrl is only overridden for local tests (RESEND_BASE_URL); production uses the SDK default.
  return new Resend(env.RESEND_API_KEY, env.RESEND_BASE_URL ? { baseUrl: env.RESEND_BASE_URL } : undefined)
}

/**
 * Maps a Resend error ({ name, statusCode, message }) to the app's provider-neutral codes.
 * Account-level refusals (unverified sending domain, testing-mode recipient restriction,
 * invalid sender) affect every message, so they are reported as 'provider_blocked' and
 * pause sending until an administrator resumes it.
 */
export function mapResendError(error = {}) {
  const name = String(error.name || '')
  const status = Number(error.statusCode) || 0
  const detail = String(error.message || `HTTP ${status || 'error'}`).slice(0, 200)
  const accountRestricted = name === 'invalid_from_address'
    || (status === 403 && /domain is not verified|verify a domain|only send testing emails/i.test(detail))
  let code = 'provider_error'
  let temporary = false
  let permanent = false
  if (accountRestricted) code = 'provider_blocked'
  else if (['missing_api_key', 'invalid_api_key', 'restricted_api_key', 'invalid_access', 'security_error'].includes(name) || status === 401) code = 'auth_failed'
  else if (name === 'rate_limit_exceeded') { code = 'rate_limited'; temporary = true }
  else if (['daily_quota_exceeded', 'monthly_quota_exceeded'].includes(name)) { code = 'quota_exceeded'; temporary = true }
  else if (['application_error', 'internal_server_error', 'concurrent_idempotent_requests'].includes(name) || status >= 500) temporary = true
  else if (['validation_error', 'missing_required_field', 'invalid_parameter'].includes(name) || status === 422) permanent = true
  return new EmailTransportError(`Resend rejected the message: ${detail}`, { code, status, temporary, permanent, providerErrorCode: name.slice(0, 40) })
}

export function createResendTransport(env = process.env) {
  return {
    name: 'resend',
    async send({ to, subject, html, text, customId, attachments = [] }) {
      if (!resendConfigured(env)) throw new EmailTransportError('Resend is not configured', { code: 'not_configured' })
      const signal = AbortSignal.timeout(Number(env.EMAIL_SEND_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)
      let result
      try {
        result = await client(env).emails.send(
          { from: env.EMAIL_FROM, to: [to.email], subject, html, text, ...(attachments.length ? { attachments } : {}) },
          {
            signal,
            // Resend de-duplicates repeated requests with the same key for 24 hours.
            ...(customId ? { idempotencyKey: String(customId).slice(0, 256) } : {}),
          },
        )
      } catch (error) {
        const timedOut = signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError'
        throw new EmailTransportError(timedOut ? 'Resend request timed out' : 'Resend could not be reached', { code: timedOut ? 'timeout' : 'network_error', temporary: true })
      }
      if (result?.error) {
        if (signal.aborted) throw new EmailTransportError('Resend request timed out', { code: 'timeout', temporary: true })
        throw mapResendError(result.error)
      }
      if (!result?.data?.id) throw new EmailTransportError('Resend returned no message id', { code: 'provider_error', temporary: true })
      return { providerMessageId: String(result.data.id) }
    },
    // Credential check without sending. A sending-only key is valid but may not list domains
    // (restricted_api_key), which still proves the key is accepted.
    async checkConnection() {
      if (!resendConfigured(env)) return { ok: false, httpStatus: null, errorCode: 'not_configured' }
      try {
        const { error } = await client(env).domains.list()
        if (!error || error.name === 'restricted_api_key') return { ok: true, httpStatus: 200, errorCode: '' }
        return { ok: false, httpStatus: error.statusCode || null, errorCode: mapResendError(error).code }
      } catch {
        return { ok: false, httpStatus: null, errorCode: 'network_error' }
      }
    },
  }
}
