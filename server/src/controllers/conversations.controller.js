import mongoose from 'mongoose'
import Class from '../models/Class.js'
import Conversation from '../models/Conversation.js'
import Message from '../models/Message.js'
import User from '../models/User.js'
import { createNotification } from '../services/notifications.service.js'

const pageSettings = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 30))
  return { page, limit, skip: (page - 1) * limit }
}
function fail(status, message) { const error = new Error(message); error.status = status; throw error }
function conversationKey(participants, classId) { return `${[...participants.map(String)].sort().join(':')}:${String(classId || 'none')}` }

async function allowedPair(user, target, requestedClassId) {
  if (!target || !target.isActive) fail(404, 'An authorized contact was not found')
  const supportPair = (user.role === 'teacher' && target.role === 'admin') || (user.role === 'admin' && target.role === 'teacher')
  if (supportPair) {
    if (requestedClassId) fail(400, 'Support conversations do not use a class')
    return null
  }
  if (!['teacher', 'student'].includes(target.role) || target.role === user.role) fail(404, 'An authorized classmate was not found')
  let academicClass
  if (user.role === 'student') {
    academicClass = await Class.findOne({ _id: user.class, isActive: true }).select('_id').lean()
    if (!academicClass || String(target.role) !== 'teacher' || !target.assignedClasses.some((id) => String(id) === String(academicClass._id))) fail(404, 'An authorized class teacher was not found')
    if (requestedClassId && String(requestedClassId) !== String(academicClass._id)) fail(400, 'Conversations are limited to your assigned class')
  } else if (user.role === 'teacher') {
    if (target.role !== 'student' || !user.assignedClasses.some((id) => String(id) === String(target.class))) fail(404, 'An authorized student was not found')
    const classId = requestedClassId || target.class
    if (String(classId) !== String(target.class) || !user.assignedClasses.some((id) => String(id) === String(classId))) fail(404, 'An authorized student was not found')
    academicClass = await Class.findOne({ _id: classId, isActive: true }).select('_id').lean()
    if (!academicClass) fail(404, 'An authorized student was not found')
  } else fail(403, 'Messaging is available to teachers, students, and support administrators')
  return academicClass._id
}

async function ownedConversation(user, conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) fail(400, 'A valid conversation ID is required')
  const conversation = await Conversation.findOne({ _id: conversationId, participants: user._id }).exec()
  if (!conversation) fail(404, 'Conversation not found')
  const otherId = conversation.participants.find((participant) => String(participant) !== String(user._id))
  const other = await User.findOne({ _id: otherId, isActive: true }).select('role class assignedClasses isActive').exec()
  try { await allowedPair(user, other, conversation.classId) } catch { fail(404, 'Conversation not found') }
  return conversation
}

export async function listConversations(req, res) {
  const { page, limit, skip } = pageSettings(req.query)
  const filter = { participants: req.user._id }
  const [conversations, total] = await Promise.all([
    Conversation.find(filter).populate('participants', 'fullName role studentId profileImage class assignedClasses isActive').sort({ lastMessageAt: -1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Conversation.countDocuments(filter),
  ])
  const authorizedConversations = []
  for (const conversation of conversations) {
    const other = conversation.participants.find((participant) => String(participant._id) !== String(req.user._id))
    try { await allowedPair(req.user, other, conversation.classId); authorizedConversations.push(conversation) } catch { /* Hide conversations after class permissions change. */ }
  }
  const unread = authorizedConversations.length ? await Message.aggregate([
    { $match: { conversationId: { $in: authorizedConversations.map((item) => item._id) }, senderId: { $ne: req.user._id }, isRead: false } },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]) : []
  const unreadByConversation = new Map(unread.map((item) => [String(item._id), item.count]))
  return res.json({ success: true, conversations: authorizedConversations.map((conversation) => ({ ...conversation, unreadCount: unreadByConversation.get(String(conversation._id)) || 0, otherParticipant: conversation.participants.find((participant) => String(participant._id) !== String(req.user._id)) || null })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

export async function listConversationContacts(req, res) {
  let contacts
  if (req.user.role === 'student') {
    const academicClass = await Class.findById(req.user.class).select('_id isActive').lean()
    contacts = academicClass?.isActive ? await User.find({ role: 'teacher', assignedClasses: academicClass._id, isActive: true }).select('fullName role profileImage department').sort({ fullName: 1 }).lean() : []
  } else if (req.user.role === 'teacher' && req.query.support === '1') {
    contacts = await User.find({ role: 'admin', isActive: true }).select('fullName role profileImage').sort({ fullName: 1 }).lean()
  } else if (req.user.role === 'teacher') {
    const classes = await Class.find({ _id: { $in: req.user.assignedClasses }, isActive: true }).select('_id').lean()
    contacts = classes.length ? await User.find({ role: 'student', class: { $in: classes.map((item) => item._id) }, isActive: true }).select('fullName role studentId profileImage class').sort({ fullName: 1 }).lean() : []
  } else {
    contacts = await User.find({ role: 'teacher', isActive: true }).select('fullName role profileImage').sort({ fullName: 1 }).lean()
  }
  const conversations = await Conversation.find({ participants: req.user._id }).select('participants classId').lean()
  const existingKeys = new Set(conversations.map((item) => `${[...item.participants.map(String)].sort().join(':')}:${String(item.classId || 'none')}`))
  return res.json({ success: true, contacts: contacts.map((contact) => {
    const classId = req.user.role === 'student' ? req.user.class : req.user.role === 'teacher' && contact.role === 'student' ? contact.class : null
    const participants = [req.user._id, contact._id]
    return { ...contact, classId, conversationExists: existingKeys.has(conversationKey(participants, classId)) }
  }) })
}

export async function createConversation(req, res) {
  const targetId = req.body?.targetUserId || req.body?.teacherId || req.body?.studentId
  if (!mongoose.isValidObjectId(targetId)) fail(400, 'Choose a valid conversation contact')
  const target = await User.findById(targetId).select('fullName role class assignedClasses isActive studentId profileImage').exec()
  const classId = await allowedPair(req.user, target, req.body?.classId)
  const participants = [req.user._id, target._id]
  const participantKey = conversationKey(participants, classId)
  let conversation = await Conversation.findOne({ participantKey }).exec()
  if (!conversation) {
    try { conversation = await Conversation.create({ participants, classId, participantKey }) } catch (error) {
      if (error.code !== 11000) throw error
      conversation = await Conversation.findOne({ participantKey }).exec()
    }
  }
  await conversation.populate('participants', 'fullName role studentId profileImage')
  return res.status(201).json({ success: true, conversation, created: conversation.createdAt.getTime() === conversation.updatedAt.getTime() })
}

export async function listConversationMessages(req, res) {
  const conversation = await ownedConversation(req.user, req.params.id)
  const { page, limit, skip } = pageSettings(req.query)
  const [messages, total] = await Promise.all([
    Message.find({ conversationId: conversation._id }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Message.countDocuments({ conversationId: conversation._id }),
  ])
  return res.json({ success: true, conversationId: conversation._id, messages: messages.reverse(), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

function sanitizeText(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
}

export async function sendConversationMessage(req, res) {
  const conversation = await ownedConversation(req.user, req.params.id)
  const text = sanitizeText(req.body?.messageText)
  if (!text || text.length > 5000) fail(400, 'Message must contain between 1 and 5,000 characters')
  const message = await Message.create({ conversationId: conversation._id, senderId: req.user._id, messageText: text })
  conversation.lastMessage = text
  conversation.lastMessageAt = message.createdAt
  await conversation.save()
  const recipientId = conversation.participants.find((participant) => String(participant) !== String(req.user._id))
  await createNotification({ recipientId, senderId: req.user._id, type: 'new_message', title: `Message from ${req.user.fullName}`, message: text.slice(0, 220), relatedEntityType: 'conversation', relatedEntityId: conversation._id, dedupeKey: `message:${message._id}` })
  return res.status(201).json({ success: true, message })
}

export async function markConversationRead(req, res) {
  const conversation = await ownedConversation(req.user, req.params.id)
  const result = await Message.updateMany({ conversationId: conversation._id, senderId: { $ne: req.user._id }, isRead: false }, { $set: { isRead: true, readAt: new Date() } })
  return res.json({ success: true, updatedCount: result.modifiedCount })
}
