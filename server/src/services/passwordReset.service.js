// Self-service password reset by email: single-use, short-lived tokens stored only as hashes.
import { createHash, randomBytes } from 'node:crypto'
import User from '../models/User.js'
import { publicAppUrl, sendEmail } from './email/email.service.js'
import { passwordChangedTemplate, passwordResetTemplate } from './email/templates/accountSecurity.templates.js'
import { hashPassword } from './password.service.js'
import { loadSystemSettings } from './systemSettings.service.js'

const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback)
export const resetSettings = () => ({
  ttlMinutes: Math.min(positive(process.env.PASSWORD_RESET_TTL_MINUTES, 60), 24 * 60),
  cooldownSeconds: positive(process.env.PASSWORD_RESET_COOLDOWN_SECONDS, 60),
})
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex')

/** Issues a reset link for an active account and emails it. Silent for unknown emails. */
export async function requestPasswordReset(email, now = new Date()) {
  const { ttlMinutes, cooldownSeconds } = resetSettings()
  const user = await User.findOne({ email, isActive: true }).select('fullName email passwordReset').lean()
  if (!user) return { sent: false, reason: 'not_found' }
  const token = randomBytes(32).toString('base64url')
  // Conditional update enforces the per-account cooldown even under concurrent requests.
  const claim = await User.updateOne(
    { _id: user._id, $or: [{ 'passwordReset.requestedAt': { $exists: false } }, { 'passwordReset.requestedAt': { $lte: new Date(now.getTime() - cooldownSeconds * 1000) } }] },
    { $set: { passwordResetTokenHash: hashToken(token), 'passwordReset.expiresAt': new Date(now.getTime() + ttlMinutes * 60000), 'passwordReset.requestedAt': now } },
  )
  if (!claim.modifiedCount) return { sent: false, reason: 'cooldown' }
  const message = passwordResetTemplate({ fullName: user.fullName, resetUrl: publicAppUrl(`/reset-password/${token}`), expiresInMinutes: ttlMinutes, supportUrl: publicAppUrl('/forgot-password') })
  const result = await sendEmail({ type: 'password_reset', to: { email: user.email, name: user.fullName, userId: user._id }, customId: `reset-${user._id}-${now.getTime()}`, ...message })
  return { sent: result.ok, reason: result.ok ? null : 'delivery_failed' }
}

/** Returns 'reset' | 'expired' | 'invalid'. On success all sessions are signed out. */
export async function completePasswordReset(token, newPassword, now = new Date()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return 'invalid'
  const tokenHash = hashToken(token)
  const user = await User.findOne({ passwordResetTokenHash: tokenHash }).select('fullName email passwordReset').lean()
  if (!user) return 'invalid'
  if (!user.passwordReset?.expiresAt || new Date(user.passwordReset.expiresAt) <= now) {
    await User.updateOne({ _id: user._id, passwordResetTokenHash: tokenHash }, { $unset: { passwordResetTokenHash: 1 } })
    return 'expired'
  }
  const updated = await User.updateOne(
    { _id: user._id, passwordResetTokenHash: tokenHash },
    {
      $set: { passwordHash: await hashPassword(newPassword), emailVerified: true },
      // Receiving the link proves the email address; lift any lock and end every session.
      $unset: { passwordResetTokenHash: 1, passwordReset: 1, loginLock: 1 },
      $inc: { sessionVersion: 1 },
    },
  )
  if (!updated.modifiedCount) return 'invalid'
  let timezone = 'UTC'
  try { timezone = (await loadSystemSettings())?.general?.timezone || 'UTC' } catch { /* default */ }
  const notice = passwordChangedTemplate({ fullName: user.fullName, changedAt: now, timezone, loginUrl: publicAppUrl('/login'), forgotUrl: publicAppUrl('/forgot-password') })
  sendEmail({ type: 'password_changed', to: { email: user.email, name: user.fullName, userId: user._id }, customId: `changed-${user._id}-${now.getTime()}`, ...notice }).catch(() => {})
  return 'reset'
}
