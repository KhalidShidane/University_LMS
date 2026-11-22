import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import Notification from '../models/Notification.js'
import Conversation from '../models/Conversation.js'
import Message from '../models/Message.js'
import Submission from '../models/Submission.js'
import QuizAttempt from '../models/QuizAttempt.js'
import { hashPassword } from '../services/password.service.js'
import { submissionFilePath, removeStoredFile } from '../services/assignmentFiles.service.js'
import { createNotification } from '../services/notifications.service.js'
import { sendUpcomingAssignmentReminders } from '../services/assignmentDeadlineNotifications.service.js'

test('notifications persist and deliver privately while authorized classmates can message', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated communications integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_communications_test_${process.pid}_${Date.now()}`
  const previousSecret = process.env.JWT_SECRET
  const previousNodeEnv = process.env.NODE_ENV
  process.env.JWT_SECRET = 'phase-8-isolated-test-secret-do-not-use-in-production'
  process.env.NODE_ENV = 'test'
  const server = app.listen(0)
  const streamController = new AbortController()
  let streamReader
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), Faculty.init(), Department.init(), Class.init(), Notification.init(), Conversation.init(), Message.init()])
    const suffix = `${process.pid % 10000}${Date.now().toString().slice(-6)}`
    const faculty = await Faculty.create({ name: 'Communications Faculty', code: `CF${suffix}` })
    const department = await Department.create({ name: 'Communications Department', code: `CD${suffix}`, faculty: faculty._id })
    const classOne = await Class.create({ name: 'Communications Class', classCode: `CC${suffix}`, department: department._id })
    const classTwo = await Class.create({ name: 'Other Communications Class', classCode: `OC${suffix}`, department: department._id })
    const teacher = await User.create({ fullName: 'Class Teacher', email: `class_teacher${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [classOne._id] })
    const otherTeacher = await User.create({ fullName: 'Other Teacher', email: `other_class_teacher${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [classTwo._id] })
    const student = await User.create({ fullName: 'Class Student', email: `class_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `CS${suffix}`, department: department._id, class: classOne._id })
    const outsider = await User.create({ fullName: 'Other Student', email: `other_class_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `OS${suffix}`, department: department._id, class: classTwo._id })
    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const login = async (email, password) => {
      const response = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const teacherCookie = await login(teacher.email, 'TeacherPassword123')
    const studentCookie = await login(student.email, 'StudentPassword123')
    const otherTeacherCookie = await login(otherTeacher.email, 'TeacherPassword123')
    const outsiderCookie = await login(outsider.email, 'StudentPassword123')
    const asTeacher = (path, options = {}) => request(path, { ...options, headers: { cookie: teacherCookie, ...(options.headers || {}) } })
    const asStudent = (path, options = {}) => request(path, { ...options, headers: { cookie: studentCookie, ...(options.headers || {}) } })

    const stream = await fetch(`${base}/notifications/stream`, { headers: { cookie: studentCookie }, signal: streamController.signal })
    assert.equal(stream.status, 200)
    assert.match(stream.headers.get('content-type'), /text\/event-stream/)
    streamReader = stream.body.getReader()
    await streamReader.read()
    await createNotification({ recipientId: student._id, type: 'system_announcement', title: 'Realtime check', message: 'Private stream connected.', relatedEntityType: 'system', dedupeKey: `sse-test:${student._id}` })
    const sseEvent = await Promise.race([streamReader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('SSE notification event timed out')), 2500))])
    assert.match(new TextDecoder().decode(sseEvent.value), /event: notification/)

    const lesson = await asTeacher('/lessons/teacher', { method: 'POST', body: JSON.stringify({ title: 'Published cell lesson', subject: 'Biology', summary: '', content: 'Cells.', class: classOne._id, status: 'published' }) })
    assert.equal(lesson.status, 201)
    const lessonId = (await lesson.json()).lesson._id
    let studentNotifications = (await (await asStudent('/notifications')).json()).notifications
    assert.ok(studentNotifications.some((item) => item.type === 'new_lesson' && String(item.relatedEntityId) === lessonId))

    const assignmentResponse = await asTeacher('/teacher/assignments', { method: 'POST', body: JSON.stringify({ title: 'Cell assignment', description: 'Review cells', instructions: 'Upload a PDF', classId: classOne._id, totalMarks: 10, dueDate: new Date(Date.now() + 3_600_000).toISOString(), status: 'published' }) })
    assert.equal(assignmentResponse.status, 201)
    const assignment = (await assignmentResponse.json()).assignment
    await sendUpcomingAssignmentReminders(new Date())
    await sendUpcomingAssignmentReminders(new Date())
    studentNotifications = (await (await asStudent('/notifications')).json()).notifications
    assert.ok(studentNotifications.some((item) => item.type === 'new_assignment' && String(item.relatedEntityId) === String(assignment._id)))
    assert.equal(studentNotifications.filter((item) => item.type === 'assignment_deadline').length, 1)

    const pdf = new FormData()
    pdf.append('file', new Blob([Buffer.from('%PDF-1.7\nphase 8')], { type: 'application/pdf' }), 'work.pdf')
    const submittedResponse = await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdf })
    assert.equal(submittedResponse.status, 201)
    const submissionId = (await submittedResponse.json()).submission.id
    let teacherNotifications = (await (await asTeacher('/notifications')).json()).notifications
    assert.ok(teacherNotifications.some((item) => item.type === 'assignment_submitted'))
    const replacementPdf = new FormData()
    replacementPdf.append('file', new Blob([Buffer.from('%PDF-1.7\nphase 8 replacement')], { type: 'application/pdf' }), 'revised-work.pdf')
    assert.equal((await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: replacementPdf })).status, 201)
    teacherNotifications = (await (await asTeacher('/notifications')).json()).notifications
    assert.equal(teacherNotifications.filter((item) => item.type === 'assignment_submitted').length, 2)
    const grade = await asTeacher(`/teacher/submissions/${submissionId}/grade`, { method: 'PATCH', body: JSON.stringify({ marksAwarded: 8, feedback: 'Good work.' }) })
    assert.equal(grade.status, 200, JSON.stringify(await grade.clone().json()))
    studentNotifications = (await (await asStudent('/notifications')).json()).notifications
    assert.ok(studentNotifications.some((item) => item.type === 'assignment_graded'))

    const quizResponse = await asTeacher('/teacher/quizzes', { method: 'POST', body: JSON.stringify({ title: 'Written quiz', description: 'Cell knowledge', instructions: 'Answer both', classId: classOne._id, durationMinutes: 5, startDate: new Date(Date.now() - 30_000).toISOString(), endDate: new Date(Date.now() + 3_600_000).toISOString(), status: 'published', questions: [{ questionType: 'short_answer', questionText: 'Describe a cell.', marks: 4 }] }) })
    assert.equal(quizResponse.status, 201)
    const quiz = (await quizResponse.json()).quiz
    studentNotifications = (await (await asStudent('/notifications')).json()).notifications
    assert.ok(studentNotifications.some((item) => item.type === 'new_quiz'))
    const attemptResponse = await asStudent(`/student/quizzes/${quiz._id}/start`, { method: 'POST' })
    assert.equal(attemptResponse.status, 201)
    const attempt = (await attemptResponse.json()).attempt
    const savedAnswers = await asStudent(`/student/attempts/${attempt.id}/answers`, { method: 'PUT', body: JSON.stringify({ answers: [{ questionId: quiz.questions[0].id, textAnswer: 'A cell is the basic unit of life.' }] }) })
    assert.equal(savedAnswers.status, 200)
    assert.equal((await asStudent(`/student/attempts/${attempt.id}/submit`, { method: 'POST' })).status, 200)
    teacherNotifications = (await (await asTeacher('/notifications')).json()).notifications
    assert.ok(teacherNotifications.some((item) => item.type === 'quiz_completed'))
    assert.equal((await asTeacher(`/teacher/quizzes/${quiz._id}/results`, { method: 'PATCH', body: JSON.stringify({ showResults: true }) })).status, 200)
    studentNotifications = (await (await asStudent('/notifications')).json()).notifications
    assert.ok(studentNotifications.some((item) => item.type === 'quiz_results_released'))

    const contacts = await (await asStudent('/conversations/contacts')).json()
    assert.deepEqual(contacts.contacts.map((item) => String(item._id)), [String(teacher._id)])
    const teacherContacts = await (await asTeacher('/conversations/contacts')).json()
    assert.deepEqual(teacherContacts.contacts.map((item) => String(item._id)), [String(student._id)])
    assert.equal((await asStudent('/conversations', { method: 'POST', body: JSON.stringify({ targetUserId: otherTeacher._id }) })).status, 404)
    const createdConversation = await asStudent('/conversations', { method: 'POST', body: JSON.stringify({ targetUserId: teacher._id }) })
    assert.equal(createdConversation.status, 201)
    const conversation = (await createdConversation.json()).conversation
    const sentMessage = await asStudent(`/conversations/${conversation._id}/messages`, { method: 'POST', body: JSON.stringify({ messageText: 'Hello teacher, I have a question.' }) })
    assert.equal(sentMessage.status, 201)
    assert.equal((await request(`/conversations/${conversation._id}/messages`, { headers: { cookie: outsiderCookie } })).status, 404)
    const conversationList = await (await asTeacher('/conversations')).json()
    assert.equal(conversationList.conversations[0].unreadCount, 1)
    assert.equal((await asTeacher(`/conversations/${conversation._id}/read`, { method: 'PATCH' })).status, 200)
    assert.equal((await Message.find({ conversationId: conversation._id })).length, 1)
    const teacherReply = await asTeacher(`/conversations/${conversation._id}/messages`, { method: 'POST', body: JSON.stringify({ messageText: 'I can help with your question.' }) })
    assert.equal(teacherReply.status, 201)
    assert.equal(await Message.countDocuments({ conversationId: conversation._id }), 2)
    teacherNotifications = (await (await asTeacher('/notifications')).json()).notifications
    assert.ok(teacherNotifications.some((item) => item.type === 'new_message'))

    const privateList = await (await request('/notifications', { headers: { cookie: outsiderCookie } })).json()
    assert.equal(privateList.notifications.some((item) => String(item.senderId) === String(student._id)), false)
    const ownNotification = studentNotifications.find((item) => item.type === 'assignment_graded')
    assert.equal((await asTeacher(`/notifications/${ownNotification._id}/read`, { method: 'PATCH' })).status, 404)
    assert.equal((await asStudent(`/notifications/${ownNotification._id}/read`, { method: 'PATCH' })).status, 200)
    assert.equal((await asStudent('/notifications/unread-count')).status, 200)
    const unreadAfterRead = await (await asStudent('/notifications?unread=true')).json()
    assert.equal(unreadAfterRead.notifications.some((item) => String(item._id) === String(ownNotification._id)), false)
    assert.equal((await asStudent(`/notifications/${ownNotification._id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await asStudent('/notifications/read-all', { method: 'PATCH' })).status, 200)
    assert.equal((await (await asStudent('/notifications/unread-count')).json()).unreadCount, 0)

    const logout = await asStudent('/auth/logout', { method: 'POST' })
    assert.equal(logout.status, 200)
    const reloggedStudentCookie = await login(student.email, 'StudentPassword123')
    const persisted = await request('/notifications', { headers: { cookie: reloggedStudentCookie } })
    assert.ok((await persisted.json()).notifications.some((item) => item.type === 'new_lesson'))

    assert.equal((await request('/notifications', { headers: { cookie: teacherCookie } })).status, 200)
  } finally {
    streamController.abort()
    await streamReader?.cancel().catch(() => {})
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (mongoose.connection.readyState === 1) {
      const [submissions] = await Promise.all([Submission.find({}).select('storedName fileHistory').lean()])
      await Promise.all(submissions.flatMap((item) => [item.storedName, ...(item.fileHistory || []).map((file) => file.storedName)]).map((name) => removeStoredFile(submissionFilePath(name))))
      await mongoose.connection.dropDatabase()
    }
    await disconnectDatabase()
    if (previousSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previousSecret
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
})
