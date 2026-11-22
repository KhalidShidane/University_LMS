import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import JSZip from 'jszip'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import Course from '../models/Course.js'
import Lesson from '../models/Lesson.js'
import Assignment from '../models/Assignment.js'
import Quiz from '../models/Quiz.js'
import QuizAttempt from '../models/QuizAttempt.js'
import Submission from '../models/Submission.js'
import Note from '../models/Note.js'
import { hashPassword } from '../services/password.service.js'
import { deleteLessonFile, storeLessonFile } from '../services/lessonStorage.service.js'

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const cellText = (xml, ref) => {
  const match = xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(.*?)</c>)`))
  if (!match?.[1]) return ''
  return match[1].match(/<v>(.*?)<\/v>/)?.[1] ?? match[1].match(/<t[^>]*>(.*?)<\/t>/)?.[1] ?? ''
}

test('teacher gradebook Excel export, student course ZIP and note downloads, per-user theme', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated teacher/student tools integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_tools_test_${process.pid}_${Date.now()}`
  const previous = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET }
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'tools-isolated-test-secret-0123456789abcdef' })
  const server = app.listen(0)
  const stored = []
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), Course.init(), Faculty.init(), Department.init(), Class.init()])
    const password = await hashPassword('Password12345')
    const faculty = await Faculty.create({ name: 'Tools Faculty', code: 'TF' })
    const department = await Department.create({ name: 'Tools Department', code: 'TD', faculty: faculty._id })
    const classA = await Class.create({ name: 'Software Eng 3', classCode: 'BSE3', department: department._id })
    const classB = await Class.create({ name: 'Other Class', classCode: 'OTH', department: department._id })
    const teacher = await User.create({ fullName: 'Teacher Tom', email: 'teacher@example.edu', passwordHash: password, role: 'teacher', department: department._id, assignedClasses: [classA._id], emailVerified: true })
    const otherTeacher = await User.create({ fullName: 'Other Teacher', email: 'other@example.edu', passwordHash: password, role: 'teacher', department: department._id, assignedClasses: [classA._id, classB._id], emailVerified: true })
    const student = (name, id, extra = {}) => User.create({ fullName: name, email: `${id.toLowerCase()}@example.edu`, passwordHash: password, role: 'student', studentId: id, department: department._id, class: classA._id, emailVerified: true, ...extra })
    const amina = await student('Amina Ali', 'S1')
    const bilal = await student('Bilal Omar', 'S2')
    await student('Cali Inactive', 'S3', { isActive: false })
    const outsider = await student('Outside Student', 'S4', { class: classB._id })

    const due = new Date(Date.now() - 24 * 3600 * 1000)
    const a1 = await Assignment.create({ title: 'Essay', class: classA._id, createdBy: teacher._id, dueDate: due, totalMarks: 20, status: 'published' })
    const a2 = await Assignment.create({ title: 'Lab report', class: classA._id, createdBy: teacher._id, dueDate: new Date(Date.now() + 86400000), totalMarks: 10, status: 'published' })
    await Assignment.create({ title: 'Draft task', class: classA._id, createdBy: teacher._id, dueDate: due, status: 'draft' })
    await Assignment.create({ title: 'Someone else', class: classA._id, createdBy: otherTeacher._id, dueDate: due, status: 'published' })
    const quizQuestions = [{ questionType: 'true_false', questionText: 'Yes?', correctAnswer: true, points: 5 }]
    const q1 = await Quiz.create({ title: 'Quiz one', class: classA._id, createdBy: teacher._id, questions: quizQuestions, durationMinutes: 10, availableFrom: new Date(Date.now() - 86400000 * 3), dueDate: due, status: 'published' })
    const submission = (assignment, studentId, marks) => Submission.collection.insertOne({ assignment: assignment._id, student: studentId, originalName: 'x.pdf', storedName: `${new mongoose.Types.ObjectId()}.pdf`, mimeType: 'application/pdf', size: 10, submittedAt: new Date(), marksAwarded: marks, status: marks == null ? 'submitted' : 'graded' })
    await submission(a1, amina._id, 17)
    await submission(a2, amina._id, null) // submitted, not graded yet
    await QuizAttempt.collection.insertMany([
      { quiz: q1._id, student: amina._id, status: 'graded', score: 3, maxScore: 5, submittedAt: new Date() },
      { quiz: q1._id, student: amina._id, status: 'graded', score: 5, maxScore: 5, submittedAt: new Date() }, // best attempt counts
    ])

    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const login = async (email) => (await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Password12345' }) })).headers.get('set-cookie').split(';')[0]
    const teacherCookie = await login(teacher.email)
    const aminaCookie = await login(amina.email)
    const outsiderCookie = await login(outsider.email)
    const get = (path, cookie) => request(path, { headers: { cookie } })

    // ---- 1. Gradebook export: quizzes and assignments are separate; all items or one; marks or not-submitted.
    const sheetOf = async (response) => {
      const book = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
      const names = [...(await book.file('xl/workbook.xml').async('string')).matchAll(/name="([^"]+)"/g)].map((match) => match[1])
      return { names, xml: await book.file('xl/worksheets/sheet1.xml').async('string') }
    }
    const exportUrl = (params) => `/teacher/gradebook/${classA._id}/export?${new URLSearchParams(params)}`
    assert.equal((await get(`/teacher/gradebook/${classB._id}/export?type=assignments`, teacherCookie)).status, 403, 'only the teacher’s own classes')
    assert.equal((await get(exportUrl({ type: 'assignments' }), aminaCookie)).status, 403, 'students cannot export')
    assert.equal((await get(exportUrl({ type: 'all' }), teacherCookie)).status, 400, 'quizzes and assignments are never mixed')

    // Picker lists only the teacher's own published items, numbered in order.
    const assignmentItems = (await (await get(`/teacher/gradebook/${classA._id}/items?type=assignments`, teacherCookie)).json()).items
    assert.deepEqual(assignmentItems.map((item) => `${item.code}: ${item.title}`), ['A1: Essay', 'A2: Lab report'])
    const quizItems = (await (await get(`/teacher/gradebook/${classA._id}/items?type=quizzes`, teacherCookie)).json()).items
    assert.deepEqual(quizItems.map((item) => item.code), ['Q1'])

    // All assignments, marks: one sheet, one column per assignment, no quizzes.
    const allAssignments = await get(exportUrl({ type: 'assignments', report: 'marks' }), teacherCookie)
    assert.equal(allAssignments.status, 200)
    assert.match(allAssignments.headers.get('content-disposition'), /bse3-all-assignments-marks-\d{4}-\d{2}-\d{2}\.xlsx/)
    const assignmentBook = await sheetOf(allAssignments)
    assert.deepEqual(assignmentBook.names, ['Marks'], 'a single sheet, no extra sheets')
    const marks = assignmentBook.xml
    assert.equal(cellText(marks, 'E1'), 'A1: Essay (/20)')
    assert.equal(cellText(marks, 'F1'), 'A2: Lab report (/10)')
    assert.equal(cellText(marks, 'G1'), 'Submitted')
    assert.equal(cellText(marks, 'H1'), 'Not submitted')
    assert.equal(marks.includes('Quiz one'), false, 'no quizzes in the assignments file')
    assert.equal(cellText(marks, 'C2'), 'Amina Ali')
    assert.equal(cellText(marks, 'D2'), 'BSE3 Software Eng 3')
    assert.equal(cellText(marks, 'E2'), '17')
    assert.equal(cellText(marks, 'F2'), 'Pending grading')
    assert.equal(cellText(marks, 'C3'), 'Bilal Omar')
    assert.equal(cellText(marks, 'E3'), 'Not submitted')
    assert.equal(cellText(marks, 'H3'), '2')
    assert.equal(cellText(marks, 'C4'), '', 'inactive student not listed')
    assert.match(marks, /<pane xSplit="3" ySplit="1"/, 'header and names frozen')

    // A single quiz, marks: best attempt counts; a status column explains each row.
    const oneQuiz = await sheetOf(await get(exportUrl({ type: 'quizzes', itemId: String(q1._id), report: 'marks' }), teacherCookie))
    assert.equal(cellText(oneQuiz.xml, 'E1'), 'Q1: Quiz one (/5)')
    assert.equal(cellText(oneQuiz.xml, 'F1'), 'Status')
    assert.equal(cellText(oneQuiz.xml, 'E2'), '5', 'best quiz attempt')
    assert.equal(cellText(oneQuiz.xml, 'F2'), 'Graded')
    assert.equal(cellText(oneQuiz.xml, 'E3'), 'Not submitted')
    assert.equal(oneQuiz.xml.includes('Essay'), false)

    // A single assignment, not submitted: only students who did not submit that assignment.
    const missingResponse = await get(exportUrl({ type: 'assignments', itemId: String(a1._id), report: 'missing' }), teacherCookie)
    assert.match(missingResponse.headers.get('content-disposition'), /bse3-assignment-essay-not-submitted-/)
    const missingOne = await sheetOf(missingResponse)
    assert.deepEqual(missingOne.names, ['Not submitted'])
    assert.equal(cellText(missingOne.xml, 'C2'), 'Bilal Omar')
    assert.equal(cellText(missingOne.xml, 'E2'), 'A1: Essay')
    assert.equal(cellText(missingOne.xml, 'G2'), 'Not submitted (deadline passed)')
    assert.equal(cellText(missingOne.xml, 'C3'), '', 'Amina submitted, so she is not listed')
    // All assignments, not submitted: one row per missing student and assignment.
    const missingAll = await sheetOf(await get(exportUrl({ type: 'assignments', report: 'missing' }), teacherCookie))
    assert.equal((missingAll.xml.match(/Bilal Omar/g) || []).length, 2)
    assert.equal(missingAll.xml.includes('Amina Ali'), false)
    assert.equal((await get(exportUrl({ type: 'quizzes', itemId: String(a1._id) }), teacherCookie)).status, 404, 'an assignment id is not a quiz')

    // ---- 2. Course materials ZIP.
    const course = await Course.create({ name: 'Databases', courseCode: 'DB101', class: classA._id, department: department._id, teacher: teacher._id, teachingAssignments: [{ teacher: teacher._id, class: classA._id, department: department._id }] })
    const file = async (name) => { const storedName = await storeLessonFile({ buffer: PDF, originalname: name, mimetype: 'application/pdf' }, '.pdf'); stored.push(storedName); return { originalName: name, storedName, mimeType: 'application/pdf', size: PDF.length } }
    await Lesson.create({ title: 'Intro: SQL basics', class: classA._id, course: course._id, createdBy: teacher._id, status: 'published', order: 1, materials: [await file('slides.pdf'), await file('slides.pdf')] })
    await Lesson.create({ title: 'Joins', class: classA._id, course: course._id, createdBy: teacher._id, status: 'published', order: 2, materials: [await file('joins.pdf')] })
    await Lesson.create({ title: 'Hidden draft', class: classA._id, course: course._id, createdBy: teacher._id, status: 'draft', order: 3, materials: [await file('secret.pdf')] })
    assert.equal((await get(`/student/courses/${course._id}/materials/download`, outsiderCookie)).status, 404, 'other classes cannot download')
    const zipResponse = await get(`/student/courses/${course._id}/materials/download`, aminaCookie)
    assert.equal(zipResponse.status, 200)
    assert.match(zipResponse.headers.get('content-type'), /application\/zip/)
    const zip = await JSZip.loadAsync(Buffer.from(await zipResponse.arrayBuffer()))
    assert.deepEqual(Object.keys(zip.files).filter((name) => !name.endsWith('/')).sort(), [
      'DB101 - Databases/01 - Intro SQL basics/slides (2).pdf',
      'DB101 - Databases/01 - Intro SQL basics/slides.pdf',
      'DB101 - Databases/02 - Joins/joins.pdf',
    ], 'folder per lesson, safe names, duplicates renamed, drafts excluded')
    assert.equal((await zip.file('DB101 - Databases/02 - Joins/joins.pdf').async('nodebuffer')).equals(PDF), true)
    const emptyCourse = await Course.create({ name: 'Empty', courseCode: 'EMP1', class: classA._id, department: department._id, teacher: teacher._id, teachingAssignments: [{ teacher: teacher._id, class: classA._id, department: department._id }] })
    assert.equal((await get(`/student/courses/${emptyCourse._id}/materials/download`, aminaCookie)).status, 404)

    // ---- 3. Notes: single and all.
    assert.equal((await get('/student/notes/export/all', aminaCookie)).status, 404, 'no notes yet')
    const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Key ideas' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'SELECT ', marks: [{ type: 'bold' }] }, { type: 'text', text: '<script>alert(1)</script>' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Point one' }] }] }] }] }
    const note1 = await Note.create({ student: amina._id, title: 'SQL: summary', content: doc, contentText: 'Key ideas', course: course._id })
    await Note.create({ student: amina._id, title: 'SQL: summary', content: doc, contentText: 'Key ideas', course: course._id })
    await Note.create({ student: amina._id, title: 'Personal', content: doc, contentText: 'x' })
    const otherNote = await Note.create({ student: bilal._id, title: 'Not yours', content: doc, contentText: 'x' })
    const single = await get(`/student/notes/${note1._id}/download`, aminaCookie)
    assert.equal(single.status, 200)
    assert.match(single.headers.get('content-disposition'), /SQL summary\.html/)
    const html = await single.text()
    assert.match(html, /<h2>Key ideas<\/h2>/)
    assert.match(html, /<strong>SELECT <\/strong>/)
    assert.match(html, /<li><p>Point one<\/p><\/li>/)
    assert.match(html, /Course: Databases \(DB101\)/)
    assert.equal(html.includes('<script>alert'), false, 'note text is escaped')
    assert.equal((await get(`/student/notes/${otherNote._id}/download`, aminaCookie)).status, 404, 'cannot download another student’s note')
    const notesZip = await JSZip.loadAsync(Buffer.from(await (await get('/student/notes/export/all', aminaCookie)).arrayBuffer()))
    assert.deepEqual(Object.keys(notesZip.files).filter((name) => !name.endsWith('/')).sort(), [
      'My notes/DB101 - Databases/SQL summary (2).html',
      'My notes/DB101 - Databases/SQL summary.html',
      'My notes/General notes/Personal.html',
    ])

    // ---- 4. Per-user theme.
    const meBefore = await (await get('/auth/me', aminaCookie)).json()
    assert.equal(meBefore.user.theme, 'light')
    assert.equal((await request('/profile/ui-preferences', { method: 'PUT', headers: { cookie: aminaCookie }, body: JSON.stringify({ theme: 'dark' }) })).status, 200)
    assert.equal((await request('/profile/ui-preferences', { method: 'PUT', headers: { cookie: aminaCookie }, body: JSON.stringify({ theme: 'purple' }) })).status, 400)
    assert.equal((await (await get('/auth/me', aminaCookie)).json()).user.theme, 'dark')
    assert.equal((await (await get('/auth/me', teacherCookie)).json()).user.theme, 'light', 'other users are not affected')
  } finally {
    await Promise.all(stored.map((name) => deleteLessonFile(name).catch(() => {})))
    await new Promise((resolve) => server.close(resolve))
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await disconnectDatabase()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
