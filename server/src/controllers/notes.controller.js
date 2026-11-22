import mongoose from 'mongoose'
import Note, { noteColors } from '../models/Note.js'
import Lesson from '../models/Lesson.js'
import { requireStudentCourse } from './lessons.controller.js'
import { sanitizeNoteContent } from '../services/noteContent.service.js'

const MAX_NOTES_PER_STUDENT = 5000
const MAX_TAGS = 20
const listFields = '-content'

function fail(status, message, extra) {
  const error = new Error(message)
  error.status = status
  if (extra) error.extra = extra
  throw error
}

const objectId = (value, label) => {
  if (!mongoose.isValidObjectId(value)) fail(400, `A valid ${label} is required`)
  return new mongoose.Types.ObjectId(String(value))
}
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function parseTitle(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') fail(400, 'Note title must be text')
  const title = value.trim()
  if (title.length > 200) fail(400, 'Note titles can be up to 200 characters')
  return title
}

function parseColor(value) {
  if (value === undefined) return undefined
  if (!noteColors.includes(value)) fail(400, 'Choose a valid note color')
  return value
}

function parseTags(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) fail(400, 'Tags must be a list')
  const tags = [...new Set(value.map((tag) => String(tag || '').trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean))]
  if (tags.length > MAX_TAGS) fail(400, `Add no more than ${MAX_TAGS} tags`)
  if (tags.some((tag) => tag.length > 40)) fail(400, 'Each tag can be up to 40 characters')
  return tags
}

// Resolves the optional course/lesson link and guarantees the student can actually access it.
async function resolveAssociation(user, { course, lesson }) {
  if (lesson) {
    const lessonId = objectId(lesson, 'lesson')
    const doc = await Lesson.findOne({ _id: lessonId, isPublished: true }).select('course class').lean()
    if (!doc) fail(400, 'Choose a lesson you can access')
    if (doc.course) {
      const accessible = await requireStudentCourse(user._id, doc.course)
      if (!accessible || String(accessible.class) !== String(doc.class)) fail(400, 'Choose a lesson you can access')
      if (course && String(course) !== String(doc.course)) fail(400, 'The selected lesson does not belong to that course')
      return { course: accessible._id, lesson: doc._id }
    }
    if (String(doc.class) !== String(user.class)) fail(400, 'Choose a lesson you can access')
    if (course) fail(400, 'The selected lesson does not belong to that course')
    return { course: null, lesson: doc._id }
  }
  if (course) {
    const accessible = await requireStudentCourse(user._id, objectId(course, 'course'))
    if (!accessible) fail(400, 'Choose a course you are enrolled in')
    return { course: accessible._id, lesson: null }
  }
  return { course: null, lesson: null }
}

function noteResponse(note, { full = false } = {}) {
  const value = typeof note.toObject === 'function' ? note.toObject() : note
  const result = {
    _id: String(value._id),
    title: value.title || '',
    excerpt: (value.contentText || '').slice(0, 280),
    wordCount: value.wordCount || 0,
    color: value.color || 'default',
    tags: value.tags || [],
    order: value.order || 0,
    version: value.version || 1,
    course: value.course && typeof value.course === 'object' && value.course.name ? { _id: String(value.course._id), name: value.course.name, courseCode: value.course.courseCode } : value.course ? { _id: String(value.course) } : null,
    lesson: value.lesson && typeof value.lesson === 'object' && value.lesson.title ? { _id: String(value.lesson._id), title: value.lesson.title } : value.lesson ? { _id: String(value.lesson) } : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
  if (full) result.content = value.content
  return result
}

const populateLinks = (query) => query.populate('course', 'name courseCode').populate('lesson', 'title')

export async function listNotes(req, res) {
  const query = { student: req.user._id }
  const { search, course, lesson, tag, sort } = req.query
  if (course === 'none') query.course = null
  else if (course) query.course = objectId(course, 'course')
  if (lesson === 'none') query.lesson = null
  else if (lesson) query.lesson = objectId(lesson, 'lesson')
  if (typeof tag === 'string' && tag.trim()) query.tags = tag.trim().toLowerCase()
  if (typeof search === 'string' && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim().slice(0, 120)), 'i')
    query.$or = [{ title: pattern }, { contentText: pattern }, { tags: pattern }]
  }
  const sortBy = sort === 'created' ? { createdAt: -1 } : sort === 'updated' ? { updatedAt: -1 } : { order: 1, updatedAt: -1 }
  const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit, 10) || 300))
  const [notes, total] = await Promise.all([
    populateLinks(Note.find(query).select(listFields).sort(sortBy).limit(limit)).lean(),
    Note.countDocuments(query),
  ])
  return res.json({ success: true, notes: notes.map((note) => noteResponse(note)), total })
}

export async function noteFacets(req, res) {
  const student = req.user._id
  const [courses, lessons, tags, total] = await Promise.all([
    Note.aggregate([{ $match: { student, course: { $ne: null } } }, { $group: { _id: '$course', count: { $sum: 1 } } }, { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'course' } }, { $unwind: '$course' }, { $project: { _id: 1, count: 1, name: '$course.name', courseCode: '$course.courseCode' } }, { $sort: { name: 1 } }]),
    Note.aggregate([{ $match: { student, lesson: { $ne: null } } }, { $group: { _id: '$lesson', course: { $first: '$course' }, count: { $sum: 1 } } }, { $lookup: { from: 'lessons', localField: '_id', foreignField: '_id', as: 'lesson' } }, { $unwind: '$lesson' }, { $project: { _id: 1, course: 1, count: 1, title: '$lesson.title' } }, { $sort: { title: 1 } }]),
    Note.aggregate([{ $match: { student } }, { $unwind: '$tags' }, { $group: { _id: '$tags', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 100 }]),
    Note.countDocuments({ student }),
  ])
  return res.json({ success: true, total, courses, lessons, tags: tags.map((item) => ({ tag: item._id, count: item.count })) })
}

export async function getNote(req, res) {
  const note = await populateLinks(Note.findOne({ _id: objectId(req.params.id, 'note ID'), student: req.user._id })).lean()
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' })
  return res.json({ success: true, note: noteResponse(note, { full: true }) })
}

export async function createNote(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  if (await Note.countDocuments({ student: req.user._id }) >= MAX_NOTES_PER_STUDENT) fail(409, `You can keep up to ${MAX_NOTES_PER_STUDENT} notes. Delete some notes to add new ones.`)
  const association = await resolveAssociation(req.user, { course: body.course || null, lesson: body.lesson || null })
  const { content, text, wordCount } = sanitizeNoteContent(body.content)
  const first = await Note.findOne({ student: req.user._id }).sort({ order: 1 }).select('order').lean()
  const note = await Note.create({
    student: req.user._id,
    ...association,
    title: parseTitle(body.title) ?? '',
    content,
    contentText: text,
    wordCount,
    color: parseColor(body.color) ?? 'default',
    tags: parseTags(body.tags) ?? [],
    order: first ? first.order - 1 : 0,
  })
  const saved = await populateLinks(Note.findById(note._id)).lean()
  return res.status(201).json({ success: true, note: noteResponse(saved, { full: true }) })
}

export async function updateNote(req, res) {
  const id = objectId(req.params.id, 'note ID')
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const version = Number(body.version)
  if (!Number.isInteger(version) || version < 1) fail(400, 'The note version is required')
  const changes = {}
  const title = parseTitle(body.title); if (title !== undefined) changes.title = title
  const color = parseColor(body.color); if (color !== undefined) changes.color = color
  const tags = parseTags(body.tags); if (tags !== undefined) changes.tags = tags
  if ('content' in body) {
    const { content, text, wordCount } = sanitizeNoteContent(body.content)
    Object.assign(changes, { content, contentText: text, wordCount })
  }
  if ('course' in body || 'lesson' in body) {
    const current = await Note.findOne({ _id: id, student: req.user._id }).select('course lesson').lean()
    if (!current) return res.status(404).json({ success: false, message: 'Note not found' })
    const nextCourse = 'course' in body ? body.course || null : current.course
    const nextLesson = 'lesson' in body ? body.lesson || null : current.lesson
    Object.assign(changes, await resolveAssociation(req.user, { course: nextLesson && !('course' in body) ? null : nextCourse, lesson: nextLesson }))
  }
  if (!Object.keys(changes).length) fail(400, 'Nothing to update')
  const updated = await populateLinks(Note.findOneAndUpdate(
    { _id: id, student: req.user._id, version },
    { $set: changes, $inc: { version: 1 } },
    { new: true, runValidators: true },
  )).lean()
  if (!updated) {
    const latest = await populateLinks(Note.findOne({ _id: id, student: req.user._id })).lean()
    if (!latest) return res.status(404).json({ success: false, message: 'Note not found' })
    return res.status(409).json({ success: false, code: 'NOTE_VERSION_CONFLICT', message: 'This note was changed in another window. Choose which version to keep.', note: noteResponse(latest, { full: true }) })
  }
  return res.json({ success: true, note: noteResponse(updated, { full: true }) })
}

export async function deleteNote(req, res) {
  const result = await Note.deleteOne({ _id: objectId(req.params.id, 'note ID'), student: req.user._id })
  if (!result.deletedCount) return res.status(404).json({ success: false, message: 'Note not found' })
  return res.json({ success: true, message: 'Note deleted' })
}

// Reorders a (possibly filtered) subset of the student's notes. The subset keeps the same
// slots it occupied in the full custom order, so notes outside the current filter stay put.
export async function reorderNotes(req, res) {
  const ids = req.body?.ids
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_NOTES_PER_STUDENT) fail(400, 'Provide the notes in their new order')
  const subset = ids.map((id) => String(objectId(id, 'note ID')))
  if (new Set(subset).size !== subset.length) fail(400, 'The note order contains duplicates')
  const all = await Note.find({ student: req.user._id }).select('_id').sort({ order: 1, updatedAt: -1 }).lean()
  const owned = new Set(all.map((note) => String(note._id)))
  if (subset.some((id) => !owned.has(id))) fail(404, 'Note not found')
  const subsetSet = new Set(subset)
  let next = 0
  const sequence = all.map((note) => (subsetSet.has(String(note._id)) ? subset[next++] : String(note._id)))
  await Note.bulkWrite(sequence.map((id, index) => ({ updateOne: { filter: { _id: id, student: req.user._id }, update: { $set: { order: index } }, timestamps: false } })))
  return res.json({ success: true, ids: sequence })
}
