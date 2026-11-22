import mongoose from 'mongoose'
import Class from '../models/Class.js'
import Quiz from '../models/Quiz.js'
import QuizAttempt from '../models/QuizAttempt.js'
import User from '../models/User.js'
import { createNotification, notifyClassStudents, notifyUsers } from '../services/notifications.service.js'

const validStatuses = ['draft', 'published', 'closed']

function fail(status, message) {
  const error = new Error(message)
  error.status = status
  throw error
}

function asQuestion(input, index) {
  const type = input.questionType || input.type || 'multiple_choice'
  if (!['multiple_choice', 'true_false', 'short_answer'].includes(type)) fail(400, `Question ${index + 1} has an unsupported type`)
  const prompt = String(input.questionText ?? input.prompt ?? '').trim()
  if (!prompt || prompt.length > 2000) fail(400, `Question ${index + 1} needs text under 2,000 characters`)
  const marks = Number(input.marks ?? input.points ?? 1)
  if (!Number.isFinite(marks) || marks <= 0 || marks > 1000) fail(400, `Question ${index + 1} marks must be between 0 and 1,000`)
  let options = []
  let correctOption
  let correctAnswer
  if (type === 'multiple_choice') {
    options = Array.isArray(input.options) ? input.options.map((option) => String(option).trim()) : []
    if (options.length < 2 || options.length > 8 || options.some((option) => !option || option.length > 500)) fail(400, `Question ${index + 1} needs 2 to 8 non-empty options`)
    correctOption = Number(input.correctOption ?? input.correctAnswer)
    if (!Number.isInteger(correctOption) || correctOption < 0 || correctOption >= options.length) fail(400, `Choose a valid correct answer for question ${index + 1}`)
    correctAnswer = correctOption
  } else if (type === 'true_false') {
    options = ['True', 'False']
    const answer = input.correctAnswer ?? input.correctOption
    if (typeof answer === 'boolean') correctOption = answer ? 0 : 1
    else if (typeof answer === 'string' && ['true', 'false'].includes(answer.toLowerCase())) correctOption = answer.toLowerCase() === 'true' ? 0 : 1
    else if (Number.isInteger(Number(answer)) && [0, 1].includes(Number(answer))) correctOption = Number(answer)
    else fail(400, `Choose True or False for question ${index + 1}`)
    correctAnswer = correctOption === 0
  }
  return { prompt, questionType: type, options, correctOption, correctAnswer, points: marks, order: Number.isInteger(Number(input.order)) ? Number(input.order) : index }
}

function safeQuestion(question, includeCorrect = false) {
  const id = String(question._id)
  const result = {
    id,
    questionText: question.prompt,
    prompt: question.prompt,
    questionType: question.questionType || 'multiple_choice',
    options: question.options || [],
    marks: question.points,
    points: question.points,
    order: question.order || 0,
  }
  if (includeCorrect) {
    result.correctAnswer = question.questionType === 'true_false' ? question.correctOption === 0 : question.questionType === 'short_answer' ? null : question.correctOption
    result.correctOption = question.correctOption
  }
  return result
}

function safeQuiz(quiz, { includeCorrect = false } = {}) {
  const value = typeof quiz.toObject === 'function' ? quiz.toObject() : quiz
  const status = value.status || (value.isPublished ? 'published' : 'draft')
  return {
    ...value,
    classId: value.class,
    teacherId: value.createdBy,
    startDate: value.availableFrom,
    endDate: value.dueDate,
    totalMarks: value.questions.reduce((sum, question) => sum + Number(question.points || 0), 0),
    status,
    showResults: Boolean(value.showResults),
    questions: [...value.questions].sort((a, b) => (a.order || 0) - (b.order || 0)).map((question) => safeQuestion(question, includeCorrect)),
  }
}

function safeAttempt(attempt, { withAnswers = false } = {}) {
  const value = typeof attempt.toObject === 'function' ? attempt.toObject() : attempt
  const result = {
    id: String(value._id),
    _id: String(value._id),
    quizId: value.quiz,
    studentId: value.student,
    startedAt: value.startedAt,
    expiresAt: value.endsAt,
    endsAt: value.endsAt,
    submittedAt: value.submittedAt,
    status: value.status === 'in-progress' ? 'in_progress' : value.status === 'expired' ? 'auto_submitted' : value.status,
    score: value.score,
    maxScore: value.maxScore,
    gradedAt: value.gradedAt || null,
    pendingManualGrading: false,
  }
  if (withAnswers) result.answers = (value.answers || []).map((answer) => ({ questionId: String(answer.question), selectedOption: answer.selectedOption, textAnswer: answer.textAnswer || '', marksAwarded: answer.marksAwarded, feedback: answer.feedback || '' }))
  return result
}

async function ownedQuiz(teacherId, quizId) {
  if (!mongoose.isValidObjectId(quizId)) fail(400, 'A valid quiz ID is required')
  return Quiz.findOne({ _id: quizId, createdBy: teacherId }).exec()
}

async function requireAssignedClass(user, classId) {
  if (!mongoose.isValidObjectId(classId)) fail(400, 'Choose a valid class')
  if (!user.assignedClasses.some((id) => String(id) === String(classId))) fail(403, 'You can only create quizzes for classes assigned to you')
  const record = await Class.findOne({ _id: classId, isActive: true }).select('_id').lean()
  if (!record) fail(400, 'Choose an active assigned class')
}

function parseQuizInput(body, current = null) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const result = {}
  if ('title' in input) result.title = String(input.title).trim()
  if ('description' in input) result.description = String(input.description || '').trim()
  if ('instructions' in input) result.instructions = String(input.instructions || '').trim()
  if ('classId' in input || 'class' in input) result.class = input.classId ?? input.class
  if ('durationMinutes' in input) result.durationMinutes = Number(input.durationMinutes)
  if ('startDate' in input || 'availableFrom' in input) result.availableFrom = input.startDate ?? input.availableFrom
  if ('endDate' in input || 'dueDate' in input) result.dueDate = input.endDate ?? input.dueDate
  if ('showResults' in input) result.showResults = Boolean(input.showResults)
  if ('attemptLimit' in input) result.attemptLimit = Number(input.attemptLimit)
  if ('status' in input) result.status = input.status
  else if ('isPublished' in input) result.status = input.isPublished ? 'published' : 'draft'
  if ('questions' in input) {
    if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 100) fail(400, 'A quiz needs between 1 and 100 questions')
    result.questions = input.questions.map(asQuestion)
  }
  if (result.title !== undefined && (!result.title || result.title.length > 160)) fail(400, 'Title is required and must be 160 characters or less')
  if (result.durationMinutes !== undefined && (!Number.isInteger(result.durationMinutes) || result.durationMinutes < 1 || result.durationMinutes > 600)) fail(400, 'Quiz duration must be between 1 and 600 minutes')
  if (result.status && !validStatuses.includes(result.status)) fail(400, 'Choose draft, published, or closed status')
  if (result.startDate === '') result.availableFrom = new Date()
  if (result.endDate === '') result.dueDate = null
  if (result.availableFrom && Number.isNaN(new Date(result.availableFrom).getTime())) fail(400, 'Enter a valid quiz start date')
  if (result.dueDate && Number.isNaN(new Date(result.dueDate).getTime())) fail(400, 'Enter a valid quiz end date')
  if (result.attemptLimit !== undefined && (!Number.isInteger(result.attemptLimit) || result.attemptLimit < 1 || result.attemptLimit > 10)) fail(400, 'Attempt limit must be between 1 and 10')
  const startDate = result.availableFrom ?? current?.availableFrom
  const endDate = result.dueDate !== undefined ? result.dueDate : current?.dueDate
  if (startDate && endDate && new Date(endDate) <= new Date(startDate)) fail(400, 'End date must be after the start date')
  return result
}

export async function listTeacherQuizzesV2(req, res) {
  const quizzes = await Quiz.find({ createdBy: req.user._id }).populate('class', 'name classCode').sort({ updatedAt: -1 }).lean()
  const result = await Promise.all(quizzes.map(async (quiz) => ({ ...safeQuiz(quiz, { includeCorrect: true }), attemptsCount: await QuizAttempt.countDocuments({ quiz: quiz._id }) })))
  return res.json({ success: true, quizzes: result })
}

export async function createTeacherQuiz(req, res) {
  const input = parseQuizInput(req.body)
  await requireAssignedClass(req.user, input.class)
  if (!input.title || input.durationMinutes === undefined || !input.questions) fail(400, 'Add a title, duration, class, and at least one question')
  const quiz = await Quiz.create({ ...input, createdBy: req.user._id, status: input.status || 'draft' })
  if (quiz.status === 'published') await notifyClassStudents(quiz.class, { type: 'new_quiz', title: 'New quiz available', message: `${quiz.title} is ready for your class.`, senderId: req.user._id, relatedEntityType: 'quiz', relatedEntityId: quiz._id }, `quiz-published:${quiz._id}`)
  await quiz.populate('class', 'name classCode')
  return res.status(201).json({ success: true, quiz: safeQuiz(quiz, { includeCorrect: true }) })
}

export async function getTeacherQuiz(req, res) {
  const quiz = await ownedQuiz(req.user._id, req.params.id)
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  await quiz.populate('class', 'name classCode')
  return res.json({ success: true, quiz: safeQuiz(quiz, { includeCorrect: true }) })
}

export async function updateTeacherQuiz(req, res) {
  const quiz = await ownedQuiz(req.user._id, req.params.id)
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  const input = parseQuizInput(req.body, quiz)
  const wasPublished = quiz.status === 'published' || quiz.isPublished
  if ('class' in input) await requireAssignedClass(req.user, input.class)
  const hasAttempts = await QuizAttempt.exists({ quiz: quiz._id })
  if (hasAttempts && 'questions' in input) fail(409, 'Questions are locked after a student starts this quiz')
  if (hasAttempts && 'class' in input && String(input.class) !== String(quiz.class)) fail(409, 'A quiz class cannot change after students start attempts')
  for (const [key, value] of Object.entries(input)) quiz.set(key, value)
  await quiz.save()
  if (!wasPublished && quiz.status === 'published') await notifyClassStudents(quiz.class, { type: 'new_quiz', title: 'New quiz available', message: `${quiz.title} is ready for your class.`, senderId: req.user._id, relatedEntityType: 'quiz', relatedEntityId: quiz._id }, `quiz-published:${quiz._id}`)
  await quiz.populate('class', 'name classCode')
  return res.json({ success: true, quiz: safeQuiz(quiz, { includeCorrect: true }) })
}

export async function updateTeacherQuizStatus(req, res) {
  const quiz = await ownedQuiz(req.user._id, req.params.id)
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  const status = req.body?.status
  if (!validStatuses.includes(status)) fail(400, 'Choose draft, published, or closed status')
  if (status === 'draft' && await QuizAttempt.exists({ quiz: quiz._id })) fail(409, 'A quiz with student attempts cannot be moved back to draft')
  if (status === 'published') {
    await requireAssignedClass(req.user, quiz.class)
    if (!quiz.questions.length) fail(400, 'Add at least one question before publishing')
    if (quiz.dueDate && quiz.dueDate <= new Date()) fail(400, 'Set an end date in the future before publishing')
  }
  const wasPublished = quiz.status === 'published' || quiz.isPublished
  quiz.status = status
  await quiz.save()
  if (!wasPublished && status === 'published') await notifyClassStudents(quiz.class, { type: 'new_quiz', title: 'New quiz available', message: `${quiz.title} is ready for your class.`, senderId: req.user._id, relatedEntityType: 'quiz', relatedEntityId: quiz._id }, `quiz-published:${quiz._id}`)
  return res.json({ success: true, quiz: safeQuiz(quiz) })
}

export async function updateQuizResults(req, res) {
  const quiz = await ownedQuiz(req.user._id, req.params.id)
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  if (typeof req.body?.showResults !== 'boolean') fail(400, 'Choose whether quiz results should be released')
  const previouslyReleased = quiz.showResults
  quiz.showResults = req.body.showResults
  await quiz.save()
  if (!previouslyReleased && quiz.showResults) {
    const studentIds = await QuizAttempt.distinct('student', { quiz: quiz._id })
    await notifyUsers(studentIds, { type: 'quiz_results_released', title: 'Quiz results released', message: `Results for ${quiz.title} are now available.`, senderId: req.user._id, relatedEntityType: 'quiz', relatedEntityId: quiz._id }, `quiz-results:${quiz._id}`)
  }
  return res.json({ success: true, showResults: quiz.showResults })
}

function pendingManualAnswers(quiz, attempt) {
  return quiz.questions.some((question) => {
    if (question.questionType !== 'short_answer') return false
    const answer = attempt.answers.find((item) => String(item.question) === String(question._id))
    return Boolean(answer?.textAnswer?.trim()) && answer.marksAwarded === null
  })
}

function scoreAvailableToStudent(quiz, attempt) {
  const hasManualQuestions = quiz.questions.some((question) => question.questionType === 'short_answer')
  return hasManualQuestions
    ? attempt.status === 'graded'
    : ['submitted', 'auto_submitted', 'graded'].includes(attempt.status)
}

export async function listTeacherQuizAttempts(req, res) {
  const quiz = await ownedQuiz(req.user._id, req.params.id)
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  const attempts = await QuizAttempt.find({ quiz: quiz._id }).populate('student', 'fullName email studentId profileImage').sort({ startedAt: -1 }).exec()
  return res.json({ success: true, quiz: safeQuiz(quiz, { includeCorrect: true }), attempts: attempts.map((attempt) => ({ ...safeAttempt(attempt, { withAnswers: true }), student: attempt.student, pendingManualGrading: pendingManualAnswers(quiz, attempt) })) })
}

async function finalizeAttempt(quiz, attempt, automatic = false) {
  if (attempt.status !== 'in_progress' && attempt.status !== 'in-progress') return attempt
  const now = new Date()
  const answersByQuestion = new Map(attempt.answers.map((answer) => [String(answer.question), answer]))
  let score = 0
  for (const question of quiz.questions) {
    let answer = answersByQuestion.get(String(question._id))
    if (!answer) {
      answer = { question: question._id, textAnswer: '', marksAwarded: 0 }
      attempt.answers.push(answer)
      answersByQuestion.set(String(question._id), answer)
    }
    if (question.questionType === 'short_answer') {
      if (!answer.textAnswer?.trim()) answer.marksAwarded = 0
      else answer.marksAwarded = null
    } else {
      answer.marksAwarded = answer.selectedOption === question.correctOption ? question.points : 0
    }
    if (answer.marksAwarded !== null) score += Number(answer.marksAwarded || 0)
  }
  const status = automatic ? 'auto_submitted' : 'submitted'
  let gradedAt = null
  if (!automatic && !pendingManualAnswers(quiz, attempt)) {
    gradedAt = now
  }
  const finalized = await QuizAttempt.findOneAndUpdate(
    { _id: attempt._id, status: { $in: ['in_progress', 'in-progress'] } },
    { $set: { answers: attempt.answers, score, submittedAt: automatic ? attempt.endsAt : now, status: gradedAt ? 'graded' : status, gradedAt }, $unset: { activeKey: 1 } },
    { new: true, runValidators: true },
  )
  if (finalized) {
    if (pendingManualAnswers(quiz, finalized)) await createNotification({ recipientId: quiz.createdBy, type: 'quiz_completed', title: 'Quiz responses need grading', message: 'A student submitted written answers for a quiz.', relatedEntityType: 'quiz', relatedEntityId: quiz._id, dedupeKey: `quiz-manual-grading:${finalized._id}` })
    return finalized
  }
  const current = await QuizAttempt.findById(attempt._id).exec()
  return current
}

async function expireIfNeeded(quiz, attempt) {
  const now = new Date()
  if ((attempt.status === 'in_progress' || attempt.status === 'in-progress') && attempt.endsAt <= now) return finalizeAttempt(quiz, attempt, true)
  return attempt
}

function availableQuizQuery(classId) {
  return { class: classId, $or: [{ status: { $in: ['published', 'closed'] } }, { status: { $exists: false }, isPublished: true }] }
}

export async function listStudentQuizzesV2(req, res) {
  const quizzes = await Quiz.find(availableQuizQuery(req.user.class)).sort({ createdAt: -1, availableFrom: -1 }).lean()
  const attempts = await QuizAttempt.find({ student: req.user._id, quiz: { $in: quizzes.map((quiz) => quiz._id) } }).sort({ startedAt: -1 }).lean()
  const grouped = new Map()
  for (const attempt of attempts) {
    const key = String(attempt.quiz)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(attempt)
  }
  return res.json({ success: true, quizzes: quizzes.map((quiz) => {
    const history = (grouped.get(String(quiz._id)) || []).map((attempt) => {
      const item = safeAttempt(attempt)
      item.scoreAvailable = scoreAvailableToStudent(quiz, attempt)
      if (!item.scoreAvailable) { item.score = null; item.maxScore = null }
      return item
    })
    const latest = history[0] || null
    const item = safeQuiz(quiz)
    if (!quiz.showResults) item.questions = item.questions.map(({ correctAnswer, correctOption, ...question }) => question)
    return { ...item, questions: item.questions.map(({ id, ...question }) => ({ ...question, id })), attempt: latest, attempts: history, resultsReleased: Boolean(quiz.showResults) }
  }) })
}

async function studentQuiz(req, quizId) {
  if (!mongoose.isValidObjectId(quizId)) fail(400, 'A valid quiz ID is required')
  return Quiz.findOne({ _id: quizId, ...availableQuizQuery(req.user.class) }).exec()
}

function quizForStudent(quiz) {
  const item = safeQuiz(quiz)
  item.questions = item.questions.map(({ correctAnswer, correctOption, ...question }) => question)
  return item
}

export async function getStudentQuiz(req, res) {
  const quiz = await studentQuiz(req, req.params.id)
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  return res.json({ success: true, quiz: quizForStudent(quiz), resultsReleased: Boolean(quiz.showResults) })
}

export async function startStudentQuiz(req, res) {
  const quiz = await studentQuiz(req, req.params.id)
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  const now = new Date()
  let previous = await QuizAttempt.find({ quiz: quiz._id, student: req.user._id }).sort({ startedAt: -1 }).exec()
  for (const item of previous) await expireIfNeeded(quiz, item)
  previous = await QuizAttempt.find({ quiz: quiz._id, student: req.user._id }).sort({ startedAt: -1 }).exec()
  const active = previous.find((item) => ['in_progress', 'in-progress'].includes(item.status) && item.endsAt > now)
  if (active) {
    return res.json({ success: true, attempt: safeAttempt(active, { withAnswers: true }), quiz: quizForStudent(quiz), serverNow: now })
  }
  if (quiz.status !== 'published' && quiz.isPublished !== true) fail(403, 'This quiz is closed to new attempts')
  const start = quiz.availableFrom || quiz.createdAt
  if (start && now < start) fail(403, 'This quiz is not available yet')
  if (quiz.dueDate && now >= quiz.dueDate) fail(403, 'The quiz availability window has ended')
  const attemptLimit = quiz.attemptLimit || 1
  if (previous.some((item) => ['submitted', 'auto_submitted', 'graded', 'expired'].includes(item.status)) && previous.filter((item) => ['submitted', 'auto_submitted', 'graded', 'expired'].includes(item.status)).length >= attemptLimit) fail(409, 'You have used all available attempts')
  const expiresAt = new Date(Math.min(now.getTime() + quiz.durationMinutes * 60_000, quiz.dueDate ? quiz.dueDate.getTime() : Infinity))
  const maxScore = quiz.questions.reduce((sum, question) => sum + Number(question.points), 0)
  try {
    const attempt = await QuizAttempt.create({ quiz: quiz._id, student: req.user._id, startedAt: now, endsAt: expiresAt, maxScore, status: 'in_progress', activeKey: `${quiz._id}:${req.user._id}` })
    return res.status(201).json({ success: true, attempt: safeAttempt(attempt, { withAnswers: true }), quiz: quizForStudent(quiz), serverNow: now })
  } catch (error) {
    if (error.code === 11000) {
      const activeAttempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id, status: 'in_progress' }).exec()
      if (activeAttempt) return res.json({ success: true, attempt: safeAttempt(activeAttempt, { withAnswers: true }), quiz: quizForStudent(quiz), serverNow: new Date() })
    }
    throw error
  }
}

export async function getStudentQuizAttempt(req, res) {
  const quiz = await studentQuiz(req, req.params.id)
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' })
  let attempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id, status: { $in: ['in_progress', 'in-progress'] } }).sort({ startedAt: -1 }).exec()
  if (!attempt) return res.status(404).json({ success: false, message: 'There is no active attempt for this quiz' })
  attempt = await expireIfNeeded(quiz, attempt)
  return res.json({ success: true, quiz: quizForStudent(quiz), attempt: safeAttempt(attempt, { withAnswers: true }), serverNow: new Date() })
}

async function ownAttempt(studentId, attemptId) {
  if (!mongoose.isValidObjectId(attemptId)) fail(400, 'A valid attempt ID is required')
  const attempt = await QuizAttempt.findOne({ _id: attemptId, student: studentId }).exec()
  if (!attempt) fail(404, 'Quiz attempt not found')
  const quiz = await Quiz.findById(attempt.quiz).exec()
  if (!quiz || String(quiz.class) !== String((await User.findById(studentId).select('class').lean())?.class)) fail(404, 'Quiz attempt not found')
  return { attempt, quiz }
}

export async function saveStudentQuizAnswers(req, res) {
  const { attempt, quiz } = await ownAttempt(req.user._id, req.params.attemptId)
  const currentAttempt = await expireIfNeeded(quiz, attempt)
  if (currentAttempt.status !== 'in_progress') return res.status(409).json({ success: false, message: 'This quiz attempt is no longer accepting answers', attempt: safeAttempt(currentAttempt, { withAnswers: true }) })
  if (!Array.isArray(req.body?.answers)) fail(400, 'Answers must be provided as a list')
  const questionMap = new Map(quiz.questions.map((question) => [String(question._id), question]))
  const incoming = new Map()
  for (const value of req.body.answers) {
    const id = String(value.questionId || value.question || '')
    const question = questionMap.get(id)
    if (!question || incoming.has(id)) fail(400, 'Answer list contains an unknown or duplicate question')
    const answer = { question: question._id }
    if (question.questionType === 'short_answer') {
      answer.textAnswer = String(value.textAnswer || '').slice(0, 10000)
      if ('selectedOption' in value) fail(400, 'Short answer questions require a text response')
    } else {
      const selectedOption = Number(value.selectedOption)
      if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption >= question.options.length) fail(400, 'Choose one of the listed answer options')
      answer.selectedOption = selectedOption
      answer.textAnswer = ''
    }
    answer.marksAwarded = null
    incoming.set(id, answer)
  }
  const saved = new Map(currentAttempt.answers.map((answer) => [String(answer.question), answer.toObject()]))
  for (const [id, value] of incoming) saved.set(id, value)
  const serverNow = new Date()
  const updated = await QuizAttempt.findOneAndUpdate(
    { _id: currentAttempt._id, status: { $in: ['in_progress', 'in-progress'] }, endsAt: { $gt: serverNow } },
    { $set: { answers: [...saved.values()] } },
    { new: true, runValidators: true },
  )
  if (!updated) {
    const fresh = await QuizAttempt.findById(currentAttempt._id).exec()
    if (fresh?.status === 'in_progress' && fresh.endsAt <= serverNow) await expireIfNeeded(quiz, fresh)
    return res.status(409).json({ success: false, message: 'This quiz attempt is no longer accepting answers', attempt: fresh ? safeAttempt(fresh) : undefined })
  }
  return res.json({ success: true, attempt: safeAttempt(updated, { withAnswers: true }), serverNow })
}

export async function submitStudentQuizAttempt(req, res) {
  let { attempt, quiz } = await ownAttempt(req.user._id, req.params.attemptId)
  attempt = await expireIfNeeded(quiz, attempt)
  if (attempt.status !== 'in_progress') return res.status(409).json({ success: false, message: 'This attempt has already been submitted', attempt: safeAttempt(attempt) })
  attempt = await finalizeAttempt(quiz, attempt)
  const output = safeAttempt(attempt)
  const resultsReleased = scoreAvailableToStudent(quiz, attempt)
  if (!resultsReleased) { output.score = null; output.maxScore = null }
  return res.json({ success: true, attempt: output, resultsReleased, detailsReleased: Boolean(quiz.showResults) })
}

export async function getStudentQuizResult(req, res) {
  let { attempt, quiz } = await ownAttempt(req.user._id, req.params.attemptId)
  if (attempt.status === 'in_progress' || attempt.status === 'in-progress') attempt = await expireIfNeeded(quiz, attempt)
  if (!scoreAvailableToStudent(quiz, attempt)) return res.json({ success: true, released: false, status: safeAttempt(attempt).status })
  const detailsReleased = Boolean(quiz.showResults)
  const result = safeAttempt(attempt, { withAnswers: detailsReleased })
  if (detailsReleased) {
    result.questions = quiz.questions.map((question) => {
      const answer = attempt.answers.find((item) => String(item.question) === String(question._id))
      return { ...safeQuestion(question, true), selectedOption: answer?.selectedOption, textAnswer: answer?.textAnswer || '', marksAwarded: answer?.marksAwarded ?? null, feedback: answer?.feedback || '' }
    })
  } else {
    result.questions = quiz.questions.map((question) => {
      const answer = attempt.answers.find((item) => String(item.question) === String(question._id))
      return { id: String(question._id), questionText: question.prompt, questionType: question.questionType, marks: question.points, marksAwarded: answer?.marksAwarded ?? null }
    })
  }
  return res.json({ success: true, released: true, detailsReleased, result })
}

export async function getStudentQuizReview(req, res) {
  let { attempt, quiz } = await ownAttempt(req.user._id, req.params.attemptId)
  if (attempt.status === 'in_progress' || attempt.status === 'in-progress') attempt = await expireIfNeeded(quiz, attempt)
  if (attempt.status === 'in_progress' || attempt.status === 'in-progress') fail(409, 'Submit this quiz before reviewing it')
  const detailsReleased = Boolean(quiz.showResults)
  const scoreReleased = scoreAvailableToStudent(quiz, attempt)
  const questions = [...quiz.questions].sort((a, b) => (a.order || 0) - (b.order || 0)).map((question) => {
    const answer = attempt.answers.find((item) => String(item.question) === String(question._id))
    const item = { ...safeQuestion(question, detailsReleased), selectedOption: answer?.selectedOption ?? null, textAnswer: answer?.textAnswer || '' }
    if (scoreReleased) { item.marksAwarded = answer?.marksAwarded ?? null; item.feedback = answer?.feedback || '' }
    return item
  })
  const output = safeAttempt(attempt)
  if (!scoreReleased) { output.score = null; output.maxScore = null }
  return res.json({ success: true, readOnly: true, detailsReleased, scoreReleased, quiz: { _id: quiz._id, title: quiz.title }, attempt: output, questions })
}

export async function gradeTeacherQuizAnswer(req, res) {
  const { attemptId } = req.params
  if (!mongoose.isValidObjectId(attemptId)) fail(400, 'A valid attempt ID is required')
  let attempt = await QuizAttempt.findById(attemptId).exec()
  if (!attempt) return res.status(404).json({ success: false, message: 'Quiz attempt not found' })
  const quiz = await Quiz.findOne({ _id: attempt.quiz, createdBy: req.user._id }).exec()
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz attempt not found' })
  attempt = await expireIfNeeded(quiz, attempt)
  if (attempt.status === 'in_progress' || attempt.status === 'in-progress') fail(409, 'Wait until the student submits before grading')
  const questionId = String(req.body?.questionId || '')
  const question = quiz.questions.find((item) => String(item._id) === questionId)
  if (!question) fail(404, 'Quiz question not found')
  const answer = attempt.answers.find((item) => String(item.question) === questionId)
  if (!answer) fail(409, 'The student has no answer record for this question')
  const marks = Number(req.body?.marksAwarded)
  if (!Number.isFinite(marks) || marks < 0 || marks > question.points) fail(400, `Marks must be between 0 and ${question.points}`)
  answer.marksAwarded = marks
  answer.feedback = String(req.body.feedback || '').trim().slice(0, 3000)
  attempt.score = attempt.answers.reduce((sum, item) => sum + (item.marksAwarded === null ? 0 : Number(item.marksAwarded || 0)), 0)
  if (!pendingManualAnswers(quiz, attempt)) { attempt.status = 'graded'; attempt.gradedAt = new Date() }
  await attempt.save()
  if (attempt.status === 'graded') {
    await createNotification({ recipientId: attempt.student, type: 'quiz_results_released', title: 'Quiz marks are ready', message: `Your marks for ${quiz.title} are ready to view.`, senderId: quiz.createdBy, relatedEntityType: 'quiz', relatedEntityId: quiz._id }, `quiz-marks-ready:${attempt._id}`)
  }
  return res.json({ success: true, attempt: safeAttempt(attempt, { withAnswers: true }), pendingManualGrading: pendingManualAnswers(quiz, attempt) })
}
