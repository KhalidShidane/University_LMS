import mongoose from 'mongoose'
import { courseSemesters } from '../config/academicSemesters.js'

export { courseSemesters }

const courseSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  courseCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
  academicYear: { type: String, trim: true, maxlength: 20, default: '' },
  semester: { type: String, trim: true, maxlength: 80, default: '' },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null, index: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  teachingAssignments: [{
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  }],
  coverImage: { storedName: { type: String, trim: true, maxlength: 80 }, mimeType: { type: String, trim: true, maxlength: 40 } },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false })

courseSchema.index({ department: 1, class: 1, name: 1 })
courseSchema.index(
  { courseCode: 1, department: 1, class: 1 },
  { unique: true, partialFilterExpression: { isActive: true }, name: 'active_course_code_scope_unique' },
)
const Course = mongoose.models.Course || mongoose.model('Course', courseSchema)
export default Course
