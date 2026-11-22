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
import { sessionCookieOptions } from '../middleware/auth.middleware.js'
import { setEmailTransport } from '../services/email/email.service.js'

test('authentication registration, sessions, profile, and role access', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated authentication integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_auth_test_${process.pid}_${Date.now()}`
  const previousSecret = process.env.JWT_SECRET
  const previousNodeEnv = process.env.NODE_ENV
  const previousExpiration = process.env.JWT_EXPIRES_IN
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'phase-3-isolated-test-secret-do-not-use-in-production'
  process.env.JWT_EXPIRES_IN = '2h'
  const server = app.listen(0)
  const sentEmails = []
  setEmailTransport({ name: 'test', async send(message) { sentEmails.push(message); return { providerMessageId: `test-${sentEmails.length}` } } })

  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), Faculty.init(), Department.init(), Class.init()])
    const suffix = `${process.pid % 10000}${Date.now().toString().slice(-6)}`
    const faculty = await Faculty.create({ name: 'Auth Test Faculty', code: `ATF${suffix}` })
    const otherFaculty = await Faculty.create({ name: 'Other Auth Test Faculty', code: `OATF${suffix}` })
    const department = await Department.create({ name: 'Auth Test Department', code: `ATD${suffix}`, faculty: faculty._id })
    const otherDepartment = await Department.create({ name: 'Other Auth Test Department', code: `OATD${suffix}`, faculty: otherFaculty._id })
    const academicClass = await Class.create({ name: 'Auth Test Class', classCode: `ATC${suffix}`, department: department._id })
    const otherClass = await Class.create({ name: 'Other Auth Test Class', classCode: `OATC${suffix}`, department: otherDepartment._id })
    const inactiveFaculty = await Faculty.create({ name: 'Inactive Faculty', code: `IAF${suffix}`, isActive: false })
    const inactiveDepartment = await Department.create({ name: 'Inactive Department', code: `IAD${suffix}`, faculty: faculty._id, isActive: false })
    const inactiveClass = await Class.create({ name: 'Inactive Class', classCode: `IAC${suffix}`, department: department._id, isActive: false })
    const admin = await User.create({ fullName: 'Auth Test Admin', email: `admin_${suffix}@example.edu`, passwordHash: await hashPassword('AdminPassword123'), role: 'admin' })
    const teacher = await User.create({ fullName: 'Auth Test Teacher', email: `teacher_${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id })
    const inactive = await User.create({ fullName: 'Inactive Test Student', email: `inactive_${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `IN${suffix}`, department: department._id, class: academicClass._id, isActive: false })
    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const body = (email, studentId, refs = {}) => ({
      fullName: '  Newly Registered Student  ', email, password: 'StudentPassword123', studentId,
      faculty: String(faculty._id), department: String(department._id), class: String(academicClass._id), role: 'admin', ...refs,
    })

    assert.equal(sessionCookieOptions().httpOnly, true)
    assert.equal(sessionCookieOptions().sameSite, 'lax')
    assert.equal(sessionCookieOptions().maxAge, 2 * 60 * 60 * 1000)
    process.env.NODE_ENV = 'production'
    assert.equal(sessionCookieOptions().secure, true)
    process.env.NODE_ENV = 'test'

    const unauthenticated = await request('/admin/dashboard/stats')
    assert.equal(unauthenticated.status, 401)
    const noSession = await request('/auth/me')
    assert.equal(noSession.status, 401)

    const registerResponse = await request('/auth/register', { method: 'POST', body: JSON.stringify(body(` STUDENT_${suffix}@example.edu `, `STU${suffix}`)) })
    assert.equal(registerResponse.status, 201)
    const registerResult = await registerResponse.json()
    assert.equal(registerResult.verificationRequired, true)
    assert.equal(registerResult.emailSent, true)
    assert.equal(JSON.stringify(registerResult).includes('passwordHash'), false)
    assert.equal(registerResponse.headers.get('set-cookie'), null)
    const blockedLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: `student_${suffix}@example.edu`, password: 'StudentPassword123' }) })
    assert.equal(blockedLogin.status, 403)
    assert.equal((await blockedLogin.json()).code, 'EMAIL_NOT_VERIFIED')
    const verificationToken = new URL(sentEmails.at(-1).text.match(/https?:\/\/\S+/)[0]).pathname.split('/').pop()
    assert.equal((await request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: verificationToken }) })).status, 200)
    const verifiedLoginResponse = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: `student_${suffix}@example.edu`, password: 'StudentPassword123' }) })
    assert.equal(verifiedLoginResponse.status, 200)
    const verifiedLoginResult = await verifiedLoginResponse.json()
    assert.equal(verifiedLoginResult.user.role, 'student')
    assert.equal(verifiedLoginResult.user.email, `student_${suffix}@example.edu`)
    assert.equal(verifiedLoginResult.user.fullName, 'Newly Registered Student')
    assert.equal(verifiedLoginResult.user.faculty.name, faculty.name)
    assert.equal(verifiedLoginResult.user.department.name, department.name)
    assert.equal(verifiedLoginResult.user.class.name, academicClass.name)
    const studentCookie = verifiedLoginResponse.headers.get('set-cookie')?.split(';')[0]
    assert.match(studentCookie || '', /^lms_session=/)
    const storedStudent = await User.findOne({ email: `student_${suffix}@example.edu` }).select('+passwordHash').exec()
    assert.match(storedStudent.passwordHash, /^\$2[aby]\$/)
    assert.notEqual(storedStudent.passwordHash, 'StudentPassword123')

    const sessionResponse = await request('/auth/me', { headers: { cookie: studentCookie } })
    assert.equal(sessionResponse.status, 200)
    assert.equal((await sessionResponse.json()).user.role, 'student')
    assert.equal((await request('/profile', { method: 'PATCH', body: JSON.stringify({ fullName: 'Should Not Work' }) })).status, 401)
    const profileUpdate = await request('/profile', { method: 'PATCH', headers: { cookie: studentCookie }, body: JSON.stringify({ fullName: '  Updated Student Name  ', role: 'admin', email: 'changed@example.edu' }) })
    assert.equal(profileUpdate.status, 200)
    assert.equal((await profileUpdate.json()).user.fullName, 'Updated Student Name')
    const updatedSession = await request('/auth/me', { headers: { cookie: studentCookie } })
    const updatedProfile = (await updatedSession.json()).user
    assert.equal(updatedProfile.fullName, 'Updated Student Name')
    assert.equal(updatedProfile.role, 'student')
    assert.equal(updatedProfile.email, `student_${suffix}@example.edu`)
    assert.equal((await request('/profile', { method: 'PATCH', headers: { cookie: studentCookie }, body: JSON.stringify({ fullName: '   ' }) })).status, 400)
    const studentAdminResponse = await request('/admin/dashboard/stats', { headers: { cookie: studentCookie } })
    assert.equal(studentAdminResponse.status, 403)
    const studentTeacherResponse = await request('/teacher/overview', { headers: { cookie: studentCookie } })
    assert.equal(studentTeacherResponse.status, 403)

    const duplicateEmail = await request('/auth/register', { method: 'POST', body: JSON.stringify(body(`student_${suffix}@example.edu`, `STU_EMAIL${suffix}`)) })
    assert.equal(duplicateEmail.status, 409)
    const duplicateId = await request('/auth/register', { method: 'POST', body: JSON.stringify(body(`second_${suffix}@example.edu`, `STU${suffix}`)) })
    assert.equal(duplicateId.status, 409)
    const wrongDepartment = await request('/auth/register', { method: 'POST', body: JSON.stringify(body(`wrong_dept_${suffix}@example.edu`, `WD${suffix}`, { department: String(otherDepartment._id), class: String(otherClass._id) })) })
    assert.equal(wrongDepartment.status, 400)
    const wrongFaculty = await request('/auth/register', { method: 'POST', body: JSON.stringify(body(`wrong_faculty_${suffix}@example.edu`, `WF${suffix}`, { faculty: String(otherFaculty._id) })) })
    assert.equal(wrongFaculty.status, 400)
    for (const [email, studentId, refs] of [
      [`inactive_faculty_${suffix}@example.edu`, `IF${suffix}`, { faculty: String(inactiveFaculty._id) }],
      [`inactive_department_${suffix}@example.edu`, `ID${suffix}`, { department: String(inactiveDepartment._id) }],
      [`inactive_class_${suffix}@example.edu`, `IC${suffix}`, { class: String(inactiveClass._id) }],
    ]) {
      const response = await request('/auth/register', { method: 'POST', body: JSON.stringify(body(email, studentId, refs)) })
      assert.equal(response.status, 400)
    }

    const loginResponse = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: `student_${suffix}@example.edu`, password: 'StudentPassword123' }) })
    assert.equal(loginResponse.status, 200)
    const loginResult = await loginResponse.json()
    assert.equal(loginResult.user.role, 'student')
    assert.equal(JSON.stringify(loginResult).includes('passwordHash'), false)
    const loginCookie = loginResponse.headers.get('set-cookie')?.split(';')[0]
    const incorrectPassword = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: `student_${suffix}@example.edu`, password: 'incorrect-password' }) })
    assert.equal(incorrectPassword.status, 401)
    const inactiveLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: inactive.email, password: 'StudentPassword123' }) })
    assert.equal(inactiveLogin.status, 401)

    const adminLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: admin.email, password: 'AdminPassword123' }) })
    const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0]
    assert.equal((await request('/admin/dashboard/stats', { headers: { cookie: adminCookie } })).status, 200)
    const teacherLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: teacher.email, password: 'TeacherPassword123' }) })
    const teacherCookie = teacherLogin.headers.get('set-cookie')?.split(';')[0]
    assert.equal((await request('/admin/dashboard/stats', { headers: { cookie: teacherCookie } })).status, 403)

    const logoutResponse = await request('/auth/logout', { method: 'POST', headers: { cookie: loginCookie } })
    assert.equal(logoutResponse.status, 200)
    assert.match(logoutResponse.headers.get('set-cookie') || '', /lms_session=;/)
    assert.equal((await request('/auth/me')).status, 401)
  } finally {
    setEmailTransport(null)
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await disconnectDatabase()
    if (previousSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previousSecret
    if (previousExpiration === undefined) delete process.env.JWT_EXPIRES_IN
    else process.env.JWT_EXPIRES_IN = previousExpiration
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
})
