// Per-account protection against password guessing. Works together with the per-IP+email
// rate limiter on the login route: the limiter slows one client down, the lockout stops a
// distributed attack on a single account. Counters reset on a successful sign-in.
import User from '../models/User.js'
import { hashPassword, verifyPassword } from './password.service.js'

const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback)
export const lockoutSettings = () => ({
  maxFailures: positive(process.env.LOGIN_MAX_FAILED_ATTEMPTS, 10),
  lockMinutes: positive(process.env.LOGIN_LOCK_MINUTES, 15),
})

// A real bcrypt hash used when the email is unknown, so failed sign-ins take the same time
// whether or not the account exists (no timing-based account discovery).
let dummyHash = null
export async function verifyAgainstDummy(password) {
  dummyHash ||= await hashPassword('timing-equalizer-not-a-real-password')
  await verifyPassword(password, dummyHash)
  return false
}

/** Minutes left on an active lock, or 0. */
export function lockedMinutes(user, now = new Date()) {
  const until = user?.loginLock?.until
  return until && new Date(until) > now ? Math.ceil((new Date(until) - now) / 60000) : 0
}

/** Records a failed password and locks the account when the threshold is reached. */
export async function registerFailedLogin(user, now = new Date()) {
  const { maxFailures, lockMinutes } = lockoutSettings()
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    { $inc: { 'loginLock.failures': 1 }, $set: { 'loginLock.lastFailedAt': now } },
    { new: true, projection: { loginLock: 1 } },
  ).lean()
  const failures = updated?.loginLock?.failures || 0
  if (failures >= maxFailures) {
    await User.updateOne({ _id: user._id }, { $set: { 'loginLock.until': new Date(now.getTime() + lockMinutes * 60000), 'loginLock.failures': 0 } })
    return { locked: true, minutes: lockMinutes }
  }
  return { locked: false, remaining: maxFailures - failures }
}

export async function clearFailedLogins(user) {
  if (user.loginLock?.failures || user.loginLock?.until) await User.updateOne({ _id: user._id }, { $unset: { loginLock: 1 } })
}
