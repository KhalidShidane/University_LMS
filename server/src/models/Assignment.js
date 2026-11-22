import mongoose from 'mongoose'
import Class from './Class.js'
import Lesson from './Lesson.js'
import { getExistingReferences } from '../services/referenceValidation.service.js'

const assignmentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 5000, default: '' },
  instructions: { type: String, trim: true, maxlength: 10000, default: '' },
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
  lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  dueDate: { type: Date, required: true, index: true },
  maxScore: { type: Number, default: 100, min: 1, max: 10000 },
  totalMarks: { type: Number, default: undefined, min: 1, max: 10000 },
  attachments: [{ originalName: { type: String, trim: true, maxlength: 255 }, storedName: { type: String, trim: true, maxlength: 90 }, mimeType: { type: String, trim: true, maxlength: 120 }, size: { type: Number, min: 1, max: 100 * 1024 * 1024 }, uploadedAt: { type: Date, default: Date.now } }],
  status: { type: String, enum: ['draft', 'published', 'closed'], default: undefined, index: true },
  isPublished: { type: Boolean, default: true, index: true },
  // First time the assignment was published; drives which deadline reminders still apply.
  publishedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false })

assignmentSchema.pre('validate', async function validateReferences() {
  if (!this.status) this.status = this.isPublished ? 'published' : 'draft'
  this.isPublished = this.status === 'published'
  if (this.status === 'published' && !this.publishedAt) this.publishedAt = new Date()
  if (this.totalMarks == null) this.totalMarks = this.maxScore
  else this.maxScore = this.totalMarks
  if (this.class) await getExistingReferences(Class, [this.class], 'class')
  if (this.lesson) {
    await getExistingReferences(Lesson, [this.lesson], 'lesson')
    const lesson = await Lesson.findById(this.lesson).select('class').lean()
    if (lesson && String(lesson.class) !== String(this.class)) {
      this.invalidate('lesson', 'Assignment lesson must belong to the selected class')
    }
  }
})

assignmentSchema.index({ class: 1, status: 1, dueDate: 1 })

const Assignment = mongoose.models.Assignment || mongoose.model('Assignment', assignmentSchema)
export default Assignment
