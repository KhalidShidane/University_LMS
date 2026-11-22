import { createHash, randomBytes } from 'node:crypto'
import User from '../models/User.js'
import { publicAppUrl, sendEmail } from './email/email.service.js'
import { verifyEmailTemplate } from './email/templates/verifyEmail.template.js'

const DAY_MS = 24 * 60 * 60 * 1000
const clamp = (value, min, max, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.min(Math.max(number, min), max) : fallback
}

export const verificationSettings = () => ({
  ttlHours: clamp(process.env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS, 1, 168, 24),
  resendCooldownSeconds: clamp(process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS, 10, 3600, 60),
  maxSendsPerDay: clamp(process.env.EMAIL_VERIFICATION_MAX_SENDS_PER_DAY, 1, 50, 5),
})

export const hashVerificationToken = (token) => createHash('sha256').update(String(token)).digest('hex')

/**
 * Issues a fresh single-use token (replacing any earlier one) and emails it.
 * With enforceLimits, a per-account cooldown and daily cap apply.
 * Returns { sent: boolean, reason: null | 'cooldown' | 'daily_limit' | 'delivery_failed' | 'not_found' }.
 */
export async function issueEmailVerification(userId, { enforceLimits = true, now = new Date() } = {}) {
  const { ttlHours, resendCooldownSeconds, maxSendsPerDay } = verificationSettings()
  const user = await User.findById(userId).select('fullName email emailVerified emailVerification').lean()
  if (!user || user.emailVerified !== false) return { sent: false, reason: 'not_found' }

  const state = user.emailVerification || {}
  const windowActive = state.windowStartedAt && now - new Date(state.windowStartedAt) < DAY_MS
  const sendCount = windowActive ? Number(state.sendCount) || 0 : 0
  if (enforceLimits && sendCount >= maxSendsPerDay) return { sent: false, reason: 'daily_limit' }

  const token = randomBytes(32).toString('base64url')
  const cooldownBoundary = new Date(now.getTime() - resendCooldownSeconds * 1000)
  // Conditional update: concurrent resend requests cannot both pass the cooldown.
  const claim = await User.updateOne(
    {
      _id: user._id,
      emailVerified: false,
      ...(enforceLimits ? { $or: [{ 'emailVerification.lastSentAt': { $exists: false } }, { 'emailVerification.lastSentAt': null }, { 'emailVerification.lastSentAt': { $lte: cooldownBoundary } }] } : {}),
    },
    {
      $set: {
        emailVerificationTokenHash: hashVerificationToken(token),
        'emailVerification.expiresAt': new Date(now.getTime() + ttlHours * 60 * 60 * 1000),
        'emailVerification.lastSentAt': now,
        'emailVerification.windowStartedAt': windowActive ? state.windowStartedAt : now,
        'emailVerification.sendCount': sendCount + 1,
        'emailVerification.deliveryStatus': 'pending',
        'emailVerification.deliveryError': '',
      },
    },
  )
  if (!claim.modifiedCount) return { sent: false, reason: 'cooldown' }

  const verifyUrl = publicAppUrl(`/verify-email/${encodeURIComponent(token)}`)
  const message = verifyEmailTemplate({ fullName: user.fullName, verifyUrl, expiresInHours: ttlHours, supportUrl: publicAppUrl('/verify-email') })
  const result = await sendEmail({ type: 'email_verification', to: { email: user.email, name: user.fullName, userId: user._id }, customId: `verify-${user._id}-${now.getTime()}`, ...message })
  await User.updateOne({ _id: user._id }, {
    $set: {
      'emailVerification.deliveryStatus': result.ok ? 'sent' : 'failed',
      'emailVerification.deliveryError': result.ok ? '' : result.errorCode,
    },
  })
  return { sent: result.ok, reason: result.ok ? null : 'delivery_failed' }
}

/** Returns 'verified' | 'expired' | 'invalid'. Tokens are single-use. */
export async function confirmEmailVerification(token, { now = new Date() } = {}) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return 'invalid'
  const tokenHash = hashVerificationToken(token)
  const user = await User.findOne({ emailVerificationTokenHash: tokenHash }).select('_id emailVerification').lean()
  if (!user) return 'invalid'
  if (!user.emailVerification?.expiresAt || new Date(user.emailVerification.expiresAt) <= now) {
    await User.updateOne({ _id: user._id, emailVerificationTokenHash: tokenHash }, { $unset: { emailVerificationTokenHash: 1 } })
    return 'expired'
  }
  const updated = await User.updateOne(
    { _id: user._id, emailVerificationTokenHash: tokenHash, 'emailVerification.expiresAt': { $gt: now } },
    { $set: { emailVerified: true, emailVerifiedAt: now }, $unset: { emailVerificationTokenHash: 1, 'emailVerification.expiresAt': 1 } },
  )
  return updated.modifiedCount ? 'verified' : 'invalid'
}

/**
 * One-time, idempotent migration: accounts created before email verification existed
 * have no emailVerified field and are marked verified so they are never locked out.
 */
export async function migrateLegacyEmailVerification() {
  const result = await User.collection.updateMany(
    { emailVerified: { $exists: false } },
    { $set: { emailVerified: true, emailVerificationLegacy: true } },
  )
  if (result.modifiedCount) console.info(`Email verification migration: marked ${result.modifiedCount} existing account(s) as verified`)
  return result.modifiedCount
}
