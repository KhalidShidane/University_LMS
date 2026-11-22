import mongoose from 'mongoose'
import Assignment from '../models/Assignment.js'
import Class from '../models/Class.js'
import Course from '../models/Course.js'
import Lesson from '../models/Lesson.js'
import User from '../models/User.js'
import { notifyClassStudents, notifyUsers } from '../services/notifications.service.js'
import { loadSystemSettings } from '../services/systemSettings.service.js'
import {
  allowedCoverTypes,
  allowedMaterialTypes,
  deleteLessonFile,
  deleteLessonFiles,
  fileExtension,
  hasSafeSignature,
  lessonFilePath,
  storeLessonFile,
} from '../services/lessonStorage.service.js'

const lessonStatuses = ['draft', 'published', 'archived']
const pageSettings = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20))
  return { page, limit, skip: (page - 1) * limit }
}

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function parseLessonAttachments(value) {
  if (!Array.isArray(value) || value.length > 50) throw badRequest('Add no more than 50 lesson links')
  return value.map((attachment, index) => {
    const name = String(attachment?.name || '').trim()
    const rawUrl = String(attachment?.url || '').trim()
    let url
    try { url = new URL(rawUrl) } catch { throw badRequest(`Lesson link ${index + 1} needs a valid URL`) }
    if (!name || name.length > 120 || rawUrl.length > 2000 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw badRequest(`Lesson link ${index + 1} needs a title and a valid HTTP or HTTPS URL`)
    }
    return { name, url: url.toString() }
  })
}

function safeSearch(value) {
  const search = String(value || '').trim().slice(0, 80)
  return search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null
}

async function requireAssignedActiveClass(user, classId) {
  if (!mongoose.isValidObjectId(classId)) throw badRequest('Choose a valid class')
  if (!user.assignedClasses.some((id) => String(id) === String(classId))) {
    const error = new Error('You can only manage lessons for classes assigned to you')
    error.status = 403
    throw error
  }
  const academicClass = await Class.findOne({ _id: classId, isActive: true }).select('_id').lean()
  if (!academicClass) throw badRequest('Choose an active assigned class')
}

async function requireAssignedCourse(user, courseId, classId) {
  if (!mongoose.isValidObjectId(courseId)) throw badRequest('Choose a valid course')
  const course = await Course.findOne({ _id: courseId, isActive: true, $or: [{ teacher: user._id }, { 'teachingAssignments.teacher': user._id }] }).select('_id class students name teacher teachingAssignments').lean()
  if (course) {
    const assignment = (course.teachingAssignments || []).find((item) => String(item.teacher) === String(user._id) && (!classId || String(item.class) === String(classId)))
    if (assignment) course.class = assignment.class
    else if (course.teacher && String(course.teacher) === String(user._id) && (!classId || String(course.class) === String(classId))) return course
    else if (!assignment) course._unauthorizedClass = true
  }
  if (!course || course._unauthorizedClass) {
    const error = new Error('You can only manage lessons for courses assigned to you')
    error.status = 403
    throw error
  }
  return course
}

async function notifyCourseStudents(course, lesson) {
  const active = await User.find({ class: lesson.class, role: 'student', isActive: true }).select('_id').lean()
  await notifyUsers(active.map((student) => student._id), { type: 'new_lesson', title: 'New lesson published', message: `${lesson.title} is now available in your course.`, senderId: lesson.createdBy, relatedEntityType: 'lesson', relatedEntityId: lesson._id }, `course-lesson-published:${lesson._id}`)
}

async function findOwnedLesson(teacherId, lessonId) {
  if (!mongoose.isValidObjectId(lessonId)) throw badRequest('A valid lesson ID is required')
  const lesson = await Lesson.findById(lessonId).exec()
  if (!lesson) return null
  if (String(lesson.createdBy) !== String(teacherId)) {
    if (!lesson.course) return null
    await requireAssignedCourse({ _id: teacherId }, lesson.course, lesson.class)
  } else if (lesson.course) await requireAssignedCourse({ _id: teacherId }, lesson.course, lesson.class)
  return lesson
}

function lessonResponse(lesson) {
  if (lesson.status) return lesson
  return { ...lesson, status: lesson.isPublished ? 'published' : 'draft' }
}

export async function listTeacherLessons(req, res) {
  const { page, limit, skip } = pageSettings(req.query)
  const assignedCourses = await Course.find({ isActive: true, $or: [{ teacher: req.user._id }, { 'teachingAssignments.teacher': req.user._id }] }).distinct('_id')
  const query = { $or: [{ createdBy: req.user._id, course: null }, { course: { $in: assignedCourses } }] }
  if (req.query.status && lessonStatuses.includes(req.query.status)) {
    if (req.query.status === 'archived') query.status = 'archived'
    else query.$and = [{ $or: [{ status: req.query.status }, { status: { $exists: false }, isPublished: req.query.status === 'published' }] }]
  }
  if (req.query.class) query.class = req.query.class
  const search = safeSearch(req.query.search)
  if (search) (query.$and ||= []).push({ $or: [{ title: search }, { subject: search }, { summary: search }, { content: search }] })
  const [lessons, total] = await Promise.all([
    Lesson.find(query).populate('class', 'name classCode').populate('course', 'name courseCode').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Lesson.countDocuments(query),
  ])
  return res.json({ success: true, lessons: lessons.map(lessonResponse), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

export async function getTeacherLesson(req, res) {
  const lesson = await findOwnedLesson(req.user._id, req.params.id)
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  await lesson.populate('class', 'name classCode')
  await lesson.populate('course', 'name courseCode')
  return res.json({ success: true, lesson: lessonResponse(lesson.toObject()) })
}

export async function createLesson(req, res) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const course = body.course ? await requireAssignedCourse(req.user, body.course, body.class) : null
  if (!course) await requireAssignedActiveClass(req.user, body.class)
  if (body.status && !lessonStatuses.includes(body.status)) throw badRequest('Choose draft, published, or archived status')
  const lesson = await Lesson.create({
    title: body.title,
    subject: body.subject || '',
    summary: body.summary || '',
    content: body.content,
    attachments: body.attachments === undefined ? [] : parseLessonAttachments(body.attachments),
    class: body.course ? course.class : body.class,
    course: course?._id || null,
    status: body.status || (body.isPublished === true ? 'published' : 'draft'),
    isPublished: body.isPublished === true,
    createdBy: req.user._id,
  })
  if (lesson.isPublished) course ? await notifyCourseStudents(course._id, lesson) : await notifyClassStudents(lesson.class, { type: 'new_lesson', title: 'New lesson published', message: `${lesson.title} is now available to your class.`, senderId: req.user._id, relatedEntityType: 'lesson', relatedEntityId: lesson._id }, `lesson-published:${lesson._id}`)
  await lesson.populate('class', 'name classCode')
  await lesson.populate('course', 'name courseCode')
  return res.status(201).json({ success: true, lesson: lesson.toObject() })
}

export async function updateLesson(req, res) {
  const lesson = await findOwnedLesson(req.user._id, req.params.id)
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const wasPublished = lesson.isPublished
  if (Object.hasOwn(body, 'course') && body.course) {
    const course = await requireAssignedCourse(req.user, body.course, body.class || lesson.class)
    lesson.course = course._id
    lesson.class = course.class
  } else if (Object.hasOwn(body, 'class')) await requireAssignedActiveClass(req.user, body.class)
  for (const field of ['title', 'subject', 'summary', 'content', 'class', 'order']) {
    if (Object.hasOwn(body, field)) lesson.set(field, body[field])
  }
  if (Object.hasOwn(body, 'attachments')) lesson.attachments = parseLessonAttachments(body.attachments)
  if (Object.hasOwn(body, 'status')) {
    if (!lessonStatuses.includes(body.status)) throw badRequest('Choose draft, published, or archived status')
    lesson.status = body.status
  } else if (typeof body.isPublished === 'boolean') {
    lesson.status = body.isPublished ? 'published' : 'draft'
  }
  await lesson.save()
  if (!wasPublished && lesson.isPublished) lesson.course ? await notifyCourseStudents(lesson.course, lesson) : await notifyClassStudents(lesson.class, { type: 'new_lesson', title: 'New lesson published', message: `${lesson.title} is now available to your class.`, senderId: req.user._id, relatedEntityType: 'lesson', relatedEntityId: lesson._id }, `lesson-published:${lesson._id}`)
  await lesson.populate('class', 'name classCode')
  await lesson.populate('course', 'name courseCode')
  return res.json({ success: true, lesson: lesson.toObject() })
}

export async function updateLessonStatus(req, res) {
  const lesson = await findOwnedLesson(req.user._id, req.params.id)
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  const status = req.body?.status
  if (!lessonStatuses.includes(status)) throw badRequest('Choose draft, published, or archived status')
  if (status === 'published') lesson.course ? await requireAssignedCourse(req.user, lesson.course, lesson.class) : await requireAssignedActiveClass(req.user, lesson.class)
  const wasPublished = lesson.isPublished
  lesson.status = status
  await lesson.save()
  if (!wasPublished && lesson.isPublished) lesson.course ? await notifyCourseStudents(lesson.course, lesson) : await notifyClassStudents(lesson.class, { type: 'new_lesson', title: 'New lesson published', message: `${lesson.title} is now available to your class.`, senderId: req.user._id, relatedEntityType: 'lesson', relatedEntityId: lesson._id }, `lesson-published:${lesson._id}`)
  return res.json({ success: true, lesson: { id: lesson._id, status: lesson.status, isPublished: lesson.isPublished } })
}

export async function deleteLesson(req, res) {
  const lesson = await findOwnedLesson(req.user._id, req.params.id)
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  if (await Assignment.exists({ lesson: lesson._id })) return res.status(409).json({ success: false, message: 'This lesson is used by an assignment; archive it instead' })
  await lesson.deleteOne()
  await deleteLessonFiles(lesson)
  return res.json({ success: true, message: 'Lesson deleted' })
}

async function checkMaterialUpload(files, acceptedTypes, maximumFiles, settings) {
  if (!Array.isArray(files) || !files.length) throw badRequest('Choose at least one file')
  if (files.length > maximumFiles) throw badRequest(`Upload no more than ${maximumFiles} files at a time`)
  for (const file of files) {
    const extension = fileExtension(file.originalname)
    if (!settings.uploads.learningMaterialTypes.includes(extension.slice(1)) || file.size > Math.min(10 * 1024 * 1024, settings.uploads.maxFileSizeMB * 1024 * 1024)) throw badRequest('File type or size is not allowed by the current upload settings')
    if (!acceptedTypes[extension]?.includes(file.mimetype) || !hasSafeSignature(file, extension)) {
      throw badRequest(`The file "${file.originalname.slice(0, 80)}" is not a valid supported file`)
    }
  }
}

export async function uploadLessonMaterials(req, res) {
  const lesson = await findOwnedLesson(req.user._id, req.params.id)
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  lesson.course ? await requireAssignedCourse(req.user, lesson.course, lesson.class) : await requireAssignedActiveClass(req.user, lesson.class)
  const settings = await loadSystemSettings()
  await checkMaterialUpload(req.files, allowedMaterialTypes, 8, settings)
  if (lesson.materials.length + req.files.length > 20) throw badRequest('A lesson can contain no more than 20 materials')

  const storedNames = []
  try {
    const newMaterials = []
    for (const file of req.files) {
      const extension = fileExtension(file.originalname)
      const storedName = await storeLessonFile(file, extension)
      storedNames.push(storedName)
      newMaterials.push({
        originalName: file.originalname.split(/[\\/]/).pop().trim().slice(0, 255) || `material${extension}`,
        storedName,
        mimeType: file.mimetype,
        size: file.size,
        uploadedAt: new Date(),
      })
    }
    lesson.materials.push(...newMaterials)
    await lesson.save()
  } catch (error) {
    await Promise.all(storedNames.map(deleteLessonFile))
    throw error
  }
  return res.status(201).json({ success: true, materials: lesson.materials })
}

export async function deleteLessonMaterial(req, res) {
  const lesson = await findOwnedLesson(req.user._id, req.params.id)
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  const material = lesson.materials.id(req.params.materialId)
  if (!material) return res.status(404).json({ success: false, message: 'Lesson material not found' })
  const storedName = material.storedName
  material.deleteOne()
  await lesson.save()
  await deleteLessonFile(storedName)
  return res.json({ success: true, materials: lesson.materials })
}

async function readableLesson(req, lessonId) {
  if (!mongoose.isValidObjectId(lessonId)) throw badRequest('A valid lesson ID is required')
  if (req.user.role === 'teacher') return findOwnedLesson(req.user._id, lessonId)
  if (req.user.role === 'student') {
    const lesson = await Lesson.findOne({ _id: lessonId, isPublished: true }).exec()
    if (!lesson) return null
    // Students only see lessons posted to their own class.
    if (!req.user.class || String(lesson.class) !== String(req.user.class)) return null
    if (lesson.course) {
      const course = await Course.findOne({ _id: lesson.course, isActive: true, $or: [{ class: req.user.class }, { 'teachingAssignments.class': req.user.class }] }).select('_id').lean()
      return course ? lesson : null
    }
    return String(lesson.class) === String(req.user.class) ? lesson : null
  }
  const error = new Error('You do not have access to this lesson')
  error.status = 403
  throw error
}

export async function downloadLessonMaterial(req, res, next) {
  const lesson = await readableLesson(req, req.params.id)
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  const material = lesson.materials.id(req.params.materialId)
  if (!material) return res.status(404).json({ success: false, message: 'Lesson material not found' })
  const filePath = lessonFilePath(material.storedName)
  if (!filePath) return res.status(404).json({ success: false, message: 'Lesson material not found' })
  res.type(material.mimeType)
  res.set('Cache-Control', 'private, no-store')
  return res.download(filePath, material.originalName, (error) => {
    if (error && !res.headersSent) next(error)
  })
}

export async function uploadLessonCover(req, res) {
  const lesson = await findOwnedLesson(req.user._id, req.params.id)
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  if (!req.file) throw badRequest('Choose a JPG, PNG, or WebP cover image')
  const extension = fileExtension(req.file.originalname)
  const settings = await loadSystemSettings()
  if (!settings.uploads.learningMaterialTypes.includes(extension.slice(1)) || req.file.size > Math.min(10 * 1024 * 1024, settings.uploads.maxFileSizeMB * 1024 * 1024)) throw badRequest('File type or size is not allowed by the current upload settings')
  if (!allowedCoverTypes[extension]?.includes(req.file.mimetype) || !hasSafeSignature(req.file, extension)) {
    throw badRequest('Choose a valid JPG, PNG, or WebP image')
  }
  const storedName = await storeLessonFile(req.file, extension)
  const previousName = lesson.coverImage?.storedName
  lesson.coverImage = { storedName, mimeType: req.file.mimetype }
  try {
    await lesson.save()
  } catch (error) {
    await deleteLessonFile(storedName)
    throw error
  }
  if (previousName) await deleteLessonFile(previousName)
  return res.json({ success: true, coverImage: lesson.coverImage })
}

export async function deleteLessonCover(req, res) {
  const lesson = await findOwnedLesson(req.user._id, req.params.id)
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  const previousName = lesson.coverImage?.storedName
  lesson.coverImage = undefined
  await lesson.save()
  if (previousName) await deleteLessonFile(previousName)
  return res.json({ success: true })
}

export async function getLessonCover(req, res) {
  const lesson = await readableLesson(req, req.params.id)
  if (!lesson?.coverImage?.storedName) return res.status(404).json({ success: false, message: 'Lesson cover not found' })
  const filePath = lessonFilePath(lesson.coverImage.storedName)
  if (!filePath) return res.status(404).json({ success: false, message: 'Lesson cover not found' })
  res.type(lesson.coverImage.mimeType)
  res.set('Cache-Control', 'private, max-age=300')
  return res.sendFile(filePath, (error) => {
    if (error && !res.headersSent) res.status(error.statusCode === 404 ? 404 : 500).end()
  })
}

export async function listStudentLessons(req, res) {
  const activeCourses = await Course.find({ isActive: true, $or: [{ class: req.user.class }, { 'teachingAssignments.class': req.user.class }] }).distinct('_id')
  const query = { class: req.user.class, isPublished: true, $or: [{ course: null }, { course: { $in: activeCourses } }] }
  const search = safeSearch(req.query.search)
  if (search) query.$and = [{ $or: [{ title: search }, { subject: search }, { summary: search }, { content: search }] }]
  const lessons = await Lesson.find(query).populate('createdBy', 'fullName').sort({ order: 1, createdAt: -1 }).lean()
  return res.json({ success: true, lessons: lessons.map(lessonResponse) })
}

export async function getStudentLesson(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw badRequest('A valid lesson ID is required')
  const activeCourses = await Course.find({ isActive: true, $or: [{ class: req.user.class }, { 'teachingAssignments.class': req.user.class }] }).distinct('_id')
  const lesson = await Lesson.findOne({ _id: req.params.id, class: req.user.class, isPublished: true, $or: [{ course: null }, { course: { $in: activeCourses } }] })
    .populate('createdBy', 'fullName')
    .populate('class', 'name classCode')
    .lean()
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  return res.json({ success: true, lesson: lessonResponse(lesson) })
}

export async function requireStudentCourse(studentId, courseId) {
  if (!mongoose.isValidObjectId(courseId)) throw badRequest('A valid course ID is required')
  const student = await User.findOne({ _id: studentId, role: 'student', isActive: true }).select('class').lean()
  if (!student) return null
  const course = await Course.findOne({ _id: courseId, isActive: true, $or: [{ class: student.class }, { 'teachingAssignments.class': student.class }, { students: studentId }] }).select('name courseCode class academicYear teacher teachingAssignments').populate('teachingAssignments.teacher', 'fullName').lean()
  if (!course) return null
  const assignment = course.teachingAssignments?.find((item) => String(item.class) === String(student.class))
  if (assignment) { course.class = student.class; course.teacher = assignment.teacher }
  return course
}

export async function listStudentCourseLessons(req, res) {
  const course = await requireStudentCourse(req.user._id, req.params.courseId)
  if (!course) return res.status(404).json({ success: false, message: 'Course not found' })
  const query = { course: course._id, class: course.class, isPublished: true }
  const search = safeSearch(req.query.search)
  if (search) query.$or = [{ title: search }, { subject: search }, { summary: search }, { content: search }]
  const lessons = await Lesson.find(query).populate('createdBy', 'fullName').sort({ order: 1, createdAt: -1 }).lean()
  return res.json({ success: true, course, lessons: lessons.map(lessonResponse) })
}

export async function getStudentCourseLesson(req, res) {
  const course = await requireStudentCourse(req.user._id, req.params.courseId)
  if (!course) return res.status(404).json({ success: false, message: 'Course not found' })
  const lesson = await Lesson.findOne({ _id: req.params.lessonId, course: course._id, class: course.class, isPublished: true }).populate('createdBy', 'fullName').populate('class', 'name classCode').lean()
  if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' })
  return res.json({ success: true, course, lesson: lessonResponse(lesson) })
}

export async function countStudentsForClasses(classIds) {
  if (!classIds.length) return new Map()
  const counts = await User.aggregate([
    { $match: { role: 'student', isActive: true, class: { $in: classIds } } },
    { $group: { _id: '$class', count: { $sum: 1 } } },
  ])
  return new Map(counts.map((item) => [String(item._id), item.count]))
}
