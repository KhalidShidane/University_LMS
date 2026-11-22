import Announcement from '../models/Announcement.js'
import mongoose from 'mongoose'
import { ANNOUNCEMENT_AUDIENCES, announcementAudienceFilter, emailAnnouncement, queueEmailTask } from '../services/emailNotifications.service.js'

const badRequest = (message) => Object.assign(new Error(message), { status: 400 })

export async function listAnnouncements(_req, res) {
  const announcements = await Announcement.find({ isActive: true })
    .sort({ createdAt: -1 })
    .populate('author', 'fullName')
    .lean()
  return res.json({ success: true, announcements })
}

export async function createAnnouncement(req, res) {
  const { title, message } = req.body || {}
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 160) throw badRequest('Enter an announcement title (up to 160 characters)')
  if (typeof message !== 'string' || !message.trim() || message.trim().length > 5000) throw badRequest('Enter announcement details (up to 5000 characters)')
  const emailAudience = req.body?.emailAudience || 'none'
  if (!ANNOUNCEMENT_AUDIENCES.includes(emailAudience)) throw badRequest('Choose a valid email audience')
  const needsTarget = ['faculty', 'department', 'class'].includes(emailAudience)
  const emailTarget = needsTarget ? req.body?.emailTarget : null
  if (needsTarget && (!mongoose.isValidObjectId(emailTarget) || !(await announcementAudienceFilter(emailAudience, emailTarget)))) throw badRequest(`Choose an active ${emailAudience} for the email audience`)
  const announcement = await Announcement.create({ title: title.trim(), message: message.trim(), author: req.user._id, emailAudience, emailTarget })
  await announcement.populate('author', 'fullName')
  if (emailAudience !== 'none') queueEmailTask('announcement', () => emailAnnouncement(announcement._id))
  return res.status(201).json({ success: true, announcement })
}
