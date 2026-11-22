import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import Quiz from '../models/Quiz.js'
import QuizAttempt from '../models/QuizAttempt.js'
import { hashPassword } from '../services/password.service.js'

test('quizzes enforce class access, server timers, answer privacy, grading, and results release', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated quiz integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_quizzes_test_${process.pid}_${Date.now()}`
  const previousSecret = process.env.JWT_SECRET
  const previousNodeEnv = process.env.NODE_ENV
  process.env.JWT_SECRET = 'phase-7-isolated-test-secret-do-not-use-in-production'
  process.env.NODE_ENV = 'test'
  const server = app.listen(0)

  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), Faculty.init(), Department.init(), Class.init(), Quiz.init(), QuizAttempt.init()])
    const suffix = `${process.pid % 10000}${Date.now().toString().slice(-6)}`
    const faculty = await Faculty.create({ name: 'Quiz Test Faculty', code: `QF${suffix}` })
    const department = await Department.create({ name: 'Quiz Test Department', code: `QD${suffix}`, faculty: faculty._id })
    const classOne = await Class.create({ name: 'Quiz Class One', classCode: `Q1${suffix}`, department: department._id })
    const classTwo = await Class.create({ name: 'Quiz Class Two', classCode: `Q2${suffix}`, department: department._id })
    const teacher = await User.create({ fullName: 'Quiz Teacher', email: `quiz_teacher${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [classOne._id] })
    const otherTeacher = await User.create({ fullName: 'Other Quiz Teacher', email: `other_quiz_teacher${suffix}@example.edu`, passwordHash: await hashPassword('TeacherPassword123'), role: 'teacher', department: department._id, assignedClasses: [classTwo._id] })
    const student = await User.create({ fullName: 'Quiz Student', email: `quiz_student${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `QS${suffix}`, department: department._id, class: classOne._id })
    const outsider = await User.create({ fullName: 'Quiz Outsider', email: `quiz_outsider${suffix}@example.edu`, passwordHash: await hashPassword('StudentPassword123'), role: 'student', studentId: `QO${suffix}`, department: department._id, class: classTwo._id })
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
    const teacherRequest = (path, options = {}) => request(path, { ...options, headers: { cookie: teacherCookie, ...(options.headers || {}) } })
    const studentRequest = (path, options = {}) => request(path, { ...options, headers: { cookie: studentCookie, ...(options.headers || {}) } })
    const quizPayload = (classId, overrides = {}) => ({
      title: 'Biology Knowledge Check', description: 'Cell structures', instructions: 'Answer all questions.', classId,
      durationMinutes: 10, startDate: new Date(Date.now() - 60_000).toISOString(), endDate: new Date(Date.now() + 600_000).toISOString(),
      status: 'published', questions: [
        { questionType: 'multiple_choice', questionText: 'Which is the powerhouse of the cell?', options: ['Nucleus', 'Mitochondrion'], correctAnswer: 1, marks: 2 },
        { questionType: 'true_false', questionText: 'Cells contain DNA.', correctAnswer: true, marks: 1 },
        { questionType: 'short_answer', questionText: 'Explain osmosis.', marks: 5 },
      ], ...overrides,
    })

    assert.equal((await teacherRequest('/teacher/quizzes', { method: 'POST', body: JSON.stringify(quizPayload(classTwo._id)) })).status, 403)
    const createResponse = await teacherRequest('/teacher/quizzes', { method: 'POST', body: JSON.stringify(quizPayload(classOne._id)) })
    assert.equal(createResponse.status, 201)
    const created = (await createResponse.json()).quiz
    assert.equal(created.totalMarks, 8)
    assert.equal(created.questions.length, 3)
    assert.equal((await request(`/teacher/quizzes/${created._id}`, { headers: { cookie: otherTeacherCookie } })).status, 404)
    assert.equal((await teacherRequest(`/teacher/quizzes/${created._id}`)).status, 200)

    const visible = await studentRequest('/student/quizzes')
    const studentQuizzes = (await visible.json()).quizzes
    assert.equal(studentQuizzes.length, 1)
    assert.equal(studentQuizzes[0].questions.some((question) => 'correctAnswer' in question || 'correctOption' in question), false)
    assert.equal((await request('/student/quizzes', { headers: { cookie: outsiderCookie } }).then((response) => response.json())).quizzes.length, 0)
    assert.equal((await request(`/student/quizzes/${created._id}`, { headers: { cookie: outsiderCookie } })).status, 404)

    const startedResponse = await studentRequest(`/student/quizzes/${created._id}/start`, { method: 'POST' })
    assert.equal(startedResponse.status, 201)
    const started = await startedResponse.json()
    assert.ok(new Date(started.attempt.expiresAt) > new Date(started.serverNow))
    assert.equal(started.quiz.questions.some((question) => 'correctAnswer' in question || 'correctOption' in question), false)
    const resumedResponse = await studentRequest(`/student/quizzes/${created._id}/start`, { method: 'POST' })
    const resumed = await resumedResponse.json()
    assert.equal(resumed.attempt.id, started.attempt.id)
    assert.equal(resumed.attempt.expiresAt, started.attempt.expiresAt)

    const answerPayload = { answers: [
      { questionId: started.quiz.questions[0].id, selectedOption: 1 },
      { questionId: started.quiz.questions[1].id, selectedOption: 0 },
      { questionId: started.quiz.questions[2].id, textAnswer: 'Water moves across a selectively permeable membrane.' },
    ] }
    assert.equal((await studentRequest(`/student/attempts/${started.attempt.id}/answers`, { method: 'PUT', body: JSON.stringify(answerPayload) })).status, 200)
    const restoredResponse = await studentRequest(`/student/quizzes/${created._id}/attempt`)
    const restored = await restoredResponse.json()
    assert.equal(restored.attempt.expiresAt, started.attempt.expiresAt)
    assert.equal(restored.attempt.answers.length, 3)
    assert.equal((await request(`/student/attempts/${started.attempt.id}/result`, { headers: { cookie: outsiderCookie } })).status, 404)

    const submittedResponse = await studentRequest(`/student/attempts/${started.attempt.id}/submit`, { method: 'POST' })
    assert.equal(submittedResponse.status, 200)
    const submitted = await submittedResponse.json()
    assert.equal(submitted.attempt.score, null)
    const storedAttempt = await QuizAttempt.findById(started.attempt.id)
    assert.equal(storedAttempt.score, 3)
    assert.equal(storedAttempt.status, 'submitted')
    assert.equal((await studentRequest(`/student/attempts/${started.attempt.id}/submit`, { method: 'POST' })).status, 409)

    assert.equal((await teacherRequest(`/teacher/quizzes/${created._id}/attempts`)).status, 200)
    assert.equal((await request(`/teacher/quizzes/${created._id}/attempts`, { headers: { cookie: otherTeacherCookie } })).status, 404)
    const questionId = started.quiz.questions[2].id
    const gradeResponse = await teacherRequest(`/teacher/attempts/${started.attempt.id}/grade`, { method: 'PATCH', body: JSON.stringify({ questionId, marksAwarded: 4, feedback: 'Good explanation.' }) })
    assert.equal(gradeResponse.status, 200, JSON.stringify(await gradeResponse.clone().json()))
    const graded = (await gradeResponse.json()).attempt
    assert.equal(graded.status, 'graded')
    assert.equal(graded.score, 7)
    const marksOnly = await (await studentRequest(`/student/attempts/${started.attempt.id}/result`)).json()
    assert.equal(marksOnly.released, true)
    assert.equal(marksOnly.detailsReleased, false)
    assert.equal(marksOnly.result.score, 7)
    assert.equal(marksOnly.result.questions[2].marksAwarded, 4)
    assert.equal('textAnswer' in marksOnly.result.questions[2], false)
    assert.equal('feedback' in marksOnly.result.questions[2], false)
    const releaseResponse = await teacherRequest(`/teacher/quizzes/${created._id}/results`, { method: 'PATCH', body: JSON.stringify({ showResults: true }) })
    assert.equal(releaseResponse.status, 200, JSON.stringify(await releaseResponse.clone().json()))
    const released = await (await studentRequest(`/student/attempts/${started.attempt.id}/result`)).json()
    assert.equal(released.released, true)
    assert.equal(released.result.score, 7)
    assert.equal(released.result.questions[0].correctAnswer, 1)
    assert.equal((await teacherRequest(`/teacher/quizzes/${created._id}`, { method: 'PUT', body: JSON.stringify({ questions: quizPayload(classOne._id).questions }) })).status, 409)

    const objectiveResponse = await teacherRequest('/teacher/quizzes', { method: 'POST', body: JSON.stringify(quizPayload(classOne._id, {
      title: 'Objective score check',
      questions: [
        { questionType: 'multiple_choice', questionText: 'Which is a mammal?', options: ['Shark', 'Whale'], correctAnswer: 1, marks: 2 },
        { questionType: 'true_false', questionText: 'Birds lay eggs.', correctAnswer: true, marks: 1 },
      ],
    })) })
    assert.equal(objectiveResponse.status, 201)
    const objectiveQuiz = (await objectiveResponse.json()).quiz
    const objectiveStart = await (await studentRequest(`/student/quizzes/${objectiveQuiz._id}/start`, { method: 'POST' })).json()
    const objectiveAnswers = objectiveStart.quiz.questions.map((question, index) => ({ questionId: question.id, selectedOption: index === 0 ? 1 : 0 }))
    assert.equal((await studentRequest(`/student/attempts/${objectiveStart.attempt.id}/answers`, { method: 'PUT', body: JSON.stringify({ answers: objectiveAnswers }) })).status, 200)
    const objectiveSubmit = await (await studentRequest(`/student/attempts/${objectiveStart.attempt.id}/submit`, { method: 'POST' })).json()
    assert.equal(objectiveSubmit.resultsReleased, true)
    assert.equal(objectiveSubmit.detailsReleased, false)
    assert.equal(objectiveSubmit.attempt.score, 3)
    const objectiveResult = await (await studentRequest(`/student/attempts/${objectiveStart.attempt.id}/result`)).json()
    assert.equal(objectiveResult.released, true)
    assert.equal(objectiveResult.detailsReleased, false)
    // Before details are released, students see only per-question marks: never the correct
    // answers, the answer options, or their own selections.
    for (const question of objectiveResult.result.questions) {
      assert.deepEqual(Object.keys(question).sort(), ['id', 'marks', 'marksAwarded', 'questionText', 'questionType'])
    }
    assert.equal(JSON.stringify(objectiveResult).includes('correct'), false)
    const objectiveHistory = (await (await studentRequest('/student/quizzes')).json()).quizzes.find((item) => item._id === objectiveQuiz._id)
    assert.equal(objectiveHistory.attempt.scoreAvailable, true)
    assert.equal(objectiveHistory.attempt.score, 3)

    const expiringResponse = await teacherRequest('/teacher/quizzes', { method: 'POST', body: JSON.stringify(quizPayload(classOne._id, { title: 'Expiry Check', endDate: new Date(Date.now() + 600_000).toISOString(), questions: [{ questionType: 'true_false', questionText: 'The earth is round.', correctAnswer: true, marks: 1 }] })) })
    assert.equal(expiringResponse.status, 201)
    const expiringQuiz = (await expiringResponse.json()).quiz
    const expiringAttempt = await (await studentRequest(`/student/quizzes/${expiringQuiz._id}/start`, { method: 'POST' })).json()
    await QuizAttempt.updateOne({ _id: expiringAttempt.attempt.id }, { $set: { endsAt: new Date(Date.now() - 1000) } })
    const afterExpiry = await studentRequest(`/student/attempts/${expiringAttempt.attempt.id}/answers`, { method: 'PUT', body: JSON.stringify({ answers: [{ questionId: expiringAttempt.quiz.questions[0].id, selectedOption: 0 }] }) })
    assert.equal(afterExpiry.status, 409)
    const expiredAttempt = await QuizAttempt.findById(expiringAttempt.attempt.id)
    assert.equal(expiredAttempt.status, 'auto_submitted')
    assert.equal(expiredAttempt.submittedAt.getTime(), expiredAttempt.endsAt.getTime())
    assert.equal((await studentRequest(`/student/quizzes/${expiringQuiz._id}/start`, { method: 'POST' })).status, 409)
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
