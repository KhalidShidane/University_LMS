import mongoose from 'mongoose'
import { readFile } from 'node:fs/promises'
import Course from '../models/Course.js'
import Assignment from '../models/Assignment.js'
import Notification from '../models/Notification.js'
import { courseSemesters as defaultCourseSemesters } from '../config/academicSemesters.js'
import Class from '../models/Class.js'
import Department from '../models/Department.js'
import User from '../models/User.js'
import Lesson from '../models/Lesson.js'
import { allowedCoverTypes, deleteLessonFile, deleteLessonFiles, fileExtension, hasSafeSignature, lessonFilePath, storeLessonFile } from '../services/lessonStorage.service.js'
import { loadSystemSettings } from '../services/systemSettings.service.js'
import { academicYearStart, resolveCurrentAcademicYear } from '../utils/academicYear.js'
import { createWithGeneratedCode } from '../services/codeGenerator.service.js'

const badRequest = (message) => Object.assign(new Error(message), { status: 400 })
const coursePopulate = [
  { path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } },
  { path: 'class', select: 'name classCode department' },
  { path: 'teacher', select: 'fullName email profileImage' },
  { path: 'teachingAssignments.teacher', select: 'fullName email profileImage' },
  { path: 'teachingAssignments.class', select: 'name classCode department' },
  { path: 'students', select: 'fullName email studentId profileImage class' },
]

async function populated(course) {
  await course.populate(coursePopulate)
  const record = course.toObject()
  record.lessonCount = await Lesson.countDocuments({ course: course._id })
  return record
}

export async function listAdminCourses(req, res) {
  const courses = await Course.find({}).sort({ name: 1 }).populate(coursePopulate).lean()
  const counts = await Lesson.aggregate([{ $match: { course: { $in: courses.map((item) => item._id) } } }, { $group: { _id: '$course', count: { $sum: 1 } } }])
  const lessonCounts = new Map(counts.map((item) => [String(item._id), item.count]))
  return res.json({ success: true, courses: courses.map((item) => ({ ...item, lessonCount: lessonCounts.get(String(item._id)) || 0 })) })
}

export async function createAdminCourse(req, res) {
  const { name, courseCode } = req.body || {}
  const systemSettings = await loadSystemSettings()
  if (typeof name !== 'string' || !name.trim()) throw badRequest('Course name is required')
  const providedCourseCode = typeof courseCode === 'string' ? courseCode.trim().toUpperCase() : ''
  if (providedCourseCode && await Course.exists({ courseCode: providedCourseCode, class: null, isActive: true })) throw Object.assign(new Error('An unassigned course already uses this course code; choose another or leave it empty to generate one'), { status: 409 })
  const academicYear = systemSettings.academic?.academicYear || `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(-2)}`
  const configuredSemesters = systemSettings.academic?.semesters?.length ? systemSettings.academic.semesters : defaultCourseSemesters
  const semester = configuredSemesters.includes(systemSettings.academic?.semester) ? systemSettings.academic.semester : configuredSemesters[0]
  let coverImage
  if (req.file) {
    const extension = fileExtension(req.file.originalname)
    const extensionName = extension.slice(1)
    if (!systemSettings.uploads.learningMaterialTypes.includes(extensionName) || req.file.size > 1024 * 1024) throw badRequest('Course images must be 1 MB or smaller')
    if (!allowedCoverTypes[extension]?.includes(req.file.mimetype) || !hasSafeSignature(req.file, extension)) throw badRequest('Choose a valid JPG, PNG, or WebP course image')
    const storedName = await storeLessonFile(req.file, extension)
    coverImage = { storedName, mimeType: req.file.mimetype }
  }
  let course
  try {
    const createCourse = (code) => Course.create({ name: name.trim(), courseCode: code, academicYear, semester, coverImage })
    course = providedCourseCode
      ? await createCourse(providedCourseCode)
      : await createWithGeneratedCode(Course, 'courseCode', name, createCourse, { maxLength: 30, numbered: true })
  } catch (error) {
    if (coverImage) await deleteLessonFile(coverImage.storedName)
    if (error.code === 11000) throw Object.assign(new Error('This course code is already used in the selected class and department'), { status: 409 })
    throw error
  }
  return res.status(201).json({ success: true, course: await populated(course) })
}

export async function deleteAdminCourse(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw badRequest('A valid course ID is required')
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ success: false, message: 'Course not found' })
  const lessons = await Lesson.find({ course: course._id })
  const lessonIds = lessons.map((lesson) => lesson._id)
  if (lessonIds.length) {
    await Assignment.updateMany({ lesson: { $in: lessonIds } }, { $set: { lesson: null } })
    await Notification.deleteMany({ relatedEntityType: 'lesson', relatedEntityId: { $in: lessonIds } })
    await Promise.all(lessons.map(async (lesson) => { await deleteLessonFiles(lesson); await lesson.deleteOne() }))
  }
  const coverStoredName = course.coverImage?.storedName
  await course.deleteOne()
  if (coverStoredName && !await Course.exists({ 'coverImage.storedName': coverStoredName })) await deleteLessonFile(coverStoredName)
  return res.json({ success: true, message: 'Course and its lessons and uploaded materials were permanently deleted' })
}

export async function updateAdminCourse(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw badRequest('A valid course ID is required')
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ success: false, message: 'Course not found' })
  const { name, courseCode, description } = req.body || {}
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) throw badRequest('Course name is required')
    if (name.trim().length > 120) throw badRequest('Course name must be 120 characters or fewer')
    course.name = name.trim()
  }
  if (description !== undefined) {
    if (typeof description !== 'string' || description.length > 1000) throw badRequest('Description must be 1000 characters or fewer')
    course.description = description.trim()
  }
  // Empty code keeps the current one.
  const nextCode = typeof courseCode === 'string' ? courseCode.trim().toUpperCase() : ''
  if (nextCode && nextCode !== course.courseCode) {
    if (nextCode.length > 30) throw badRequest('Course code must be 30 characters or fewer')
    const classes = [course.class, ...(course.teachingAssignments || []).map((item) => item.class)].filter(Boolean)
    const scope = classes.length ? { $or: [{ class: { $in: classes } }, { 'teachingAssignments.class': { $in: classes } }] } : { class: null }
    if (await Course.exists({ _id: { $ne: course._id }, courseCode: nextCode, isActive: true, ...scope })) throw Object.assign(new Error(`The code ${nextCode} is already used by another course; choose another`), { status: 409 })
    course.courseCode = nextCode
  }
  try {
    await course.save()
  } catch (error) {
    if (error?.code === 11000) throw Object.assign(new Error('Another active course already uses this code'), { status: 409 })
    throw error
  }
  return res.json({ success: true, course: await populated(course) })
}

export async function updateAdminCourseStatus(req, res) {
  if (!mongoose.isValidObjectId(req.params.id) || typeof req.body?.isActive !== 'boolean') throw badRequest('Choose a valid course status')
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ success: false, message: 'Course not found' })
  course.isActive = req.body.isActive
  await course.save()
  return res.json({ success: true, course: await populated(course) })
}

export async function getCourseCover(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw badRequest('A valid course ID is required')
  const course = await Course.findOne({ _id: req.params.id, $or: [{ isActive: true }, { students: req.user._id }] }).select('class teacher teachingAssignments students coverImage').lean()
  if (!course?.coverImage?.storedName) return res.status(404).json({ success: false, message: 'Course image not found' })
  const allowed = req.user.role === 'admin'
    || (req.user.role === 'teacher' && (String(course.teacher) === String(req.user._id) || course.teachingAssignments?.some((item) => String(item.teacher) === String(req.user._id))))
  if (!allowed) return res.status(404).json({ success: false, message: 'Course image not found' })
  const filePath = lessonFilePath(course.coverImage.storedName)
  if (!filePath) return res.status(404).json({ success: false, message: 'Course image not found' })
  const image = await readFile(filePath).catch(() => null)
  if (!image) return res.status(404).json({ success: false, message: 'Course image not found' })
  res.type(course.coverImage.mimeType || 'application/octet-stream')
  res.set('Cache-Control', 'private, max-age=300')
  return res.send(image)
}

export async function assignCourseTeacher(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw badRequest('A valid course ID is required')
  const teacherId = req.body?.teacherId
  let course = await Course.findOne(teacherId ? { _id: req.params.id, isActive: true } : { _id: req.params.id })
  if (!course) return res.status(404).json({ success: false, message: 'Course not found' })
  if (!teacherId) {
    const classId = req.body?.classId
    course.teachingAssignments = classId
      ? course.teachingAssignments.filter((item) => String(item.class) !== String(classId))
      : []
    const primary = course.teachingAssignments[0]
    course.teacher = primary?.teacher || null
    course.class = primary?.class || null
    course.department = primary?.department || null
    await course.save()
  }
  else {
    if (!mongoose.isValidObjectId(teacherId)) throw badRequest('Choose a valid teacher')
    const teacher = await User.findOne({ _id: teacherId, role: 'teacher', isActive: true }).select('department departments assignedClasses').lean()
    if (!teacher) throw badRequest('Choose an active teacher')
    const classId = req.body?.classId || course.class
    if (!mongoose.isValidObjectId(classId)) throw badRequest('Choose a class for this course')
    const academicClass = await Class.findOne({ _id: classId, isActive: true }).select('_id department').lean()
    if (!academicClass || !teacher.assignedClasses.some((id) => String(id) === String(academicClass._id))) throw badRequest('Choose one of this teacher’s assigned classes')
    const teacherDepartments = new Set([...(teacher.departments || []).map(String), ...(teacher.department ? [String(teacher.department)] : [])])
    if (!teacherDepartments.has(String(academicClass.department))) throw badRequest('The teacher must be assigned to the class department')
    if (await Course.exists({ _id: { $ne: course._id }, courseCode: course.courseCode, isActive: true, $or: [{ class: academicClass._id }, { 'teachingAssignments.class': academicClass._id }] })) throw Object.assign(new Error('Another active course with this code already exists in the selected class'), { status: 409 })
    if (!course.teachingAssignments.length && course.class && course.teacher) {
      course.teachingAssignments.push({ teacher: course.teacher, class: course.class, department: course.department || academicClass.department })
    }
    const existingAssignment = course.teachingAssignments.find((item) => String(item.class) === String(academicClass._id))
    if (existingAssignment) existingAssignment.teacher = teacher._id
    else course.teachingAssignments.push({ teacher: teacher._id, class: academicClass._id, department: academicClass.department })
    if (!course.class) {
      course.class = academicClass._id
      course.department = academicClass.department
      course.teacher = teacher._id
    }
    await course.save()
  }
  return res.json({ success: true, course: await populated(course) })
}

export async function updateCourseStudent(req, res) {
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.body?.studentId)) throw badRequest('Choose a valid course and student')
  const course = await Course.findOne({ _id: req.params.id, isActive: true })
  if (!course) return res.status(404).json({ success: false, message: 'Course not found' })
  const student = await User.findOne({ _id: req.body.studentId, role: 'student', isActive: true }).select('class department').lean()
  const classAssignment = course.teachingAssignments.find((item) => String(item.class) === String(student?.class))
  const validLegacyPlacement = String(student?.class) === String(course.class) && String(student?.department) === String(course.department)
  if (!student || (!classAssignment && !validLegacyPlacement)) throw badRequest('Student must be active and enrolled in this course university class')
  const enrolled = course.students.some((id) => String(id) === String(student._id))
  if (req.body.action === 'enroll' && !enrolled) course.students.push(student._id)
  else if (req.body.action === 'remove') course.students = course.students.filter((id) => String(id) !== String(student._id))
  else if (!['enroll', 'remove'].includes(req.body.action)) throw badRequest('Choose enroll or remove action')
  await course.save()
  return res.json({ success: true, course: await populated(course) })
}

export async function listTeacherCourses(req, res) {
  const courses = await Course.find({ isActive: true, $or: [{ teacher: req.user._id }, { 'teachingAssignments.teacher': req.user._id }] }).sort({ name: 1 }).populate('class', 'name classCode').populate('teachingAssignments.class', 'name classCode').lean()
  const records = courses.flatMap((course) => {
    const assignments = (course.teachingAssignments || []).filter((item) => String(item.teacher) === String(req.user._id))
    if (!assignments.length && String(course.teacher) === String(req.user._id) && course.class) assignments.push({ teacher: course.teacher, class: course.class, department: course.department })
    return assignments.map((assignment) => ({ ...course, class: assignment.class, assignmentClassId: String(assignment.class?._id || assignment.class), assignedTeacher: assignment.teacher }))
  })
  const counts = await Lesson.aggregate([{ $match: { course: { $in: courses.map((item) => item._id) }, class: { $in: records.map((item) => item.class?._id || item.class) } } }, { $group: { _id: { course: '$course', class: '$class' }, count: { $sum: 1 } } }])
  const lessonCounts = new Map(counts.map((item) => [`${item._id.course}:${item._id.class}`, item.count]))
  return res.json({ success: true, courses: records.map((item) => ({ ...item, lessonCount: lessonCounts.get(`${item._id}:${item.assignmentClassId}`) || 0 })) })
}

export async function listStudentCourses(req, res) {
  const [settings, courseDocuments] = await Promise.all([
    loadSystemSettings(),
    Course.find({ isActive: true, $or: [{ class: req.user.class }, { 'teachingAssignments.class': req.user.class }, { students: req.user._id }, ...(req.user.department ? [{ department: req.user.department }] : [])] })
      .sort({ academicYear: -1, name: 1 }).populate('class', 'name classCode').populate('teacher', 'fullName').populate('teachingAssignments.class', 'name classCode').populate('teachingAssignments.teacher', 'fullName').lean(),
  ])
  const courses = courseDocuments.map((course) => {
    const assignment = course.teachingAssignments?.find((item) => String(item.class?._id || item.class) === String(req.user.class))
    return assignment ? { ...course, class: assignment.class, teacher: assignment.teacher } : course
  })
  const counts = await Lesson.aggregate([{ $match: { course: { $in: courses.map((item) => item._id) }, class: req.user.class, isPublished: true } }, { $group: { _id: '$course', count: { $sum: 1 } } }])
  const lessonCounts = new Map(counts.map((item) => [String(item._id), item.count]))
  const currentAcademicYear = resolveCurrentAcademicYear(
    settings.academic?.academicYear,
    courses.filter((item) => String(item.class?._id) === String(req.user.class)).map((item) => item.academicYear),
  )
  const currentYearStart = academicYearStart(currentAcademicYear)
  const visibleCourses = courses.filter((course) => {
    const belongsToCurrentClass = String(course.class?._id) === String(req.user.class)
    const explicitlyEnrolled = course.students?.some((studentId) => String(studentId) === String(req.user._id))
    const sameAcademicYear = course.academicYear && academicYearStart(course.academicYear) === currentYearStart
    const legacyCurrentCourse = !course.academicYear && belongsToCurrentClass
    const isUpcomingInDepartment = req.user.department
      && String(course.department) === String(req.user.department)
      && academicYearStart(course.academicYear) > currentYearStart
    return explicitlyEnrolled || (sameAcademicYear && belongsToCurrentClass) || legacyCurrentCourse || isUpcomingInDepartment
  })
  const records = visibleCourses.map((item) => {
    const course = { ...item, lessonCount: lessonCounts.get(String(item._id)) || 0 }
    const explicitlyEnrolled = course.students?.some((studentId) => String(studentId) === String(req.user._id))
    const legacyCourseInCurrentClass = !course.academicYear && String(course.class?._id) === String(req.user.class)
    const sameAcademicYear = course.academicYear && academicYearStart(course.academicYear) === academicYearStart(currentAcademicYear)
    course.coursePeriod = sameAcademicYear || legacyCourseInCurrentClass
      ? 'current'
      : academicYearStart(course.academicYear) > currentYearStart ? 'upcoming' : explicitlyEnrolled ? 'previous' : 'current'
    return course
  })
  return res.json({
    success: true,
    currentAcademicYear,
    courses: records,
    currentCourses: records.filter((course) => course.coursePeriod === 'current'),
    previousCourses: records.filter((course) => course.coursePeriod === 'previous'),
    upcomingCourses: records.filter((course) => course.coursePeriod === 'upcoming'),
  })
}
