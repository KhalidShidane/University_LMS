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
import Assignment from '../models/Assignment.js'
import Quiz from '../models/Quiz.js'
import Submission from '../models/Submission.js'
import EmailJob from '../models/EmailJob.js'
import EmailLog from '../models/EmailLog.js'
import { hashPassword } from '../services/password.service.js'
import { setEmailTransport } from '../services/email/email.service.js'
import { EmailTransportError } from '../services/email/transportError.js'
import { processEmailQueueOnce } from '../services/email/emailQueue.service.js'
import { applicableReminderWindow, emailAssignmentPublished, emailCoursePublished, emailLessonMaterialsAdded, emailLessonPublished, emailQuizPublished, queueEmailTask, scanDeadlineReminders } from '../services/emailNotifications.service.js'

const HOUR = 3600 * 1000
const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET', 'CLIENT_URL', 'APP_URL', 'EMAIL_DAILY_LIMIT', 'EMAIL_MONTHLY_LIMIT', 'EMAIL_DAILY_RESERVED_FOR_ACCOUNT', 'EMAIL_MAX_PER_MINUTE', 'EMAIL_QUEUE_INTERVAL_MS']
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('email notifications: events, recipients, queue, quota, retries, reminders, preferences, announcements', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated email notification integration checks',
}, async () => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_notify_test_${process.pid}_${Date.now()}`
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'email-notification-isolated-test-secret-0123456789', CLIENT_URL: 'https://lms.example.edu', EMAIL_DAILY_LIMIT: '200', EMAIL_MONTHLY_LIMIT: '6000', EMAIL_DAILY_RESERVED_FOR_ACCOUNT: '20', EMAIL_MAX_PER_MINUTE: '240', EMAIL_QUEUE_INTERVAL_MS: '15000' })
  delete process.env.APP_URL

  // Fake provider: records messages; `mode` can simulate failures.
  const outbox = []
  const transport = { name: 'test', mode: 'ok', delayMs: 0, async send(message) {
    if (this.delayMs) await wait(this.delayMs)
    if (this.mode === 'temporary') throw new EmailTransportError('Resend request timed out', { code: 'timeout', temporary: true })
    if (this.mode === 'permanent') throw new EmailTransportError('Resend rejected the message: invalid recipient', { code: 'provider_error', status: 400, permanent: true })
    outbox.push(message)
    return { providerMessageId: `m-${outbox.length}` }
  } }
  setEmailTransport(transport)
  const server = app.listen(0)

  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), EmailJob.init(), EmailLog.init(), Faculty.init(), Department.init(), Class.init(), Course.init()])
    const password = await hashPassword('Password12345')
    const faculty = await Faculty.create({ name: 'Notify Faculty', code: 'NF' })
    const department = await Department.create({ name: 'Notify Department', code: 'ND', faculty: faculty._id })
    const classA = await Class.create({ name: 'Class Alpha', classCode: 'CA', department: department._id })
    const classB = await Class.create({ name: 'Class Beta', classCode: 'CB', department: department._id })
    const admin = await User.create({ fullName: 'Admin', email: 'admin@example.edu', passwordHash: password, role: 'admin', emailVerified: true })
    const teacher = await User.create({ fullName: 'Teacher Tom', email: 'teacher@example.edu', passwordHash: password, role: 'teacher', department: department._id, assignedClasses: [classA._id, classB._id], emailVerified: true })
    const student = (name, extra) => User.create({ fullName: name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.edu`, passwordHash: password, role: 'student', studentId: name.replace(/\s+/g, '').toUpperCase(), department: department._id, class: classA._id, emailVerified: true, ...extra })
    const s1 = await student('Sara Ali')
    const s2 = await student('Omar Noor', { notificationPreferences: { email: { quizzes: false } } })
    const s3 = await student('Unverified Ida', { emailVerified: false })
    const s4 = await student('Beta Bashir', { class: classB._id })
    await student('Inactive Ibra', { isActive: false })
    const recipients = async (key) => (await EmailJob.find({ dedupeKey: new RegExp(`^${key}`) }).select('recipientEmail').lean()).map((job) => job.recipientEmail).sort()

    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const login = async (email) => (await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Password12345' }) })).headers.get('set-cookie').split(';')[0]
    const teacherCookie = await login(teacher.email)
    const adminCookie = await login(admin.email)
    const s1Cookie = await login(s1.email)

    // ---- A. Quiz: drafts send nothing; publishing queues only eligible students; publish is not blocked.
    const quizPayload = (overrides) => ({ title: 'Cells Quiz', instructions: 'Answer every question.', classId: String(classA._id), durationMinutes: 15, startDate: new Date(Date.now() - 60000).toISOString(), endDate: new Date(Date.now() + 3 * 24 * HOUR).toISOString(), questions: [{ questionType: 'true_false', questionText: 'Cells contain DNA.', correctAnswer: true, marks: 1 }], ...overrides })
    const draft = await request('/teacher/quizzes', { method: 'POST', headers: { cookie: teacherCookie }, body: JSON.stringify(quizPayload({ status: 'draft' })) })
    assert.equal(draft.status, 201)
    const draftId = (await draft.json()).quiz._id
    await wait(200)
    assert.equal(await EmailJob.countDocuments({}), 0, 'draft quizzes do not notify')
    transport.delayMs = 3000 // a slow provider must not slow down publishing
    const started = Date.now()
    const publish = await request(`/teacher/quizzes/${draftId}/status`, { method: 'PATCH', headers: { cookie: teacherCookie }, body: JSON.stringify({ status: 'published' }) })
    assert.equal(publish.status, 200)
    assert.ok(Date.now() - started < 2000, 'publishing returns before any email is sent')
    transport.delayMs = 0
    await wait(300)
    assert.deepEqual(await recipients('quiz-published'), ['sara.ali@example.edu'], 'pref-off, unverified, inactive, and other-class students are excluded')
    assert.ok((await Quiz.findById(draftId).lean()).publishedAt, 'publish time recorded')

    // Idempotency: re-triggering the same event does not queue duplicates.
    assert.equal(await emailQuizPublished(draftId), 0)
    assert.equal(await EmailJob.countDocuments({ dedupeKey: /^quiz-published/ }), 1)

    const firstRun = await processEmailQueueOnce()
    assert.equal(firstRun.sent, 1)
    const quizEmail = outbox.at(-1)
    assert.equal(quizEmail.to.email, 'sara.ali@example.edu')
    assert.match(quizEmail.subject, /New quiz: Cells Quiz/)
    assert.match(quizEmail.html, /Answer every question/)
    assert.match(quizEmail.html, /Class Alpha/)
    assert.match(quizEmail.html, /Deadline/)
    assert.match(quizEmail.text, /https:\/\/lms\.example\.edu\/app\/quizzes/)
    assert.equal((await processEmailQueueOnce()).sent, 0, 'sent jobs are never resent')

    // ---- B. Assignment, lesson, material, and course events.
    const course = await Course.create({ name: 'Molecular Biology', courseCode: 'MB101', description: 'Intro to molecules', teachingAssignments: [{ teacher: teacher._id, class: classA._id, department: department._id }], class: classA._id, department: department._id, teacher: teacher._id })
    const lesson = await Lesson.create({ title: 'Cell Membranes', summary: 'How membranes work', class: classA._id, course: course._id, createdBy: teacher._id, status: 'published' })
    const assignment = await Assignment.create({ title: 'Membrane Essay', description: 'Write 500 words.', class: classA._id, lesson: lesson._id, createdBy: teacher._id, dueDate: new Date(Date.now() + 5 * 24 * HOUR), status: 'published' })
    await emailAssignmentPublished(assignment._id)
    await emailLessonPublished(lesson._id)
    await emailCoursePublished(course._id, classA._id)
    assert.deepEqual(await recipients('assignment-published'), ['omar.noor@example.edu', 'sara.ali@example.edu'])
    assert.deepEqual(await recipients('lesson-published'), ['omar.noor@example.edu', 'sara.ali@example.edu'])
    assert.deepEqual(await recipients('course-published'), ['omar.noor@example.edu', 'sara.ali@example.edu'])
    assert.equal(await emailCoursePublished(course._id, classB._id), 0, 'course not assigned to class B: no emails there')
    // Materials uploaded right after publishing are covered by the lesson email; later uploads notify.
    await Lesson.updateOne({ _id: lesson._id }, { $push: { materials: { originalName: 'slides.pdf', storedName: 'x1.pdf', mimeType: 'application/pdf', size: 10 } } })
    const withMaterial = await Lesson.findById(lesson._id).lean()
    assert.equal(await emailLessonMaterialsAdded(lesson._id, [withMaterial.materials[0]._id]), 0, 'within grace period')
    assert.equal(await emailLessonMaterialsAdded(lesson._id, [withMaterial.materials[0]._id], new Date(Date.now() + 20 * 60000)), 2)
    const draftLesson = await Lesson.create({ title: 'Draft Lesson', class: classA._id, createdBy: teacher._id, status: 'draft' })
    assert.equal(await emailLessonPublished(draftLesson._id), 0, 'unpublished lessons send nothing')

    // ---- F. Preferences: defaults, update, validation, and send-time enforcement.
    const prefs = await request('/profile/notification-preferences', { headers: { cookie: s1Cookie } })
    assert.equal(prefs.status, 200)
    assert.deepEqual((await prefs.json()).email, { quizzes: true, assignments: true, lessons: true, materials: true, courses: true, announcements: true, reminders: true })
    const turnOff = await request('/profile/notification-preferences', { method: 'PUT', headers: { cookie: s1Cookie }, body: JSON.stringify({ email: { lessons: false } }) })
    assert.equal((await turnOff.json()).email.lessons, false)
    assert.equal((await request('/profile/notification-preferences', { method: 'PUT', headers: { cookie: s1Cookie }, body: JSON.stringify({ email: { email_verification: false } }) })).status, 400, 'mandatory emails cannot be disabled')
    assert.equal((await request('/profile/notification-preferences', { method: 'PUT', headers: { cookie: s1Cookie }, body: JSON.stringify({ email: { quizzes: 'no' } }) })).status, 400)
    assert.equal((await request('/profile/notification-preferences')).status, 401)

    const batch = await processEmailQueueOnce()
    assert.equal(batch.sent, 7, '8 queued, 1 cancelled by the new preference')
    const cancelled = await EmailJob.findOne({ dedupeKey: `lesson-published:${lesson._id}:${s1._id}` }).lean()
    assert.deepEqual([cancelled.status, cancelled.cancelReason], ['cancelled', 'preference_disabled'])
    const subjects = outbox.map((message) => message.subject)
    for (const expected of [/New assignment: Membrane Essay/, /New lesson: Cell Membranes/, /New course available: Molecular Biology/, /New course material: Cell Membranes/]) assert.ok(subjects.some((subject) => expected.test(subject)), `${expected} sent`)
    const assignmentEmail = outbox.find((message) => /New assignment/.test(message.subject))
    assert.match(assignmentEmail.html, /Molecular Biology/, 'assignment shows its course')
    assert.match(assignmentEmail.text, new RegExp(`/app/assignments/${assignment._id}`))
    assert.match(outbox.find((message) => /material/.test(message.subject)).html, /slides\.pdf/)

    // ---- E. Announcements: admin chooses audience explicitly; default sends nothing.
    const announce = (body) => request('/announcements', { method: 'POST', headers: { cookie: adminCookie }, body: JSON.stringify(body) })
    assert.equal((await announce({ title: 'Library hours', message: 'Open late.' })).status, 201)
    await wait(200)
    assert.equal(await EmailJob.countDocuments({ dedupeKey: /^announcement/ }), 0, 'no audience chosen: in-app only')
    assert.equal((await announce({ title: 'Bad', message: 'x', emailAudience: 'class', emailTarget: 'nope' })).status, 400)
    assert.equal((await announce({ title: 'Bad', message: 'x', emailAudience: 'everyone' })).status, 400)
    assert.equal((await request('/announcements', { method: 'POST', headers: { cookie: teacherCookie }, body: JSON.stringify({ title: 'T', message: 'x', emailAudience: 'all_students' }) })).status, 403, 'only admins can announce')
    assert.equal((await announce({ title: 'Beta field trip', message: 'Bring water.', emailAudience: 'class', emailTarget: String(classB._id) })).status, 201)
    await wait(300)
    assert.deepEqual(await recipients('announcement'), ['beta.bashir@example.edu'])
    assert.equal((await announce({ title: 'Exams', message: 'Schedule out.', emailAudience: 'all_students' })).status, 201)
    await wait(300)
    assert.equal(await EmailJob.countDocuments({ dedupeKey: /^announcement/ }), 4, 'all active verified students: Sara, Omar, Beta (+1 earlier)')

    // ---- Quota: notifications wait when the plan limit is reached; nothing is lost.
    process.env.EMAIL_DAILY_LIMIT = String(await EmailLog.countDocuments({ status: 'sent' }) + 20)
    const blocked = await processEmailQueueOnce()
    assert.equal(blocked.quotaExhausted, true)
    assert.ok(blocked.waiting >= 3)
    assert.equal(await EmailJob.countDocuments({ dedupeKey: /^announcement/, status: 'pending' }), 4)
    process.env.EMAIL_DAILY_LIMIT = String(await EmailLog.countDocuments({ status: 'sent' }) + 22)
    assert.equal((await processEmailQueueOnce()).sent, 2, 'only the remaining quota is used')
    process.env.EMAIL_DAILY_LIMIT = '200'

    // ---- Reliability: temporary failures retry later; permanent ones stop; crashes recover.
    transport.mode = 'temporary'
    await processEmailQueueOnce()
    const retrying = await EmailJob.findOne({ dedupeKey: /^announcement/, status: 'pending' }).lean()
    assert.ok(retrying.attempts >= 1 && retrying.nextAttemptAt > new Date(), 'scheduled for retry with backoff')
    assert.equal(retrying.lastErrorCode, 'timeout')
    transport.mode = 'ok'
    await EmailJob.updateMany({ status: 'pending' }, { $set: { nextAttemptAt: new Date() } })
    await processEmailQueueOnce()
    assert.equal(await EmailJob.countDocuments({ dedupeKey: /^announcement/, status: 'sent' }), 4)
    await EmailJob.create({ template: 'announcement', recipientUser: s1._id, recipientEmail: s1.email, dedupeKey: 'perm-test', data: { title: 'x', message: 'y', url: 'https://lms.example.edu' }, expiresAt: new Date(Date.now() + HOUR) })
    transport.mode = 'permanent'
    await processEmailQueueOnce()
    assert.equal((await EmailJob.findOne({ dedupeKey: 'perm-test' }).lean()).status, 'failed')
    transport.mode = 'ok'
    await EmailJob.create({ template: 'announcement', recipientUser: s1._id, recipientEmail: s1.email, dedupeKey: 'crash-test', data: { title: 'x', message: 'y', url: 'https://lms.example.edu' }, status: 'sending', lockedUntil: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + HOUR) })
    await processEmailQueueOnce()
    assert.equal((await EmailJob.findOne({ dedupeKey: 'crash-test' }).lean()).status, 'sent', 'interrupted job recovered after restart')
    assert.ok(await EmailLog.countDocuments({ status: 'failed' }) >= 2, 'failures are logged')

    // A failing email task never affects the request that triggered it.
    queueEmailTask('test', () => { throw new Error('boom') })
    await wait(50)

    // ---- Deadline reminders.
    const now = new Date()
    const at = (hours) => new Date(now.getTime() + hours * HOUR)
    assert.equal(applicableReminderWindow({ dueDate: at(30), publishedAt: at(-48) }, now), null, 'too early')
    assert.equal(applicableReminderWindow({ dueDate: at(20), publishedAt: at(-48) }, now).key, '24h')
    assert.equal(applicableReminderWindow({ dueDate: at(5), publishedAt: at(-48) }, now).key, '6h', 'after downtime only the latest window is used')
    assert.equal(applicableReminderWindow({ dueDate: at(20), publishedAt: at(-1) }, now), null, 'published <24h before deadline: no 24h reminder')
    assert.equal(applicableReminderWindow({ dueDate: at(5), publishedAt: at(-2) }, now).key, '6h', 'but the 6h reminder still applies')
    assert.equal(applicableReminderWindow({ dueDate: at(3), publishedAt: at(-2) }, now), null, 'published inside 6h window: none')
    assert.equal(applicableReminderWindow({ dueDate: at(-1), publishedAt: at(-48) }, now), null, 'never after the deadline')

    const dueAssignment = await Assignment.create({ title: 'Lab Report', class: classA._id, createdBy: teacher._id, dueDate: at(20), status: 'published' })
    await Assignment.updateOne({ _id: dueAssignment._id }, { $set: { publishedAt: at(-48) } })
    await Submission.collection.insertOne({ assignment: dueAssignment._id, student: s2._id, originalName: 'a.pdf', storedName: `s-${Date.now()}.pdf`, mimeType: 'application/pdf', size: 10, submittedAt: new Date() })
    const dueQuiz = await Quiz.create({ title: 'Speed Quiz', class: classA._id, createdBy: teacher._id, questions: [{ questionType: 'true_false', questionText: 'Yes?', correctAnswer: true, points: 1 }], durationMinutes: 5, availableFrom: at(-48), dueDate: at(5), status: 'published' })
    await Quiz.updateOne({ _id: dueQuiz._id }, { $set: { publishedAt: at(-10) } })
    const lateQuiz = await Quiz.create({ title: 'Late Quiz', class: classA._id, createdBy: teacher._id, questions: [{ questionType: 'true_false', questionText: 'Yes?', correctAnswer: true, points: 1 }], durationMinutes: 5, availableFrom: at(-1), dueDate: at(4), status: 'published' })

    await scanDeadlineReminders(now)
    assert.deepEqual(await recipients(`reminder:assignment:${dueAssignment._id}:24h`), ['sara.ali@example.edu'], 'submitted student excluded')
    assert.deepEqual(await recipients(`reminder:quiz:${dueQuiz._id}:6h`), ['omar.noor@example.edu', 'sara.ali@example.edu'])
    assert.equal(await EmailJob.countDocuments({ dedupeKey: new RegExp(`^reminder:quiz:${lateQuiz._id}`) }), 0)
    assert.equal(await scanDeadlineReminders(now), 0, 'repeated scans do not duplicate reminders')

    // Deadline moved: the old reminder is cancelled at send time and a new one follows the new date.
    await Assignment.updateOne({ _id: dueAssignment._id }, { $set: { dueDate: at(22) } })
    // Sara completes the quiz before her reminder goes out.
    await mongoose.connection.collection('quizattempts').insertOne({ quiz: dueQuiz._id, student: s1._id, status: 'submitted', submittedAt: new Date() })
    await processEmailQueueOnce()
    const reminderJobs = await EmailJob.find({ dedupeKey: /^reminder:/ }).lean()
    const byKey = (pattern) => reminderJobs.find((job) => pattern.test(job.dedupeKey))
    assert.deepEqual([byKey(new RegExp(`assignment:${dueAssignment._id}`)).status, byKey(new RegExp(`assignment:${dueAssignment._id}`)).cancelReason], ['cancelled', 'deadline_changed'])
    assert.equal(byKey(new RegExp(`quiz:${dueQuiz._id}:6h:\\d+:${s1._id}`)).cancelReason, 'already_completed')
    assert.equal(byKey(new RegExp(`quiz:${dueQuiz._id}:6h:\\d+:${s2._id}`)).status, 'sent')
    const reminderEmail = outbox.find((message) => /Speed Quiz is due in 6 hours/.test(message.subject))
    assert.ok(reminderEmail, '6h reminder sent')
    assert.match(reminderEmail.html, /not completed/)
    await scanDeadlineReminders(now)
    assert.deepEqual(await recipients(`reminder:assignment:${dueAssignment._id}:24h:${at(22).getTime()}`), ['sara.ali@example.edu'], 'rescheduled for the new deadline')
    assert.equal(byKey(/perm/), undefined)
  } finally {
    setEmailTransport(null)
    await new Promise((resolve) => server.close(resolve))
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await disconnectDatabase()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
