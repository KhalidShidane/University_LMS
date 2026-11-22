import mongoose from 'mongoose'
import User from '../models/User.js'
import { recordAudit } from '../services/auditLog.service.js'
import { publicAppUrl, sendEmail } from '../services/email/email.service.js'
import { twoFactorChangedTemplate } from '../services/email/templates/accountSecurity.templates.js'
import { verifyPassword } from '../services/password.service.js'
import { loadSystemSettings } from '../services/systemSettings.service.js'
import { currentStep, decryptSecret, encryptSecret, findRecoveryCode, newRecoveryCodes, newSecret, setupDetails, verifyTotp } from '../services/twoFactor.service.js'

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })

async function notify(user, enabled) {
  let timezone = 'UTC'
  try { timezone = (await loadSystemSettings())?.general?.timezone || 'UTC' } catch { /* default */ }
  const message = twoFactorChangedTemplate({ fullName: user.fullName, enabled, timezone, forgotUrl: publicAppUrl('/forgot-password') })
  sendEmail({ type: enabled ? 'two_factor_enabled' : 'two_factor_disabled', to: { email: user.email, name: user.fullName, userId: user._id }, customId: `2fa-${user._id}-${Date.now()}`, ...message }).catch(() => {})
}

/** Code check for a signed-in user: authenticator code (one-time) or recovery code. */
async function checkCode(user, code) {
  const step = verifyTotp(decryptSecret(user.twoFactor.secret), code, { lastUsedStep: user.twoFactor.lastUsedStep ?? -1 })
  if (step !== null) {
    const claim = await User.updateOne({ _id: user._id, $or: [{ 'twoFactor.lastUsedStep': { $exists: false } }, { 'twoFactor.lastUsedStep': { $lt: step } }] }, { $set: { 'twoFactor.lastUsedStep': step } })
    return claim.modifiedCount === 1
  }
  const index = findRecoveryCode(user.twoFactor.recoveryCodes, code)
  if (index < 0) return false
  const claim = await User.updateOne({ _id: user._id, 'twoFactor.recoveryCodes': user.twoFactor.recoveryCodes[index] }, { $pull: { 'twoFactor.recoveryCodes': user.twoFactor.recoveryCodes[index] } })
  return claim.modifiedCount === 1
}

export async function twoFactorStatus(req, res) {
  const user = await User.findById(req.user._id).select('role twoFactor.enabled twoFactor.enabledAt +twoFactor.recoveryCodes').lean()
  return res.json({ success: true, enabled: Boolean(user.twoFactor?.enabled), enabledAt: user.twoFactor?.enabledAt || null, recoveryCodesLeft: user.twoFactor?.recoveryCodes?.length || 0, recommended: user.role === 'admin' })
}

/** Step 1: create a pending secret and return the QR code to scan. */
export async function startTwoFactorSetup(req, res) {
  const user = await User.findById(req.user._id).select('email twoFactor.enabled').lean()
  if (user.twoFactor?.enabled) throw fail(409, 'Two-step verification is already on')
  const secret = newSecret()
  await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.pendingSecret': encryptSecret(secret) } })
  return res.json({ success: true, ...(await setupDetails(secret, user.email)) })
}

/** Step 2: confirm with a code from the app; turns 2FA on and returns recovery codes once. */
export async function enableTwoFactor(req, res) {
  const user = await User.findById(req.user._id).select('fullName email twoFactor.enabled +twoFactor.pendingSecret').lean()
  if (user.twoFactor?.enabled) throw fail(409, 'Two-step verification is already on')
  if (!user.twoFactor?.pendingSecret) throw fail(400, 'Start the setup again to get a new QR code')
  const secret = decryptSecret(user.twoFactor.pendingSecret)
  const step = verifyTotp(secret, req.body?.code)
  if (step === null) throw fail(400, 'That code is not valid. Check the time on your phone and try the newest code.', 'INVALID_CODE')
  const { codes, hashes } = newRecoveryCodes()
  await User.updateOne({ _id: user._id }, {
    $set: { 'twoFactor.enabled': true, 'twoFactor.secret': encryptSecret(secret), 'twoFactor.recoveryCodes': hashes, 'twoFactor.lastUsedStep': step, 'twoFactor.enabledAt': new Date() },
    $unset: { 'twoFactor.pendingSecret': 1 },
  })
  await recordAudit(req, { action: 'auth.2fa.enabled', resourceType: 'user', resourceId: user._id })
  notify(user, true)
  return res.json({ success: true, enabled: true, recoveryCodes: codes })
}

/** Turn 2FA off: needs the password and a current code (or recovery code). */
export async function disableTwoFactor(req, res) {
  const user = await User.findById(req.user._id).select('fullName email +passwordHash twoFactor.enabled twoFactor.lastUsedStep +twoFactor.secret +twoFactor.recoveryCodes').lean()
  if (!user.twoFactor?.enabled) throw fail(409, 'Two-step verification is already off')
  if (typeof req.body?.password !== 'string' || !(await verifyPassword(req.body.password, user.passwordHash))) throw fail(400, 'Your password is incorrect', 'INVALID_PASSWORD')
  if (!(await checkCode(user, req.body?.code))) throw fail(400, 'That code is not valid', 'INVALID_CODE')
  await User.updateOne({ _id: user._id }, { $unset: { twoFactor: 1 } })
  await recordAudit(req, { action: 'auth.2fa.disabled', resourceType: 'user', resourceId: user._id })
  notify(user, false)
  return res.json({ success: true, enabled: false })
}

/** Replace all recovery codes (needs a current code). */
export async function regenerateRecoveryCodes(req, res) {
  const user = await User.findById(req.user._id).select('twoFactor.enabled twoFactor.lastUsedStep +twoFactor.secret +twoFactor.recoveryCodes').lean()
  if (!user.twoFactor?.enabled) throw fail(409, 'Two-step verification is off')
  if (!(await checkCode(user, req.body?.code))) throw fail(400, 'That code is not valid', 'INVALID_CODE')
  const { codes, hashes } = newRecoveryCodes()
  await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.recoveryCodes': hashes } })
  await recordAudit(req, { action: 'auth.2fa.recovery_regenerated', resourceType: 'user', resourceId: user._id })
  return res.json({ success: true, recoveryCodes: codes })
}

/** Admin: remove 2FA from a user who lost their phone and recovery codes; signs them out everywhere. */
export async function adminResetTwoFactor(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail(400, 'A valid user ID is required')
  if (String(req.params.id) === String(req.user._id)) throw fail(400, 'Use your own recovery codes or profile settings to change your two-step verification')
  const user = await User.findById(req.params.id).select('fullName email twoFactor.enabled').lean()
  if (!user) return res.status(404).json({ success: false, message: 'User not found' })
  if (!user.twoFactor?.enabled) return res.json({ success: true, message: 'Two-step verification was already off for this user' })
  await User.updateOne({ _id: user._id }, { $unset: { twoFactor: 1 }, $inc: { sessionVersion: 1 } })
  await recordAudit(req, { action: 'admin.user.2fa_reset', resourceType: 'user', resourceId: user._id })
  notify(user, false)
  return res.json({ success: true, message: `Two-step verification was reset for ${user.fullName}. They can sign in with their password and set it up again.` })
}

export { currentStep }
