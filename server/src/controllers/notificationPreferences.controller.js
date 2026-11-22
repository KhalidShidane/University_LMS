import User from '../models/User.js'
import { EMAIL_PREFERENCE_CATEGORIES } from '../services/emailNotifications.service.js'

// Account and security emails (such as email verification) are mandatory and not listed here.
const describe = (preferences = {}) => Object.fromEntries(EMAIL_PREFERENCE_CATEGORIES.map((key) => [key, preferences[key] !== false]))

export async function getNotificationPreferences(req, res) {
  const user = await User.findById(req.user._id).select('notificationPreferences role').lean()
  return res.json({ success: true, email: describe(user?.notificationPreferences?.email), categories: EMAIL_PREFERENCE_CATEGORIES, mandatory: ['email_verification'] })
}

/** Per-user interface preferences; only affects the signed-in user's own account. */
export async function updateUiPreferences(req, res) {
  const theme = req.body?.theme
  if (!['light', 'dark'].includes(theme)) return res.status(400).json({ success: false, message: 'Theme must be light or dark' })
  await User.updateOne({ _id: req.user._id }, { $set: { 'uiPreferences.theme': theme } })
  return res.json({ success: true, theme })
}

export async function updateNotificationPreferences(req, res) {
  const input = req.body?.email
  if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ success: false, message: 'Provide email notification preferences' })
  const unknown = Object.keys(input).filter((key) => !EMAIL_PREFERENCE_CATEGORIES.includes(key))
  if (unknown.length) return res.status(400).json({ success: false, message: `Unknown preference: ${unknown.join(', ')}` })
  const update = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'boolean') return res.status(400).json({ success: false, message: `${key} must be true or false` })
    update[`notificationPreferences.email.${key}`] = value
  }
  const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true }).select('notificationPreferences').lean()
  return res.json({ success: true, email: describe(user?.notificationPreferences?.email) })
}
