import { Router } from 'express'
import { disableTwoFactor, enableTwoFactor, regenerateRecoveryCodes, startTwoFactorSetup, twoFactorStatus } from '../controllers/twoFactor.controller.js'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import rateLimit from 'express-rate-limit'
import { currentSession, forgotPassword, login, loginTwoFactor, logout, registerStudent, resendVerification, resetPassword, verifyEmail } from '../controllers/auth.controller.js'

const limiter = (limit, message) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message },
})
// Per-IP limits on top of the per-account cooldown and daily cap in the verification service.
const resendLimiter = limiter(Number(process.env.EMAIL_VERIFICATION_RESEND_IP_LIMIT) || 5, 'Too many verification email requests. Please wait 15 minutes and try again.')
const verifyLimiter = limiter(30, 'Too many verification attempts. Please wait a few minutes and try again.')

// Password guessing: failed sign-ins per client + email (successful sign-ins are not counted),
// on top of the per-account lockout in the login handler.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 8,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `login:${req.ip}:${String(req.body?.email || '').trim().toLowerCase().slice(0, 254)}`,
  message: { success: false, code: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
})
// Registrations per client network (generous, because a whole campus can share one address).
const registerLimiter = limiter(Number(process.env.REGISTER_RATE_LIMIT) || 40, 'Too many registrations from this network. Please wait 15 minutes and try again.')

const forgotLimiter = limiter(Number(process.env.PASSWORD_RESET_IP_LIMIT) || 5, 'Too many password reset requests. Please wait 15 minutes and try again.')
const resetLimiter = limiter(20, 'Too many password reset attempts. Please wait a few minutes and try again.')
const twoFactorLimiter = limiter(20, 'Too many verification code attempts. Please wait 15 minutes and try again.')

const router = Router()
router.post('/login', loginLimiter, asyncHandler(login))
router.post('/login/2fa', twoFactorLimiter, asyncHandler(loginTwoFactor))
router.get('/2fa', requireAuth, asyncHandler(twoFactorStatus))
router.post('/2fa/setup', requireAuth, asyncHandler(startTwoFactorSetup))
router.post('/2fa/enable', requireAuth, twoFactorLimiter, asyncHandler(enableTwoFactor))
router.post('/2fa/disable', requireAuth, twoFactorLimiter, asyncHandler(disableTwoFactor))
router.post('/2fa/recovery-codes', requireAuth, twoFactorLimiter, asyncHandler(regenerateRecoveryCodes))
router.post('/register', registerLimiter, asyncHandler(registerStudent))
router.post('/verify-email', verifyLimiter, asyncHandler(verifyEmail))
router.post('/resend-verification', resendLimiter, asyncHandler(resendVerification))
router.post('/forgot-password', forgotLimiter, asyncHandler(forgotPassword))
router.post('/reset-password', resetLimiter, asyncHandler(resetPassword))
router.post('/logout', requireAuth, asyncHandler(logout))
router.get('/me', requireAuth, asyncHandler(currentSession))

export default router
