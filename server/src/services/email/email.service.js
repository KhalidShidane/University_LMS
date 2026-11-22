// Provider-neutral email sending. Business logic calls sendEmail(); the transport
// (Resend today) can be replaced by changing EMAIL_PROVIDER and adding a transport.
import EmailLog from '../../models/EmailLog.js'
import { createResendTransport } from './resend.transport.js'
import { EmailTransportError } from './transportError.js'
import { inlineIconAttachments } from './inlineIcons.js'
import { isProviderBlocked, markProviderBlocked } from './providerStatus.service.js'

// Development-only transport: prints the message summary (and links) to the server console.
function createConsoleTransport() {
  return {
    name: 'console',
    async send({ to, subject, text }) {
      if (process.env.NODE_ENV === 'production') throw new EmailTransportError('The console email provider is disabled in production', { code: 'not_configured' })
      console.info(`[email:console] To: ${to.email} | Subject: ${subject}\n${text}`)
      return { providerMessageId: `console-${Date.now()}` }
    },
  }
}

let transportOverride = null

// Provider health: an account-level failure (blocked/invalid keys, not configured) affects every
// message, so callers can tell users honestly that email is unavailable right now.
const ACCOUNT_LEVEL_ERRORS = new Set(['auth_failed', 'not_configured'])
let providerOutage = null
export async function emailDeliveryAvailable(now = Date.now()) {
  // A provider block stays until an administrator resumes sending (no periodic retries).
  if (await isProviderBlocked(activeTransport().name)) return false
  if (!providerOutage) return true
  // Re-check periodically: the next real send attempt clears or renews the outage.
  return now - providerOutage.at > 5 * 60 * 1000
}
/** Test hook: replace the transport (pass null to restore). */
export function setEmailTransport(transport) { transportOverride = transport; providerOutage = null }

export function activeTransport() {
  if (transportOverride) return transportOverride
  return (process.env.EMAIL_PROVIDER || 'resend').toLowerCase() === 'console' ? createConsoleTransport() : createResendTransport()
}

export function publicAppUrl(path = '/') {
  const configured = process.env.APP_URL || String(process.env.CLIENT_URL || '').split(',')[0].trim() || 'http://localhost:5173'
  return new URL(path, configured.endsWith('/') ? configured : `${configured}/`).toString()
}

/**
 * Sends one email and records the outcome. Never throws: returns { ok, providerMessageId, errorCode, temporary }.
 * @param {{ type: string, to: { email: string, name?: string, userId?: any }, subject: string, html: string, text: string, customId?: string }} message
 */
export async function sendEmail(message, { bypassProviderBlock = false } = {}) {
  const transport = activeTransport()
  const base = { type: message.type, recipientUser: message.to.userId || null, recipientEmail: message.to.email, subject: message.subject, provider: transport.name }
  if (!bypassProviderBlock && await isProviderBlocked(transport.name)) {
    // Do not call the provider while the account is blocked; record the skip for troubleshooting.
    await EmailLog.create({ ...base, status: 'skipped', errorCode: 'provider_blocked', errorMessage: 'Not sent: email provider is temporarily blocked' }).catch(() => {})
    return { ok: false, errorCode: 'provider_blocked', blocked: true, temporary: false, permanent: false }
  }
  try {
    // Attach the inline icon images the message references (cid:darsivo-*).
    const result = await transport.send({ ...message, attachments: inlineIconAttachments(message.html) })
    providerOutage = null
    await EmailLog.create({ ...base, status: 'sent', providerMessageId: result.providerMessageId || '' }).catch(() => {})
    return { ok: true, providerMessageId: result.providerMessageId || '' }
  } catch (error) {
    const errorCode = error instanceof EmailTransportError ? error.code : 'unexpected_error'
    if (ACCOUNT_LEVEL_ERRORS.has(errorCode)) providerOutage = { code: errorCode, at: Date.now() }
    const errorMessage = error instanceof EmailTransportError ? error.message : 'Unexpected email error'
    if (errorCode === 'provider_blocked') {
      await markProviderBlocked({ provider: transport.name, errorCode, providerErrorCode: error.providerErrorCode, providerErrorIdentifier: error.providerErrorIdentifier, httpStatus: error.status, message: errorMessage }).catch((stateError) => console.error('Could not record provider block', stateError.message))
    }
    // Log type and reason only: no recipient token, message body, or credentials.
    console.error(`Email delivery failed (${message.type}, ${transport.name}): ${errorCode} - ${errorMessage}`)
    await EmailLog.create({ ...base, status: 'failed', errorCode, errorMessage }).catch(() => {})
    return { ok: false, errorCode, blocked: errorCode === 'provider_blocked', temporary: Boolean(error.temporary), permanent: Boolean(error.permanent), httpStatus: error.status || null, providerErrorCode: error.providerErrorCode || '', providerErrorIdentifier: error.providerErrorIdentifier || '' }
  }
}
