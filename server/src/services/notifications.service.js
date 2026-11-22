import mongoose from 'mongoose'
import Notification from '../models/Notification.js'
import User from '../models/User.js'
import { emitNotification } from './notificationRealtime.service.js'

export async function createNotification(input) {
  try {
    if (input.dedupeKey) {
      const result = await Notification.findOneAndUpdate(
        { dedupeKey: input.dedupeKey },
        { $setOnInsert: input },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, includeResultMetadata: true },
      ).exec()
      const notification = result.value || result
      if (result.lastErrorObject?.upserted) emitNotification(notification.recipientId, notification.toObject())
      return notification
    }
    const notification = await Notification.create(input)
    emitNotification(notification.recipientId, notification.toObject())
    return notification
  } catch (error) {
    // Notifications must never cause the academic operation that triggered them to fail.
    console.error('Notification delivery failed', error.message)
    return null
  }
}

export async function notifyUsers(userIds, input, dedupePrefix = '') {
  const ids = [...new Set(userIds.map(String))].filter((id) => mongoose.isValidObjectId(id))
  return Promise.all(ids.map((recipientId) => createNotification({
    ...input,
    recipientId,
    dedupeKey: dedupePrefix ? `${dedupePrefix}:${recipientId}` : undefined,
  })))
}

export async function notifyClassStudents(classId, input, dedupePrefix = '') {
  try {
    const students = await User.find({ role: 'student', class: classId, isActive: true }).select('_id').lean()
    return await notifyUsers(students.map((student) => student._id), input, dedupePrefix)
  } catch (error) {
    console.error('Class notification fanout failed', error.message)
    return []
  }
}
