import mongoose from 'mongoose'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import User from '../models/User.js'
import Lesson from '../models/Lesson.js'
import Assignment from '../models/Assignment.js'
import Submission from '../models/Submission.js'
import Quiz from '../models/Quiz.js'
import QuizAttempt from '../models/QuizAttempt.js'
import { recordAudit } from '../services/auditLog.service.js'

const idFields = ['facultyId', 'departmentId', 'classId', 'teacherId', 'studentId', 'assignmentId', 'quizId']
const publishedStatus = { $or: [{ status: { $in: ['published', 'closed'] } }, { status: { $exists: false }, isPublished: true }] }
const fail = (status, message) => Object.assign(new Error(message), { status })
const id = (value) => String(value?._id || value || '')

function parseFilters(query) {
  const filters = {}
  for (const field of idFields) {
    if (!query[field]) continue
    if (!mongoose.isValidObjectId(query[field])) throw fail(400, `A valid ${field} is required`)
    filters[field] = new mongoose.Types.ObjectId(query[field])
  }
  if (query.from || query.to) {
    const from = query.from ? new Date(query.from) : null
    const to = query.to ? new Date(query.to) : null
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) throw fail(400, 'Choose a valid date range')
    filters.date = {}
    if (from) filters.date.$gte = from
    if (to) { to.setHours(23, 59, 59, 999); filters.date.$lte = to }
  }
  return filters
}

async function classScope(user, filters) {
  let classQuery = {}
  let scopedClassIds = null
  if (user.role === 'teacher') {
    const assigned = (user.assignedClasses || []).map(id)
    if (filters.classId && !assigned.includes(id(filters.classId))) throw fail(403, 'You can only view analytics for your assigned classes')
    scopedClassIds = assigned
  } else if (user.role === 'student') {
    if (filters.classId && id(filters.classId) !== id(user.class)) throw fail(403, 'You can only view your own class analytics')
    scopedClassIds = [id(user.class)]
    filters.studentId = user._id
  } else if (user.role === 'admin') {
    if (filters.teacherId) {
      const teacher = await User.findOne({ _id: filters.teacherId, role: 'teacher' }).select('assignedClasses').lean()
      if (!teacher) throw fail(404, 'Teacher not found')
      scopedClassIds = (teacher.assignedClasses || []).map(id)
    }
    if (filters.studentId) {
      const student = await User.findOne({ _id: filters.studentId, role: 'student' }).select('class').lean()
      if (!student) throw fail(404, 'Student not found')
      if (scopedClassIds && !scopedClassIds.includes(id(student.class))) throw fail(404, 'Student report not found')
      scopedClassIds = [id(student.class)]
    }
  }
  if (filters.classId) {
    if (scopedClassIds && !scopedClassIds.includes(id(filters.classId))) throw fail(user.role === 'teacher' || user.role === 'student' ? 403 : 404, 'Class is outside the selected report scope')
    classQuery._id = filters.classId
  } else if (scopedClassIds) classQuery._id = { $in: scopedClassIds }
  if (filters.departmentId) classQuery.department = filters.departmentId
  if (filters.facultyId) {
    const departments = await Department.find({ faculty: filters.facultyId }).distinct('_id')
    classQuery.department = classQuery.department ? { $in: departments.filter((dep) => id(dep) === id(classQuery.department)) } : { $in: departments }
  }
  const classes = await Class.find(classQuery).select('_id name classCode department').populate({ path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } }).sort({ name: 1 }).lean()
  if (filters.classId && !classes.some((item) => id(item) === id(filters.classId))) throw fail(404, 'Class not found')
  return classes
}

const within = (field, range) => range ? { [field]: range } : {}
const paged = (query, defaultLimit = 25) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit))
  return { page, limit, skip: (page - 1) * limit }
}

function populationFilter(filters, key) {
  const match = {}
  if (filters[key]) match._id = filters[key]
  return match
}

async function aggregatePerformance(studentIds, assignmentIds, quizIds, dateRange) {
  if (!studentIds.length) return new Map()
  const [assignments, quizzes] = await Promise.all([
    assignmentIds.length ? Submission.aggregate([
      { $match: { student: { $in: studentIds }, assignment: { $in: assignmentIds }, ...within('submittedAt', dateRange), $or: [{ marksAwarded: { $ne: null } }, { score: { $ne: null } }] } },
      { $lookup: { from: 'assignments', localField: 'assignment', foreignField: '_id', as: 'assignmentDoc' } },
      { $unwind: '$assignmentDoc' },
      { $project: { student: 1, ratio: { $multiply: [{ $divide: [{ $ifNull: ['$marksAwarded', '$score'] }, { $ifNull: ['$assignmentDoc.totalMarks', '$assignmentDoc.maxScore'] }] }, 100] } } },
      { $group: { _id: '$student', average: { $avg: '$ratio' }, graded: { $sum: 1 } } },
    ]) : [],
    quizIds.length ? QuizAttempt.aggregate([
      { $match: { student: { $in: studentIds }, quiz: { $in: quizIds }, status: 'graded', score: { $ne: null }, gradedAt: { $ne: null }, ...within('submittedAt', dateRange) } },
      { $project: { student: 1, ratio: { $multiply: [{ $divide: ['$score', '$maxScore'] }, 100] } } },
      { $group: { _id: '$student', average: { $avg: '$ratio' }, graded: { $sum: 1 } } },
    ]) : [],
  ])
  const map = new Map()
  for (const record of assignments) map.set(id(record._id), { assignmentAverage: Math.round(record.average * 10) / 10, gradedAssignments: record.graded, quizAverage: null, gradedQuizzes: 0 })
  for (const record of quizzes) {
    const item = map.get(id(record._id)) || { assignmentAverage: null, gradedAssignments: 0, quizAverage: null, gradedQuizzes: 0 }
    item.quizAverage = Math.round(record.average * 10) / 10
    item.gradedQuizzes = record.graded
    map.set(id(record._id), item)
  }
  for (const item of map.values()) {
    item.overallAverage = combinedAverage(item.assignmentAverage, item.gradedAssignments, item.quizAverage, item.gradedQuizzes)
  }
  return map
}

async function detailForStudent(studentId, filters, classes) {
  const student = await User.findOne({ _id: studentId, role: 'student' }).select('fullName studentId class isActive createdAt').populate({ path: 'class', select: 'name classCode department', populate: { path: 'department', select: 'name code faculty', populate: { path: 'faculty', select: 'name code' } } }).lean()
  if (!student || !classes.some((item) => id(item) === id(student.class))) throw fail(404, 'Student report not found')
  const assignmentQuery = { class: student.class._id, ...publishedStatus, ...populationFilter(filters, 'assignmentId'), ...within('createdAt', filters.date) }
  const quizQuery = { class: student.class._id, ...publishedStatus, ...populationFilter(filters, 'quizId'), ...within('createdAt', filters.date) }
  const [assignments, quizzes] = await Promise.all([
    Assignment.find(assignmentQuery).select('title dueDate totalMarks maxScore createdAt').sort({ dueDate: -1 }).lean(),
    Quiz.find(quizQuery).select('title totalMarks createdAt showResults').sort({ createdAt: -1 }).lean(),
  ])
  const [submissions, attempts] = await Promise.all([
    Submission.find({ student: student._id, assignment: { $in: assignments.map((item) => item._id) } }).select('assignment status submittedAt marksAwarded score feedback gradedAt').lean(),
    QuizAttempt.find({ student: student._id, quiz: { $in: quizzes.map((item) => item._id) }, ...within('submittedAt', filters.date) }).select('quiz status submittedAt score maxScore gradedAt').sort({ submittedAt: -1 }).lean(),
  ])
  const submissionMap = new Map(submissions.map((item) => [id(item.assignment), item]))
  const attemptMap = new Map()
  for (const attempt of attempts) { const list = attemptMap.get(id(attempt.quiz)) || []; list.push(attempt); attemptMap.set(id(attempt.quiz), list) }
  const assignmentRows = assignments.map((assignment) => {
    const submission = submissionMap.get(id(assignment._id))
    const marks = submission?.marksAwarded ?? submission?.score
    const graded = Number.isFinite(marks)
    return { id: assignment._id, title: assignment.title, dueDate: assignment.dueDate, status: !submission ? 'missing' : graded ? 'graded' : 'submitted', gradingStatus: submission && !graded ? 'pending' : null, submittedAt: submission?.submittedAt || null, marksAwarded: graded ? marks : null, totalMarks: assignment.totalMarks || assignment.maxScore, gradedAt: submission?.gradedAt || null }
  })
  const quizRows = quizzes.map((quiz) => {
    const list = attemptMap.get(id(quiz._id)) || []
    const complete = list.filter((attempt) => ['submitted', 'auto_submitted', 'graded'].includes(attempt.status))
    const graded = list.filter((attempt) => attempt.status === 'graded' && attempt.score != null && attempt.gradedAt)
    const visible = quiz.showResults && graded.length > 0
    return { id: quiz._id, title: quiz.title, status: !complete.length ? list.length ? 'in_progress' : 'not_started' : graded.length ? 'graded' : 'pending', attempts: complete.length, score: visible ? graded[0].score : null, maxScore: visible ? graded[0].maxScore : null, submittedAt: complete[0]?.submittedAt || null }
  })
  const gradedAssignments = assignmentRows.filter((item) => item.status === 'graded')
  const gradedQuizzes = quizRows.filter((item) => item.status === 'graded' && item.score != null && item.maxScore)
  const assignmentAverage = average(gradedAssignments.map((item) => (item.marksAwarded / item.totalMarks) * 100))
  const quizAverage = average(gradedQuizzes.map((item) => (item.score / item.maxScore) * 100))
  return { student: { id: student._id, fullName: student.fullName, studentId: student.studentId, class: student.class, isActive: student.isActive }, assignments: assignmentRows, quizzes: quizRows, summary: { assignmentAverage, quizAverage, overallPerformance: combinedAverage(assignmentAverage, gradedAssignments.length, quizAverage, gradedQuizzes.length), submittedAssignments: assignmentRows.filter((item) => item.status === 'submitted' || item.status === 'graded').length, missingAssignments: assignmentRows.filter((item) => item.status === 'missing').length, gradedAssignments: gradedAssignments.length, pendingAssignments: assignmentRows.filter((item) => item.gradingStatus === 'pending').length, completedQuizzes: quizRows.filter((item) => ['pending', 'graded'].includes(item.status)).length } }
}

function average(values) { const valid = values.filter(Number.isFinite); return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length * 10) / 10 : null }
function combinedAverage(assignmentAverage, assignmentCount, quizAverage, quizCount) {
  const count = assignmentCount + quizCount
  return count ? Math.round(((assignmentAverage || 0) * assignmentCount + (quizAverage || 0) * quizCount) / count * 10) / 10 : null
}

async function reportData(req, filters = parseFilters(req.query)) {
  const classes = await classScope(req.user, filters)
  const classIds = classes.map((item) => item._id)
  const studentQuery = { role: 'student', class: { $in: classIds } }
  if (filters.studentId) studentQuery._id = filters.studentId
  const assignmentQuery = { class: { $in: classIds }, ...publishedStatus, ...populationFilter(filters, 'assignmentId'), ...within('createdAt', filters.date) }
  const quizQuery = { class: { $in: classIds }, ...publishedStatus, ...populationFilter(filters, 'quizId'), ...within('createdAt', filters.date) }
  if (req.user.role === 'admin' && filters.teacherId) {
    assignmentQuery.createdBy = filters.teacherId
    quizQuery.createdBy = filters.teacherId
  }
  const [students, assignments, quizzes, lessonCount, lessonCounts, totalFaculties, totalDepartments] = await Promise.all([
    User.find(studentQuery).select('fullName studentId class isActive createdAt').sort({ fullName: 1 }).lean(),
    Assignment.find(assignmentQuery).select('title class createdBy createdAt dueDate totalMarks maxScore').lean(),
    Quiz.find(quizQuery).select('title class createdBy createdAt totalMarks showResults').lean(),
    Lesson.countDocuments({ class: { $in: classIds }, isPublished: true, ...within('createdAt', filters.date) }),
    Lesson.aggregate([{ $match: { class: { $in: classIds }, isPublished: true, ...within('createdAt', filters.date) } }, { $group: { _id: '$class', count: { $sum: 1 } } }]),
    req.user.role === 'admin' ? Faculty.countDocuments(filters.facultyId ? { _id: filters.facultyId } : {}) : Promise.resolve(0),
    req.user.role === 'admin' ? Department.countDocuments(filters.departmentId ? { _id: filters.departmentId } : filters.facultyId ? { faculty: filters.facultyId } : {}) : Promise.resolve(0),
  ])
  const studentIds = students.map((item) => item._id)
  const assignmentIds = assignments.map((item) => item._id)
  const quizIds = quizzes.map((item) => item._id)
  const [submissions, attempts, performance] = await Promise.all([
    assignmentIds.length ? Submission.find({ assignment: { $in: assignmentIds }, student: { $in: studentIds }, ...within('submittedAt', filters.date) }).select('assignment student status submittedAt marksAwarded score gradedAt').lean() : [],
    quizIds.length ? QuizAttempt.find({ quiz: { $in: quizIds }, student: { $in: studentIds }, ...within('submittedAt', filters.date) }).select('quiz student status submittedAt score maxScore gradedAt').lean() : [],
    aggregatePerformance(studentIds, assignmentIds, quizIds, filters.date),
  ])
  const subByAssignment = new Map()
  for (const item of submissions) { const list = subByAssignment.get(id(item.assignment)) || []; list.push(item); subByAssignment.set(id(item.assignment), list) }
  const attemptsByQuiz = new Map()
  for (const item of attempts) { const list = attemptsByQuiz.get(id(item.quiz)) || []; list.push(item); attemptsByQuiz.set(id(item.quiz), list) }
  const rosterByClass = new Map()
  for (const student of students) { const list = rosterByClass.get(id(student.class)) || []; list.push(student); rosterByClass.set(id(student.class), list) }
  const classRows = classes.map((item) => {
    const roster = rosterByClass.get(id(item)) || []
    const rosterIds = new Set(roster.map((student) => id(student)))
    const classAssignments = assignments.filter((assignment) => id(assignment.class) === id(item))
    const classQuizzes = quizzes.filter((quiz) => id(quiz.class) === id(item))
    const relevantSubs = classAssignments.flatMap((assignment) => subByAssignment.get(id(assignment)) || []).filter((submission) => rosterIds.has(id(submission.student)))
    const gradedSubs = relevantSubs.filter((submission) => submission.marksAwarded != null || submission.score != null)
    const relevantAttempts = classQuizzes.flatMap((quiz) => attemptsByQuiz.get(id(quiz)) || []).filter((attempt) => rosterIds.has(id(attempt.student)))
    const gradedAttempts = relevantAttempts.filter((attempt) => attempt.status === 'graded' && attempt.score != null && attempt.gradedAt)
    const expected = roster.length * classAssignments.length
    return { _id: item._id, name: item.name, classCode: item.classCode, department: item.department, studentCount: roster.length, lessons: lessonCounts.find((record) => id(record._id) === id(item))?.count || 0, assignments: classAssignments.length, submittedAssignments: relevantSubs.length, gradedAssignments: gradedSubs.length, missingSubmissions: Math.max(0, expected - relevantSubs.length), submissionRate: expected ? Math.round(relevantSubs.length / expected * 100) : null, assignmentAverage: average(gradedSubs.map((submission) => { const assignment = classAssignments.find((a) => id(a) === id(submission.assignment)); return ((submission.marksAwarded ?? submission.score) / (assignment?.totalMarks || assignment?.maxScore || 1)) * 100 })), quizzes: classQuizzes.length, quizParticipation: relevantAttempts.filter((item) => ['submitted', 'auto_submitted', 'graded'].includes(item.status)).length, quizAverage: average(gradedAttempts.map((item) => item.score / item.maxScore * 100)) }
  })
  const gradeValues = submissions.filter((item) => item.marksAwarded != null || item.score != null).map((item) => { const assignment = assignments.find((a) => id(a) === id(item.assignment)); return ((item.marksAwarded ?? item.score) / (assignment?.totalMarks || assignment?.maxScore || 1)) * 100 })
  const gradedAttemptRows = attempts.filter((item) => item.status === 'graded' && item.score != null && item.gradedAt)
  const totalAssignmentCount = await Assignment.countDocuments({ class: { $in: classIds }, ...(req.user.role === 'admin' && filters.teacherId ? { createdBy: filters.teacherId } : {}), ...populationFilter(filters, 'assignmentId'), ...within('createdAt', filters.date) })
  const assignmentAverage = average(gradeValues)
  const quizAverage = average(gradedAttemptRows.map((item) => item.score / item.maxScore * 100))
  const activeStudents = students.filter((item) => item.isActive).length
  let teacherQuery = { role: 'teacher' }
  if (filters.teacherId) teacherQuery._id = filters.teacherId
  if (filters.departmentId) teacherQuery.department = filters.departmentId
  else if (filters.facultyId) teacherQuery.department = { $in: await Department.find({ faculty: filters.facultyId }).distinct('_id') }
  const teachersCount = req.user.role === 'admin' ? await User.countDocuments(teacherQuery) : 0
  const missingTotal = classRows.reduce((sum, item) => sum + item.missingSubmissions, 0)
  return { filters, classes: classRows, students, assignments, quizzes, submissions, attempts, performance, metrics: { students: students.length, activeStudents, inactiveStudents: students.length - activeStudents, teachers: teachersCount, faculties: totalFaculties, departments: totalDepartments, classes: classes.length, lessons: lessonCount, assignments: totalAssignmentCount, totalQuizAttempts: attempts.length, submittedAssignments: submissions.length, missingSubmissions: missingTotal, assignmentAverage, quizAverage, overallPerformance: combinedAverage(assignmentAverage, gradeValues.length, quizAverage, gradedAttemptRows.length) }, classDirectory: classes }
}

export async function adminAnalyticsOverview(req, res) {
  const data = await reportData(req)
  const departmentIds = data.filters.facultyId ? await Department.find({ faculty: data.filters.facultyId }).distinct('_id') : null
  const teacherDepartmentFilter = data.filters.departmentId ? data.filters.departmentId : departmentIds ? { $in: departmentIds } : undefined
  const [byFaculty, byDepartment, teachersByDepartment, classesByDepartment, registrations, recentSubmissions, quizParticipation] = await Promise.all([
    User.aggregate([{ $match: { role: 'student', class: { $in: data.classDirectory.map((item) => item._id) }, ...(data.filters.studentId ? { _id: data.filters.studentId } : {}) } }, { $lookup: { from: 'classes', localField: 'class', foreignField: '_id', as: 'class' } }, { $unwind: '$class' }, { $lookup: { from: 'departments', localField: 'class.department', foreignField: '_id', as: 'department' } }, { $unwind: '$department' }, { $group: { _id: '$department.faculty', students: { $sum: 1 } } }, { $lookup: { from: 'faculties', localField: '_id', foreignField: '_id', as: 'faculty' } }, { $unwind: '$faculty' }, { $project: { _id: 1, name: '$faculty.name', students: 1 } }, { $sort: { students: -1 } }]),
    User.aggregate([{ $match: { role: 'student', class: { $in: data.classDirectory.map((item) => item._id) }, ...(data.filters.studentId ? { _id: data.filters.studentId } : {}) } }, { $lookup: { from: 'classes', localField: 'class', foreignField: '_id', as: 'class' } }, { $unwind: '$class' }, { $group: { _id: '$class.department', students: { $sum: 1 } } }, { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'department' } }, { $unwind: '$department' }, { $project: { _id: 1, name: '$department.name', students: 1 } }, { $sort: { students: -1 } }]),
    User.aggregate([{ $match: { role: 'teacher', ...(data.filters.teacherId ? { _id: data.filters.teacherId } : {}), ...(teacherDepartmentFilter ? { department: teacherDepartmentFilter } : {}) } }, { $group: { _id: '$department', teachers: { $sum: 1 } } }, { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'department' } }, { $unwind: '$department' }, { $project: { _id: 1, name: '$department.name', teachers: 1 } }, { $sort: { teachers: -1 } }]),
    Class.aggregate([{ $match: { _id: { $in: data.classDirectory.map((item) => item._id) } } }, { $group: { _id: '$department', classes: { $sum: 1 } } }, { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'department' } }, { $unwind: '$department' }, { $project: { _id: 1, name: '$department.name', classes: 1 } }, { $sort: { classes: -1 } }]),
    User.aggregate([{ $match: { role: 'student', class: { $in: data.classDirectory.map((item) => item._id) }, ...(data.filters.studentId ? { _id: data.filters.studentId } : {}), ...within('createdAt', data.filters.date) } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, registrations: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Submission.aggregate([
      { $match: { assignment: { $in: data.assignments.map((item) => item._id) }, ...(data.filters.studentId ? { student: data.filters.studentId } : {}), ...within('submittedAt', data.filters.date) } },
      { $lookup: { from: 'assignments', localField: 'assignment', foreignField: '_id', as: 'assignmentDoc' } },
      { $unwind: '$assignmentDoc' },
      { $addFields: { month: { $dateToString: { format: '%Y-%m', date: '$submittedAt' } }, marks: { $ifNull: ['$marksAwarded', '$score'] }, total: { $ifNull: ['$assignmentDoc.totalMarks', '$assignmentDoc.maxScore'] } } },
      { $group: { _id: '$month', submissions: { $sum: 1 }, graded: { $sum: { $cond: [{ $ne: ['$marks', null] }, 1, 0] } }, average: { $avg: { $cond: [{ $ne: ['$marks', null] }, { $multiply: [{ $divide: ['$marks', '$total'] }, 100] }, null] } } } },
      { $sort: { _id: 1 } },
    ]),
    QuizAttempt.aggregate([
      { $match: { quiz: { $in: data.quizzes.map((item) => item._id) }, submittedAt: { $ne: null, ...(data.filters.date || {}) }, ...(data.filters.studentId ? { student: data.filters.studentId } : {}) } },
      { $addFields: { month: { $dateToString: { format: '%Y-%m', date: '$submittedAt' } } } },
      { $group: { _id: '$month', attempts: { $sum: 1 }, graded: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'graded'] }, { $ne: ['$score', null] }, { $ne: ['$gradedAt', null] }] }, 1, 0] } }, average: { $avg: { $cond: [{ $and: [{ $eq: ['$status', 'graded'] }, { $ne: ['$score', null] }, { $ne: ['$gradedAt', null] }] }, { $multiply: [{ $divide: ['$score', '$maxScore'] }, 100] }, null] } } } },
      { $sort: { _id: 1 } },
    ]),
  ])
  const byClass = data.classes.map((item) => ({ _id: item._id, name: item.name, students: item.studentCount }))
  const departmentActivityMap = new Map()
  for (const item of data.classes) {
    const departmentId = id(item.department)
    const current = departmentActivityMap.get(departmentId) || { name: item.department?.name || 'Department', assignments: 0, quizzes: 0, submitted: 0, missing: 0 }
    current.assignments += item.assignments; current.quizzes += item.quizzes; current.submitted += item.submittedAssignments; current.missing += item.missingSubmissions
    departmentActivityMap.set(departmentId, current)
  }
  const departmentAcademicActivity = [...departmentActivityMap.values()]
  return res.json({ success: true, metrics: data.metrics, studentsByFaculty: byFaculty, studentsByDepartment: byDepartment, studentsByClass: byClass, teachersByDepartment, classesByDepartment, departmentAcademicActivity, academicActivityByFaculty: byFaculty.map((faculty) => ({ name: faculty.name, students: faculty.students, assignments: data.classes.filter((item) => id(item.department?.faculty) === id(faculty._id)).reduce((sum, item) => sum + item.assignments, 0), quizzes: data.classes.filter((item) => id(item.department?.faculty) === id(faculty._id)).reduce((sum, item) => sum + item.quizzes, 0) })), registrationTrend: registrations, assignmentSubmissionTrend: recentSubmissions, quizParticipationTrend: quizParticipation, performanceTrend: [...new Set([...recentSubmissions.map((item) => item._id), ...quizParticipation.map((item) => item._id)])].sort().map((month) => ({ month, assignments: recentSubmissions.find((item) => item._id === month)?.average ?? null, quizzes: quizParticipation.find((item) => item._id === month)?.average ?? null })), classes: data.classes })
}

export async function adminAnalyticsDirectory(req, res) {
  const type = req.params.type
  const filters = parseFilters(req.query)
  const { page, limit, skip } = paged(req.query)
  let Model = { students: User, teachers: User, faculties: Faculty, departments: Department, classes: Class, assignments: Assignment, quizzes: Quiz }[type]
  if (!Model) throw fail(404, 'Report type not found')
  let query = {}
  if (['students', 'teachers'].includes(type)) query.role = type === 'students' ? 'student' : 'teacher'
  const scopeClasses = await classScope({ role: 'admin' }, filters)
  if (type === 'students') query.class = { $in: scopeClasses.map((item) => item._id) }
  if (type === 'students' && filters.departmentId) query.department = filters.departmentId
  if (type === 'teachers' && filters.departmentId) query.department = filters.departmentId
  if (type === 'teachers' && filters.facultyId) {
    const departmentIds = await Department.find({ faculty: filters.facultyId }).distinct('_id')
    query.department = { $in: departmentIds }
  }
  if (type === 'classes') query._id = { $in: scopeClasses.map((item) => item._id) }
  if (type === 'teachers' && filters.classId) query.assignedClasses = filters.classId
  if (type === 'assignments' || type === 'quizzes') {
    query.class = { $in: scopeClasses.map((item) => item._id) }
    Object.assign(query, publishedStatus)
    if (filters.teacherId) query.createdBy = filters.teacherId
  }
  if (type === 'assignments' && filters.assignmentId) query._id = filters.assignmentId
  if (type === 'quizzes' && filters.quizId) query._id = filters.quizId
  if (type === 'departments' && filters.facultyId) query.faculty = filters.facultyId
  if (type === 'classes' && filters.departmentId) query.department = filters.departmentId
  if (filters.studentId && type === 'students') query._id = filters.studentId
  const search = String(req.query.search || '').trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (search) {
    const searchOr = ['students', 'teachers'].includes(type) ? [{ fullName: new RegExp(search, 'i') }, { studentId: new RegExp(search, 'i') }] : [{ name: new RegExp(search, 'i') }, { code: new RegExp(search, 'i') }, { title: new RegExp(search, 'i') }]
    if (query.$or) { query.$and = [{ $or: query.$or }, { $or: searchOr }]; delete query.$or } else query.$or = searchOr
  }
  if (req.query.status === 'active') query.isActive = true
  if (req.query.status === 'inactive') query.isActive = false
  if (filters.date) query.createdAt = filters.date
  let finder = Model.find(query)
  if (['students', 'teachers'].includes(type)) finder = finder.select('fullName studentId role email isActive createdAt department class')
  if (type === 'departments') finder = finder.populate('faculty', 'name code')
  if (type === 'classes') finder = finder.populate('department', 'name code faculty')
  if (type === 'assignments') finder = finder.select('title class createdBy dueDate totalMarks maxScore status createdAt').populate('class', 'name classCode').populate('createdBy', 'fullName')
  if (type === 'quizzes') finder = finder.select('title class createdBy dueDate totalMarks status createdAt').populate('class', 'name classCode').populate('createdBy', 'fullName')
  const [records, total] = await Promise.all([finder.sort({ name: 1, fullName: 1 }).skip(skip).limit(limit).lean(), Model.countDocuments(query)])
  return res.json({ success: true, records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

export async function adminAnalyticsPerformance(req, res) {
  const filters = parseFilters(req.query)
  const classes = await classScope(req.user, filters)
  const classIds = classes.map((item) => item._id)
  const { page, limit, skip } = paged(req.query, 50)
  const query = { role: 'student', class: { $in: classIds }, ...populationFilter(filters, 'studentId') }
  const [students, total, assignments, quizzes] = await Promise.all([
    User.find(query).select('fullName studentId class isActive createdAt').sort({ fullName: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(query),
    Assignment.find({ class: { $in: classIds }, ...publishedStatus, ...populationFilter(filters, 'assignmentId'), ...within('createdAt', filters.date) }).select('_id').lean(),
    Quiz.find({ class: { $in: classIds }, ...publishedStatus, ...populationFilter(filters, 'quizId'), ...within('createdAt', filters.date) }).select('_id').lean(),
  ])
  const performance = await aggregatePerformance(students.map((item) => item._id), assignments.map((item) => item._id), quizzes.map((item) => item._id), filters.date)
  const records = students.map((student) => ({ student, ...(performance.get(id(student)) || { assignmentAverage: null, quizAverage: null, overallAverage: null, gradedAssignments: 0, gradedQuizzes: 0 }) }))
  return res.json({ success: true, records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

export async function teacherAnalyticsOverview(req, res) {
  const data = await reportData(req)
  return res.json({ success: true, metrics: data.metrics, classes: data.classes })
}

export async function teacherAnalyticsClass(req, res) {
  const filters = parseFilters({ ...req.query, classId: req.params.classId })
  const data = await reportData(req, filters)
  const classReport = data.classes[0]
  const { page, limit, skip } = paged(req.query, 50)
  const sorted = data.students.map((student) => ({ student: { id: student._id, fullName: student.fullName, studentId: student.studentId }, ...(data.performance.get(id(student)) || { assignmentAverage: null, quizAverage: null, overallAverage: null, gradedAssignments: 0, gradedQuizzes: 0 }) })).sort((a, b) => (b.overallAverage ?? -1) - (a.overallAverage ?? -1))
  const trendMap = new Map()
  for (const submission of data.submissions) {
    const month = submission.submittedAt?.toISOString().slice(0, 7)
    if (!month) continue
    const current = trendMap.get(month) || { month, assignmentCount: 0, assignmentTotal: 0, quizCount: 0, quizTotal: 0 }
    const marks = submission.marksAwarded ?? submission.score
    if (marks != null) {
      const assignment = data.assignments.find((item) => id(item) === id(submission.assignment))
      current.assignmentCount += 1
      current.assignmentTotal += Number(marks) / (assignment?.totalMarks || assignment?.maxScore || 1) * 100
    }
    trendMap.set(month, current)
  }
  for (const attempt of data.attempts) {
    const month = attempt.submittedAt?.toISOString().slice(0, 7)
    if (!month) continue
    const current = trendMap.get(month) || { month, assignmentCount: 0, assignmentTotal: 0, quizCount: 0, quizTotal: 0 }
    if (attempt.status === 'graded' && attempt.score != null && attempt.gradedAt) { current.quizCount += 1; current.quizTotal += Number(attempt.score) / Number(attempt.maxScore || 1) * 100 }
    trendMap.set(month, current)
  }
  const performanceTrend = [...trendMap.values()].sort((a, b) => a.month.localeCompare(b.month)).map((item) => ({ month: item.month, assignmentAverage: item.assignmentCount ? Math.round(item.assignmentTotal / item.assignmentCount * 10) / 10 : null, quizAverage: item.quizCount ? Math.round(item.quizTotal / item.quizCount * 10) / 10 : null }))
  return res.json({ success: true, class: classReport, performanceTrend, topStudents: sorted.filter((item) => item.overallAverage != null).slice(0, 5), attentionStudents: sorted.filter((item) => item.overallAverage != null && item.overallAverage < 50), students: sorted.slice(skip, skip + limit), pagination: { page, limit, total: data.students.length, pages: Math.ceil(data.students.length / limit) } })
}

export async function teacherAnalyticsStudent(req, res) {
  if (!mongoose.isValidObjectId(req.params.studentId)) throw fail(400, 'A valid student ID is required')
  const filters = parseFilters(req.query)
  const classes = await classScope(req.user, filters)
  return res.json({ success: true, ...(await detailForStudent(req.params.studentId, filters, classes)) })
}

export async function studentAnalyticsPerformance(req, res) {
  const filters = parseFilters(req.query)
  filters.studentId = req.user._id
  const classes = await classScope(req.user, filters)
  return res.json({ success: true, ...(await detailForStudent(req.user._id, filters, classes)) })
}

function escapeCell(value) { return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/,/g, ';') }
function exportRows(data, role) {
  if (role === 'student') {
    return [['Category', 'Title', 'Status', 'Score', 'Maximum', 'Date'], ...data.assignments.map((item) => ['Assignment', item.title, item.status, item.marksAwarded, item.totalMarks, item.submittedAt]), ...data.quizzes.map((item) => ['Quiz', item.title, item.status, item.score, item.maxScore, item.submittedAt])]
  }
  return [['Student', 'Student ID', 'Class', 'Assignment average %', 'Quiz average %', 'Overall %', 'Graded assignments', 'Graded quizzes'], ...data.students.slice(0, 5000).map((item) => { const p = data.performance.get(id(item)) || {}; return [item.fullName, item.studentId, data.classDirectory.find((c) => id(c) === id(item.class))?.name || '', p.assignmentAverage, p.quizAverage, p.overallAverage, p.gradedAssignments, p.gradedQuizzes] })]
}

async function adminExportRows(data, report, filters) {
  if (report === 'classes') return [['Class', 'Class code', 'Department', 'Faculty', 'Students', 'Lessons', 'Assignments', 'Submission rate %', 'Missing submissions', 'Assignment average %', 'Quizzes', 'Quiz attempts', 'Quiz average %'], ...data.classes.slice(0, 5000).map((item) => [item.name, item.classCode, item.department?.name, item.department?.faculty?.name, item.studentCount, item.lessons, item.assignments, item.submissionRate, item.missingSubmissions, item.assignmentAverage, item.quizzes, item.quizParticipation, item.quizAverage])]
  if (report === 'faculties') {
    const records = await Faculty.find(filters.facultyId ? { _id: filters.facultyId } : {}).select('name code isActive createdAt').sort({ name: 1 }).limit(5000).lean()
    return [['Faculty', 'Code', 'Students'], ...records.map((item) => { const studentCount = data.students.filter((student) => { const academicClass = data.classDirectory.find((row) => id(row) === id(student.class)); return id(academicClass?.department?.faculty) === id(item._id) }).length; return [item.name, item.code, studentCount] })]
  }
  if (report === 'departments') {
    const query = filters.facultyId ? { faculty: filters.facultyId } : filters.departmentId ? { _id: filters.departmentId } : {}
    const records = await Department.find(query).populate('faculty', 'name').sort({ name: 1 }).limit(5000).lean()
    const teachers = await User.aggregate([{ $match: { role: 'teacher', department: { $in: records.map((item) => item._id) } } }, { $group: { _id: '$department', count: { $sum: 1 } } }])
    const teacherMap = new Map(teachers.map((item) => [id(item._id), item.count]))
    return [['Department', 'Faculty', 'Students', 'Classes', 'Teachers', 'Assignments', 'Assignment submissions', 'Quizzes', 'Quiz attempts'], ...records.map((item) => { const students = data.students.filter((student) => id(student.class) && id(data.classDirectory.find((row) => id(row) === id(student.class))?.department) === id(item._id)).length; const classes = data.classes.filter((row) => id(row.department) === id(item._id)); return [item.name, item.faculty?.name, students, classes.length, teacherMap.get(id(item._id)) || 0, classes.reduce((sum, row) => sum + row.assignments, 0), classes.reduce((sum, row) => sum + row.submittedAssignments, 0), classes.reduce((sum, row) => sum + row.quizzes, 0), classes.reduce((sum, row) => sum + row.quizParticipation, 0)] })]
  }
  if (report === 'teachers') {
    const query = { role: 'teacher' }
    if (filters.teacherId) query._id = filters.teacherId
    if (filters.departmentId) query.department = filters.departmentId
    else if (filters.facultyId) query.department = { $in: await Department.find({ faculty: filters.facultyId }).distinct('_id') }
    if (filters.classId) query.assignedClasses = filters.classId
    const records = await User.find(query).select('fullName email department assignedClasses isActive').populate('department', 'name').sort({ fullName: 1 }).limit(5000).lean()
    return [['Teacher', 'Email', 'Department', 'Assigned classes', 'Status'], ...records.map((item) => [item.fullName, item.email, item.department?.name, (item.assignedClasses || []).length, item.isActive ? 'Active' : 'Inactive'])]
  }
  return exportRows(data, 'admin')
}

export function createCsvExport(rows) {
  const safe = (value) => {
    let text = String(value ?? '')
    if (/^[=+@\t\r-]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  return `\uFEFF${rows.map((row) => row.map(safe).join(',')).join('\r\n')}`
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}

function zip(files) {
  const local = []; const central = []; let offset = 0
  for (const [name, content] of files) {
    const filename = Buffer.from(name); const data = Buffer.from(content); const crc = crc32(data)
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6); header.writeUInt16LE(0, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26)
    local.push(header, filename, data)
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42)
    central.push(directory, filename); offset += header.length + filename.length + data.length
  }
  const centralData = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, centralData, end])
}

export function createXlsxExport(rows) {
  const xml = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => { const col = String.fromCharCode(65 + c); const text = String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); return `<c r="${col}${r + 1}" t="inlineStr"><is><t>${text}</t></is></c>` }).join('')}</row>`).join('')
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="LMS Report" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xml}</sheetData></worksheet>`],
  ])
}

export function createPdfExport(rows, title) {
  const lines = [title, `Generated: ${new Date().toISOString()}`, '', ...rows.map((row) => row.join(' | '))]
  const escape = (value) => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1').slice(0, 160)
  const pageLines = Array.from({ length: Math.ceil(lines.length / 52) || 1 }, (_, index) => lines.slice(index * 52, (index + 1) * 52))
  const pageIds = pageLines.map((_, index) => 4 + index * 2)
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  pageLines.forEach((page, index) => {
    const pageId = pageIds[index]
    const contentId = pageId + 1
    const commands = page.map((line, lineIndex) => `BT /F1 ${lineIndex === 0 && index === 0 ? 12 : 9} Tf 40 ${790 - lineIndex * 14} Td (${escape(line)}) Tj ET`).join('\n')
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`)
  })
  let body = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(body); body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}

export function createStudentPerformancePdf(data) {
  const pages = []
  const escape = (value) => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1').slice(0, 110)
  const text = (value, x, y, size = 10, color = [0.12, 0.19, 0.28], bold = false) => `q ${color.join(' ')} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${escape(value)}) Tj ET Q`
  const rect = (x, y, width, height, color) => `q ${color.join(' ')} rg ${x} ${y} ${width} ${height} re f Q`
  const line = (x1, y1, x2, y2, color = [0.87, 0.9, 0.94]) => `q ${color.join(' ')} RG 0.7 w ${x1} ${y1} m ${x2} ${y2} l S Q`
  const pctValue = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : 'N/A'
  const summary = data.summary || {}
  const identity = data.student || {}
  const className = identity.class?.name || 'Class not set'
  const department = identity.class?.department?.name || ''
  const faculty = identity.class?.department?.faculty?.name || ''
  const titleColor = [0.06, 0.27, 0.35]
  const accent = [0.05, 0.57, 0.39]
  const pale = [0.94, 0.97, 0.98]
  const muted = [0.36, 0.43, 0.52]
  const commands = []

  commands.push(rect(0, 650, 612, 142, titleColor))
  commands.push(text('STUDENT ACADEMIC REPORT', 42, 752, 9, [0.62, 0.91, 0.82], true))
  commands.push(text('My Academic Performance', 42, 718, 24, [1, 1, 1], true))
  commands.push(text(identity.fullName || 'Student', 42, 691, 12, [1, 1, 1], true))
  commands.push(text(`Student ID: ${identity.studentId || 'N/A'}  |  Class: ${className}`, 42, 672, 9, [0.88, 0.94, 0.96]))
  commands.push(text([department, faculty].filter(Boolean).join('  |  ') || 'Academic profile', 42, 657, 8, [0.82, 0.9, 0.93]))
  commands.push(text(`Generated ${new Date().toISOString().slice(0, 10)}`, 435, 752, 8, [0.88, 0.94, 0.96]))

  const metrics = [
    ['ASSIGNMENT AVG.', pctValue(summary.assignmentAverage)],
    ['QUIZ AVG.', pctValue(summary.quizAverage)],
    ['OVERALL', pctValue(summary.overallPerformance)],
  ]
  metrics.forEach(([label, value], index) => {
    const x = 42 + index * 178
    commands.push(rect(x, 555, 164, 72, pale))
    commands.push(rect(x, 555, 4, 72, index === 1 ? [0.16, 0.63, 0.57] : accent))
    commands.push(text(label, x + 14, 605, 8, muted, true))
    commands.push(text(value, x + 14, 577, 19, titleColor, true))
  })

  commands.push(text('PERFORMANCE SNAPSHOT', 42, 522, 10, titleColor, true))
  const bars = [
    ['Assignments', summary.assignmentAverage],
    ['Quizzes', summary.quizAverage],
    ['Overall', summary.overallPerformance],
  ]
  bars.forEach(([label, value], index) => {
    const y = 486 - index * 37
    commands.push(text(label, 42, y + 4, 9, muted))
    commands.push(rect(140, y, 350, 12, [0.9, 0.93, 0.96]))
    const amount = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0
    if (amount) commands.push(rect(140, y, 350 * amount / 100, 12, index === 1 ? [0.16, 0.63, 0.57] : accent))
    commands.push(text(pctValue(value), 505, y + 2, 9, titleColor, true))
  })

  const submitted = Number(summary.submittedAssignments || 0)
  const missing = Number(summary.missingAssignments || 0)
  const assignmentTotal = submitted + missing
  commands.push(text('ASSIGNMENT PROGRESS', 42, 365, 10, titleColor, true))
  commands.push(rect(42, 338, 528, 13, [0.9, 0.93, 0.96]))
  if (assignmentTotal) {
    commands.push(rect(42, 338, 528 * submitted / assignmentTotal, 13, accent))
    commands.push(text(`${submitted} submitted`, 42, 320, 9, muted))
    commands.push(text(`${missing} missing`, 140, 320, 9, muted))
    commands.push(text(`${Number(summary.pendingAssignments || 0)} pending grades`, 238, 320, 9, muted))
  } else {
    commands.push(text('No assignment records yet', 42, 320, 9, muted))
  }

  commands.push(line(42, 298, 570, 298))
  commands.push(text('REPORT TOTALS', 42, 277, 10, titleColor, true))
  commands.push(text(`Assignments submitted: ${submitted}    Missing: ${missing}    Completed quizzes: ${Number(summary.completedQuizzes || 0)}`, 42, 257, 9, muted))
  commands.push(text('Scores include graded or released results only.', 42, 232, 8, muted))
  pages.push(commands.join('\n'))

  const results = [
    ...(data.assignments || []).map((item) => ({ category: 'Assignment', ...item })),
    ...(data.quizzes || []).map((item) => ({ category: 'Quiz', ...item })),
  ]
  const rowsPerPage = 30
  const chunks = Array.from({ length: Math.ceil(results.length / rowsPerPage) }, (_, index) => results.slice(index * rowsPerPage, (index + 1) * rowsPerPage))
  chunks.forEach((chunk, pageIndex) => {
    const pageCommands = [
      rect(0, 720, 612, 72, titleColor),
      text('RESULT DETAILS', 42, 758, 9, [0.62, 0.91, 0.82], true),
      text(`Assignments and quizzes  |  Page ${pageIndex + 2}`, 42, 735, 16, [1, 1, 1], true),
      rect(42, 686, 528, 24, pale),
      text('TYPE', 50, 695, 8, titleColor, true),
      text('ITEM', 125, 695, 8, titleColor, true),
      text('STATUS', 375, 695, 8, titleColor, true),
      text('SCORE', 500, 695, 8, titleColor, true),
    ]
    chunk.forEach((item, index) => {
      const y = 667 - index * 20
      const marks = item.marksAwarded ?? item.score
      const maximum = item.totalMarks ?? item.maxScore
      const score = marks == null || maximum == null ? '—' : `${marks}/${maximum}`
      const status = String(item.status || 'pending').replace(/_/g, ' ')
      pageCommands.push(line(42, y - 5, 570, y - 5, [0.92, 0.94, 0.96]))
      pageCommands.push(text(item.category, 50, y, 8, muted))
      pageCommands.push(text(String(item.title || 'Untitled').slice(0, 38), 125, y, 8, titleColor))
      pageCommands.push(text(status.slice(0, 18), 375, y, 8, muted))
      pageCommands.push(text(score, 500, y, 8, titleColor, true))
    })
    pages.push(pageCommands.join('\n'))
  })

  const pageIds = pages.map((_, index) => 5 + index * 2)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]
  pages.forEach((content, index) => {
    const pageId = pageIds[index]
    const contentId = pageId + 1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  })
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}

export async function exportAnalytics(req, res) {
  const data = req.user.role === 'student'
    ? await studentExportData(req)
    : await reportData(req)
  const report = ['performance', 'students', 'teachers', 'faculties', 'departments', 'classes'].includes(req.query.report) ? req.query.report : 'performance'
  let rows = req.user.role === 'admin' ? await adminExportRows(data, report, data.filters) : exportRows(data, req.user.role)
  if (rows.length > 5001) rows = rows.slice(0, 5001)
  const format = req.params.format
  const reportTitle = { performance: 'Performance', students: 'Students', teachers: 'Teachers', faculties: 'Faculties', departments: 'Departments', classes: 'Classes' }[report]
  const title = req.user.role === 'student' ? 'My Academic Performance' : req.user.role === 'teacher' ? 'Teaching Performance Report' : `${reportTitle || 'University'} Analytics Report`
  const stamp = new Date().toISOString().slice(0, 10)
  await recordAudit(req, { action: 'reports.exported', resourceType: 'report', metadata: { report, format, recordCount: Math.max(0, rows.length - 1) } })
  if (format === 'pdf' && req.user.role === 'student') return res.type('application/pdf').attachment(`my-academic-performance-${stamp}.pdf`).send(createStudentPerformancePdf(data))
  if (format === 'csv') return res.type('text/csv; charset=utf-8').attachment(`lms-report-${stamp}.csv`).send(createCsvExport([['Report', title], ['Generated', new Date().toISOString()], [], ...rows]))
  if (format === 'excel') return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`lms-report-${stamp}.xlsx`).send(createXlsxExport([['Report', title], ['Generated', new Date().toISOString()], [], ...rows]))
  if (format === 'pdf') return res.type('application/pdf').attachment(`lms-report-${stamp}.pdf`).send(createPdfExport(rows, title))
  throw fail(404, 'Unsupported report format')
}

async function studentExportData(req) {
  const filters = parseFilters(req.query)
  filters.studentId = req.user._id
  const classes = await classScope(req.user, filters)
  const detail = await detailForStudent(req.user._id, filters, classes)
  return { ...detail, students: [], performance: new Map(), classDirectory: classes }
}
