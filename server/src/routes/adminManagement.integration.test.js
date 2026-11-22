import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import { hashPassword } from '../services/password.service.js'

test('admin management APIs enforce roles and manage academic structure and accounts', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated admin integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_admin_test_${process.pid}_${Date.now()}`
  const previousSecret = process.env.JWT_SECRET
  const previousNodeEnv = process.env.NODE_ENV
  process.env.JWT_SECRET = 'phase-4-isolated-test-secret-do-not-use-in-production'
  process.env.NODE_ENV = 'test'
  const server = app.listen(0)

  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), Faculty.init(), Department.init(), Class.init()])
    const suffix = `${process.pid % 10000}${Date.now().toString().slice(-6)}`
    const faculty = await Faculty.create({ name: 'Starting Faculty', code: `SF${suffix}` })
    const department = await Department.create({ name: 'Starting Department', code: `SD${suffix}`, faculty: faculty._id })
    const academicClass = await Class.create({ name: 'Starting Class', classCode: `SC${suffix}`, department: department._id })
    const secondClass = await Class.create({ name: 'Second Class', classCode: `S2${suffix}`, department: department._id })
    const otherFaculty = await Faculty.create({ name: 'Other Faculty', code: `OF${suffix}` })
    const otherDepartment = await Department.create({ name: 'Other Department', code: `OD${suffix}`, faculty: otherFaculty._id })
    const otherClass = await Class.create({ name: 'Other Class', classCode: `OC${suffix}`, department: otherDepartment._id })
    const inactiveFaculty = await Faculty.create({ name: 'Inactive Faculty', code: `IF${suffix}`, isActive: false })
    const admin = await User.create({ fullName: 'Phase Four Admin', email: `admin${suffix}@example.edu`, passwordHash: await hashPassword('AdminPassword123'), role: 'admin' })
    const teacher = await User.create({ fullName: 'Phase Four Teacher', email: `teacher${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [academicClass._id] })
    const student = await User.create({ fullName: 'Phase Four Student', email: `student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `ST${suffix}`, department: department._id, class: academicClass._id })
    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const signIn = async (email, password) => {
      const response = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const adminCookie = await signIn(admin.email, 'AdminPassword123')
    const teacherCookie = await signIn(teacher.email, 'TeacherPassword123')
    const studentCookie = await signIn(student.email, 'StudentPassword123')
    const asAdmin = (path, options = {}) => request(path, { ...options, headers: { cookie: adminCookie, ...(options.headers || {}) } })

    assert.equal((await request('/faculties')).status, 401)
    assert.equal((await request('/faculties', { headers: { cookie: teacherCookie } })).status, 403)
    assert.equal((await request('/students', { headers: { cookie: studentCookie } })).status, 403)

    const newFacultyResponse = await asAdmin('/faculties', { method: 'POST', body: JSON.stringify({ name: 'New Faculty', code: `NF${suffix}`, description: 'Initial description' }) })
    assert.equal(newFacultyResponse.status, 201)
    const newFaculty = (await newFacultyResponse.json()).record
    const duplicateFaculty = await asAdmin('/faculties', { method: 'POST', body: JSON.stringify({ name: 'Duplicate Faculty', code: `NF${suffix}` }) })
    assert.equal(duplicateFaculty.status, 409)
    const updateFaculty = await asAdmin(`/faculties/${newFaculty._id}`, { method: 'PUT', body: JSON.stringify({ name: 'Renamed Faculty', description: 'Edited description' }) })
    assert.equal(updateFaculty.status, 200)
    assert.equal((await (await asAdmin(`/faculties/${newFaculty._id}`)).json()).record.name, 'Renamed Faculty')
    assert.equal((await asAdmin(`/faculties/${newFaculty._id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) })).status, 200)
    assert.equal((await asAdmin(`/faculties/${newFaculty._id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) })).status, 200)

    const newDepartmentResponse = await asAdmin('/departments', { method: 'POST', body: JSON.stringify({ name: 'New Department', code: `ND${suffix}`, faculty: newFaculty._id }) })
    assert.equal(newDepartmentResponse.status, 201)
    const newDepartment = (await newDepartmentResponse.json()).record
    assert.equal((await asAdmin('/departments', { method: 'POST', body: JSON.stringify({ name: 'Invalid Department', code: `ID${suffix}`, faculty: inactiveFaculty._id }) })).status, 400)
    const newClassResponse = await asAdmin('/classes', { method: 'POST', body: JSON.stringify({ name: 'New Class', classCode: `NC${suffix}`, department: newDepartment._id, level: 'Year 1' }) })
    assert.equal(newClassResponse.status, 201)
    const newClass = (await newClassResponse.json()).record
    assert.equal((await asAdmin('/classes', { method: 'POST', body: JSON.stringify({ name: 'Invalid Class', classCode: `IC${suffix}`, department: 'not-an-object-id' }) })).status, 400)
    assert.equal((await asAdmin(`/classes/${newClass._id}`, { method: 'PUT', body: JSON.stringify({ name: 'Edited Class', level: 'Year 2' }) })).status, 200)
    assert.equal((await asAdmin(`/classes/${academicClass._id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await asAdmin(`/classes?faculty=${otherFaculty._id}&limit=1&page=1`)).status, 200)

    const createdTeacherResponse = await asAdmin('/teachers', { method: 'POST', body: JSON.stringify({ fullName: 'Created Teacher', email: `created_teacher${suffix}@example.edu`, password: 'CreateTeacher123', department: department._id, assignedClasses: [academicClass._id, secondClass._id] }) })
    assert.equal(createdTeacherResponse.status, 201)
    const createdTeacher = (await createdTeacherResponse.json()).teacher
    assert.equal(createdTeacher.assignedClasses.length, 2)
    assert.equal(JSON.stringify(createdTeacher).includes('passwordHash'), false)
    const storedTeacher = await User.findById(createdTeacher._id).select('+passwordHash').lean()
    assert.match(storedTeacher.passwordHash, /^\$2[aby]\$/)
    assert.equal((await asAdmin(`/teachers/${createdTeacher._id}/classes`, { method: 'PATCH', body: JSON.stringify({ assignedClasses: [academicClass._id] }) })).status, 200)
    assert.equal((await asAdmin(`/teachers/${createdTeacher._id}/classes`, { method: 'PATCH', body: JSON.stringify({ assignedClasses: [otherClass._id] }) })).status, 400)
    assert.equal((await asAdmin(`/teachers/${createdTeacher._id}`, { method: 'PUT', body: JSON.stringify({ fullName: 'Updated Teacher' }) })).status, 200)
    assert.equal((await asAdmin(`/teachers/${createdTeacher._id}/password`, { method: 'PATCH', body: JSON.stringify({ password: 'ResetTeacher123' }) })).status, 200)
    assert.equal((await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: createdTeacher.email, password: 'ResetTeacher123' }) })).status, 200)
    assert.equal((await asAdmin(`/teachers?search=Updated&department=${department._id}&page=1&limit=1`)).status, 200)

    const studentSearch = await asAdmin(`/students?search=${student.studentId}&faculty=${faculty._id}&department=${department._id}&class=${academicClass._id}&status=active&page=1&limit=1`)
    assert.equal(studentSearch.status, 200)
    const studentList = await studentSearch.json()
    assert.equal(studentList.students.length, 1)
    assert.equal(studentList.students[0].studentId, student.studentId)
    assert.equal(studentList.pagination.limit, 1)
    assert.equal((await asAdmin(`/students/${student._id}`, { method: 'PUT', body: JSON.stringify({ fullName: 'Updated Student', role: 'teacher' }) })).status, 200)
    assert.equal((await User.findById(student._id).select('role fullName').lean()).role, 'student')
    assert.equal((await asAdmin(`/students/${student._id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) })).status, 200)
    assert.equal((await request('/auth/me', { headers: { cookie: studentCookie } })).status, 401)
    assert.equal((await asAdmin(`/students/${student._id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) })).status, 200)
    assert.equal((await asAdmin(`/teachers/${createdTeacher._id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) })).status, 200)
    assert.equal((await asAdmin(`/teachers/${createdTeacher._id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) })).status, 200)

    const statsResponse = await asAdmin('/admin/dashboard/stats')
    assert.equal(statsResponse.status, 200)
    const stats = (await statsResponse.json()).metrics
    assert.equal(stats.students, await User.countDocuments({ role: 'student' }))
    assert.equal(stats.teachers, await User.countDocuments({ role: 'teacher' }))
    assert.equal(stats.faculties, await Faculty.countDocuments())
    assert.equal(stats.departments, await Department.countDocuments())
    assert.equal(stats.classes, await Class.countDocuments())
    assert.equal(stats.activeUsers, await User.countDocuments({ isActive: true }))
    assert.equal(stats.inactiveUsers, await User.countDocuments({ isActive: false }))
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await disconnectDatabase()
    if (previousSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previousSecret
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
})
