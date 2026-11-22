import User from '../models/User.js'
import Faculty from '../models/Faculty.js'
import Class from '../models/Class.js'
import Department from '../models/Department.js'
import { createSessionCookie, clearSessionCookie } from '../middleware/auth.middleware.js'
import { hashPassword, isPasswordLengthValid, verifyPassword } from '../services/password.service.js'
import { createHash } from 'node:crypto'
import { recordAudit } from '../services/auditLog.service.js'

const safeUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  studentId: user.studentId,
  faculty: user.department?.faculty || user.class?.department?.faculty,
  department: user.department || user.class?.department,
  class: user.class,
  assignedClasses: user.assignedClasses,
  profileImage: user.profileImage,
})

const populateProfile = (user) => user.populate([
  { path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } },
  { path: 'class', select: 'name classCode department', populate: { path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } } },
])

export async function registerStudent(req, res) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const { fullName, email, password, studentId, faculty: facultyId, department: departmentId, class: classId } = body
  if (typeof fullName !== 'string' || !fullName.trim() || typeof email !== 'string' || !email.trim() || typeof studentId !== 'string' || !studentId.trim() || !facultyId || !departmentId || !classId) {
    return res.status(400).json({ success: false, message: 'Complete all required fields' })
  }
  if (fullName.trim().length > 160 || email.trim().length > 254 || studentId.trim().length > 40) {
    return res.status(400).json({ success: false, message: 'One or more fields exceed the allowed length' })
  }
  if (!isPasswordLengthValid(password)) {
    return res.status(400).json({ success: false, message: 'Password must be 8 or more characters and no more than 72 bytes' })
  }

  const [faculty, department, selectedClass] = await Promise.all([
    Faculty.findById(facultyId).select('_id isActive').lean(),
    Department.findById(departmentId).select('_id faculty isActive').lean(),
    Class.findById(classId).select('_id department isActive').lean(),
  ])
  if (!faculty?.isActive) return res.status(400).json({ success: false, message: 'Choose an active faculty' })
  if (!department?.isActive || String(department.faculty) !== String(faculty._id)) {
    return res.status(400).json({ success: false, message: 'Choose a department within the selected faculty' })
  }
  if (!selectedClass?.isActive || String(selectedClass.department) !== String(department._id)) {
    return res.status(400).json({ success: false, message: 'Choose an active class within the selected department' })
  }

  const passwordHash = await hashPassword(password)
  const user = await User.create({
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    role: 'student',
    studentId: studentId.trim(),
    department: department._id,
    class: classId,
  })
  await populateProfile(user)
  createSessionCookie(res, user)
  await recordAudit(req, { action: 'auth.student.registered', resourceType: 'user', resourceId: user._id, metadata: { role: 'student' } })
  return res.status(201).json({ success: true, user: safeUser(user) })
}

export async function login(req, res) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const email = String(body.email || '').trim().toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required' })

  const user = await User.findOne({ email }).select('+passwordHash +sessionVersion').exec()
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    await recordAudit(req, { action: 'auth.login.failed', resourceType: 'authentication', metadata: { emailHash: createHash('sha256').update(email).digest('hex') } })
    return res.status(401).json({ success: false, message: 'Email or password is incorrect' })
  }
  await populateProfile(user)
  createSessionCookie(res, user)
  await recordAudit(req, { action: 'auth.login.succeeded', resourceType: 'user', resourceId: user._id, metadata: { role: user.role } })
  return res.json({ success: true, user: safeUser(user) })
}

export async function logout(req, res) {
  await User.updateOne({ _id: req.user._id }, { $inc: { sessionVersion: 1 } })
  await recordAudit(req, { action: 'auth.logout', resourceType: 'user', resourceId: req.user._id })
  clearSessionCookie(res)
  return res.json({ success: true, message: 'Signed out' })
}

export async function currentSession(req, res) {
  const user = await User.findById(req.user._id).exec()
  if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'Your session is no longer active' })
  await populateProfile(user)
  return res.json({ success: true, user: safeUser(user) })
}
