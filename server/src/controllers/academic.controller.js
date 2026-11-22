import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import User from '../models/User.js'
import Lesson from '../models/Lesson.js'
import Assignment from '../models/Assignment.js'
import Quiz from '../models/Quiz.js'
import Submission from '../models/Submission.js'
import QuizAttempt from '../models/QuizAttempt.js'
import { countStudentsForClasses } from './lessons.controller.js'
import { courseSemesters } from '../config/academicSemesters.js'
import { loadSystemSettings } from '../services/systemSettings.service.js'

export async function getAcademicOptions(req, res) {
  const [faculties, departments, classes, settings] = await Promise.all([
    Faculty.find({ isActive: true }).select('name code').sort('name').lean(),
    Department.find({ isActive: true }).select('name code faculty').sort('name').lean(),
    Class.find({ isActive: true }).select('name classCode department level').sort('name').lean(),
    loadSystemSettings(),
  ])
  const semesters = settings.academic?.semesters?.length ? settings.academic.semesters : [...courseSemesters]
  if (settings.academic?.semester && !semesters.includes(settings.academic.semester)) semesters.push(settings.academic.semester)
  return res.json({ success: true, faculties, departments, classes, semesters, currentSemester: settings.academic?.semester || '' })
}

export async function getTeachingClasses(req, res) {
  const classes = await Class.find({ _id: { $in: req.user.assignedClasses }, isActive: true })
    .populate({ path: 'department', select: 'name code', populate: { path: 'faculty', select: 'name code' } })
    .sort({ name: 1 })
    .lean()
  const counts = await countStudentsForClasses(classes.map((item) => item._id))
  return res.json({ success: true, classes: classes.map((item) => ({ ...item, studentsCount: counts.get(String(item._id)) || 0 })) })
}

export async function getTeacherDashboard(req, res) {
  const classes = await Class.find({ _id: { $in: req.user.assignedClasses }, isActive: true }).populate({ path: 'department', select: 'name code', populate: { path: 'faculty', select: 'name code' } }).sort({ name: 1 }).lean()
  const classIds = classes.map((item) => item._id)
  const [lessons, publishedLessons, students, recentLessons] = await Promise.all([
    Lesson.countDocuments({ createdBy: req.user._id }),
    Lesson.countDocuments({ createdBy: req.user._id, isPublished: true }),
    User.countDocuments({ role: 'student', class: { $in: classIds }, isActive: true }),
    Lesson.find({ createdBy: req.user._id }).populate('class', 'name classCode').sort({ updatedAt: -1 }).limit(5).lean(),
  ])
  const counts = await countStudentsForClasses(classes.map((item) => item._id))
  const populatedClasses = classes.map((item) => ({ ...item, studentsCount: counts.get(String(item._id)) || 0 }))
  return res.json({ success: true, metrics: { classes: classes.length, lessons, publishedLessons, students }, classes: populatedClasses, recentLessons })
}

export async function getTeachingClassStudents(req, res) {
  const { id } = req.params
  if (!req.user.assignedClasses.some((classId) => String(classId) === String(id))) {
    return res.status(403).json({ success: false, message: 'You can only view students in your assigned classes' })
  }
  const academicClass = await Class.findOne({ _id: id, isActive: true }).select('_id name classCode').lean()
  if (!academicClass) return res.status(404).json({ success: false, message: 'Class not found' })
  const search = String(req.query.search || '').trim().slice(0, 80)
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25))
  const query = { role: 'student', class: id, isActive: true }
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const safe = new RegExp(escaped, 'i')
    query.$or = [{ fullName: safe }, { email: safe }, { studentId: safe }]
  }
  const [students, total] = await Promise.all([
    User.find(query).select('fullName email studentId profileImage').sort({ fullName: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(query),
  ])
  return res.json({ success: true, class: academicClass, students, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

export async function getStudentClasses(req, res) {
  const student = await User.findById(req.user._id).populate({ path: 'class', populate: { path: 'department', populate: { path: 'faculty' } } }).lean()
  return res.json({ success: true, classes: student?.class ? [student.class] : [] })
}

export async function getTeacherMetrics(req, res) {
  const classIds = req.user.assignedClasses
  const [lessons, assignments, quizzes, pendingSubmissions] = await Promise.all([
    Lesson.countDocuments({ createdBy: req.user._id }),
    Assignment.countDocuments({ createdBy: req.user._id }),
    Quiz.countDocuments({ createdBy: req.user._id }),
    Submission.countDocuments({ assignment: { $in: await Assignment.find({ createdBy: req.user._id }).distinct('_id') }, score: null }),
  ])
  const [students, classes] = await Promise.all([
    User.countDocuments({ role: 'student', class: { $in: classIds }, isActive: true }),
    Class.find({ _id: { $in: classIds } }).select('name classCode').lean(),
  ])
  return res.json({ success: true, metrics: { students, classes: classes.length, lessons, assignments, quizzes, pendingSubmissions }, classes })
}

export async function getStudentOverview(req, res) {
  const [student, lessons, assignments, quizzes, submissions] = await Promise.all([
    User.findById(req.user._id).populate({ path: 'class', populate: { path: 'department', populate: { path: 'faculty' } } }).lean(),
    Lesson.find({ class: req.user.class, isPublished: true }).sort({ order: 1, createdAt: -1 }).limit(5).lean(),
    Assignment.find({ class: req.user.class, isPublished: true }).sort({ dueDate: 1 }).limit(8).lean(),
    Quiz.find({ class: req.user.class, isPublished: true }).select('-questions.correctOption').sort({ availableFrom: 1 }).limit(5).lean(),
    Submission.find({ student: req.user._id }).select('assignment score marksAwarded feedback submittedAt').populate({ path: 'assignment', select: 'title totalMarks maxScore' }).lean(),
  ])
  return res.json({ success: true, class: student?.class || null, lessons, assignments, quizzes, submissions })
}

export async function getStudentWeeklyLearning(req, res) {
  const classId = req.user.class
  const [lessons, assignments, quizzes] = await Promise.all([
    Lesson.find({ class: classId, isPublished: true }).select('_id title subject summary course createdAt').populate('course', 'name courseCode').sort({ createdAt: -1 }).limit(300).lean(),
    Assignment.find({ class: classId, isPublished: true }).select('_id title description dueDate totalMarks maxScore createdAt').sort({ createdAt: -1 }).limit(300).lean(),
    Quiz.find({ class: classId, $or: [{ status: 'published' }, { status: { $exists: false }, isPublished: true }] }).select('_id title description durationMinutes availableFrom dueDate createdAt').sort({ createdAt: -1 }).limit(300).lean(),
  ])
  const [submissions, attempts] = await Promise.all([
    Submission.find({ student: req.user._id, assignment: { $in: assignments.map((item) => item._id) } }).select('assignment status marksAwarded score submittedAt').lean(),
    QuizAttempt.find({ student: req.user._id, quiz: { $in: quizzes.map((item) => item._id) } }).select('quiz status submittedAt startedAt').sort({ startedAt: -1 }).lean(),
  ])
  const submissionByAssignment = new Map(submissions.map((item) => [String(item.assignment), item]))
  const attemptByQuiz = new Map()
  for (const attempt of attempts) if (!attemptByQuiz.has(String(attempt.quiz))) attemptByQuiz.set(String(attempt.quiz), attempt)
  const items = [
    ...lessons.map((item) => ({ id: item._id, type: 'lesson', title: item.title, description: item.summary || item.subject || '', postedAt: item.createdAt, courseId: item.course?._id || item.course || null, courseName: item.course?.name || '', courseCode: item.course?.courseCode || '' })),
    ...assignments.map((item) => {
      const submission = submissionByAssignment.get(String(item._id))
      return { id: item._id, type: 'assignment', title: item.title, description: item.description || '', postedAt: item.createdAt, dueDate: item.dueDate, totalMarks: item.totalMarks || item.maxScore, submissionStatus: submission?.status || 'not_submitted' }
    }),
    ...quizzes.map((item) => {
      const attempt = attemptByQuiz.get(String(item._id))
      return { id: item._id, type: 'quiz', title: item.title, description: item.description || '', postedAt: item.createdAt, dueDate: item.dueDate, durationMinutes: item.durationMinutes, attemptStatus: attempt?.status || 'not_started' }
    }),
  ].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt))
  return res.json({ success: true, items })
}
