import mongoose from 'mongoose'
import Notification from '../models/Notification.js'
import { addNotificationStream } from '../services/notificationRealtime.service.js'

const pagination = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20))
  return { page, limit, skip: (page - 1) * limit }
}

function badRequest(message) { const error = new Error(message); error.status = 400; throw error }

export async function listNotifications(req, res) {
  const { page, limit, skip } = pagination(req.query)
  const query = { recipientId: req.user._id }
  if (req.query.unread === 'true') query.isRead = false
  else if (req.query.unread === 'false') query.isRead = true
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(query),
    Notification.countDocuments({ recipientId: req.user._id, isRead: false }),
  ])
  return res.json({ success: true, notifications, unreadCount, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

export async function getUnreadNotificationCount(req, res) {
  const count = await Notification.countDocuments({ recipientId: req.user._id, isRead: false })
  return res.json({ success: true, unreadCount: count })
}

export async function markNotificationRead(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) badRequest('A valid notification ID is required')
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipientId: req.user._id },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true },
  ).lean()
  if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' })
  return res.json({ success: true, notification })
}

export async function markAllNotificationsRead(req, res) {
  const result = await Notification.updateMany({ recipientId: req.user._id, isRead: false }, { $set: { isRead: true, readAt: new Date() } })
  return res.json({ success: true, updatedCount: result.modifiedCount })
}

export async function deleteNotification(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) badRequest('A valid notification ID is required')
  const notification = await Notification.findOneAndDelete({ _id: req.params.id, recipientId: req.user._id })
  if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' })
  return res.json({ success: true })
}

export function streamNotifications(req, res) {
  res.status(200)
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders?.()
  res.write('retry: 5000\nevent: ready\ndata: {}\n\n')
  const remove = addNotificationStream(req.user._id, res)
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': heartbeat\n\n') }, 25_000)
  heartbeat.unref?.()
  req.on('close', () => { clearInterval(heartbeat); remove() })
}
