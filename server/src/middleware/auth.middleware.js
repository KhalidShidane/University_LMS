import jwt from 'jsonwebtoken'
import User from '../models/User.js'

function jwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32 || secret.startsWith('replace_with_')) {
    const error = new Error('Authentication is not configured')
    error.status = 503
    throw error
  }
  return secret
}

export function sessionCookieOptions() {
  const configuredExpiration = process.env.JWT_EXPIRES_IN || '12h'
  const durationSeconds = typeof configuredExpiration === 'number'
    ? configuredExpiration
    : (() => {
      const match = String(configuredExpiration).match(/^(\d+)(s|m|h|d)$/)
      if (!match) return 12 * 60 * 60
      const units = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 }
      return Number(match[1]) * units[match[2]]
    })()
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: durationSeconds * 1000,
  }
}

export function createSessionCookie(res, user) {
  const token = jwt.sign({ sub: String(user._id), ver: Number(user.sessionVersion) || 0 }, jwtSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || '12h', issuer: 'university-lms' })
  res.cookie('lms_session', token, sessionCookieOptions())
}

export function clearSessionCookie(res) {
  const { httpOnly, secure, sameSite, path } = sessionCookieOptions()
  res.clearCookie('lms_session', { httpOnly, secure, sameSite, path })
}

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.lms_session
    if (!token) return res.status(401).json({ success: false, message: 'Authentication required' })

    const payload = jwt.verify(token, jwtSecret(), { issuer: 'university-lms' })
    const user = await User.findById(payload.sub).select('+sessionVersion').exec()
    if (!user || !user.isActive) {
      clearSessionCookie(res)
      return res.status(401).json({ success: false, message: 'Your session is no longer active' })
    }
    if ((Number(payload.ver) || 0) !== (Number(user.sessionVersion) || 0)) {
      clearSessionCookie(res)
      return res.status(401).json({ success: false, message: 'Your session has been signed out' })
    }

    req.user = user
    return next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      clearSessionCookie(res)
      return res.status(401).json({ success: false, message: 'Your session has expired' })
    }
    return next(error)
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have access to this resource' })
    }
    return next()
  }
}
