import mongoose from 'mongoose'
import Conversation from './Conversation.js'
import User from './User.js'
import { getExistingReferences } from '../services/referenceValidation.service.js'

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  messageText: { type: String, trim: true, required: true, minlength: 1, maxlength: 5000 },
  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false })

messageSchema.index({ conversationId: 1, createdAt: -1 })
messageSchema.pre('validate', async function validateReferences() {
  if (this.conversationId) await getExistingReferences(Conversation, [this.conversationId], 'conversationId')
  if (this.senderId) await getExistingReferences(User, [this.senderId], 'senderId')
})

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema)
export default Message
