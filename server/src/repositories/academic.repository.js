import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import User from '../models/User.js'

export const academicModels = Object.freeze({ faculty: Faculty, department: Department, class: Class, user: User })

const populatePaths = {
  department: ['faculty'],
  class: ['department'],
  user: ['department', 'class', 'assignedClasses'],
}

export async function findAcademicRecord(type, id) {
  const Model = academicModels[type]
  if (!Model) throw new TypeError(`Unknown academic record type: ${type}`)

  let query = Model.findById(id)
  for (const path of populatePaths[type] || []) query = query.populate(path)
  return query.exec()
}

export async function setAcademicRecordActive(type, id, isActive) {
  const Model = academicModels[type]
  if (!Model) throw new TypeError(`Unknown academic record type: ${type}`)
  return Model.findByIdAndUpdate(id, { $set: { isActive } }, { new: true, runValidators: true }).exec()
}

export async function countAcademicReferences(type, id) {
  if (type === 'faculty') return Department.countDocuments({ faculty: id }).exec()
  if (type === 'department') {
    const [classes, users] = await Promise.all([
      Class.countDocuments({ department: id }).exec(),
      User.countDocuments({ department: id }).exec(),
    ])
    return classes + users
  }
  if (type === 'class') {
    const [studentAssignments, teacherAssignments] = await Promise.all([
      User.countDocuments({ class: id }).exec(),
      User.countDocuments({ assignedClasses: id }).exec(),
    ])
    return studentAssignments + teacherAssignments
  }
  if (type === 'user') return 0
  throw new TypeError(`Unknown academic record type: ${type}`)
}
