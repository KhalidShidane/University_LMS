import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import User from '../models/User.js'
import Assignment from '../models/Assignment.js'
import Submission from '../models/Submission.js'
import Quiz from '../models/Quiz.js'
import QuizAttempt from '../models/QuizAttempt.js'
import Lesson from '../models/Lesson.js'
import { hashPassword } from '../services/password.service.js'

test('analytics use real records and enforce class and student privacy', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated analytics integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_analytics_test_${process.pid}_${Date.now()}`
  const previousSecret = process.env.JWT_SECRET
  process.env.JWT_SECRET = 'phase-9-isolated-test-secret-do-not-use-in-production'
  const server = app.listen(0)
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([Faculty.init(), Department.init(), Class.init(), User.init(), Assignment.init(), Submission.init(), Quiz.init(), QuizAttempt.init(), Lesson.init()])
    const suffix = `${process.pid % 10000}${Date.now().toString().slice(-6)}`
    const facultyA = await Faculty.create({ name: 'Analytics Faculty A', code: `FA${suffix}` })
    const facultyB = await Faculty.create({ name: 'Analytics Faculty B', code: `FB${suffix}` })
    const departmentA = await Department.create({ name: 'Analytics Department A', code: `DA${suffix}`, faculty: facultyA._id })
    const departmentB = await Department.create({ name: 'Analytics Department B', code: `DB${suffix}`, faculty: facultyB._id })
    const classA = await Class.create({ name: 'Analytics Class A', classCode: `CA${suffix}`, department: departmentA._id })
    const classB = await Class.create({ name: 'Analytics Class B', classCode: `CB${suffix}`, department: departmentB._id })
    const passwordHash = await hashPassword('AnalyticsPassword123')
    const admin = await User.create({ fullName: 'Analytics Admin', email: `analytics_admin${suffix}@example.edu`, passwordHash, role: 'admin' })
    const teacher = await User.create({ fullName: 'Analytics Teacher', email: `analytics_teacher${suffix}@example.edu`, passwordHash, role: 'teacher', department: departmentA._id, assignedClasses: [classA._id] })
    const studentA = await User.create({ fullName: 'Analytics Student A', email: `analytics_student_a${suffix}@example.edu`, passwordHash, role: 'student', studentId: `AS${suffix}A`, department: departmentA._id, class: classA._id })
    const studentB = await User.create({ fullName: 'Analytics Student B', email: `analytics_student_b${suffix}@example.edu`, passwordHash, role: 'student', studentId: `AS${suffix}B`, department: departmentA._id, class: classA._id })
    const outsider = await User.create({ fullName: 'Analytics Outsider', email: `analytics_outsider${suffix}@example.edu`, passwordHash, role: 'student', studentId: `AS${suffix}O`, department: departmentB._id, class: classB._id })
    const assignment = await Assignment.create({ title: 'Graded analytics assignment', description: 'Unit work', class: classA._id, createdBy: teacher._id, dueDate: new Date(Date.now() + 86_400_000), totalMarks: 10, status: 'published' })
    const pending = await Assignment.create({ title: 'Pending analytics assignment', description: 'Pending work', class: classA._id, createdBy: teacher._id, dueDate: new Date(Date.now() + 86_400_000), totalMarks: 10, status: 'published' })
    const missing = await Assignment.create({ title: 'Missing analytics assignment', description: 'Missing work', class: classA._id, createdBy: teacher._id, dueDate: new Date(Date.now() + 86_400_000), totalMarks: 10, status: 'published' })
    await Submission.create({ assignment: assignment._id, student: studentA._id, originalName: 'a.pdf', storedName: `analytics-${suffix}-a.pdf`, mimeType: 'application/pdf', size: 10, status: 'graded', marksAwarded: 8, submittedAt: new Date(), gradedAt: new Date(), gradedBy: teacher._id })
    await Submission.create({ assignment: pending._id, student: studentA._id, originalName: 'b.pdf', storedName: `analytics-${suffix}-b.pdf`, mimeType: 'application/pdf', size: 10, status: 'submitted', submittedAt: new Date() })
    const quiz = await Quiz.create({ title: 'Analytics quiz', class: classA._id, createdBy: teacher._id, questions: [{ questionType: 'short_answer', prompt: 'Explain the concept', points: 10 }], durationMinutes: 10, status: 'published', showResults: true })
    await QuizAttempt.create({ quiz: quiz._id, student: studentA._id, startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000), submittedAt: new Date(), score: 7, maxScore: 10, status: 'graded', gradedAt: new Date() })
    const weeklyLesson = await Lesson.create({ title: 'Weekly analytics lesson', class: classA._id, createdBy: teacher._id, content: 'Weekly lesson content', status: 'published' })
    await Lesson.create({ title: 'Private other-class lesson', class: classB._id, createdBy: teacher._id, content: 'Other class content', status: 'published' })

    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const login = async (email) => {
      const response = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'AnalyticsPassword123' }) })
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const adminCookie = await login(admin.email)
    const teacherCookie = await login(teacher.email)
    const studentCookie = await login(studentA.email)
    const asAdmin = (path, options = {}) => request(path, { ...options, headers: { cookie: adminCookie, ...(options.headers || {}) } })
    const asTeacher = (path, options = {}) => request(path, { ...options, headers: { cookie: teacherCookie, ...(options.headers || {}) } })
    const asStudent = (path, options = {}) => request(path, { ...options, headers: { cookie: studentCookie, ...(options.headers || {}) } })

    const overviewResponse = await asAdmin('/admin/analytics/overview')
    assert.equal(overviewResponse.status, 200)
    const overview = await overviewResponse.json()
    assert.equal(overview.metrics.students, 3)
    assert.equal(overview.metrics.faculties, 2)
    assert.equal(overview.metrics.departments, 2)
    assert.equal(overview.metrics.classes, 2)
    assert.equal(overview.studentsByFaculty.length >= 2, true)
    assert.equal(overview.studentsByDepartment.length >= 2, true)

    const teacherClass = await asTeacher(`/teacher/analytics/classes/${classA._id}`)
    assert.equal(teacherClass.status, 200)
    const classReport = await teacherClass.json()
    assert.equal(classReport.class.studentCount, 2)
    assert.equal((await asTeacher(`/teacher/analytics/classes/${classB._id}`)).status, 403)
    assert.equal((await asTeacher(`/teacher/analytics/students/${outsider._id}`)).status, 404)

    const ownReportResponse = await asStudent('/student/analytics/performance')
    assert.equal(ownReportResponse.status, 200)
    const ownReport = await ownReportResponse.json()
    assert.equal(String(ownReport.student.id), String(studentA._id))
    assert.equal(ownReport.summary.assignmentAverage, 80)
    assert.equal(ownReport.summary.missingAssignments, 1)
    assert.equal(ownReport.summary.pendingAssignments, 1)
    assert.equal(ownReport.summary.overallPerformance, 75)
    assert.equal(JSON.stringify(ownReport).includes(outsider.email), false)

    const weeklyResponse = await asStudent('/student/weekly-learning')
    assert.equal(weeklyResponse.status, 200)
    const weekly = await weeklyResponse.json()
    assert.equal(weekly.items.some((item) => item.type === 'lesson' && String(item.id) === String(weeklyLesson._id)), true)
    assert.equal(weekly.items.some((item) => item.type === 'assignment' && String(item.id) === String(assignment._id)), true)
    assert.equal(weekly.items.some((item) => item.type === 'quiz' && String(item.id) === String(quiz._id)), true)
    assert.equal(weekly.items.some((item) => item.title === 'Private other-class lesson'), false)

    const csv = await asStudent('/reports/export/csv')
    const pdf = await asStudent('/reports/export/pdf')
    const excel = await asStudent('/reports/export/excel')
    assert.match(csv.headers.get('content-type'), /text\/csv/)
    assert.match(pdf.headers.get('content-type'), /application\/pdf/)
    assert.match(excel.headers.get('content-type'), /spreadsheetml\.sheet/)
    assert.equal((await excel.arrayBuffer()).byteLength > 100, true)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase() }
    await disconnectDatabase()
    if (previousSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previousSecret
  }
})
