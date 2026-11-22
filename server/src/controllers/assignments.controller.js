import mongoose from 'mongoose'
import Assignment from '../models/Assignment.js'
import Class from '../models/Class.js'
import Submission from '../models/Submission.js'
import User from '../models/User.js'
import {
  allowedAssignmentFiles,
  assignmentFilePath,
  extensionOf,
  hasValidSignature,
  maxAssignmentAttachments,
  maxAttachmentBytes,
  maxSubmissionBytes,
  removeStoredFile,
  safeOriginalName,
  storeAssignmentAttachment,
  storeSubmission,
  submissionFilePath,
  submissionImageExtensions,
} from '../services/assignmentFiles.service.js'
import { notifyClassStudents, createNotification } from '../services/notifications.service.js'
import { loadSystemSettings } from '../services/systemSettings.service.js'

const statuses = ['draft', 'published', 'closed']
const paging = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25))
  return { page, limit, skip: (page - 1) * limit }
}
const fail = (status, message) => Object.assign(new Error(message), { status })
const objectId = (value) => mongoose.isValidObjectId(value)
function requestObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Request body must be a JSON object')
  return body
}
function validateText(body, key, maxLength, required = false) {
  if (!Object.hasOwn(body, key)) return
  if (typeof body[key] !== 'string' || body[key].length > maxLength || (required && !body[key].trim())) throw fail(400, `${key} must be a non-empty string of ${maxLength} characters or fewer`)
}
function parseDeadline(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw fail(400, 'Enter a valid assignment deadline with timezone information')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw fail(400, 'Enter a valid assignment deadline')
  return date
}
const regex = (value) => {
  const text = String(value || '').trim().slice(0, 80)
  return text ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null
}
const statusOf = (assignment) => assignment.status || (assignment.isPublished ? 'published' : 'draft')
const totalMarksOf = (assignment) => assignment.totalMarks ?? assignment.maxScore ?? 100
const publicAttachments = (items = []) => items.map(({ _id, originalName, mimeType, size, uploadedAt }) => ({ _id, originalName, mimeType, size, uploadedAt }))

async function teacherClass(user, classId) {
  if (!objectId(classId)) throw fail(400, 'Choose a valid class')
  if (!user.assignedClasses.some((id) => String(id) === String(classId))) throw fail(403, 'You can only manage assignments for classes assigned to you')
  if (!await Class.exists({ _id: classId, isActive: true })) throw fail(400, 'Choose an active assigned class')
}

async function ownedAssignment(teacherId, id) {
  if (!objectId(id)) throw fail(400, 'A valid assignment ID is required')
  return Assignment.findOne({ _id: id, createdBy: teacherId }).exec()
}

function publicSubmission(submission, revealGrade = true) {
  if (!submission) return null
  const item = typeof submission.toObject === 'function' ? submission.toObject() : submission
  const graded = revealGrade && (item.status === 'graded' || item.status === 'returned' || item.marksAwarded != null || item.score != null)
  return {
    id: item._id,
    originalName: item.originalName,
    mimeType: item.mimeType,
    size: item.size,
    submittedAt: item.submittedAt,
    status: item.status,
    ...(graded ? {
      marksAwarded: item.marksAwarded ?? item.score,
      score: item.marksAwarded ?? item.score,
      feedback: item.feedback || '',
      gradedAt: item.gradedAt,
    } : {}),
  }
}

function assignmentForStudent(assignment, submission) {
  const item = typeof assignment.toObject === 'function' ? assignment.toObject() : assignment
  return {
    ...item,
    status: statusOf(item),
    totalMarks: totalMarksOf(item),
    maxScore: totalMarksOf(item),
    submission: publicSubmission(submission),
    attachments: publicAttachments(item.attachments || []),
  }
}

function deadlineState(assignment, now = new Date()) {
  if (statusOf(assignment) === 'closed') return 'closed'
  const due = new Date(assignment.dueDate)
  if (due < now) return 'overdue'
  if (due.getTime() <= now.getTime() + 24 * 60 * 60 * 1000) return 'due'
  return 'upcoming'
}

export async function listTeacherAssignments(req, res) {
  const { page, limit, skip } = paging(req.query)
  const query = { createdBy: req.user._id }
  if (req.query.class) {
    if (!objectId(req.query.class)) throw fail(400, 'A valid class filter is required')
    query.class = req.query.class
  }
  if (statuses.includes(req.query.status)) {
    if (req.query.status === 'published') query.$or = [{ status: 'published' }, { status: { $exists: false }, isPublished: true }]
    else if (req.query.status === 'draft') query.$or = [{ status: 'draft' }, { status: { $exists: false }, isPublished: false }]
    else query.status = 'closed'
  }
  const search = regex(req.query.search)
  if (search) (query.$and ||= []).push({ $or: [{ title: search }, { description: search }, { instructions: search }] })
  const now = new Date()
  if (req.query.deadline === 'upcoming') query.dueDate = { $gt: new Date(now.getTime() + 24 * 60 * 60 * 1000) }
  if (req.query.deadline === 'due') query.dueDate = { $gte: now, $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) }
  if (req.query.deadline === 'overdue') query.dueDate = { $lt: now }
  const [assignments, total] = await Promise.all([
    Assignment.find(query).populate('class', 'name classCode').sort({ dueDate: 1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Assignment.countDocuments(query),
  ])
  const ids = assignments.map((item) => item._id)
  const submissions = await Submission.aggregate([
    { $match: { assignment: { $in: ids } } },
    { $group: { _id: '$assignment', submitted: { $sum: 1 }, graded: { $sum: { $cond: [{ $or: [{ $in: ['$status', ['graded', 'returned']] }, { $ne: ['$score', null] }] }, 1, 0] } } } },
  ])
  const counts = new Map(submissions.map((item) => [String(item._id), item]))
  return res.json({ success: true, assignments: assignments.map((item) => {
    const count = counts.get(String(item._id)) || { submitted: 0, graded: 0 }
    return { ...item, attachments: publicAttachments(item.attachments), status: statusOf(item), totalMarks: totalMarksOf(item), maxScore: totalMarksOf(item), deadlineState: deadlineState(item, now), submittedCount: count.submitted, gradedCount: count.graded }
  }), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

export async function createTeacherAssignment(req, res) {
  const body = requestObject(req.body)
  validateText(body, 'title', 160, true)
  validateText(body, 'description', 5000)
  validateText(body, 'instructions', 10000)
  await teacherClass(req.user, body.classId || body.class)
  const dueDate = parseDeadline(body.dueDate)
  const totalMarks = Number(body.totalMarks ?? body.maxScore ?? 100)
  if (!Number.isFinite(totalMarks) || totalMarks <= 0 || totalMarks > 10000) throw fail(400, 'Total marks must be a positive number no greater than 10000')
  if (body.status && !statuses.includes(body.status)) throw fail(400, 'Choose draft, published, or closed status')
  if (!String(body.title || '').trim()) throw fail(400, 'Assignment title is required')
  const assignment = await Assignment.create({
    title: body.title,
    description: body.description || '',
    instructions: body.instructions || '',
    class: body.classId || body.class,
    lesson: body.lesson || null,
    createdBy: req.user._id,
    dueDate,
    maxScore: totalMarks,
    totalMarks,
    status: body.status || (body.isPublished === false ? 'draft' : 'published'),
  })
  if (statusOf(assignment) === 'published') await notifyClassStudents(assignment.class, { type: 'new_assignment', title: 'New assignment available', message: `${assignment.title} is ready for your class.`, senderId: req.user._id, relatedEntityType: 'assignment', relatedEntityId: assignment._id }, `assignment-published:${assignment._id}`)
  await assignment.populate('class', 'name classCode')
  return res.status(201).json({ success: true, assignment: { ...assignment.toObject(), status: statusOf(assignment), totalMarks } })
}

export async function getTeacherAssignment(req, res) {
  const assignment = await ownedAssignment(req.user._id, req.params.id)
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  await assignment.populate('class', 'name classCode')
  return res.json({ success: true, assignment: { ...assignment.toObject(), attachments: publicAttachments(assignment.attachments), status: statusOf(assignment), totalMarks: totalMarksOf(assignment), maxScore: totalMarksOf(assignment) } })
}

export async function updateTeacherAssignment(req, res) {
  const assignment = await ownedAssignment(req.user._id, req.params.id)
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  const wasPublished = statusOf(assignment) === 'published'
  const body = requestObject(req.body)
  validateText(body, 'title', 160, true)
  validateText(body, 'description', 5000)
  validateText(body, 'instructions', 10000)
  const nextClass = body.classId || body.class
  if (nextClass) {
    await teacherClass(req.user, nextClass)
    if (String(nextClass) !== String(assignment.class) && await Submission.exists({ assignment: assignment._id })) throw fail(409, 'Class cannot be changed after student submissions exist')
  }
  if (Object.hasOwn(body, 'dueDate')) {
    assignment.dueDate = parseDeadline(body.dueDate)
  }
  if (Object.hasOwn(body, 'totalMarks') || Object.hasOwn(body, 'maxScore')) {
    const marks = Number(body.totalMarks ?? body.maxScore)
    if (!Number.isFinite(marks) || marks <= 0 || marks > 10000) throw fail(400, 'Total marks must be a positive number no greater than 10000')
    const highestAwarded = await Submission.findOne({ assignment: assignment._id, $or: [{ marksAwarded: { $gt: marks } }, { marksAwarded: null, score: { $gt: marks } }] }).select('_id').lean()
    if (highestAwarded) throw fail(409, 'Total marks cannot be lower than a grade already awarded')
    assignment.totalMarks = marks
    assignment.maxScore = marks
  }
  for (const field of ['title', 'description', 'instructions', 'lesson']) if (Object.hasOwn(body, field)) assignment.set(field, body[field])
  if (nextClass) assignment.class = nextClass
  if (Object.hasOwn(body, 'status')) {
    if (!statuses.includes(body.status)) throw fail(400, 'Choose draft, published, or closed status')
    assignment.status = body.status
  } else if (typeof body.isPublished === 'boolean') assignment.status = body.isPublished ? 'published' : 'draft'
  await assignment.save()
  if (!wasPublished && statusOf(assignment) === 'published') await notifyClassStudents(assignment.class, { type: 'new_assignment', title: 'New assignment available', message: `${assignment.title} is ready for your class.`, senderId: req.user._id, relatedEntityType: 'assignment', relatedEntityId: assignment._id }, `assignment-published:${assignment._id}`)
  await assignment.populate('class', 'name classCode')
  return res.json({ success: true, assignment: { ...assignment.toObject(), attachments: publicAttachments(assignment.attachments), status: statusOf(assignment), totalMarks: totalMarksOf(assignment), maxScore: totalMarksOf(assignment) } })
}

export async function updateTeacherAssignmentStatus(req, res) {
  const assignment = await ownedAssignment(req.user._id, req.params.id)
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  const { status } = requestObject(req.body)
  if (!statuses.includes(status)) throw fail(400, 'Choose draft, published, or closed status')
  if (status === 'published') await teacherClass(req.user, assignment.class)
  const wasPublished = statusOf(assignment) === 'published'
  assignment.status = status
  await assignment.save()
  if (!wasPublished && statusOf(assignment) === 'published') await notifyClassStudents(assignment.class, { type: 'new_assignment', title: 'New assignment available', message: `${assignment.title} is ready for your class.`, senderId: req.user._id, relatedEntityType: 'assignment', relatedEntityId: assignment._id }, `assignment-published:${assignment._id}`)
  return res.json({ success: true, assignment: { id: assignment._id, status: assignment.status, isPublished: assignment.isPublished } })
}

export async function addAssignmentAttachments(req, res) {
  const assignment = await ownedAssignment(req.user._id, req.params.id)
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  if (!Array.isArray(req.files) || !req.files.length) throw fail(400, 'Choose one or more assignment files')
  const settings = await loadSystemSettings()
  if (req.files.some((file) => file.size > Math.min(maxAttachmentBytes, settings.uploads.maxFileSizeMB * 1024 * 1024))) throw fail(413, 'A file exceeds the current upload size limit')
  if (assignment.attachments.length + req.files.length > maxAssignmentAttachments) throw fail(400, `An assignment can have up to ${maxAssignmentAttachments} attachments`)
  for (const file of req.files) {
    const ext = extensionOf(file.originalname)
    if (file.size > maxAttachmentBytes || !allowedAssignmentFiles[ext]?.includes(file.mimetype) || !hasValidSignature(file, ext)) throw fail(400, `The file "${safeOriginalName(file.originalname)}" is not a valid supported attachment`)
  }
  const stored = []
  try {
    const attachments = []
    for (const file of req.files) {
      const ext = extensionOf(file.originalname)
      const storedName = await storeAssignmentAttachment(file, ext)
      stored.push(assignmentFilePath(storedName))
      attachments.push({ originalName: safeOriginalName(file.originalname), storedName, mimeType: file.mimetype, size: file.size, uploadedAt: new Date() })
    }
    assignment.attachments.push(...attachments)
    await assignment.save()
  } catch (error) {
    await Promise.all(stored.map(removeStoredFile))
    throw error
  }
  return res.status(201).json({ success: true, attachments: assignment.attachments.map(({ _id, originalName, mimeType, size }) => ({ _id, originalName, mimeType, size })) })
}

export async function downloadAssignmentAttachment(req, res, next) {
  if (!objectId(req.params.id) || !objectId(req.params.attachmentId)) throw fail(400, 'A valid assignment and attachment ID are required')
  const assignment = await Assignment.findById(req.params.id).exec()
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  if (req.user.role === 'teacher' && String(assignment.createdBy) !== String(req.user._id)) return res.status(404).json({ success: false, message: 'Assignment not found' })
  if (req.user.role === 'student' && (String(assignment.class) !== String(req.user.class) || statusOf(assignment) !== 'published')) return res.status(404).json({ success: false, message: 'Assignment not found' })
  const attachment = assignment.attachments.id(req.params.attachmentId)
  const path = attachment && assignmentFilePath(attachment.storedName)
  if (!attachment || !path) return res.status(404).json({ success: false, message: 'Assignment attachment not found' })
  res.set('Cache-Control', 'private, no-store')
  res.type(attachment.mimeType)
  return res.download(path, attachment.originalName, (error) => { if (error && !res.headersSent) next(error) })
}

export async function listStudentAssignments(req, res) {
  const { page, limit, skip } = paging(req.query)
  const query = { class: req.user.class, $or: [{ status: 'published' }, { status: { $exists: false }, isPublished: true }] }
  const now = new Date()
  if (req.query.status === 'submitted' || req.query.status === 'to-do') {
    const ownIds = await Submission.distinct('assignment', { student: req.user._id })
    if (req.query.status === 'submitted') query._id = { $in: ownIds }
    else {
      query._id = { $nin: ownIds }
      query.dueDate = { $gte: now }
    }
  }
  if (req.query.status === 'overdue') query.dueDate = { $lt: now }
  if (req.query.status === 'due') query.dueDate = { $gte: now, $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) }
  const search = regex(req.query.search)
  if (search) query.$and = [{ $or: [{ title: search }, { description: search }, { instructions: search }] }]
  const [assignments, total] = await Promise.all([
    Assignment.find(query).sort({ dueDate: 1 }).skip(skip).limit(limit).lean(),
    Assignment.countDocuments(query),
  ])
  const ownSubmissions = await Submission.find({ student: req.user._id, assignment: { $in: assignments.map((item) => item._id) } }).lean()
  const byAssignment = new Map(ownSubmissions.map((item) => [String(item.assignment), item]))
  return res.json({ success: true, assignments: assignments.map((item) => ({ ...assignmentForStudent(item, byAssignment.get(String(item._id))), deadlineState: deadlineState(item, now) })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

export async function getStudentAssignment(req, res) {
  if (!objectId(req.params.id)) throw fail(400, 'A valid assignment ID is required')
  const assignment = await Assignment.findOne({ _id: req.params.id, class: req.user.class, $or: [{ status: 'published' }, { status: { $exists: false }, isPublished: true }] }).exec()
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  const submission = await Submission.findOne({ assignment: assignment._id, student: req.user._id }).exec()
  return res.json({ success: true, assignment: { ...assignmentForStudent(assignment, submission), deadlineState: deadlineState(assignment) } })
}

export async function getMyAssignmentSubmission(req, res) {
  if (!objectId(req.params.id)) throw fail(400, 'A valid assignment ID is required')
  const assignment = await Assignment.findOne({ _id: req.params.id, class: req.user.class, $or: [{ status: 'published' }, { status: { $exists: false }, isPublished: true }] }).select('_id').lean()
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  const submission = await Submission.findOne({ assignment: assignment._id, student: req.user._id }).exec()
  return res.json({ success: true, submission: publicSubmission(submission) })
}

export async function getStudentAssignmentResult(req, res) {
  if (!objectId(req.params.id)) throw fail(400, 'A valid assignment ID is required')
  const assignment = await Assignment.findOne({ _id: req.params.id, class: req.user.class }).exec()
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment result not found' })
  const submission = await Submission.findOne({ assignment: assignment._id, student: req.user._id }).exec()
  if (!submission) return res.status(404).json({ success: false, message: 'No submission found for this assignment' })
  if (!['graded', 'returned'].includes(submission.status) && submission.marksAwarded == null && submission.score == null) {
    return res.json({ success: true, result: { graded: false, submission: publicSubmission(submission, false) } })
  }
  return res.json({ success: true, result: { graded: true, assignment: { id: assignment._id, title: assignment.title, totalMarks: totalMarksOf(assignment) }, submission: publicSubmission(submission) } })
}

function ensureSubmissionAllowed(assignment) {
  const status = statusOf(assignment)
  if (status !== 'published') throw fail(409, status === 'closed' ? 'This assignment is closed' : 'This assignment is not open for submissions')
  if (Date.now() > new Date(assignment.dueDate).getTime()) throw fail(409, 'The assignment deadline has passed; submissions and replacements are closed')
}

export async function submitStudentAssignment(req, res) {
  if (!objectId(req.params.id)) throw fail(400, 'A valid assignment ID is required')
  const assignment = await Assignment.findOne({ _id: req.params.id, class: req.user.class }).exec()
  if (!assignment || statusOf(assignment) !== 'published') return res.status(404).json({ success: false, message: 'Assignment not found' })
  ensureSubmissionAllowed(assignment)
  if (!req.file) throw fail(400, 'Choose a PDF, Word, PowerPoint, or image file to submit')
  const settings = await loadSystemSettings()
  const extension = extensionOf(req.file.originalname)
  const extensionName = extension.slice(1)
  const isImage = submissionImageExtensions.includes(extension)
  if (!isImage && !settings.uploads.assignmentTypes.includes(extensionName)) throw fail(400, 'This assignment file type is currently disabled')
  if (!allowedAssignmentFiles[extension]?.includes(req.file.mimetype) || !hasValidSignature(req.file, extension)) throw fail(400, 'Choose a valid PDF, Word, PowerPoint, or image (JPG, PNG, WEBP) file')
  const submissionLimit = Math.min(maxSubmissionBytes, settings.uploads.maxFileSizeMB * 1024 * 1024)
  if (req.file.size > submissionLimit) throw fail(413, `Submissions must be ${Math.floor(submissionLimit / 1024 / 1024)} MB or smaller`)
  const storedName = await storeSubmission(req.file, extension)
  const storedPath = submissionFilePath(storedName)
  try {
    ensureSubmissionAllowed(assignment)
    let submission = await Submission.findOne({ assignment: assignment._id, student: req.user._id }).exec()
    const isReplacement = Boolean(submission)
    if (submission) {
      submission.fileHistory.push({ originalName: submission.originalName, storedName: submission.storedName, mimeType: submission.mimeType, size: submission.size, submittedAt: submission.submittedAt })
      if (submission.marksAwarded != null || submission.score != null) {
        submission.gradeHistory.push({ marksAwarded: submission.marksAwarded ?? submission.score, feedback: submission.feedback || '', gradedBy: submission.gradedBy || req.user._id, gradedAt: submission.gradedAt || submission.updatedAt || new Date() })
      }
      submission.originalName = safeOriginalName(req.file.originalname)
      submission.storedName = storedName
      submission.mimeType = req.file.mimetype
      submission.size = req.file.size
      submission.status = 'submitted'
      submission.submittedAt = new Date()
      submission.score = null
      submission.marksAwarded = null
      submission.feedback = ''
      submission.gradedBy = null
      submission.gradedAt = null
      await submission.save()
    } else {
      submission = await Submission.create({ assignment: assignment._id, student: req.user._id, originalName: safeOriginalName(req.file.originalname), storedName, mimeType: req.file.mimetype, size: req.file.size, status: 'submitted', submittedAt: new Date() })
    }
    await createNotification({ recipientId: assignment.createdBy, senderId: req.user._id, type: 'assignment_submitted', title: isReplacement ? 'Assignment submission updated' : 'Assignment submitted', message: `${req.user.fullName} ${isReplacement ? 'updated a submission for' : 'submitted'} ${assignment.title}.`, relatedEntityType: 'assignment', relatedEntityId: assignment._id, dedupeKey: `assignment-submission:${submission._id}:${submission.submittedAt.getTime()}` })
    return res.status(201).json({ success: true, submission: publicSubmission(submission, false), message: 'Assignment submission received' })
  } catch (error) {
    await removeStoredFile(storedPath)
    throw error
  }
}

export async function listTeacherAssignmentSubmissions(req, res) {
  const assignment = await ownedAssignment(req.user._id, req.params.id)
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' })
  const { page, limit, skip } = paging(req.query)
  const roster = await User.find({ role: 'student', class: assignment.class, isActive: true }).select('fullName email studentId profileImage').sort({ fullName: 1 }).lean()
  const allSubmissions = await Submission.find({ assignment: assignment._id }).populate('student', 'fullName email studentId profileImage').populate('gradedBy', 'fullName').sort({ submittedAt: -1 }).lean()
  const byStudent = new Map(allSubmissions.map((item) => [String(item.student?._id || item.student), item]))
  const entries = roster.map((student) => {
    const submission = byStudent.get(String(student._id)) || null
    const isGraded = submission && (submission.marksAwarded != null || submission.score != null || ['graded', 'returned'].includes(submission.status))
    const currentStatus = submission?.status === 'returned' ? 'returned' : isGraded ? 'graded' : submission?.status === 'late' ? 'late' : 'submitted'
    return { student, submission: submission ? teacherSubmissionView(submission) : null, status: submission ? currentStatus : 'missing' }
  })
  const statusFilter = req.query.status
  const filtered = statusFilter && ['submitted', 'late', 'graded', 'returned', 'missing'].includes(statusFilter) ? entries.filter((item) => item.status === statusFilter) : entries
  const search = regex(req.query.search)
  const searched = search ? filtered.filter((item) => search.test(`${item.student.fullName} ${item.student.studentId || ''} ${item.student.email}`)) : filtered
  const pageEntries = searched.slice(skip, skip + limit)
  return res.json({ success: true, assignment: { id: assignment._id, title: assignment.title, totalMarks: totalMarksOf(assignment), dueDate: assignment.dueDate, status: statusOf(assignment), class: assignment.class }, submissions: pageEntries, summary: { totalStudents: roster.length, submitted: entries.filter((item) => item.submission).length, graded: entries.filter((item) => ['graded', 'returned'].includes(item.status)).length, missing: entries.filter((item) => item.status === 'missing').length }, pagination: { page, limit, total: searched.length, pages: Math.ceil(searched.length / limit) } })
}

export async function getTeacherSubmission(req, res) {
  const id = req.params.submissionId || req.params.id
  if (!objectId(id)) throw fail(400, 'A valid submission ID is required')
  const submission = await Submission.findById(id).populate({ path: 'assignment', select: 'createdBy title class dueDate maxScore totalMarks' }).populate('student', 'fullName email studentId profileImage').populate('gradedBy', 'fullName').exec()
  if (!submission || !submission.assignment || String(submission.assignment.createdBy) !== String(req.user._id)) return res.status(404).json({ success: false, message: 'Submission not found' })
  return res.json({ success: true, submission: teacherSubmissionView(submission) })
}

function teacherSubmissionView(submission) {
  const item = typeof submission.toObject === 'function' ? submission.toObject() : submission
  return {
    _id: item._id,
    assignment: item.assignment,
    student: item.student,
    originalName: item.originalName,
    mimeType: item.mimeType,
    size: item.size,
    status: item.status,
    submittedAt: item.submittedAt,
    marksAwarded: item.marksAwarded ?? item.score,
    score: item.marksAwarded ?? item.score,
    feedback: item.feedback || '',
    gradedBy: item.gradedBy,
    gradedAt: item.gradedAt,
    gradeHistory: item.gradeHistory || [],
  }
}

export async function gradeTeacherSubmission(req, res) {
  const id = req.params.submissionId || req.params.id
  if (!objectId(id)) throw fail(400, 'A valid submission ID is required')
  const submission = await Submission.findById(id).populate('assignment').exec()
  if (!submission || !submission.assignment || String(submission.assignment.createdBy) !== String(req.user._id)) return res.status(404).json({ success: false, message: 'Submission not found' })
  const body = requestObject(req.body)
  const rawMarks = body.marksAwarded ?? body.score
  if (rawMarks === undefined || rawMarks === null || rawMarks === '') throw fail(400, 'Marks awarded are required')
  if (body.feedback !== undefined && typeof body.feedback !== 'string') throw fail(400, 'Feedback must be text')
  if (body.status !== undefined && !['graded', 'returned'].includes(body.status)) throw fail(400, 'Grade status must be graded or returned')
  const marks = Number(rawMarks)
  const totalMarks = totalMarksOf(submission.assignment)
  if (!Number.isFinite(marks) || marks < 0 || marks > totalMarks) throw fail(400, `Marks must be between 0 and ${totalMarks}`)
  const feedback = (body.feedback || '').trim()
  if (feedback.length > 5000) throw fail(400, 'Feedback must be 5000 characters or fewer')
  if (submission.marksAwarded != null || submission.score != null) {
    submission.gradeHistory.push({ marksAwarded: submission.marksAwarded ?? submission.score, feedback: submission.feedback || '', gradedBy: submission.gradedBy || req.user._id, gradedAt: submission.gradedAt || submission.updatedAt || new Date() })
  }
  submission.score = marks
  submission.marksAwarded = marks
  submission.feedback = feedback
  submission.gradedBy = req.user._id
  submission.gradedAt = new Date()
  submission.status = body.status === 'returned' ? 'returned' : 'graded'
  await submission.save()
  await createNotification({ recipientId: submission.student, senderId: req.user._id, type: 'assignment_graded', title: 'Assignment graded', message: `${submission.assignment.title} has been graded: ${marks} / ${totalMarks} marks.`, relatedEntityType: 'assignment', relatedEntityId: submission.assignment._id, dedupeKey: `assignment-grade:${submission._id}:${submission.gradedAt.getTime()}` })
  return res.json({ success: true, submission })
}

export async function downloadAssignmentSubmission(req, res, next) {
  const id = req.params.submissionId || req.params.id
  if (!objectId(id)) throw fail(400, 'A valid submission ID is required')
  const submission = await Submission.findById(id).populate('assignment', 'createdBy class').exec()
  if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' })
  const canRead = req.user.role === 'teacher'
    ? String(submission.assignment?.createdBy) === String(req.user._id)
    : String(submission.student) === String(req.user._id) && String(submission.assignment?.class) === String(req.user.class)
  if (!canRead) return res.status(404).json({ success: false, message: 'Submission not found' })
  const path = submissionFilePath(submission.storedName)
  if (!path) return res.status(404).json({ success: false, message: 'Submission file not found' })
  res.set('Cache-Control', 'private, no-store')
  res.type(submission.mimeType)
  return res.download(path, submission.originalName, (error) => { if (error && !res.headersSent) next(error) })
}
