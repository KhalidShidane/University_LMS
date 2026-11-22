import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import Course from '../models/Course.js'
import Lesson from '../models/Lesson.js'
import Note from '../models/Note.js'
import { hashPassword } from '../services/password.service.js'

const doc = (...paragraphs) => ({ type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) })

test('student notes are private, linked to accessible lessons, autosave safely and keep their order', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated notes integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_notes_test_${process.pid}_${Date.now()}`
  const previousSecret = process.env.JWT_SECRET
  const previousNodeEnv = process.env.NODE_ENV
  process.env.JWT_SECRET = 'notes-isolated-test-secret-do-not-use-in-production'
  process.env.NODE_ENV = 'test'
  const server = app.listen(0)

  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), Faculty.init(), Department.init(), Class.init(), Course.init(), Lesson.init(), Note.init()])
    const suffix = `${process.pid % 10000}${Date.now().toString().slice(-6)}`
    const faculty = await Faculty.create({ name: 'Notes Faculty', code: `NF${suffix}` })
    const department = await Department.create({ name: 'Notes Department', code: `ND${suffix}`, faculty: faculty._id })
    const classA = await Class.create({ name: 'Notes Class A', classCode: `NCA${suffix}`, department: department._id })
    const classB = await Class.create({ name: 'Notes Class B', classCode: `NCB${suffix}`, department: department._id })
    const teacher = await User.create({ fullName: 'Notes Teacher', email: `notes_teacher${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [classA._id, classB._id] })
    const student = await User.create({ fullName: 'Notes Student', email: `notes_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `NS${suffix}`, department: department._id, class: classA._id })
    const outsider = await User.create({ fullName: 'Other Student', email: `notes_other_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `NO${suffix}`, department: department._id, class: classB._id })
    const courseA = await Course.create({ name: 'Biology', courseCode: `BIO${suffix}`, department: department._id, class: classA._id, teacher: teacher._id, teachingAssignments: [{ teacher: teacher._id, class: classA._id, department: department._id }] })
    const courseB = await Course.create({ name: 'Physics', courseCode: `PHY${suffix}`, department: department._id, class: classB._id, teacher: teacher._id, teachingAssignments: [{ teacher: teacher._id, class: classB._id, department: department._id }] })
    const lessonA = await Lesson.create({ title: 'Cells', content: 'Cells', class: classA._id, course: courseA._id, createdBy: teacher._id, status: 'published' })
    const draftLesson = await Lesson.create({ title: 'Draft', content: 'Draft', class: classA._id, course: courseA._id, createdBy: teacher._id, status: 'draft' })
    const lessonB = await Lesson.create({ title: 'Forces', content: 'Forces', class: classB._id, course: courseB._id, createdBy: teacher._id, status: 'published' })

    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const login = async (email, password) => {
      const response = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const studentCookie = await login(student.email, 'StudentPassword123')
    const outsiderCookie = await login(outsider.email, 'StudentPassword123')
    const teacherCookie = await login(teacher.email, 'TeacherPassword123')
    const as = (cookie) => (path, options = {}) => request(path, { ...options, headers: { cookie, ...(options.headers || {}) } })
    const studentApi = as(studentCookie)
    const outsiderApi = as(outsiderCookie)

    // Only students may use notes.
    assert.equal((await as(teacherCookie)('/student/notes')).status, 403)
    assert.equal((await request('/student/notes')).status, 401)

    // Create notes: lesson-linked (course is derived), course-only and general.
    const lessonNoteResponse = await studentApi('/student/notes', { method: 'POST', body: JSON.stringify({ title: 'Cell notes', lesson: String(lessonA._id), content: doc('Mitochondria produce ATP'), tags: ['Exam', '#Biology'], color: 'green' }) })
    assert.equal(lessonNoteResponse.status, 201)
    const lessonNote = (await lessonNoteResponse.json()).note
    assert.equal(lessonNote.course._id, String(courseA._id))
    assert.equal(lessonNote.lesson.title, 'Cells')
    assert.deepEqual(lessonNote.tags, ['exam', 'biology'])
    const courseNote = (await (await studentApi('/student/notes', { method: 'POST', body: JSON.stringify({ title: 'Course overview', course: String(courseA._id), content: doc('Syllabus') }) })).json()).note
    const generalNote = (await (await studentApi('/student/notes', { method: 'POST', body: JSON.stringify({ title: 'General', content: doc('Study plan') }) })).json()).note
    assert.equal(generalNote.course, null)
    assert.equal(generalNote.lesson, null)

    // Associations must be accessible to the student.
    assert.equal((await studentApi('/student/notes', { method: 'POST', body: JSON.stringify({ lesson: String(lessonB._id) }) })).status, 400)
    assert.equal((await studentApi('/student/notes', { method: 'POST', body: JSON.stringify({ lesson: String(draftLesson._id) }) })).status, 400)
    assert.equal((await studentApi('/student/notes', { method: 'POST', body: JSON.stringify({ course: String(courseB._id) }) })).status, 400)
    assert.equal((await studentApi('/student/notes', { method: 'POST', body: JSON.stringify({ course: String(courseB._id), lesson: String(lessonA._id) }) })).status, 400)
    assert.equal((await studentApi('/student/notes', { method: 'POST', body: JSON.stringify({ content: { type: 'doc', content: 'bad' }, color: 'neon' }) })).status, 400)

    // Long-form content well above the default 25 kb API body limit is accepted and stored intact.
    const longParagraphs = Array.from({ length: 400 }, (_, index) => `Paragraph ${index} ${'detailed academic explanation '.repeat(20)}`)
    const longResponse = await studentApi(`/student/notes/${generalNote._id}`, { method: 'PATCH', body: JSON.stringify({ version: generalNote.version, content: doc(...longParagraphs) }) })
    assert.equal(longResponse.status, 200)
    const longNote = (await longResponse.json()).note
    assert.equal(longNote.content.content.length, 400)
    assert.equal(longNote.version, 2)
    assert.equal(longNote.wordCount, 400 * 62)

    // Autosave with an outdated version is refused instead of overwriting newer content.
    const stale = await studentApi(`/student/notes/${generalNote._id}`, { method: 'PATCH', body: JSON.stringify({ version: 1, content: doc('old copy') }) })
    assert.equal(stale.status, 409)
    const staleBody = await stale.json()
    assert.equal(staleBody.code, 'NOTE_VERSION_CONFLICT')
    assert.equal(staleBody.note.version, 2)
    assert.equal((await Note.findById(generalNote._id).lean()).content.content.length, 400)

    // Moving a note to a general note and back to a lesson.
    const moved = await (await studentApi(`/student/notes/${courseNote._id}`, { method: 'PATCH', body: JSON.stringify({ version: courseNote.version, course: null, lesson: String(lessonA._id) }) })).json()
    assert.equal(moved.note.lesson._id, String(lessonA._id))
    assert.equal(moved.note.course._id, String(courseA._id))

    // Search and filters.
    const list = async (query = '') => (await (await studentApi(`/student/notes${query}`)).json()).notes
    assert.deepEqual((await list('?search=mitochondria')).map((note) => note.title), ['Cell notes'])
    assert.deepEqual((await list(`?lesson=${lessonA._id}&sort=created`)).map((note) => note.title), ['Course overview', 'Cell notes'])
    assert.deepEqual((await list('?course=none')).map((note) => note.title), ['General'])
    assert.deepEqual((await list('?tag=exam')).map((note) => note.title), ['Cell notes'])
    assert.equal((await list())[0].content, undefined, 'list responses stay lightweight')
    const facets = await (await studentApi('/student/notes/facets')).json()
    assert.equal(facets.total, 3)
    assert.equal(facets.courses[0].name, 'Biology')
    assert.equal(facets.lessons[0].title, 'Cells')

    // Drag-and-drop ordering is saved and survives reloads; filtered reorders keep other notes in place.
    const initialOrder = (await list()).map((note) => note._id)
    assert.deepEqual(initialOrder, [generalNote._id, courseNote._id, lessonNote._id])
    assert.equal((await studentApi('/student/notes/order', { method: 'PUT', body: JSON.stringify({ ids: [lessonNote._id, generalNote._id, courseNote._id] }) })).status, 200)
    assert.deepEqual((await list()).map((note) => note._id), [lessonNote._id, generalNote._id, courseNote._id])
    assert.equal((await studentApi('/student/notes/order', { method: 'PUT', body: JSON.stringify({ ids: [courseNote._id, lessonNote._id] }) })).status, 200)
    assert.deepEqual((await list()).map((note) => note._id), [courseNote._id, generalNote._id, lessonNote._id])

    // Another student cannot see, edit, reorder or delete these notes.
    assert.equal((await outsiderApi(`/student/notes/${lessonNote._id}`)).status, 404)
    assert.equal((await outsiderApi(`/student/notes/${lessonNote._id}`, { method: 'PATCH', body: JSON.stringify({ version: 1, title: 'hijack' }) })).status, 404)
    assert.equal((await outsiderApi(`/student/notes/${lessonNote._id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await outsiderApi('/student/notes/order', { method: 'PUT', body: JSON.stringify({ ids: [lessonNote._id] }) })).status, 404)
    assert.equal((await (await outsiderApi('/student/notes')).json()).notes.length, 0)
    assert.equal((await Note.findById(lessonNote._id).lean()).title, 'Cell notes')

    // Delete.
    assert.equal((await studentApi(`/student/notes/${lessonNote._id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await studentApi(`/student/notes/${lessonNote._id}`)).status, 404)
    assert.equal((await list()).length, 2)
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
