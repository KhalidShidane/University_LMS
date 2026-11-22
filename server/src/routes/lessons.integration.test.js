import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import Lesson from '../models/Lesson.js'
import { hashPassword } from '../services/password.service.js'

test('teacher lessons are class-scoped and students only see published lessons for their class', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated lesson integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_lessons_test_${process.pid}_${Date.now()}`
  const previousSecret = process.env.JWT_SECRET
  const previousNodeEnv = process.env.NODE_ENV
  process.env.JWT_SECRET = 'phase-5-isolated-test-secret-do-not-use-in-production'
  process.env.NODE_ENV = 'test'
  const server = app.listen(0)

  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), Faculty.init(), Department.init(), Class.init(), Lesson.init()])
    const suffix = `${process.pid % 10000}${Date.now().toString().slice(-6)}`
    const faculty = await Faculty.create({ name: 'Lesson Test Faculty', code: `LTF${suffix}` })
    const department = await Department.create({ name: 'Lesson Test Department', code: `LTD${suffix}`, faculty: faculty._id })
    const assignedClass = await Class.create({ name: 'Assigned Lesson Class', classCode: `ALC${suffix}`, department: department._id })
    const otherClass = await Class.create({ name: 'Other Lesson Class', classCode: `OLC${suffix}`, department: department._id })
    const teacher = await User.create({ fullName: 'Lesson Owner', email: `lesson_owner${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [assignedClass._id] })
    const otherTeacher = await User.create({ fullName: 'Other Teacher', email: `other_teacher${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [otherClass._id] })
    const student = await User.create({ fullName: 'In Class Student', email: `lesson_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `LS${suffix}`, department: department._id, class: assignedClass._id })
    const outsider = await User.create({ fullName: 'Other Class Student', email: `other_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `OS${suffix}`, department: department._id, class: otherClass._id })
    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const login = async (email) => {
      const response = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: email.includes('student') ? 'StudentPassword123' : 'TeacherPassword123' }) })
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const teacherCookie = await login(teacher.email)
    const otherTeacherCookie = await login(otherTeacher.email)
    const studentCookie = await login(student.email)
    const outsiderCookie = await login(outsider.email)
    const teacherRequest = (path, options = {}) => request(path, { ...options, headers: { cookie: teacherCookie, ...(options.headers || {}) } })
    const studentRequest = (path, options = {}) => request(path, { ...options, headers: { cookie: studentCookie, ...(options.headers || {}) } })

    const dashboard = await teacherRequest('/teacher/dashboard')
    assert.equal(dashboard.status, 200)
    assert.equal((await dashboard.json()).metrics.classes, 1)
    const students = await teacherRequest(`/teacher/classes/${assignedClass._id}/students?search=In%20Class`)
    assert.equal((await students.json()).students.length, 1)
    assert.equal((await teacherRequest(`/teacher/classes/${otherClass._id}/students`)).status, 403)

    const create = async (cookie, classId, title, status = 'draft', attachments = []) => request('/lessons/teacher', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ title, subject: 'Biology', summary: 'Cell structure', content: 'A lesson about cells.', class: classId, status, attachments }) })
    assert.equal((await create(teacherCookie, otherClass._id, 'Forbidden class lesson')).status, 403)
    const draftResponse = await create(teacherCookie, assignedClass._id, 'Cell structure draft')
    assert.equal(draftResponse.status, 201)
    const draft = (await draftResponse.json()).lesson
    const publishedResponse = await create(teacherCookie, assignedClass._id, 'Cell structure published', 'published', [{ name: 'Cell video', url: 'https://example.edu/cell-video' }])
    assert.equal(publishedResponse.status, 201)
    const published = (await publishedResponse.json()).lesson
    assert.equal(published.attachments[0].url, 'https://example.edu/cell-video')
    assert.equal((await create(teacherCookie, assignedClass._id, 'Unsafe lesson link', 'draft', [{ name: 'Unsafe', url: 'javascript:alert(1)' }])).status, 400)
    const archivedResponse = await create(teacherCookie, assignedClass._id, 'Archived content', 'archived')
    assert.equal(archivedResponse.status, 201)
    const otherPublishedResponse = await create(otherTeacherCookie, otherClass._id, 'Other class published', 'published')
    assert.equal(otherPublishedResponse.status, 201)
    assert.equal((await request(`/lessons/teacher/${draft._id}`, { headers: { cookie: otherTeacherCookie } })).status, 404)
    assert.equal((await request(`/lessons/teacher/${draft._id}`, { method: 'PATCH', headers: { cookie: otherTeacherCookie, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Stolen edit' }) })).status, 404)

    const form = new FormData()
    form.append('files', new Blob([Buffer.from('%PDF-1.7\nlesson test')], { type: 'application/pdf' }), 'guide.pdf')
    const upload = await fetch(`${base}/lessons/teacher/${published._id}/materials`, { method: 'POST', headers: { cookie: teacherCookie }, body: form })
    assert.equal(upload.status, 201)
    const material = (await upload.json()).materials[0]
    assert.equal((await request(`/lessons/${published._id}/materials/${material._id}`, { headers: { cookie: outsiderCookie } })).status, 404)
    assert.equal((await studentRequest(`/lessons/${published._id}/materials/${material._id}`)).status, 200)

    const invalidForm = new FormData()
    invalidForm.append('files', new Blob([Buffer.from('not a PDF')], { type: 'application/pdf' }), 'invalid.pdf')
    const invalidUpload = await fetch(`${base}/lessons/teacher/${published._id}/materials`, { method: 'POST', headers: { cookie: teacherCookie }, body: invalidForm })
    assert.equal(invalidUpload.status, 400)
    const oversizedForm = new FormData()
    oversizedForm.append('files', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1, 0x61)], { type: 'application/pdf' }), 'large.pdf')
    const oversizedUpload = await fetch(`${base}/lessons/teacher/${published._id}/materials`, { method: 'POST', headers: { cookie: teacherCookie }, body: oversizedForm })
    assert.equal(oversizedUpload.status, 413)
    const coverForm = new FormData()
    coverForm.append('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'cover.png')
    assert.equal((await fetch(`${base}/lessons/teacher/${published._id}/cover`, { method: 'POST', headers: { cookie: teacherCookie }, body: coverForm })).status, 200)

    const studentLessons = await studentRequest('/lessons/student')
    const visible = (await studentLessons.json()).lessons
    assert.deepEqual(visible.map((lesson) => lesson.title), ['Cell structure published'])
    const studentLesson = await (await studentRequest(`/lessons/student/${published._id}`)).json()
    assert.equal(studentLesson.lesson.attachments[0].name, 'Cell video')
    assert.equal((await request('/lessons/student', { headers: { cookie: outsiderCookie } })).status, 200)
    const otherVisible = (await (await request('/lessons/student', { headers: { cookie: outsiderCookie } })).json()).lessons
    assert.deepEqual(otherVisible.map((lesson) => lesson.title), ['Other class published'])
    assert.equal((await request(`/lessons/student/${draft._id}`, { headers: { cookie: studentCookie } })).status, 404)
    assert.equal((await Lesson.findById(published._id)).isPublished, true)
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
