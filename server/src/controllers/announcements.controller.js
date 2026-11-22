import Announcement from '../models/Announcement.js'

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
  const announcement = await Announcement.create({ title: title.trim(), message: message.trim(), author: req.user._id })
  await announcement.populate('author', 'fullName')
  return res.status(201).json({ success: true, announcement })
}
