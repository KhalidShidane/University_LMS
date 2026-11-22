import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Assignment from '../models/Assignment.js'
import Class from '../models/Class.js'
import Lesson from '../models/Lesson.js'
import Quiz from '../models/Quiz.js'
import QuizAttempt from '../models/QuizAttempt.js'
import Submission from '../models/Submission.js'
import User from '../models/User.js'

const uploadDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../uploads')
const hasClass = (user, classId) => user.assignedClasses.some((id) => String(id) === String(classId))

async function requireTeacherClass(user, classId) {
  if (!hasClass(user, classId)) {
    const error = new Error('You can only manage content for your assigned classes')
    error.status = 403
    throw error
  }
  const record = await Class.findOne({ _id: classId, isActive: true }).select('_id').lean()
  if (!record) {
    const error = new Error('Choose an active assigned class')
    error.status = 400
    throw error
  }
}

export async function listTeacherLessons(req, res) {
  const lessons = await Lesson.find({ createdBy: req.user._id })
    .populate('class', 'name classCode')
    .sort({ updatedAt: -1 })
    .lean()
  return res.json({ success: true, lessons })
}

export async function createLesson(req, res) {
  await requireTeacherClass(req.user, req.body.class)
  const lesson = await Lesson.create({ ...req.body, createdBy: req.user._id })
  return res.status(201).json({ success: true, lesson })
}

export async function updateLesson(req, res) {
  const lesson = await Lesson.findOne({ _id: req.params.id, createdBy: req.user._id })
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  if (req.body.class) await requireTeacherClass(req.user, req.body.class)
  for (const field of ['title', 'summary', 'content', 'class', 'attachments', 'isPublished', 'order']) {
    if (field in req.body) lesson.set(field, req.body[field])
  }
  await lesson.save()
  return res.json({ success: true, lesson })
}

export async function listTeacherAssignments(req, res) {
  const assignments = await Assignment.find({ createdBy: req.user._id })
    .populate('class', 'name classCode')
    .sort({ dueDate: 1 })
    .lean()
  const submissions = await Submission.find({ assignment: { $in: assignments.map((item) => item._id) } })
    .select('assignment student score status submittedAt')
    .populate('student', 'fullName email studentId profileImage')
    .lean()
  const grouped = submissions.reduce((result, item) => {
    const key = String(item.assignment)
    result[key] ||= []
    result[key].push(item)
    return result
  }, {})
  return res.json({ success: true, assignments: assignments.map((item) => ({ ...item, submissions: grouped[String(item._id)] || [] })) })
}

export async function createAssignment(req, res) {
  await requireTeacherClass(req.user, req.body.class)
  const assignment = await Assignment.create({ ...req.body, createdBy: req.user._id })
  return res.status(201).json({ success: true, assignment })
}

export async function updateAssignment(req, res) {
  const assignment = await Assignment.findOne({ _id: req.params.id, createdBy: req.user._id })
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  if (req.body.class) await requireTeacherClass(req.user, req.body.class)
  for (const field of ['title', 'instructions', 'class', 'lesson', 'dueDate', 'maxScore', 'isPublished']) {
    if (field in req.body) assignment.set(field, req.body[field])
  }
  await assignment.save()
  return res.json({ success: true, assignment })
}

export async function listStudentLessons(req, res) {
  const lessons = await Lesson.find({ class: req.user.class, isPublished: true })
    .populate('createdBy', 'fullName')
    .sort({ order: 1, createdAt: -1 })
    .lean()
  return res.json({ success: true, lessons })
}

export async function listStudentAssignments(req, res) {
  const assignments = await Assignment.find({ class: req.user.class, isPublished: true })
    .sort({ dueDate: 1 })
    .lean()
  const submissions = await Submission.find({ student: req.user._id, assignment: { $in: assignments.map((item) => item._id) } }).lean()
  const byAssignment = new Map(submissions.map((item) => [String(item.assignment), item]))
  return res.json({ success: true, assignments: assignments.map((item) => ({ ...item, submission: byAssignment.get(String(item._id)) || null })) })
}

export async function submitAssignment(req, res) {
  const assignment = await Assignment.findOne({ _id: req.params.id, class: req.user.class, isPublished: true })
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose a PDF file to submit' })
  if (req.file.mimetype !== 'application/pdf' || !req.file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return res.status(400).json({ success: false, message: 'Only valid PDF documents are accepted' })
  }

  const storedName = `${randomUUID()}.pdf`
  await mkdir(uploadDirectory, { recursive: true })
  const filePath = join(uploadDirectory, storedName)
  await writeFile(filePath, req.file.buffer, { flag: 'wx' })
  try {
    const late = new Date() > assignment.dueDate
    const existingSubmission = await Submission.findOne({ assignment: assignment._id, student: req.user._id }).select('storedName').lean()
    const submission = await Submission.findOneAndUpdate(
      { assignment: assignment._id, student: req.user._id },
      {
        $set: {
          originalName: req.file.originalname.slice(0, 255),
          storedName,
          mimeType: 'application/pdf',
          size: req.file.size,
          status: late ? 'late' : 'submitted',
          submittedAt: new Date(),
          score: null,
          feedback: '',
          gradedBy: null,
          gradedAt: null,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    )
    if (existingSubmission?.storedName && existingSubmission.storedName !== storedName) {
      await unlink(join(uploadDirectory, existingSubmission.storedName)).catch(() => {})
    }
    return res.status(201).json({ success: true, submission: { id: submission._id, originalName: submission.originalName, status: submission.status, submittedAt: submission.submittedAt } })
  } catch (error) {
    await unlink(filePath).catch(() => {})
    throw error
  }
}

export async function listTeacherSubmissions(req, res) {
  const assignments = await Assignment.find({ createdBy: req.user._id }).select('_id title class maxScore dueDate').lean()
  const submissions = await Submission.find({ assignment: { $in: assignments.map((item) => item._id) } })
    .populate('student', 'fullName email studentId profileImage')
    .populate('assignment', 'title class maxScore dueDate')
    .sort({ submittedAt: -1 })
    .lean()
  return res.json({ success: true, submissions })
}

export async function gradeSubmission(req, res) {
  const submission = await Submission.findById(req.params.id).populate('assignment').exec()
  if (!submission || String(submission.assignment.createdBy) !== String(req.user._id)) {
    return res.status(404).json({ success: false, message: 'Submission not found' })
  }
  const score = Number(req.body.score)
  if (!Number.isFinite(score) || score < 0 || score > submission.assignment.maxScore) {
    return res.status(400).json({ success: false, message: `Score must be between 0 and ${submission.assignment.maxScore}` })
  }
  submission.score = score
  submission.feedback = String(req.body.feedback || '').slice(0, 5000)
  submission.gradedBy = req.user._id
  submission.gradedAt = new Date()
  await submission.save()
  return res.json({ success: true, submission })
}

export async function downloadSubmission(req, res, next) {
  const submission = await Submission.findById(req.params.id).populate('assignment', 'createdBy').exec()
  if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' })
  const canRead = req.user.role === 'teacher'
    ? String(submission.assignment.createdBy) === String(req.user._id)
    : String(submission.student) === String(req.user._id)
  if (!canRead) return res.status(403).json({ success: false, message: 'You cannot access this submission' })
  return res.download(join(uploadDirectory, submission.storedName), submission.originalName, (error) => {
    if (error && !res.headersSent) next(error)
  })
}

export async function listTeacherQuizzes(req, res) {
  const quizzes = await Quiz.find({ createdBy: req.user._id }).populate('class', 'name classCode').sort({ updatedAt: -1 }).lean()
  return res.json({ success: true, quizzes })
}

export async function createQuiz(req, res) {
  await requireTeacherClass(req.user, req.body.class)
  const quiz = await Quiz.create({ ...req.body, createdBy: req.user._id })
  return res.status(201).json({ success: true, quiz })
}

export async function updateQuiz(req, res) {
  const quiz = await Quiz.findOne({ _id: req.params.id, createdBy: req.user._id })
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  if (req.body.class) await requireTeacherClass(req.user, req.body.class)
  for (const field of ['title', 'instructions', 'class', 'questions', 'durationMinutes', 'availableFrom', 'dueDate', 'attemptLimit', 'isPublished']) {
    if (field in req.body) quiz.set(field, req.body[field])
  }
  await quiz.save()
  return res.json({ success: true, quiz })
}

export async function listStudentQuizzes(req, res) {
  const [quizzes, attempts] = await Promise.all([
    Quiz.find({ class: req.user.class, isPublished: true }).select('-questions.correctOption').sort({ availableFrom: 1 }).lean(),
    QuizAttempt.find({ student: req.user._id }).select('quiz status score startedAt endsAt submittedAt').lean(),
  ])
  const attemptMap = new Map(attempts.map((attempt) => [String(attempt.quiz), attempt]))
  return res.json({ success: true, quizzes: quizzes.map((quiz) => ({ ...quiz, attempt: attemptMap.get(String(quiz._id)) || null })) })
}

export async function startQuiz(req, res) {
  const quiz = await Quiz.findOne({ _id: req.params.id, class: req.user.class, isPublished: true }).exec()
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  const now = new Date()
  if (now < quiz.availableFrom || (quiz.dueDate && now > quiz.dueDate)) {
    return res.status(403).json({ success: false, message: 'This quiz is not currently available' })
  }
  const previousAttempts = await QuizAttempt.find({ quiz: quiz._id, student: req.user._id }).sort({ startedAt: -1 }).exec()
  const activeAttempt = previousAttempts.find((attempt) => attempt.status === 'in-progress' && attempt.endsAt > now)
  if (activeAttempt) return res.json({ success: true, attempt: activeAttempt, quiz: quizForStudent(quiz) })
  for (const attempt of previousAttempts.filter((item) => item.status === 'in-progress' && item.endsAt <= now)) {
    attempt.status = 'expired'
    attempt.submittedAt = attempt.endsAt
    await attempt.save()
  }
  if (previousAttempts.filter((item) => item.status !== 'in-progress').length >= quiz.attemptLimit) {
    return res.status(409).json({ success: false, message: 'You have used all available attempts' })
  }
  const maxScore = quiz.questions.reduce((total, question) => total + question.points, 0)
  const attempt = await QuizAttempt.create({
    quiz: quiz._id,
    student: req.user._id,
    endsAt: quiz.dueDate
      ? new Date(Math.min(now.getTime() + quiz.durationMinutes * 60_000, quiz.dueDate.getTime()))
      : new Date(now.getTime() + quiz.durationMinutes * 60_000),
    maxScore,
  })
  return res.status(201).json({ success: true, attempt, quiz: quizForStudent(quiz) })
}

function quizForStudent(quiz) {
  return {
    id: quiz._id,
    title: quiz.title,
    instructions: quiz.instructions,
    durationMinutes: quiz.durationMinutes,
    questions: quiz.questions.map(({ _id, prompt, options, points }) => ({ id: _id, prompt, options, points })),
  }
}

export async function submitQuizAttempt(req, res) {
  const attempt = await QuizAttempt.findOne({ _id: req.params.attemptId, student: req.user._id }).exec()
  if (!attempt) return res.status(404).json({ success: false, message: 'Quiz attempt not found' })
  if (attempt.status !== 'in-progress') return res.status(409).json({ success: false, message: 'This attempt has already been submitted' })
  if (new Date() > attempt.endsAt) {
    attempt.status = 'expired'
    attempt.submittedAt = attempt.endsAt
    await attempt.save()
    return res.status(409).json({ success: false, message: 'The quiz timer has expired' })
  }

  const quiz = await Quiz.findById(attempt.quiz).exec()
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  const answers = Array.isArray(req.body.answers) ? req.body.answers : []
  const answerMap = new Map(answers.map((answer) => [String(answer.questionId), Number(answer.selectedOption)]))
  let score = 0
  const storedAnswers = quiz.questions.map((question) => {
    const selectedOption = answerMap.get(String(question._id))
    if (selectedOption === question.correctOption) score += question.points
    return { question: question._id, ...(Number.isInteger(selectedOption) ? { selectedOption } : {}) }
  })
  attempt.answers = storedAnswers
  attempt.score = score
  attempt.submittedAt = new Date()
  attempt.status = 'submitted'
  await attempt.save()
  return res.json({ success: true, attempt: { id: attempt._id, score: attempt.score, maxScore: attempt.maxScore, submittedAt: attempt.submittedAt } })
}
