import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import Assignment from '../models/Assignment.js'
import Submission from '../models/Submission.js'
import { hashPassword } from '../services/password.service.js'
import { assignmentFilePath, removeStoredFile, submissionFilePath } from '../services/assignmentFiles.service.js'

test('assignments enforce class ownership, deadlines, private PDF submissions, and grading permissions', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated assignment integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_assignments_test_${process.pid}_${Date.now()}`
  const previousSecret = process.env.JWT_SECRET
  const previousNodeEnv = process.env.NODE_ENV
  process.env.JWT_SECRET = 'phase-6-isolated-test-secret-do-not-use-in-production'
  process.env.NODE_ENV = 'test'
  const server = app.listen(0)
  let testAssignmentIds = []

  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), Faculty.init(), Department.init(), Class.init(), Assignment.init(), Submission.init()])
    const suffix = `${process.pid % 10000}${Date.now().toString().slice(-6)}`
    const faculty = await Faculty.create({ name: 'Assignment Test Faculty', code: `AF${suffix}` })
    const department = await Department.create({ name: 'Assignment Test Department', code: `AD${suffix}`, faculty: faculty._id })
    const classOne = await Class.create({ name: 'Assignment Class One', classCode: `A1${suffix}`, department: department._id })
    const classTwo = await Class.create({ name: 'Assignment Class Two', classCode: `A2${suffix}`, department: department._id })
    const teacher = await User.create({ fullName: 'Assignment Teacher', email: `assignment_teacher${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [classOne._id] })
    const otherTeacher = await User.create({ fullName: 'Other Assignment Teacher', email: `other_assignment_teacher${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [classTwo._id] })
    const student = await User.create({ fullName: 'Assignment Student', email: `assignment_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `AS${suffix}`, department: department._id, class: classOne._id })
    const missingStudent = await User.create({ fullName: 'Missing Work Student', email: `missing_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `MS${suffix}`, department: department._id, class: classOne._id })
    const outsider = await User.create({ fullName: 'Other Class Student', email: `other_class_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `OS${suffix}`, department: department._id, class: classTwo._id })
    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const login = async (email, password) => {
      const response = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const teacherCookie = await login(teacher.email, 'TeacherPassword123')
    const otherTeacherCookie = await login(otherTeacher.email, 'TeacherPassword123')
    const studentCookie = await login(student.email, 'StudentPassword123')
    const outsiderCookie = await login(outsider.email, 'StudentPassword123')
    const create = (cookie, classId, overrides = {}) => request('/teacher/assignments', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Cell Biology Assignment', description: 'Practice cell structure.', instructions: 'Answer each question and upload your response.', classId, totalMarks: 20, dueDate: new Date(Date.now() + 120_000).toISOString(), status: 'published', ...overrides }) })
    const teacherRequest = (path, options = {}) => request(path, { ...options, headers: { cookie: teacherCookie, ...(options.headers || {}) } })
    const studentRequest = (path, options = {}) => request(path, { ...options, headers: { cookie: studentCookie, ...(options.headers || {}) } })
    const pdfForm = (name, bytes = Buffer.from('%PDF-1.7\nAssignment PDF')) => { const data = new FormData(); data.append('file', new Blob([bytes], { type: 'application/pdf' }), name); return data }

    assert.equal((await create(teacherCookie, classTwo._id)).status, 403)
    const created = await create(teacherCookie, classOne._id)
    assert.equal(created.status, 201)
    const assignment = (await created.json()).assignment
    testAssignmentIds = [assignment._id]
    assert.equal(assignment.status, 'published')
    assert.equal((await teacherRequest(`/teacher/assignments/${assignment._id}`)).status, 200)
    assert.equal((await request(`/teacher/assignments/${assignment._id}`, { headers: { cookie: otherTeacherCookie } })).status, 404)

    const attachmentForm = new FormData()
    attachmentForm.append('files', new Blob([Buffer.from('%PDF-1.7\nInstructions')], { type: 'application/pdf' }), 'instructions.pdf')
    const attachmentResponse = await fetch(`${base}/teacher/assignments/${assignment._id}/attachments`, { method: 'POST', headers: { cookie: teacherCookie }, body: attachmentForm })
    assert.equal(attachmentResponse.status, 201)
    const attachment = (await attachmentResponse.json()).attachments[0]
    assert.equal((await request(`/assignments/${assignment._id}/attachments/${attachment._id}/download`, { headers: { cookie: outsiderCookie } })).status, 404)
    assert.equal((await studentRequest(`/assignments/${assignment._id}/attachments/${attachment._id}/download`)).status, 200)

    const visible = await studentRequest('/student/assignments')
    const studentAssignments = (await visible.json()).assignments
    assert.equal(studentAssignments.length, 1)
    assert.equal(studentAssignments[0].title, assignment.title)
    const outsiderAssignments = await (await request('/student/assignments', { headers: { cookie: outsiderCookie } })).json()
    assert.equal(outsiderAssignments.assignments.length, 0)
    assert.equal((await request(`/student/assignments/${assignment._id}`, { headers: { cookie: outsiderCookie } })).status, 404)

    const submissionResponse = await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdfForm('draft-one.pdf') })
    assert.equal(submissionResponse.status, 201)
    let submission = (await submissionResponse.json()).submission
    assert.equal(submission.status, 'submitted')
    assert.equal(Object.hasOwn(submission, 'marksAwarded'), false)
    const firstFileName = (await Submission.findById(submission.id)).storedName
    const replacementResponse = await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdfForm('final.pdf') })
    assert.equal(replacementResponse.status, 201)
    submission = (await replacementResponse.json()).submission
    const storedSubmission = await Submission.findById(submission.id)
    assert.equal(storedSubmission.fileHistory.length, 1)
    assert.equal(storedSubmission.fileHistory[0].storedName, firstFileName)
    assert.equal(storedSubmission.originalName, 'final.pdf')
    assert.equal((await request(`/submissions/${submission.id}/download`, { headers: { cookie: outsiderCookie } })).status, 404)
    assert.equal((await request(`/submissions/${submission.id}/download`, { headers: { cookie: studentCookie } })).status, 200)
    assert.equal((await request(`/submissions/${submission.id}/download`, { headers: { cookie: teacherCookie } })).status, 200)
    assert.equal((await teacherRequest(`/teacher/submissions/${submission.id}`)).status, 200)
    assert.equal((await request(`/teacher/submissions/${submission.id}`, { headers: { cookie: otherTeacherCookie } })).status, 404)

    const rosterResponse = await teacherRequest(`/teacher/assignments/${assignment._id}/submissions?status=missing`)
    const roster = await rosterResponse.json()
    assert.equal(rosterResponse.status, 200)
    assert.equal(roster.summary.missing, 1)
    assert.equal(roster.submissions[0].student.fullName, missingStudent.fullName)
    assert.equal((await request(`/teacher/submissions/${submission.id}/grade`, { method: 'PATCH', headers: { cookie: otherTeacherCookie, 'content-type': 'application/json' }, body: JSON.stringify({ marksAwarded: 15 }) })).status, 404)
    assert.equal((await request(`/teacher/submissions/${submission.id}/grade`, { method: 'PATCH', headers: { cookie: teacherCookie, 'content-type': 'application/json' }, body: JSON.stringify({ marksAwarded: 21 }) })).status, 400)
    assert.equal((await request(`/teacher/submissions/${submission.id}/grade`, { method: 'PATCH', headers: { cookie: teacherCookie, 'content-type': 'application/json' }, body: JSON.stringify({ marksAwarded: -1 }) })).status, 400)
    assert.equal((await request(`/teacher/submissions/${submission.id}/grade`, { method: 'PATCH', headers: { cookie: studentCookie, 'content-type': 'application/json' }, body: JSON.stringify({ marksAwarded: 18 }) })).status, 403)
    const ungradedResult = await (await studentRequest(`/student/assignments/${assignment._id}/result`)).json()
    assert.equal(ungradedResult.result.graded, false)
    const gradeResponse = await request(`/teacher/submissions/${submission.id}/grade`, { method: 'PATCH', headers: { cookie: teacherCookie, 'content-type': 'application/json' }, body: JSON.stringify({ marksAwarded: 18, feedback: 'Clear explanation. Review the diagram labels.', status: 'returned' }) })
    assert.equal(gradeResponse.status, 200)
    const result = await (await studentRequest(`/student/assignments/${assignment._id}/result`)).json()
    assert.equal(result.result.graded, true)
    assert.equal(result.result.submission.marksAwarded, 18)
    assert.equal(result.result.submission.feedback, 'Clear explanation. Review the diagram labels.')
    assert.equal((await (await studentRequest(`/student/assignments/${assignment._id}`)).json()).assignment.submission.marksAwarded, 18)
    const updatedGrade = await request(`/teacher/submissions/${submission.id}/grade`, { method: 'PATCH', headers: { cookie: teacherCookie, 'content-type': 'application/json' }, body: JSON.stringify({ marksAwarded: 19, feedback: 'Revised after review.' }) })
    assert.equal(updatedGrade.status, 200)
    assert.equal((await Submission.findById(submission.id)).gradeHistory.length, 1)
    const gradedReplacement = await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdfForm('replacement-before-deadline.pdf') })
    assert.equal(gradedReplacement.status, 201)
    const afterGradedReplacement = await Submission.findById(submission.id)
    assert.equal(afterGradedReplacement.fileHistory.length, 2)
    assert.equal(afterGradedReplacement.gradeHistory.length, 2)
    assert.equal(afterGradedReplacement.marksAwarded, null)
    const pendingAgain = await (await studentRequest(`/student/assignments/${assignment._id}/result`)).json()
    assert.equal(pendingAgain.result.graded, false)
    const finalGrade = await request(`/teacher/submissions/${submission.id}/grade`, { method: 'PATCH', headers: { cookie: teacherCookie, 'content-type': 'application/json' }, body: JSON.stringify({ marksAwarded: 20, feedback: 'Final work reviewed.' }) })
    assert.equal(finalGrade.status, 200)

    const invalidPdf = await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdfForm('not-a-pdf.pdf', Buffer.from('not a PDF')) })
    assert.equal(invalidPdf.status, 400)
    const invalidExtension = await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdfForm('bad.exe') })
    assert.equal(invalidExtension.status, 400)
    const oversized = await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdfForm('large.pdf', Buffer.alloc(10 * 1024 * 1024 + 1, 0x61)) })
    assert.equal(oversized.status, 413)

    const pastDueDate = await teacherRequest(`/teacher/assignments/${assignment._id}`, { method: 'PUT', body: JSON.stringify({ dueDate: new Date(Date.now() - 1000).toISOString() }) })
    assert.equal(pastDueDate.status, 200)
    const replacementAfterDeadline = await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdfForm('replacement-too-late.pdf') })
    assert.equal(replacementAfterDeadline.status, 409)

    const deadlineAssignmentResponse = await create(teacherCookie, classOne._id, { title: 'Deadline assignment', dueDate: new Date(Date.now() - 1000).toISOString() })
    assert.equal(deadlineAssignmentResponse.status, 201)
    const deadlineAssignment = (await deadlineAssignmentResponse.json()).assignment
    testAssignmentIds.push(deadlineAssignment._id)
    const afterDeadline = await fetch(`${base}/student/assignments/${deadlineAssignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdfForm('late.pdf') })
    assert.equal(afterDeadline.status, 409)
    const closeResponse = await teacherRequest(`/teacher/assignments/${assignment._id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) })
    assert.equal(closeResponse.status, 200)
    assert.equal((await fetch(`${base}/student/assignments/${assignment._id}/submit`, { method: 'POST', headers: { cookie: studentCookie }, body: pdfForm('closed.pdf') })).status, 404)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (mongoose.connection.readyState === 1) {
      const [submissions, assignments] = await Promise.all([Submission.find({}).select('storedName fileHistory').lean(), Assignment.find({ _id: { $in: testAssignmentIds } }).select('attachments').lean()])
      await Promise.all(submissions.flatMap((item) => [item.storedName, ...(item.fileHistory || []).map((file) => file.storedName)]).map((name) => removeStoredFile(submissionFilePath(name))))
      await Promise.all(assignments.flatMap((item) => (item.attachments || []).map((file) => removeStoredFile(assignmentFilePath(file.storedName)))))
      await mongoose.connection.dropDatabase()
    }
    await disconnectDatabase()
    if (previousSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previousSecret
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
})
