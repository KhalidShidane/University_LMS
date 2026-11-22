import mongoose from 'mongoose'
import protectAcademicDeletion from './plugins/protectAcademicDeletion.js'

const facultySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 20 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false })

facultySchema.plugin(protectAcademicDeletion, {
  async countReferences(id) {
    const { default: Department } = await import('./Department.js')
    return Department.countDocuments({ faculty: id }).exec()
  },
})

const Faculty = mongoose.models.Faculty || mongoose.model('Faculty', facultySchema)
export { facultySchema }
export default Faculty
