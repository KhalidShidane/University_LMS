import mongoose from 'mongoose'
import Class from './Class.js'
import User from './User.js'
import { getExistingReferences } from '../services/referenceValidation.service.js'

const conversationSchema = new mongoose.Schema({
  participants: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }], validate: [(items) => items.length === 2 && new Set(items.map(String)).size === 2, 'Conversations require two distinct participants'] },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null, index: true },
  participantKey: { type: String, required: true, unique: true, select: false },
  lastMessage: { type: String, trim: true, maxlength: 5000, default: '' },
  lastMessageAt: { type: Date, default: null, index: true },
}, { timestamps: true, versionKey: false })

conversationSchema.index({ participants: 1, lastMessageAt: -1 })
conversationSchema.pre('validate', async function validateParticipants() {
  if (this.participants?.length) await getExistingReferences(User, this.participants, 'participants')
  if (this.classId) await getExistingReferences(Class, [this.classId], 'classId')
})

const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema)
export default Conversation
