// Academic event -> email notification jobs. Recipients follow the same access rules as the
// in-app notifications (active students of the class the item was published to). Every
// function here is safe to call fire-and-forget: it never throws and never blocks the caller.
import Assignment from '../models/Assignment.js'
import Announcement from '../models/Announcement.js'
import Class from '../models/Class.js'
import Course from '../models/Course.js'
import Department from '../models/Department.js'
import Lesson from '../models/Lesson.js'
import Quiz from '../models/Quiz.js'
import QuizAttempt from '../models/QuizAttempt.js'
import Submission from '../models/Submission.js'
import User from '../models/User.js'
import { publicAppUrl } from './email/email.service.js'
import { enqueueEmails, registerEmailCheck, startEmailQueueWorker } from './email/emailQueue.service.js'
import { loadSystemSettings } from './systemSettings.service.js'

const HOUR = 60 * 60 * 1000
export const EMAIL_PREFERENCE_CATEGORIES = ['quizzes', 'assignments', 'lessons', 'materials', 'courses', 'announcements', 'reminders']
export const REMINDER_WINDOWS = [{ key: '24h', ms: 24 * HOUR, template: 'deadline_reminder_24h' }, { key: '6h', ms: 6 * HOUR, template: 'deadline_reminder_6h' }]
const COMPLETED_QUIZ_STATUSES = ['submitted', 'auto_submitted', 'graded']
const PRIORITY = { reminder: 1, academic: 3, announcement: 5 }

/** Runs an email task after the current request without blocking it or surfacing errors. */
export function queueEmailTask(label, task) {
  setImmediate(() => {
    Promise.resolve().then(task).catch((error) => console.error(`Email notification task failed (${label})`, error.message))
  })
}

async function timezone() {
  try { return (await loadSystemSettings())?.general?.timezone || 'UTC' } catch { return 'UTC' }
}

/** Active, verified students matching `filter` who have not disabled `category`. */
export async function eligibleStudents(filter, category) {
  return User.find({
    ...filter,
    role: 'student',
    isActive: true,
    emailVerified: { $ne: false },
    ...(category ? { [`notificationPreferences.email.${category}`]: { $ne: false } } : {}),
  }).select('_id email fullName').lean()
}

const jobsFor = (students, base, keyPrefix) => students.map((recipient) => ({ ...base, recipient, dedupeKey: `${keyPrefix}:${recipient._id}` }))
const isPublished = (item) => item && (item.status ? item.status === 'published' : item.isPublished === true)

async function assignmentContext(assignment) {
  const lesson = assignment.lesson ? await Lesson.findById(assignment.lesson).select('course').lean() : null
  const course = lesson?.course ? await Course.findById(lesson.course).select('name').lean() : null
  if (course) return { contextType: 'Course', contextName: course.name }
  const academicClass = await Class.findById(assignment.class).select('name').lean()
  return { contextType: 'Class', contextName: academicClass?.name || '' }
}

async function quizContext(quiz) {
  const academicClass = await Class.findById(quiz.class).select('name').lean()
  return { contextType: 'Class', contextName: academicClass?.name || '' }
}

export async function emailQuizPublished(quizId) {
  const quiz = await Quiz.findById(quizId).select('title instructions description class availableFrom dueDate durationMinutes status isPublished').lean()
  if (!isPublished(quiz)) return 0
  const [students, context, tz] = await Promise.all([eligibleStudents({ class: quiz.class }, 'quizzes'), quizContext(quiz), timezone()])
  return enqueueEmails(jobsFor(students, {
    template: 'quiz_published', category: 'quizzes', priority: PRIORITY.academic,
    data: { title: quiz.title, instructions: quiz.instructions || quiz.description, availableFrom: quiz.availableFrom, dueDate: quiz.dueDate, durationMinutes: quiz.durationMinutes, timezone: tz, url: publicAppUrl('/app/quizzes'), ...context },
  }, `quiz-published:${quiz._id}`))
}

export async function emailAssignmentPublished(assignmentId) {
  const assignment = await Assignment.findById(assignmentId).select('title description instructions class lesson dueDate status isPublished').lean()
  if (!isPublished(assignment)) return 0
  const [students, context, tz] = await Promise.all([eligibleStudents({ class: assignment.class }, 'assignments'), assignmentContext(assignment), timezone()])
  return enqueueEmails(jobsFor(students, {
    template: 'assignment_published', category: 'assignments', priority: PRIORITY.academic,
    data: { title: assignment.title, description: assignment.description || assignment.instructions, dueDate: assignment.dueDate, timezone: tz, url: publicAppUrl(`/app/assignments/${assignment._id}`), ...context },
  }, `assignment-published:${assignment._id}`))
}

function lessonUrl(lesson) {
  return publicAppUrl(lesson.course ? `/app/learning/courses/${lesson.course}/lessons/${lesson._id}` : '/app/learning')
}

async function lessonDetails(lesson) {
  const [course, academicClass] = await Promise.all([
    lesson.course ? Course.findById(lesson.course).select('name isActive').lean() : null,
    Class.findById(lesson.class).select('name').lean(),
  ])
  return { course, academicClass }
}

export async function emailLessonPublished(lessonId) {
  const lesson = await Lesson.findById(lessonId).select('title summary subject class course status isPublished').lean()
  if (!isPublished(lesson)) return 0
  const { course, academicClass } = await lessonDetails(lesson)
  if (lesson.course && !course?.isActive) return 0
  const students = await eligibleStudents({ class: lesson.class }, 'lessons')
  return enqueueEmails(jobsFor(students, {
    template: 'lesson_published', category: 'lessons', priority: PRIORITY.academic,
    data: { title: lesson.title, summary: lesson.summary || lesson.subject, courseName: course?.name || '', className: academicClass?.name || '', url: lessonUrl(lesson) },
  }, `lesson-published:${lesson._id}`))
}

// Materials uploaded right after a lesson is published are covered by the lesson email.
const MATERIAL_GRACE_MS = 15 * 60 * 1000
export async function emailLessonMaterialsAdded(lessonId, materialIds, now = new Date()) {
  const lesson = await Lesson.findById(lessonId).select('title class course status isPublished materials createdAt').lean()
  if (!isPublished(lesson) || !materialIds?.length) return 0
  if (now - new Date(lesson.createdAt) < MATERIAL_GRACE_MS) return 0
  const ids = new Set(materialIds.map(String))
  const added = (lesson.materials || []).filter((item) => ids.has(String(item._id)))
  if (!added.length) return 0
  const { course } = await lessonDetails(lesson)
  if (lesson.course && !course?.isActive) return 0
  const students = await eligibleStudents({ class: lesson.class }, 'materials')
  const batchKey = [...ids].sort().join('-').slice(0, 120)
  return enqueueEmails(jobsFor(students, {
    template: 'material_published', category: 'materials', priority: PRIORITY.academic,
    data: { lessonTitle: lesson.title, courseName: course?.name || '', fileNames: added.map((item) => item.originalName), url: lessonUrl(lesson) },
  }, `material-published:${lesson._id}:${batchKey}`))
}

/** A course becomes available to a class when an admin assigns it to that class. */
export async function emailCoursePublished(courseId, classId) {
  const course = await Course.findById(courseId).select('name courseCode description isActive teachingAssignments').populate('teachingAssignments.teacher', 'fullName').lean()
  if (!course?.isActive) return 0
  const placement = (course.teachingAssignments || []).find((item) => String(item.class) === String(classId))
  if (!placement) return 0
  const academicClass = await Class.findById(classId).select('name isActive').lean()
  if (!academicClass?.isActive) return 0
  const students = await eligibleStudents({ class: classId }, 'courses')
  return enqueueEmails(jobsFor(students, {
    template: 'course_published', category: 'courses', priority: PRIORITY.academic,
    data: { courseName: course.name, courseCode: course.courseCode, description: course.description, className: academicClass.name, teacherName: placement.teacher?.fullName || '', url: publicAppUrl(`/app/learning/courses/${course._id}`) },
  }, `course-published:${course._id}:${classId}`))
}

export const ANNOUNCEMENT_AUDIENCES = ['none', 'all_students', 'faculty', 'department', 'class']

/** Resolves an admin-chosen announcement audience to a student filter (null = invalid). */
export async function announcementAudienceFilter(audience, targetId) {
  if (audience === 'all_students') return {}
  if (audience === 'class') return (await Class.exists({ _id: targetId, isActive: true })) ? { class: targetId } : null
  if (audience === 'department') return (await Department.exists({ _id: targetId, isActive: true })) ? { class: { $in: await Class.find({ department: targetId }).distinct('_id') } } : null
  if (audience === 'faculty') {
    const departments = await Department.find({ faculty: targetId, isActive: true }).distinct('_id')
    return departments.length ? { class: { $in: await Class.find({ department: { $in: departments } }).distinct('_id') } } : null
  }
  return null
}

export async function emailAnnouncement(announcementId) {
  const announcement = await Announcement.findById(announcementId).select('title message isActive emailAudience emailTarget').lean()
  if (!announcement?.isActive || !announcement.emailAudience || announcement.emailAudience === 'none') return 0
  const filter = await announcementAudienceFilter(announcement.emailAudience, announcement.emailTarget)
  if (!filter) return 0
  const students = await eligibleStudents(filter, 'announcements')
  const queued = await enqueueEmails(jobsFor(students, {
    template: 'announcement', category: 'announcements', priority: PRIORITY.announcement,
    data: { title: announcement.title, message: announcement.message, url: publicAppUrl('/app/announcements') },
  }, `announcement:${announcement._id}`))
  await Announcement.updateOne({ _id: announcement._id }, { $inc: { emailQueuedCount: queued } })
  return queued
}

// ---- Deadline reminders -------------------------------------------------------------

/**
 * The single reminder window due now for an item, or null. A window applies when its moment
 * (deadline - window) has passed, the deadline has not, and the item was already published
 * at that moment. Only the most recent window is used, so stale reminders after downtime
 * are skipped rather than sent late in the wrong order.
 */
export function applicableReminderWindow({ dueDate, publishedAt }, now = new Date()) {
  const due = new Date(dueDate).getTime()
  if (!Number.isFinite(due) || due <= now.getTime()) return null
  const published = new Date(publishedAt).getTime()
  const current = REMINDER_WINDOWS.filter((window) => now.getTime() >= due - window.ms).sort((a, b) => a.ms - b.ms)[0]
  if (!current) return null
  return Number.isFinite(published) && published <= due - current.ms ? current : null
}

async function pendingStudents(kind, item) {
  const students = await eligibleStudents({ class: item.class }, 'reminders')
  if (!students.length) return []
  const completed = kind === 'quiz'
    ? await QuizAttempt.find({ quiz: item._id, status: { $in: COMPLETED_QUIZ_STATUSES } }).distinct('student')
    : await Submission.find({ assignment: item._id }).distinct('student')
  const done = new Set(completed.map(String))
  return students.filter((student) => !done.has(String(student._id)))
}

export async function scanDeadlineReminders(now = new Date()) {
  const horizon = new Date(now.getTime() + REMINDER_WINDOWS[0].ms)
  const publishedFilter = { $or: [{ status: 'published' }, { status: { $exists: false }, isPublished: true }], dueDate: { $gt: now, $lte: horizon } }
  const [assignments, quizzes, tz] = await Promise.all([
    Assignment.find(publishedFilter).select('title class lesson dueDate publishedAt createdAt').lean(),
    Quiz.find({ status: 'published', dueDate: { $gt: now, $lte: horizon } }).select('title class dueDate publishedAt createdAt').lean(),
    timezone(),
  ])
  let queued = 0
  for (const [kind, items] of [['assignment', assignments], ['quiz', quizzes]]) {
    for (const item of items) {
      const window = applicableReminderWindow({ dueDate: item.dueDate, publishedAt: item.publishedAt || item.createdAt }, now)
      if (!window) continue
      const students = await pendingStudents(kind, item)
      if (!students.length) continue
      const context = kind === 'quiz' ? await quizContext(item) : await assignmentContext(item)
      const due = new Date(item.dueDate)
      queued += await enqueueEmails(jobsFor(students, {
        template: window.template, category: 'reminders', priority: PRIORITY.reminder,
        data: { kind, title: item.title, dueDate: due, timezone: tz, url: publicAppUrl(kind === 'quiz' ? '/app/quizzes' : `/app/assignments/${item._id}`), ...context },
        check: { kind: `${kind}_deadline`, itemId: item._id, dueDate: due },
        expiresAt: due,
      }, `reminder:${kind}:${item._id}:${window.key}:${due.getTime()}`), now)
    }
  }
  return queued
}

// Send-time validation: cancel reminders whose item changed, closed, or was completed.
async function reminderStillValid(kind, job, now) {
  const Model = kind === 'quiz' ? Quiz : Assignment
  const item = await Model.findById(job.check.itemId).select('status isPublished dueDate class').lean()
  if (!isPublished(item)) return 'item_unpublished'
  if (!item.dueDate || new Date(item.dueDate).getTime() !== new Date(job.check.dueDate).getTime()) return 'deadline_changed'
  if (new Date(item.dueDate) <= now) return 'deadline_passed'
  const student = await User.findById(job.recipientUser).select('class').lean()
  if (!student || String(student.class) !== String(item.class)) return 'no_longer_enrolled'
  const completed = kind === 'quiz'
    ? await QuizAttempt.exists({ quiz: item._id, student: job.recipientUser, status: { $in: COMPLETED_QUIZ_STATUSES } })
    : await Submission.exists({ assignment: item._id, student: job.recipientUser })
  return completed ? 'already_completed' : null
}
registerEmailCheck('assignment_deadline', (job, now) => reminderStillValid('assignment', job, now))
registerEmailCheck('quiz_deadline', (job, now) => reminderStillValid('quiz', job, now))

export function startEmailNotifications() {
  const stopWorker = startEmailQueueWorker()
  const intervalMs = Math.max(60 * 1000, Number(process.env.EMAIL_REMINDER_SCAN_INTERVAL_MS) || 5 * 60 * 1000)
  let running = false
  const scan = async () => {
    if (running) return
    running = true
    try { await scanDeadlineReminders() } catch (error) { console.error('Deadline reminder scan failed', error.message) } finally { running = false }
  }
  void scan()
  const interval = setInterval(scan, intervalMs)
  interval.unref?.()
  return () => { clearInterval(interval); stopWorker() }
}
