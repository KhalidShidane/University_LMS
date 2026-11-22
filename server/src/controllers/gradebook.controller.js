import mongoose from 'mongoose'
import Assignment from '../models/Assignment.js'
import Class from '../models/Class.js'
import Quiz from '../models/Quiz.js'
import QuizAttempt from '../models/QuizAttempt.js'
import Submission from '../models/Submission.js'
import User from '../models/User.js'
import { STYLE, createStyledWorkbook } from '../services/gradebookWorkbook.service.js'

// Quizzes and assignments are always exported separately (never mixed in one file).
const TYPES = ['assignments', 'quizzes']
const REPORTS = ['marks', 'missing']
const COMPLETED_QUIZ = ['submitted', 'auto_submitted', 'graded']
const publishedAssignment = { $or: [{ status: { $in: ['published', 'closed'] } }, { status: { $exists: false }, isPublished: true }] }
const fail = (status, message) => Object.assign(new Error(message), { status })
const round = (value) => Math.round(Number(value) * 100) / 100
const dateText = (value) => (value ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') : '')
const slug = (value, fallback) => String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || fallback

function assertTeacherClass(req, classId) {
  if (!mongoose.isValidObjectId(classId)) throw fail(400, 'Choose a valid class')
  if (!(req.user.assignedClasses || []).some((id) => String(id) === String(classId))) throw fail(403, 'You can only export classes assigned to you')
}

/** The teacher's own published quizzes or assignments for a class, oldest first, numbered Q1/A1… */
async function teacherItems({ teacherId, classId, type }) {
  const list = type === 'quizzes'
    ? await Quiz.find({ class: classId, createdBy: teacherId, status: { $in: ['published', 'closed'] } }).select('title dueDate totalMarks questions.questionType createdAt').sort({ createdAt: 1 }).lean()
    : await Assignment.find({ class: classId, createdBy: teacherId, ...publishedAssignment }).select('title dueDate totalMarks maxScore createdAt').sort({ createdAt: 1 }).lean()
  const prefix = type === 'quizzes' ? 'Q' : 'A'
  return list.map((item, index) => ({
    id: String(item._id),
    code: `${prefix}${index + 1}`,
    title: item.title,
    max: item.totalMarks || item.maxScore || null,
    dueDate: item.dueDate || null,
    manual: (item.questions || []).some((question) => question.questionType === 'short_answer'),
  }))
}

/** Teacher: the quizzes or assignments that can be exported for a class (for the picker). */
export async function listGradebookItems(req, res) {
  const { classId } = req.params
  assertTeacherClass(req, classId)
  const type = TYPES.includes(req.query.type) ? req.query.type : null
  if (!type) throw fail(400, 'Choose quizzes or assignments')
  const items = await teacherItems({ teacherId: req.user._id, classId, type })
  return res.json({ success: true, items: items.map(({ id, code, title, max, dueDate }) => ({ id, code, title, max, dueDate })) })
}

/** Marks for the chosen items: results[itemId][studentId] = { state: 'graded'|'pending'|'missing', mark } */
export async function buildClassGradebook({ teacherId, classId, type, itemId = null, now = new Date() }) {
  const academicClass = await Class.findById(classId).select('name classCode').lean()
  if (!academicClass) throw fail(404, 'Class not found')
  let items = await teacherItems({ teacherId, classId, type })
  if (itemId) {
    items = items.filter((item) => item.id === String(itemId))
    if (!items.length) throw fail(404, `That ${type === 'quizzes' ? 'quiz' : 'assignment'} was not found in this class`)
  }
  const students = await User.find({ role: 'student', class: classId, isActive: true }).select('fullName studentId').sort({ fullName: 1 }).lean()
  const ids = items.map((item) => item.id)
  const results = Object.fromEntries(ids.map((id) => [id, {}]))

  if (ids.length && type === 'assignments') {
    const submissions = await Submission.find({ assignment: { $in: ids } }).select('assignment student marksAwarded score').lean()
    for (const submission of submissions) {
      const mark = submission.marksAwarded ?? submission.score
      results[String(submission.assignment)][String(submission.student)] = mark == null ? { state: 'pending' } : { state: 'graded', mark: round(mark) }
    }
  }
  if (ids.length && type === 'quizzes') {
    const manual = new Map(items.map((item) => [item.id, item.manual]))
    const attempts = await QuizAttempt.find({ quiz: { $in: ids }, status: { $in: COMPLETED_QUIZ } }).select('quiz student score status').lean()
    for (const attempt of attempts) {
      const quizId = String(attempt.quiz)
      const next = attempt.score == null || (attempt.status === 'submitted' && manual.get(quizId)) ? { state: 'pending' } : { state: 'graded', mark: round(attempt.score) }
      const current = results[quizId][String(attempt.student)]
      // Best attempt counts; a graded attempt beats a pending one.
      if (!current || (next.state === 'graded' && (current.state !== 'graded' || next.mark > current.mark))) results[quizId][String(attempt.student)] = next
    }
  }
  for (const item of items) for (const student of students) results[item.id][String(student._id)] ||= { state: 'missing' }
  return { academicClass, students, items, results, type, now }
}

const header = (labels) => labels.map((value) => ({ value, style: STYLE.header }))
const classLabel = (academicClass) => `${academicClass.classCode || ''} ${academicClass.name || ''}`.trim()

function resultCell(result) {
  if (result.state === 'graded') return { value: result.mark, style: STYLE.mark }
  if (result.state === 'pending') return { value: 'Pending grading', style: STYLE.pending }
  return { value: 'Not submitted', style: STYLE.missing }
}

/** One sheet: every student with their marks (one column per item when exporting all items). */
export function marksSheet({ academicClass, students, items, results }) {
  const single = items.length === 1
  const itemHeader = (item) => `${item.code}: ${item.title}${item.max ? ` (/${item.max})` : ''}`
  const labels = single
    ? ['No.', 'Student ID', 'Student name', 'Class', itemHeader(items[0]), 'Status']
    : ['No.', 'Student ID', 'Student name', 'Class', ...items.map(itemHeader), 'Submitted', 'Not submitted']
  const rows = students.map((student, index) => {
    const studentId = String(student._id)
    const base = [{ value: index + 1, style: STYLE.muted }, { value: student.studentId || '', style: STYLE.muted }, { value: student.fullName, style: STYLE.bold }, { value: classLabel(academicClass), style: STYLE.muted }]
    if (single) {
      const result = results[items[0].id][studentId]
      const status = result.state === 'graded' ? 'Graded' : result.state === 'pending' ? 'Submitted, not graded' : 'Not submitted'
      return [...base, resultCell(result), { value: status, style: result.state === 'missing' ? STYLE.missing : result.state === 'pending' ? STYLE.pending : STYLE.mark }]
    }
    const missing = items.filter((item) => results[item.id][studentId].state === 'missing').length
    return [...base, ...items.map((item) => resultCell(results[item.id][studentId])), { value: items.length - missing, style: STYLE.bold }, { value: missing, style: missing ? STYLE.missing : STYLE.mark }]
  })
  const empty = items.length ? [] : [[{ value: 'There is nothing published to export for this class yet.', style: STYLE.muted }]]
  return {
    name: 'Marks',
    rows: [header(labels), ...rows, ...empty],
    widths: single ? [6, 14, 30, 20, 26, 22] : [6, 14, 30, 20, ...items.map(() => 22), 11, 13],
    freeze: { rows: 1, cols: 3 },
    filterRow: 1,
  }
}

/** One sheet: only the students who did not submit (per item when exporting all items). */
export function missingSheet({ academicClass, students, items, results, now }) {
  const rows = []
  for (const item of items) {
    for (const student of students) {
      if (results[item.id][String(student._id)].state !== 'missing') continue
      const overdue = item.dueDate && new Date(item.dueDate) < now
      rows.push([
        { value: rows.length + 1, style: STYLE.muted }, { value: student.studentId || '', style: STYLE.muted }, { value: student.fullName, style: STYLE.bold }, { value: classLabel(academicClass), style: STYLE.muted },
        `${item.code}: ${item.title}`, dateText(item.dueDate),
        { value: overdue ? 'Not submitted (deadline passed)' : 'Not submitted yet', style: STYLE.missing },
      ])
    }
  }
  return {
    name: 'Not submitted',
    rows: [header(['No.', 'Student ID', 'Student name', 'Class', 'Item', 'Deadline', 'Status']), ...(rows.length ? rows : [[{ value: 'Every student has submitted.', style: STYLE.mark }]])],
    widths: [6, 14, 30, 20, 36, 17, 30],
    freeze: { rows: 1, cols: 3 },
    filterRow: rows.length ? 1 : null,
  }
}

/** Teacher: download quizzes or assignments for one class, all items or a single one, as marks or not-submitted list. */
export async function exportClassGradebook(req, res) {
  const { classId } = req.params
  assertTeacherClass(req, classId)
  const type = TYPES.includes(req.query.type) ? req.query.type : null
  if (!type) throw fail(400, 'Choose quizzes or assignments')
  const report = REPORTS.includes(req.query.report) ? req.query.report : 'marks'
  const itemId = req.query.itemId || null
  if (itemId && !mongoose.isValidObjectId(itemId)) throw fail(400, 'Choose a valid item')
  const data = await buildClassGradebook({ teacherId: req.user._id, classId, type, itemId })
  const sheet = report === 'missing' ? missingSheet(data) : marksSheet(data)
  const workbook = await createStyledWorkbook([sheet])
  const what = itemId ? `${type === 'quizzes' ? 'quiz' : 'assignment'}-${slug(data.items[0].title, data.items[0].code.toLowerCase())}` : `all-${type}`
  const name = `${slug(data.academicClass.classCode || data.academicClass.name, 'class')}-${what}-${report === 'missing' ? 'not-submitted' : 'marks'}-${new Date().toISOString().slice(0, 10)}.xlsx`
  return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(name).send(workbook)
}
