import mongoose from 'mongoose'
import Class from './Class.js'
import Course from './Course.js'
import { getExistingReferences } from '../services/referenceValidation.service.js'

const lessonSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  subject: { type: String, trim: true, maxlength: 120, default: '' },
  summary: { type: String, trim: true, maxlength: 500, default: '' },
  content: { type: String, trim: true, maxlength: 30000, default: '' },
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  attachments: [{ name: { type: String, trim: true }, url: { type: String, trim: true } }],
  materials: [{ originalName: { type: String, required: true, trim: true, maxlength: 255 }, storedName: { type: String, required: true, trim: true, maxlength: 80 }, mimeType: { type: String, required: true, trim: true, maxlength: 120 }, size: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024 }, uploadedAt: { type: Date, default: Date.now } }],
  coverImage: { storedName: { type: String, trim: true, maxlength: 80 }, mimeType: { type: String, trim: true, maxlength: 40 } },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: undefined, index: true },
  isPublished: { type: Boolean, default: false, index: true },
  order: { type: Number, default: 0, min: 0 },
}, { timestamps: true, versionKey: false })

lessonSchema.pre('validate', async function validateClassReference() {
  if (!this.status) this.status = this.isPublished ? 'published' : 'draft'
  this.isPublished = this.status === 'published'
  if (this.course) {
    const course = await Course.findOne({ _id: this.course, isActive: true }).select('class teachingAssignments.class').lean()
    if (!course) this.invalidate('course', 'Choose an active course')
    else {
      // A course can be taught in several classes. Keep the class the lesson was posted to
      // when it belongs to this course; only fall back to the course's primary class otherwise.
      const courseClasses = [course.class, ...(course.teachingAssignments || []).map((item) => item.class)]
        .filter(Boolean)
        .map(String)
      if (!this.class || !courseClasses.includes(String(this.class))) {
        if (course.class) this.class = course.class
        else this.invalidate('class', 'Choose a class that takes this course')
      }
    }
  }
  if (this.class) await getExistingReferences(Class, [this.class], 'class')
})

const Lesson = mongoose.models.Lesson || mongoose.model('Lesson', lessonSchema)
export default Lesson
