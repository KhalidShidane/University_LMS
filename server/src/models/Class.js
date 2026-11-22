import mongoose from 'mongoose'
import Department from './Department.js'
import { getExistingReferences } from '../services/referenceValidation.service.js'
import protectAcademicDeletion from './plugins/protectAcademicDeletion.js'

const classSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  classCode: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 30 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
  level: { type: String, trim: true, maxlength: 60, default: null },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false })

classSchema.pre('validate', async function validateDepartmentReference() {
  if (this.department) await getExistingReferences(Department, [this.department], 'department')
})

classSchema.plugin(protectAcademicDeletion, {
  async countReferences(id) {
    const { default: User } = await import('./User.js')
    const { default: Course } = await import('./Course.js')
    const [studentAssignments, teacherAssignments, courses] = await Promise.all([
      User.countDocuments({ class: id }).exec(),
      User.countDocuments({ assignedClasses: id }).exec(),
      Course.countDocuments({ class: id }).exec(),
    ])
    return studentAssignments + teacherAssignments + courses
  },
})

const Class = mongoose.models.Class || mongoose.model('Class', classSchema)
export { classSchema }
export default Class
