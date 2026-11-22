import mongoose from 'mongoose'
import Faculty from './Faculty.js'
import { getExistingReferences } from '../services/referenceValidation.service.js'
import protectAcademicDeletion from './plugins/protectAcademicDeletion.js'

const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 20 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'Faculty', required: true, index: true },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false })

departmentSchema.pre('validate', async function validateFacultyReference() {
  if (this.faculty) await getExistingReferences(Faculty, [this.faculty], 'faculty')
})

departmentSchema.plugin(protectAcademicDeletion, {
  async countReferences(id) {
    const [{ default: Class }, { default: User }, { default: Course }] = await Promise.all([
      import('./Class.js'),
      import('./User.js'),
      import('./Course.js'),
    ])
    const [classes, users, courses] = await Promise.all([
      Class.countDocuments({ department: id }).exec(),
      User.countDocuments({ department: id }).exec(),
      Course.countDocuments({ department: id }).exec(),
    ])
    return classes + users + courses
  },
})

const Department = mongoose.models.Department || mongoose.model('Department', departmentSchema)
export { departmentSchema }
export default Department
