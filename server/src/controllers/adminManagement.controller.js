import mongoose from 'mongoose'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import User from '../models/User.js'
import Course from '../models/Course.js'
import Lesson from '../models/Lesson.js'
import Assignment from '../models/Assignment.js'
import Quiz from '../models/Quiz.js'
import Submission from '../models/Submission.js'
import { hashPassword, isPasswordLengthValid } from '../services/password.service.js'
import { deleteManagedRecord } from '../services/adminDeletion.service.js'
import { createWithGeneratedCode } from '../services/codeGenerator.service.js'

const academicModels = { faculties: Faculty, departments: Department, classes: Class }
const userProfile = (query) => query
  .populate({ path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } })
  .populate({ path: 'departments', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } })
  .populate({ path: 'class', select: 'name classCode department', populate: { path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } } })
  .populate('assignedClasses', 'name classCode')

function pageOptions(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20))
  return { page, limit, skip: (page - 1) * limit }
}

function statusFilter(status) {
  if (status === 'active') return { isActive: true }
  if (status === 'inactive') return { isActive: false }
  return {}
}

function searchPattern(value) {
  const search = String(value || '').trim().slice(0, 80)
  return search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null
}

function assertObjectId(id) {
  if (!mongoose.isValidObjectId(id)) {
    const error = new Error('A valid record ID is required')
    error.status = 400
    throw error
  }
}

function validationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

async function activeDepartmentForFaculty(departmentId, facultyId) {
  if (!mongoose.isValidObjectId(departmentId)) throw validationError('Choose a valid department')
  const department = await Department.findById(departmentId).select('faculty isActive').lean()
  if (!department?.isActive) throw validationError('Choose an active department')
  const faculty = await Faculty.findById(department.faculty).select('isActive').lean()
  if (!faculty?.isActive) throw validationError('The department belongs to an inactive faculty')
  if (facultyId && String(department.faculty) !== String(facultyId)) throw validationError('The department does not belong to the selected faculty')
  return department
}

async function activeClassesForDepartment(classIds, departmentId) {
  if (!Array.isArray(classIds)) throw validationError('Assigned classes must be a list')
  const uniqueIds = [...new Set(classIds.map(String))]
  if (uniqueIds.length !== classIds.length) throw validationError('Assigned classes cannot contain duplicates')
  if (!uniqueIds.length) return
  if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) throw validationError('Choose valid classes')
  const classes = await Class.find({ _id: { $in: uniqueIds }, isActive: true }).select('_id department').lean()
  if (classes.length !== uniqueIds.length || classes.some((item) => String(item.department) !== String(departmentId))) {
    throw validationError('All assigned classes must be active and belong to the teacher department')
  }
}

async function activeDepartments(departmentIds) {
  if (!Array.isArray(departmentIds)) throw validationError('Teacher departments must be a list')
  const uniqueIds = [...new Set(departmentIds.map(String))]
  if (uniqueIds.length !== departmentIds.length) throw validationError('Teacher departments cannot contain duplicates')
  if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) throw validationError('Choose valid departments')
  if (!uniqueIds.length) return []
  const departments = await Department.find({ _id: { $in: uniqueIds }, isActive: true }).select('_id faculty').lean()
  if (departments.length !== uniqueIds.length) throw validationError('Choose active departments')
  const faculties = await Faculty.find({ _id: { $in: departments.map((item) => item.faculty) }, isActive: true }).distinct('_id')
  if (faculties.length !== new Set(departments.map((item) => String(item.faculty))).size) throw validationError('Teacher departments must belong to active faculties')
  return departments
}

async function activeClassesForDepartments(classIds, departmentIds) {
  if (!Array.isArray(classIds)) throw validationError('Assigned classes must be a list')
  const uniqueIds = [...new Set(classIds.map(String))]
  if (uniqueIds.length !== classIds.length) throw validationError('Assigned classes cannot contain duplicates')
  if (!uniqueIds.length) return
  if (!departmentIds.length) throw validationError('Assign at least one department before assigning classes')
  if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) throw validationError('Choose valid classes')
  const classes = await Class.find({ _id: { $in: uniqueIds }, isActive: true }).select('_id department').lean()
  if (classes.length !== uniqueIds.length || classes.some((item) => !departmentIds.includes(String(item.department)))) {
    throw validationError('All assigned classes must belong to one of the teacher departments')
  }
}

async function syncTeacherCourseAssignments(teacher) {
  const classIds = new Set(teacher.assignedClasses.map(String))
  const courses = await Course.find({ $or: [{ teacher: teacher._id }, { 'teachingAssignments.teacher': teacher._id }] })
  for (const course of courses) {
    course.teachingAssignments = course.teachingAssignments.filter((item) => String(item.teacher) !== String(teacher._id) || classIds.has(String(item.class)))
    if (String(course.teacher) === String(teacher._id) && !classIds.has(String(course.class))) {
      const primary = course.teachingAssignments[0]
      course.teacher = primary?.teacher || null
      course.class = primary?.class || null
      course.department = primary?.department || null
    }
    await course.save()
  }
}

async function activeStudentPlacement({ facultyId, departmentId, classId }) {
  const department = await activeDepartmentForFaculty(departmentId, facultyId)
  if (!mongoose.isValidObjectId(classId)) throw validationError('Choose a valid class')
  const academicClass = await Class.findById(classId).select('department isActive').lean()
  if (!academicClass?.isActive || String(academicClass.department) !== String(department._id)) {
    throw validationError('Choose an active class within the selected department')
  }
  return department
}

function responsePage(page, limit, total) {
  return { page, limit, total, pages: Math.ceil(total / limit) }
}

export async function getDashboardStats(req, res) {
  const [students, teachers, faculties, departments, classes, activeUsers, inactiveUsers, lessons, assignments, quizzes, submissionsToGrade, recentUsers] = await Promise.all([
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'teacher' }),
    Faculty.countDocuments(),
    Department.countDocuments(),
    Class.countDocuments(),
    User.countDocuments({ isActive: true }),
    User.countDocuments({ isActive: false }),
    Lesson.countDocuments(),
    Assignment.countDocuments({ isPublished: true }),
    Quiz.countDocuments({ isPublished: true }),
    Submission.countDocuments({ score: null }),
    User.find({ role: { $in: ['teacher', 'student'] } }).select('fullName email role profileImage createdAt isActive').sort({ createdAt: -1 }).limit(8).lean(),
  ])
  return res.json({ success: true, metrics: { students, teachers, faculties, departments, classes, activeUsers, inactiveUsers, lessons, assignments, quizzes, submissionsToGrade }, recentUsers })
}

export async function listAcademicRecords(req, res) {
  const type = req.params.type
  const Model = academicModels[type]
  if (!Model) return res.status(404).json({ success: false, message: 'Academic collection not found' })
  const { page, limit, skip } = pageOptions(req.query)
  const query = { ...statusFilter(req.query.status) }
  const pattern = searchPattern(req.query.search)
  if (pattern) query.$or = type === 'classes'
    ? [{ name: pattern }, { classCode: pattern }, { description: pattern }]
    : [{ name: pattern }, { code: pattern }, { description: pattern }]
  if (type === 'departments' && req.query.faculty) query.faculty = req.query.faculty
  if (type === 'classes') {
    if (req.query.department) query.department = req.query.department
    if (req.query.faculty) {
      const departments = await Department.find({ faculty: req.query.faculty }).distinct('_id')
      if (query.department && !departments.some((id) => String(id) === String(query.department))) query._id = { $exists: false }
      else query.department = { $in: query.department ? [query.department] : departments }
    }
  }
  let recordsQuery = Model.find(query)
  if (type === 'departments') recordsQuery = recordsQuery.populate('faculty', 'name code isActive')
  if (type === 'classes') recordsQuery = recordsQuery.populate({ path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } })
  const [records, total] = await Promise.all([
    recordsQuery.sort({ name: 1 }).skip(skip).limit(limit).lean(),
    Model.countDocuments(query),
  ])
  return res.json({ success: true, records, pagination: responsePage(page, limit, total) })
}

export async function getAcademicRecord(req, res) {
  const Model = academicModels[req.params.type]
  if (!Model) return res.status(404).json({ success: false, message: 'Academic collection not found' })
  assertObjectId(req.params.id)
  let query = Model.findById(req.params.id)
  if (req.params.type === 'departments') query = query.populate('faculty', 'name code isActive')
  if (req.params.type === 'classes') query = query.populate({ path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } })
  const record = await query.lean()
  if (!record) return res.status(404).json({ success: false, message: 'Academic record not found' })
  return res.json({ success: true, record })
}

function academicPayload(type, body) {
  const allowed = type === 'faculties'
    ? ['name', 'code', 'description']
    : type === 'departments'
      ? ['name', 'code', 'description', 'faculty']
      : ['name', 'classCode', 'description', 'department', 'level']
  const payload = Object.fromEntries(allowed.filter((field) => Object.hasOwn(body, field)).map((field) => [field, body[field]]))
  if (!Object.keys(payload).length) throw validationError('Provide at least one valid field')
  return payload
}

async function validateAcademicParents(type, payload) {
  if (type === 'departments' && payload.faculty) {
    if (!mongoose.isValidObjectId(payload.faculty)) throw validationError('Choose a valid faculty')
    const faculty = await Faculty.findById(payload.faculty).select('isActive').lean()
    if (!faculty?.isActive) throw validationError('Choose an active faculty')
  }
  if (type === 'classes' && payload.department) await activeDepartmentForFaculty(payload.department)
}

export async function createAcademicRecord(req, res) {
  const Model = academicModels[req.params.type]
  if (!Model) return res.status(404).json({ success: false, message: 'Academic collection not found' })
  const payload = academicPayload(req.params.type, req.body || {})
  await validateAcademicParents(req.params.type, payload)
  const codeField = req.params.type === 'classes' ? 'classCode' : 'code'
  const providedCode = typeof payload[codeField] === 'string' ? payload[codeField].trim() : ''
  if (providedCode && await Model.exists({ [codeField]: providedCode.toUpperCase() })) throw Object.assign(new Error(`The code ${providedCode.toUpperCase()} is already in use; choose another or leave it empty to generate one`), { status: 409 })
  const record = providedCode
    ? await Model.create({ ...payload, [codeField]: providedCode })
    : await createWithGeneratedCode(Model, codeField, payload.name, (code) => Model.create({ ...payload, [codeField]: code }), { maxLength: codeField === 'classCode' ? 30 : 20 })
  return res.status(201).json({ success: true, record })
}

export async function updateAcademicRecord(req, res) {
  const Model = academicModels[req.params.type]
  if (!Model) return res.status(404).json({ success: false, message: 'Academic collection not found' })
  assertObjectId(req.params.id)
  const record = await Model.findById(req.params.id)
  if (!record) return res.status(404).json({ success: false, message: 'Academic record not found' })
  const payload = academicPayload(req.params.type, req.body || {})
  await validateAcademicParents(req.params.type, payload)
  record.set(payload)
  await record.save()
  return res.json({ success: true, record })
}

export async function updateAcademicStatus(req, res) {
  const Model = academicModels[req.params.type]
  if (!Model) return res.status(404).json({ success: false, message: 'Academic collection not found' })
  assertObjectId(req.params.id)
  if (typeof req.body?.isActive !== 'boolean') throw validationError('isActive must be true or false')
  const existing = await Model.findById(req.params.id).select('faculty department').lean()
  if (!existing) return res.status(404).json({ success: false, message: 'Academic record not found' })
  if (req.body.isActive) await validateAcademicParents(req.params.type, req.params.type === 'departments'
    ? { faculty: existing.faculty }
    : req.params.type === 'classes'
      ? { department: existing.department }
      : {})
  const record = await Model.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive }, { new: true, runValidators: true })
  if (!record) return res.status(404).json({ success: false, message: 'Academic record not found' })
  return res.json({ success: true, record })
}

export async function deleteAdminManagedRecord(req, res) {
  assertObjectId(req.params.id)
  const deleted = await deleteManagedRecord(req.params.type, req.params.id)
  if (deleted === null) return res.status(404).json({ success: false, message: 'Record type cannot be deleted' })
  if (!deleted) return res.status(404).json({ success: false, message: 'Record not found' })
  return res.json({ success: true, message: 'Record and its related data were deleted' })
}

export async function listTeachers(req, res) {
  const { page, limit, skip } = pageOptions(req.query)
  const query = { role: 'teacher', ...statusFilter(req.query.status) }
  const pattern = searchPattern(req.query.search)
  if (pattern) query.$or = [{ fullName: pattern }, { email: pattern }]
  if (req.query.department) query.$and = [...(query.$and || []), { $or: [{ department: req.query.department }, { departments: req.query.department }] }]
  if (req.query.faculty) {
    const departments = await Department.find({ faculty: req.query.faculty }).distinct('_id')
    const departmentIds = query.$and?.[0]?.$or?.map((item) => item.department || item.departments) || departments
    const matchingIds = departments.filter((id) => departmentIds.some((value) => String(value) === String(id)))
    query.$and = [...(query.$and || []), { $or: [{ department: { $in: matchingIds } }, { departments: { $in: matchingIds } }] }]
  }
  if (req.query.class) query.assignedClasses = req.query.class
  const [teachers, total] = await Promise.all([
    userProfile(User.find(query).select('fullName email role department departments assignedClasses profileImage isActive createdAt'))
      .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(query),
  ])
  return res.json({ success: true, teachers, pagination: responsePage(page, limit, total) })
}

export async function getTeacher(req, res) {
  assertObjectId(req.params.id)
  const teacher = await userProfile(User.findOne({ _id: req.params.id, role: 'teacher' }).select('fullName email role department departments assignedClasses profileImage isActive createdAt'))
    .lean()
  if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' })
  return res.json({ success: true, teacher })
}

export async function createTeacher(req, res) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const { fullName, email, password, department, assignedClasses = [] } = body
  if (typeof fullName !== 'string' || !fullName.trim() || typeof email !== 'string' || !email.trim() || !password) throw validationError('Name, email, and temporary password are required')
  if (fullName.trim().length > 160 || email.trim().length > 254) throw validationError('Name or email exceeds the allowed length')
  if (!isPasswordLengthValid(password)) throw validationError('Temporary password must be 8 or more characters and no more than 72 bytes')
  const selectedDepartments = body.departments !== undefined
    ? await activeDepartments(body.departments)
    : department ? [await activeDepartmentForFaculty(department)] : []
  const departmentIds = selectedDepartments.map((item) => String(item._id))
  await activeClassesForDepartments(assignedClasses, departmentIds)
  const teacher = await User.create({ fullName: fullName.trim(), email: email.trim().toLowerCase(), passwordHash: await hashPassword(password), role: 'teacher', emailVerified: true, ...(selectedDepartments.length ? { department: selectedDepartments[0]._id, departments: selectedDepartments.map((item) => item._id) } : {}), assignedClasses })
  const result = await userProfile(User.findById(teacher._id).select('fullName email role department departments assignedClasses profileImage isActive createdAt')).lean()
  return res.status(201).json({ success: true, teacher: result })
}

export async function updateTeacher(req, res) {
  assertObjectId(req.params.id)
  const teacher = await User.findOne({ _id: req.params.id, role: 'teacher' })
  if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' })
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  if (Object.hasOwn(body, 'fullName')) teacher.fullName = body.fullName
  if (Object.hasOwn(body, 'email')) teacher.email = String(body.email).trim().toLowerCase()
  let departmentsChanged = false
  if (Object.hasOwn(body, 'departments')) {
    const departments = await activeDepartments(body.departments)
    teacher.departments = departments.map((item) => item._id)
    teacher.department = departments[0]?._id || null
    departmentsChanged = true
    if (!Object.hasOwn(body, 'assignedClasses')) teacher.assignedClasses = []
  } else if (Object.hasOwn(body, 'department')) {
    const department = body.department ? await activeDepartmentForFaculty(body.department) : null
    teacher.departments = department ? [department._id] : []
    teacher.department = department?._id || null
    departmentsChanged = true
    if (!Object.hasOwn(body, 'assignedClasses')) teacher.assignedClasses = []
  }
  if (Object.hasOwn(body, 'assignedClasses')) teacher.assignedClasses = body.assignedClasses
  if (departmentsChanged || Object.hasOwn(body, 'assignedClasses')) {
    const departmentIds = [...new Set([...(teacher.departments || []).map(String), ...(teacher.department ? [String(teacher.department)] : [])])]
    await activeClassesForDepartments(teacher.assignedClasses, departmentIds)
  }
  await teacher.save()
  if (departmentsChanged || Object.hasOwn(body, 'assignedClasses')) await syncTeacherCourseAssignments(teacher)
  const result = await userProfile(User.findById(teacher._id).select('fullName email role department departments assignedClasses profileImage isActive createdAt')).lean()
  return res.json({ success: true, teacher: result })
}

export async function resetTeacherPassword(req, res) {
  assertObjectId(req.params.id)
  const password = req.body?.password
  if (!isPasswordLengthValid(password)) throw validationError('New password must be 8 or more characters and no more than 72 bytes')
  const teacher = await User.findOne({ _id: req.params.id, role: 'teacher' }).select('+sessionVersion')
  if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' })
  teacher.passwordHash = await hashPassword(password)
  teacher.sessionVersion = (Number(teacher.sessionVersion) || 0) + 1
  await teacher.save()
  return res.json({ success: true, message: 'Teacher password reset successfully' })
}

export async function resetStudentPassword(req, res) {
  assertObjectId(req.params.id)
  const password = req.body?.password
  if (!isPasswordLengthValid(password)) throw validationError('New password must be 8 or more characters and no more than 72 bytes')
  const student = await User.findOne({ _id: req.params.id, role: 'student' }).select('+sessionVersion')
  if (!student) return res.status(404).json({ success: false, message: 'Student not found' })
  student.passwordHash = await hashPassword(password)
  student.sessionVersion = (Number(student.sessionVersion) || 0) + 1
  await student.save()
  return res.json({ success: true, message: 'Student password reset successfully' })
}

export async function updateTeacherClasses(req, res) {
  assertObjectId(req.params.id)
  const teacher = await User.findOne({ _id: req.params.id, role: 'teacher' })
  if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' })
  const departmentIds = [...new Set([...(teacher.departments || []).map(String), ...(teacher.department ? [String(teacher.department)] : [])])]
  await activeClassesForDepartments(req.body?.assignedClasses, departmentIds)
  teacher.assignedClasses = req.body.assignedClasses
  await teacher.save()
  await syncTeacherCourseAssignments(teacher)
  const result = await userProfile(User.findById(teacher._id).select('fullName email role department departments assignedClasses profileImage isActive createdAt')).lean()
  return res.json({ success: true, teacher: result })
}

export async function listStudents(req, res) {
  const { page, limit, skip } = pageOptions(req.query)
  const query = { role: 'student', ...statusFilter(req.query.status) }
  const pattern = searchPattern(req.query.search)
  if (pattern) query.$or = [{ fullName: pattern }, { email: pattern }, { studentId: pattern }]
  if (req.query.department) query.department = req.query.department
  if (req.query.class) query.class = req.query.class
  if (req.query.faculty) {
    const departments = await Department.find({ faculty: req.query.faculty }).distinct('_id')
    const classes = await Class.find({ department: { $in: departments } }).distinct('_id')
    if (query.class && !classes.some((id) => String(id) === String(query.class))) query._id = { $exists: false }
    else query.class = { $in: query.class ? [query.class] : classes }
  }
  const [students, total] = await Promise.all([
    userProfile(User.find(query).select('fullName email role studentId department class profileImage isActive createdAt'))
      .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(query),
  ])
  return res.json({ success: true, students, pagination: responsePage(page, limit, total) })
}

export async function getStudent(req, res) {
  assertObjectId(req.params.id)
  const student = await userProfile(User.findOne({ _id: req.params.id, role: 'student' }).select('fullName email role studentId department class profileImage isActive createdAt'))
    .lean()
  if (!student) return res.status(404).json({ success: false, message: 'Student not found' })
  return res.json({ success: true, student })
}

export async function createStudent(req, res) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const { fullName, email, password, studentId, faculty: facultyId, department: departmentId, class: classId } = body
  if (typeof fullName !== 'string' || !fullName.trim() || typeof email !== 'string' || !email.trim() || typeof studentId !== 'string' || !studentId.trim() || !facultyId || !departmentId || !classId || !password) throw validationError('Name, email, Student ID, faculty, department, class, and temporary password are required')
  if (fullName.trim().length > 160 || email.trim().length > 254 || studentId.trim().length > 40) throw validationError('One or more fields exceed the allowed length')
  if (!isPasswordLengthValid(password)) throw validationError('Temporary password must be 8 or more characters and no more than 72 bytes')
  const department = await activeStudentPlacement({ facultyId, departmentId, classId })
  const normalizedEmail = email.trim().toLowerCase()
  if (await User.exists({ email: normalizedEmail })) throw Object.assign(new Error('An account with this email already exists'), { status: 409 })
  if (await User.exists({ role: 'student', studentId: studentId.trim() })) throw Object.assign(new Error('A student with this Student ID already exists'), { status: 409 })
  const student = await User.create({ fullName: fullName.trim(), email: normalizedEmail, passwordHash: await hashPassword(password), role: 'student', emailVerified: true, studentId: studentId.trim(), department: department._id, class: classId })
  const result = await userProfile(User.findById(student._id).select('fullName email role studentId department class profileImage isActive createdAt')).lean()
  return res.status(201).json({ success: true, student: result })
}

export async function updateStudent(req, res) {
  assertObjectId(req.params.id)
  const student = await User.findOne({ _id: req.params.id, role: 'student' })
  if (!student) return res.status(404).json({ success: false, message: 'Student not found' })
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  if (Object.hasOwn(body, 'fullName')) student.fullName = body.fullName
  if (Object.hasOwn(body, 'email')) student.email = String(body.email).trim().toLowerCase()
  if (Object.hasOwn(body, 'studentId')) student.studentId = body.studentId
  const departmentId = Object.hasOwn(body, 'department') ? body.department : student.department
  const classId = Object.hasOwn(body, 'class') ? body.class : student.class
  const changedPlacement = String(departmentId) !== String(student.department || '') || String(classId) !== String(student.class || '')
  if (changedPlacement) {
    const populatedDepartment = await Department.findById(departmentId).select('faculty').lean()
    if (!populatedDepartment) throw validationError('Choose a valid department')
    const facultyId = body.faculty || String(populatedDepartment.faculty)
    const department = await activeStudentPlacement({ facultyId, departmentId, classId })
    student.department = department._id
    student.class = classId
  }
  await student.save()
  const result = await userProfile(User.findById(student._id).select('fullName email role studentId department class profileImage isActive createdAt')).lean()
  return res.json({ success: true, student: result })
}

export async function updateManagedUserStatus(req, res) {
  assertObjectId(req.params.id)
  if (typeof req.body?.isActive !== 'boolean') throw validationError('isActive must be true or false')
  const user = await User.findOneAndUpdate({ _id: req.params.id, role: { $in: ['teacher', 'student'] } }, { isActive: req.body.isActive, $inc: { sessionVersion: 1 } }, { new: true })
    .select('fullName role isActive')
  if (!user) return res.status(404).json({ success: false, message: 'User not found' })
  return res.json({ success: true, user: { id: user._id, fullName: user.fullName, role: user.role, isActive: user.isActive } })
}
