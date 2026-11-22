import User from '../models/User.js'
import { decryptSecret, findRecoveryCode, issueChallenge, readChallenge, verifyTotp } from '../services/twoFactor.service.js'
import { clearFailedLogins, lockedMinutes, registerFailedLogin, verifyAgainstDummy } from '../services/loginProtection.service.js'
import Faculty from '../models/Faculty.js'
import Class from '../models/Class.js'
import Department from '../models/Department.js'
import { createSessionCookie, clearSessionCookie } from '../middleware/auth.middleware.js'
import { hashPassword, isPasswordLengthValid, verifyPassword } from '../services/password.service.js'
import { createHash } from 'node:crypto'
import { recordAudit } from '../services/auditLog.service.js'
import { confirmEmailVerification, issueEmailVerification } from '../services/emailVerification.service.js'
import { emailDeliveryAvailable } from '../services/email/email.service.js'
import { completePasswordReset, requestPasswordReset } from '../services/passwordReset.service.js'

const safeUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  studentId: user.studentId,
  faculty: user.department?.faculty || user.class?.department?.faculty,
  department: user.department || user.class?.department,
  class: user.class,
  assignedClasses: user.assignedClasses,
  profileImage: user.profileImage,
  theme: user.uiPreferences?.theme === 'dark' ? 'dark' : 'light',
  twoFactorEnabled: Boolean(user.twoFactor?.enabled),
})

const populateProfile = (user) => user.populate([
  { path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } },
  { path: 'class', select: 'name classCode department', populate: { path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } } },
])

export async function registerStudent(req, res) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const { fullName, email, password, studentId, faculty: facultyId, department: departmentId, class: classId } = body
  if (typeof fullName !== 'string' || !fullName.trim() || typeof email !== 'string' || !email.trim() || typeof studentId !== 'string' || !studentId.trim() || !facultyId || !departmentId || !classId) {
    return res.status(400).json({ success: false, message: 'Complete all required fields' })
  }
  if (fullName.trim().length > 160 || email.trim().length > 254 || studentId.trim().length > 40) {
    return res.status(400).json({ success: false, message: 'One or more fields exceed the allowed length' })
  }
  if (!isPasswordLengthValid(password)) {
    return res.status(400).json({ success: false, message: 'Password must be 8 or more characters and no more than 72 bytes' })
  }

  const [faculty, department, selectedClass] = await Promise.all([
    Faculty.findById(facultyId).select('_id isActive').lean(),
    Department.findById(departmentId).select('_id faculty isActive').lean(),
    Class.findById(classId).select('_id department isActive').lean(),
  ])
  if (!faculty?.isActive) return res.status(400).json({ success: false, message: 'Choose an active faculty' })
  if (!department?.isActive || String(department.faculty) !== String(faculty._id)) {
    return res.status(400).json({ success: false, message: 'Choose a department within the selected faculty' })
  }
  if (!selectedClass?.isActive || String(selectedClass.department) !== String(department._id)) {
    return res.status(400).json({ success: false, message: 'Choose an active class within the selected department' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const existing = await User.findOne({ email: normalizedEmail }).select('role emailVerified').lean()
  if (existing) {
    // Never create a second account; point unverified students to the resend option.
    const pending = existing.role === 'student' && existing.emailVerified === false
    return res.status(409).json({ success: false, code: pending ? 'EMAIL_PENDING_VERIFICATION' : 'EMAIL_IN_USE', message: pending ? 'An account with this email is waiting for verification. Check your inbox or request a new verification email.' : 'An account with this email already exists' })
  }

  const passwordHash = await hashPassword(password)
  const user = await User.create({
    fullName: fullName.trim(),
    email: normalizedEmail,
    passwordHash,
    role: 'student',
    studentId: studentId.trim(),
    department: department._id,
    class: classId,
    emailVerified: false,
  })
  await recordAudit(req, { action: 'auth.student.registered', resourceType: 'user', resourceId: user._id, metadata: { role: 'student' } })
  // Email delivery is bounded by the transport timeout; failure never undoes the registration.
  const delivery = await issueEmailVerification(user._id, { enforceLimits: false }).catch(() => ({ sent: false }))
  return res.status(201).json({
    success: true,
    verificationRequired: true,
    emailSent: delivery.sent,
    message: delivery.sent
      ? 'Account created. We sent a verification link to your email address.'
      : 'Account created, but the verification email could not be sent right now. Please request a new verification email.',
  })
}

export async function login(req, res) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const email = String(body.email || '').trim().toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required' })

  const user = await User.findOne({ email }).select('+passwordHash +sessionVersion').exec()
  const emailHash = createHash('sha256').update(email).digest('hex')
  const lockMessage = (minutes) => ({ success: false, code: 'ACCOUNT_LOCKED', message: `Too many failed sign-in attempts. For your security this account is locked for ${minutes} minute${minutes === 1 ? '' : 's'}. Try again later or contact your administrator.` })
  const minutesLocked = lockedMinutes(user)
  if (minutesLocked) {
    await recordAudit(req, { action: 'auth.login.locked', resourceType: 'authentication', metadata: { emailHash } })
    return res.status(429).json(lockMessage(minutesLocked))
  }
  // Unknown emails still run a bcrypt check so response time does not reveal which accounts exist.
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password)
  if (!user || !user.isActive || !passwordOk) {
    const lock = user && !passwordOk ? await registerFailedLogin(user) : null
    await recordAudit(req, { action: lock?.locked ? 'auth.login.lockout' : 'auth.login.failed', resourceType: 'authentication', metadata: { emailHash } })
    if (lock?.locked) return res.status(429).json(lockMessage(lock.minutes))
    return res.status(401).json({ success: false, message: 'Email or password is incorrect' })
  }
  if (user.role === 'student' && user.emailVerified === false) {
    await recordAudit(req, { action: 'auth.login.unverified', resourceType: 'user', resourceId: user._id })
    return res.status(403).json({ success: false, code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address before signing in. Check your inbox or request a new verification email.' })
  }
  // Two-step verification: the password is right, but the session starts only after the code step.
  if (user.twoFactor?.enabled) {
    await recordAudit(req, { action: 'auth.login.2fa_challenge', resourceType: 'user', resourceId: user._id })
    return res.json({ success: true, twoFactorRequired: true, challengeToken: issueChallenge(user), message: 'Enter the 6-digit code from your authenticator app.' })
  }
  await clearFailedLogins(user)
  await populateProfile(user)
  createSessionCookie(res, user)
  await recordAudit(req, { action: 'auth.login.succeeded', resourceType: 'user', resourceId: user._id, metadata: { role: user.role } })
  return res.json({ success: true, user: safeUser(user) })
}

/** Second sign-in step: a 6-digit authenticator code (or a one-time recovery code). */
export async function loginTwoFactor(req, res) {
  const challenge = readChallenge(req.body?.challengeToken)
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
  if (!challenge) return res.status(401).json({ success: false, code: 'CHALLENGE_EXPIRED', message: 'Your sign-in session expired. Enter your email and password again.' })
  const user = await User.findById(challenge.sub).select('+sessionVersion +twoFactor.secret +twoFactor.recoveryCodes').exec()
  if (!user || !user.isActive || !user.twoFactor?.enabled || (Number(user.sessionVersion) || 0) !== (Number(challenge.ver) || 0)) {
    return res.status(401).json({ success: false, code: 'CHALLENGE_EXPIRED', message: 'Your sign-in session expired. Enter your email and password again.' })
  }
  const minutesLocked = lockedMinutes(user)
  if (minutesLocked) return res.status(429).json({ success: false, code: 'ACCOUNT_LOCKED', message: `Too many failed attempts. This account is locked for ${minutesLocked} minute${minutesLocked === 1 ? '' : 's'}.` })

  let accepted = false
  let usedRecovery = false
  const step = verifyTotp(decryptSecret(user.twoFactor.secret), code, { lastUsedStep: user.twoFactor.lastUsedStep ?? -1 })
  if (step !== null) {
    // Conditional update so the same code cannot be used twice, even concurrently.
    const claim = await User.updateOne({ _id: user._id, $or: [{ 'twoFactor.lastUsedStep': { $exists: false } }, { 'twoFactor.lastUsedStep': { $lt: step } }] }, { $set: { 'twoFactor.lastUsedStep': step } })
    accepted = claim.modifiedCount === 1
  } else if (/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code)) {
    const index = findRecoveryCode(user.twoFactor.recoveryCodes, code)
    if (index >= 0) {
      const hash = user.twoFactor.recoveryCodes[index]
      const claim = await User.updateOne({ _id: user._id, 'twoFactor.recoveryCodes': hash }, { $pull: { 'twoFactor.recoveryCodes': hash } })
      accepted = claim.modifiedCount === 1
      usedRecovery = accepted
    }
  }
  if (!accepted) {
    const lock = await registerFailedLogin(user)
    await recordAudit(req, { action: 'auth.login.2fa_failed', resourceType: 'user', resourceId: user._id })
    if (lock.locked) return res.status(429).json({ success: false, code: 'ACCOUNT_LOCKED', message: `Too many failed attempts. This account is locked for ${lock.minutes} minutes.` })
    return res.status(401).json({ success: false, code: 'INVALID_CODE', message: 'That code is not valid. Check your authenticator app and try again.' })
  }
  await clearFailedLogins(user)
  await populateProfile(user)
  createSessionCookie(res, user)
  await recordAudit(req, { action: usedRecovery ? 'auth.login.2fa_recovery_used' : 'auth.login.succeeded', resourceType: 'user', resourceId: user._id, metadata: { role: user.role, twoFactor: true } })
  return res.json({ success: true, user: safeUser(user), ...(usedRecovery ? { recoveryCodesLeft: Math.max(0, (user.twoFactor.recoveryCodes?.length || 1) - 1) } : {}) })
}

export async function verifyEmail(req, res) {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
  const outcome = await confirmEmailVerification(token)
  if (outcome === 'verified') {
    await recordAudit(req, { action: 'auth.email.verified', resourceType: 'authentication' })
    return res.json({ success: true, status: 'verified', message: 'Your email address is verified. You can now sign in.' })
  }
  return res.status(400).json({
    success: false,
    status: outcome,
    message: outcome === 'expired'
      ? 'This verification link has expired. Request a new verification email to continue.'
      : 'This verification link is invalid or has already been used. If you already verified your email, sign in.',
  })
}

const RESEND_RESPONSE = { success: true, message: 'If an account with that email still needs verification, a new verification email will arrive shortly. Check your inbox and spam folder.' }

export async function resendVerification(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Enter a valid email address' })
  // Provider-wide outage: same answer for every address, so nothing about accounts is revealed.
  if (!(await emailDeliveryAvailable())) return res.status(503).json({ success: false, code: 'EMAIL_UNAVAILABLE', message: 'Email sending is temporarily unavailable, so no verification email can be sent right now. Please try again later or contact your university administrator.' })
  const user = await User.findOne({ email, role: 'student', emailVerified: false, isActive: true }).select('_id').lean()
  // Same response and timing whether or not the account exists (no email enumeration).
  if (user) {
    issueEmailVerification(user._id)
      .then((result) => { if (!result.sent && result.reason !== 'delivery_failed') console.info(`Verification resend skipped: ${result.reason}`) })
      .catch((error) => console.error('Verification resend failed', error.message))
  }
  return res.json(RESEND_RESPONSE)
}

const FORGOT_RESPONSE = { success: true, message: 'If an account exists for that email, a password reset link will arrive shortly. Check your inbox and spam folder.' }

export async function forgotPassword(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Enter a valid email address' })
  if (!(await emailDeliveryAvailable())) return res.status(503).json({ success: false, code: 'EMAIL_UNAVAILABLE', message: 'Email sending is temporarily unavailable. Please try again later or contact your university administrator.' })
  // Same response and timing for every address (sending happens in the background).
  requestPasswordReset(email)
    .then((result) => { if (result.sent) recordAudit(req, { action: 'auth.password.reset_requested', resourceType: 'authentication' }).catch(() => {}) })
    .catch((error) => console.error('Password reset request failed', error.message))
  return res.json(FORGOT_RESPONSE)
}

export async function resetPassword(req, res) {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
  const password = req.body?.password
  if (!isPasswordLengthValid(password)) return res.status(400).json({ success: false, message: 'Password must be 8 or more characters and no more than 72 bytes' })
  const outcome = await completePasswordReset(token, password)
  if (outcome === 'reset') {
    await recordAudit(req, { action: 'auth.password.reset', resourceType: 'authentication' })
    clearSessionCookie(res)
    return res.json({ success: true, status: 'reset', message: 'Your password has been changed. Sign in with your new password.' })
  }
  return res.status(400).json({ success: false, status: outcome, message: outcome === 'expired' ? 'This reset link has expired. Request a new one.' : 'This reset link is invalid or has already been used. Request a new one.' })
}

export async function logout(req, res) {
  await User.updateOne({ _id: req.user._id }, { $inc: { sessionVersion: 1 } })
  await recordAudit(req, { action: 'auth.logout', resourceType: 'user', resourceId: req.user._id })
  clearSessionCookie(res)
  return res.json({ success: true, message: 'Signed out' })
}

export async function currentSession(req, res) {
  const user = await User.findById(req.user._id).exec()
  if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'Your session is no longer active' })
  await populateProfile(user)
  return res.json({ success: true, user: safeUser(user) })
}
