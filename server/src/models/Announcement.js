import mongoose from 'mongoose'
import User from './User.js'

const announcementSchema = new mongoose.Schema({
  title: { type: String, trim: true, required: true, maxlength: 160 },
  message: { type: String, trim: true, required: true, maxlength: 5000 },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false })

announcementSchema.index({ isActive: 1, createdAt: -1 })
announcementSchema.pre('validate', async function validateAuthor() {
  if (this.author) await User.exists({ _id: this.author, role: 'admin' }) || this.invalidate('author', 'Announcement author must be an administrator')
})

export default mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema)
