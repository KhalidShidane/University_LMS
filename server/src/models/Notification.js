import mongoose from 'mongoose'
import User from './User.js'
import { getExistingReferences } from '../services/referenceValidation.service.js'

const notificationTypes = [
  'new_lesson', 'new_assignment', 'assignment_deadline', 'assignment_submitted',
  'assignment_graded', 'new_quiz', 'quiz_completed', 'quiz_results_released',
  'new_message', 'system_announcement',
]

const notificationSchema = new mongoose.Schema({
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, enum: notificationTypes, required: true },
  title: { type: String, trim: true, required: true, maxlength: 160 },
  message: { type: String, trim: true, required: true, maxlength: 2000 },
  relatedEntityType: { type: String, enum: ['lesson', 'assignment', 'quiz', 'conversation', 'message', 'system'], default: null },
  relatedEntityId: { type: mongoose.Schema.Types.ObjectId, default: null },
  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null },
  dedupeKey: { type: String, trim: true, maxlength: 240, default: undefined },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false })

notificationSchema.index({ recipientId: 1, createdAt: -1 })
notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 })
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true })
notificationSchema.pre('validate', async function validateRecipient() {
  if (this.recipientId) await getExistingReferences(User, [this.recipientId], 'recipientId')
  if (this.senderId) await getExistingReferences(User, [this.senderId], 'senderId')
})

const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema)
export { notificationTypes }
export default Notification
